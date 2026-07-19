import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import basicAuth from 'express-basic-auth';
import { generateScript, generatePairCaptions } from '../scripts/generate-script';
import {
  generateRevealPhotos,
  generateBeforeImage,
  generateAfterFromBuffer,
  fetchImageAsGenerated,
  inventSubjects,
} from '../scripts/generate-reveal-photos';
import { generateTipContent } from '../scripts/generate-tip-content';
import { generateTipImages } from '../scripts/generate-tip-images';
import { uploadImageBuffer } from '../src/utils/storage';
import type { PhotoSubject } from '../scripts/lib/image-prompts';
import { generateMusicTrack as generateLyriaTrack, trimAudioFile } from '../src/utils/lyria';
import { generateMusicTrack as generateSunoTrack, downloadAndTrim } from '../src/utils/suno';
import { createRevealTiming, createTipsTiming, VIDEO } from '../src/config';
import { withRetry } from '../scripts/lib/retry';
import { uploadVideoTus } from '../scripts/lib/video-upload';
import { TikTokClient } from '../scripts/lib/tiktok-api';
import os from 'os';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthUrl,
  exchangeCodeForTokens,
  parseCallbackInput,
} from '../scripts/lib/tiktok-oauth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ROOT = path.resolve(__dirname, '..');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const app = express();
app.use(express.json());

// Basic auth for remote access (skipped for localhost)
if (process.env.DASHBOARD_USER && process.env.DASHBOARD_PASS) {
  app.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
    if (isLocal) return next();
    return basicAuth({
      users: { [process.env.DASHBOARD_USER!]: process.env.DASHBOARD_PASS! },
      challenge: true,
      realm: 'EternalFrame Dashboard',
    })(req, res, next);
  });
}

// Serve static assets (logo, etc.)
app.use('/static', express.static(path.join(ROOT, 'public')));

// Serve dashboard HTML
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// Content CRUD
// ============================================================

app.get('/api/content', async (_req, res) => {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/content/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

app.post('/api/content', async (req, res) => {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .insert(req.body)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.patch('/api/content/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/content/:id', async (req, res) => {
  const { error } = await supabase
    .from('tiktok_content_pool')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// Regenerate script for an item
app.post('/api/content/:id/regenerate', async (req, res) => {
  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, photo_era, photo_story, preset_used, tip_title, tip_body, tip_source, image_pairs')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  try {
    const imagePairs = item.image_pairs as Array<{ before_url: string; after_url: string; era?: string }> | null;
    const pairCount = imagePairs?.length || 1;

    const script = await generateScript({
      ...item,
      pair_count: pairCount,
      photo_stories: imagePairs?.map((p: { era?: string }, i: number) => `Pair ${i + 1}: ${p.era || 'unknown era'}`),
    });

    const { error: updateErr } = await supabase
      .from('tiktok_content_pool')
      .update({
        hook_text: script.hook_text,
        caption: script.caption,
        hashtags: script.hashtags,
        music_track: script.music_mood,
        music_style: script.music_style,
        slogan: script.slogan,
        status: 'scripted',
      })
      .eq('id', req.params.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    res.json({ ok: true, script });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Regenerate music for an item
app.post('/api/content/:id/regenerate-music', async (req, res) => {
  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, music_style, music_track, music_file_path, image_pairs, tips')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  // Allow overriding the music prompt from the request body
  const musicPrompt = req.body.music_style || item.music_style || item.music_track || 'warm nostalgic instrumental, gentle piano';

  // Calculate target duration
  const pairCount = (item.image_pairs as any[])?.length || 1;
  let durationMs: number;
  if (item.content_type === 'reveal') {
    const timing = createRevealTiming(pairCount);
    durationMs = Math.ceil(timing.totalDuration / VIDEO.fps * 1000);
  } else {
    const timing = createTipsTiming((item.tips as any[])?.length || 1);
    durationMs = Math.ceil(timing.totalDuration / VIDEO.fps * 1000);
  }

  const musicDir = path.join(ROOT, 'public/music');
  const musicFilename = `${item.id.slice(0, 8)}.mp3`;
  const outputPath = path.join(musicDir, musicFilename);
  const title = `EternalFrame - ${item.content_type} - ${item.id.slice(0, 8)}`;

  // Delete old music file if it exists
  if (item.music_file_path) {
    try { fs.unlinkSync(item.music_file_path); } catch {}
  }

  try {
    // Try Lyria first
    if (process.env.GOOGLE_API_KEY) {
      const { audioBuffer } = await generateLyriaTrack({
        prompt: musicPrompt,
        instrumental: true,
        title,
        durationSeconds: durationMs / 1000,
      });

      const rawPath = outputPath.replace(/\.mp3$/, '.raw.mp3');
      fs.mkdirSync(musicDir, { recursive: true });
      fs.writeFileSync(rawPath, audioBuffer);
      trimAudioFile({ inputPath: rawPath, targetDurationMs: durationMs, outputPath });
      try { fs.unlinkSync(rawPath); } catch {}
    } else if (process.env.SUNO_API_URL) {
      // Suno fallback
      const track = await generateSunoTrack({ prompt: musicPrompt, instrumental: true, title });
      await downloadAndTrim({ audioUrl: track.audioUrl, targetDurationMs: durationMs, outputPath });

      await supabase.from('tiktok_content_pool')
        .update({ suno_audio_url: track.audioUrl })
        .eq('id', item.id);
    } else {
      return res.status(400).json({ error: 'No music provider configured (GOOGLE_API_KEY or SUNO_API_URL)' });
    }

    // Update DB
    const updateFields: Record<string, any> = { music_file_path: outputPath };
    if (req.body.music_style) updateFields.music_style = req.body.music_style;

    await supabase.from('tiktok_content_pool')
      .update(updateFields)
      .eq('id', item.id);

    res.json({ ok: true, music_file_path: outputPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Re-render video for an item (resets to scripted, triggers pipeline)
app.post('/api/content/:id/re-render', async (req, res) => {
  if (pipelineRunning) {
    return res.status(409).json({ error: 'Pipeline is already running' });
  }

  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('id, status')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  // Reset status to scripted so pipeline processes from step 3 (music) onward
  const { error: updateErr } = await supabase
    .from('tiktok_content_pool')
    .update({
      status: 'scripted',
      video_url: null,
      publish_status: null,
      post_error: null,
      tiktok_post_id: null,
    })
    .eq('id', req.params.id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Optionally clear music to force regeneration
  if (req.body.regenerateMusic) {
    await supabase.from('tiktok_content_pool')
      .update({ music_file_path: null, suno_audio_url: null })
      .eq('id', req.params.id);
  }

  // Kick off the pipeline for this specific item (dry run — no TikTok posting)
  const runId = await runPipeline({ dryRun: true, contentId: req.params.id });
  res.json({ ok: true, runId });
});

// ============================================================
// Stats & Schedule
// ============================================================

app.get('/api/stats', async (_req, res) => {
  const { data, error } = await supabase
    .from('content_pipeline_stats')
    .select('*');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/schedule', async (_req, res) => {
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, status, hook_text, scheduled_for')
    .not('scheduled_for', 'is', null)
    .order('scheduled_for', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ============================================================
// Photo upload & AI analysis
// ============================================================

// 15MB ceiling — well above the ~1MB the client uploads after compression,
// but tolerant of edge cases (e.g. Chrome on Android receiving a HEIC it can't
// decode in canvas and falling back to the raw file).
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });

function uploadHandler(req: express.Request, res: express.Response, next: express.NextFunction) {
  upload.single('photo')(req, res, (err: unknown) => {
    if (err) {
      const isMulterErr = err && typeof err === 'object' && 'code' in err;
      const code = isMulterErr ? (err as { code?: string }).code : null;
      if (code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large (max ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB)` });
      }
      const msg = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

app.post('/api/upload-photo', uploadHandler, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const storagePath = `uploads/${filename}`;

  // The supabase-js storage upload uses a single fetch with no retry;
  // residential uplinks occasionally fail with a generic "fetch failed".
  // Retry transient errors and abort each attempt at 30s so a hung TCP
  // socket doesn't hold the request open until the proxy 502s.
  try {
    await withRetry(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const { error } = await supabase.storage
            .from('photos')
            .upload(storagePath, file.buffer, {
              contentType: file.mimetype,
              upsert: false,
              // @ts-expect-error storage-js accepts AbortSignal at runtime, types lag
              signal: controller.signal,
            });
          if (error) throw new Error(error.message);
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxRetries: 2,
        baseDelayMs: 500,
        maxDelayMs: 4000,
        onAttempt: (attempt, err, nextDelayMs) => {
          console.log(`[upload-photo] attempt ${attempt} failed (${err.message}); retrying in ${Math.round(nextDelayMs)}ms`);
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `Storage upload failed after retries: ${msg}` });
  }

  const { data: { publicUrl } } = supabase.storage.from('photos').getPublicUrl(storagePath);
  res.json({ url: publicUrl });
});

// ============================================================
// External videos (pre-rendered MP4s, e.g. studio-ops output)
// ============================================================
// An external item is born rendered: status='rendered' + video_url +
// scheduled_for. The existing per-minute scheduler posts it at its time via
// the pipeline's post-only short-circuit — no new posting machinery.

// Disk storage: videos are up to ~50MB (300MB cap for headroom); streaming to a
// temp file avoids buffering them in memory and TUS needs a file path anyway.
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const videoUpload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: VIDEO_MAX_BYTES },
});

// Token-row ids for the account dropdown ('default' = @huybuilds).
app.get('/api/tiktok/accounts', async (_req, res) => {
  const { data, error } = await supabase.from('tiktok_tokens').select('id').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map((r) => r.id));
});

app.post('/api/external-video', (req, res) => {
  videoUpload.single('video')(req, res, async (err: unknown) => {
    const file = req.file;
    const cleanup = () => { if (file) fs.unlink(file.path, () => {}); };
    try {
      if (err) {
        const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : null;
        if (code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `File too large (max ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)}MB)` });
        }
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
      }
      if (!file) return res.status(400).json({ error: 'No video file provided' });

      const { caption = '', hashtags = '', account = 'default', scheduledFor } = req.body;
      if (!scheduledFor || Number.isNaN(new Date(scheduledFor).getTime())) {
        return res.status(400).json({ error: 'scheduledFor (ISO datetime) is required' });
      }

      // "#nails, fresh set" -> ['nails', 'fresh', 'set'] (post caption re-adds the #)
      const tags = String(hashtags)
        .split(/[\s,]+/)
        .map((t: string) => t.replace(/^#/, '').trim())
        .filter(Boolean);

      const safeName = path.basename(file.originalname).replace(/[^\w.-]/g, '_');
      const storagePath = `tiktok-videos/external-${Date.now()}-${safeName}`;
      await uploadVideoTus(file.path, storagePath, file.size);
      const { data: { publicUrl } } = supabase.storage.from('videos').getPublicUrl(storagePath);

      const { data, error } = await supabase
        .from('tiktok_content_pool')
        .insert({
          content_type: 'external',
          status: 'rendered',
          video_url: `${publicUrl}?v=${Date.now()}`,
          caption: String(caption),
          hashtags: tags,
          tiktok_account: account === 'default' ? null : String(account),
          scheduled_for: new Date(scheduledFor).toISOString(),
          // First caption line (or filename) so pool/schedule lists have a label
          hook_text: String(caption).split('\n')[0].slice(0, 120) || safeName,
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      res.status(201).json(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({ error: `Video upload failed: ${msg}` });
    } finally {
      cleanup();
    }
  });
});

const anthropic = new Anthropic();

app.post('/api/analyze-photos', async (req, res) => {
  const { beforeUrl, afterUrl } = req.body;
  if (!beforeUrl || !afterUrl) return res.status(400).json({ error: 'Both beforeUrl and afterUrl are required' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: 'You are a photo restoration expert analyzing before/after photo pairs for the EternalFrame app. Respond ONLY with valid JSON.',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: beforeUrl },
          },
          {
            type: 'image',
            source: { type: 'url', url: afterUrl },
          },
          {
            type: 'text',
            text: `Analyze these two photos. The first is a damaged/old photo ("before") and the second is the AI-restored version ("after").

Return ONLY valid JSON:
{
  "photo_era": "estimated decade, e.g. '1960s'",
  "photo_story": "2-3 sentence description of what the photo shows, who might be in it, the emotional context, and what kind of damage/aging was present. Write in third person as if describing someone else's family photo.",
  "preset_used": "best guess at the restoration technique used, one of: 'photo-restoration', 'vintage-colorize', 'face-restoration', 'damage-repair', 'full-enhancement'"
}`,
          },
        ],
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const clean = text.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Coerce an untrusted request value into the generation_meta `source` union.
function normalizeSource(v: unknown): 'curated' | 'ai' | 'manual' | undefined {
  return v === 'curated' || v === 'ai' || v === 'manual' ? v : undefined;
}

// Suggest a fresh theme/hint (and damage notes for reveals) via Claude — the
// "✨" button in the Generate panels. Cheap, low-token; the UI falls back to
// curated suggestions if this fails or the key is missing.
app.post('/api/suggest-generation-inputs', async (req, res) => {
  const { type } = req.body || {};
  if (type !== 'reveal' && type !== 'tip') {
    return res.status(400).json({ error: "type must be 'reveal' or 'tip'" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set — AI suggestions unavailable.' });
  }

  const prompt = type === 'reveal'
    ? `Invent ONE fresh, specific idea for an old family-photo restoration video for EternalFrame. Return ONLY valid JSON:
{
  "hint": "a concrete photo scenario, e.g. '1960s Saigon wedding portrait' (max ~60 chars)",
  "damageNotes": "a short vivid description of the photo's damage, e.g. 'deep water stains, one torn corner' (max ~70 chars)"
}`
    : `Invent ONE fresh, specific topic for a photo-restoration / memory-keeping tips video for EternalFrame. Return ONLY valid JSON:
{
  "hint": "a concrete tip topic, e.g. 'scanning old prints with your phone' (max ~60 chars)"
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: 'You invent fresh, specific content ideas for EternalFrame, an AI photo restoration app. Respond ONLY with valid JSON. Avoid repeating common defaults — be varied and concrete.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
    const clean = text.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(type === 'reveal'
      ? { hint: parsed.hint ?? null, damageNotes: parsed.damageNotes ?? null }
      : { hint: parsed.hint ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Generate a reveal item with AI (damaged → restored photos)
app.post('/api/generate-reveal-photos', async (req, res) => {
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(400).json({ error: 'GOOGLE_API_KEY not set — image generation unavailable.' });
  }
  const { pairs = 1, hint, subject, era, damageNotes, source } = req.body || {};
  try {
    const subjects = subject
      ? [{
          subject,
          era: era || '1960s',
          story: `An old family photograph: ${subject}.`,
          label: String(subject).split(' ').slice(0, 3).join(' '),
        }]
      : undefined;

    const result = await generateRevealPhotos({
      pairs: Math.max(1, Math.min(6, Number(pairs) || 1)),
      hint,
      subjects,
      damageNotes,
      source: normalizeSource(source),
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Regenerate IMAGES (not script) for an item — reveal pairs or tip imagery.
// Runs in-process and returns the updated row.
app.post('/api/content/:id/regenerate-images', async (req, res) => {
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(400).json({ error: 'GOOGLE_API_KEY not set — image generation unavailable.' });
  }

  const { scope, pairIndex, tipIndex, damageNotes } = req.body || {};

  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });

  try {
    if (scope === 'pair' || scope === 'before' || scope === 'after') {
      if (item.content_type !== 'reveal') {
        return res.status(400).json({ error: 'Pair regeneration is only valid for reveal items' });
      }
      const pairs = Array.isArray(item.image_pairs) ? [...item.image_pairs] : [];
      const idx = Number(pairIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= pairs.length) {
        return res.status(400).json({ error: `Invalid pairIndex ${pairIndex}` });
      }
      const pair = { ...pairs[idx] };

      // Reconstruct a PhotoSubject for this pair (new pairs persist subject/story).
      let subject: PhotoSubject;
      if (pair.subject) {
        subject = {
          subject: pair.subject,
          era: pair.era || item.photo_era || '1960s',
          story: pair.story || item.photo_story || `An old family photograph: ${pair.subject}.`,
          label: pair.label || 'Restored memory',
          location: pair.location,
        };
      } else if (item.photo_story) {
        subject = {
          subject: item.photo_story,
          era: pair.era || item.photo_era || '1960s',
          story: item.photo_story,
          label: pair.label || 'Restored memory',
        };
      } else {
        [subject] = await inventSubjects(1);
      }

      const notes = damageNotes ?? pair.damage_notes;

      if (scope === 'pair' || scope === 'before') {
        const before = await generateBeforeImage(subject, notes);
        pair.before_url = await uploadImageBuffer({
          buffer: before.imageBuffer, contentType: before.mimeType, pathPrefix: 'generated/reveal',
        });
        pair.subject = subject.subject;
        pair.story = subject.story;
        pair.location = subject.location ?? pair.location ?? null;
        pair.damage_notes = notes ?? null;
        if (scope === 'pair') {
          const after = await generateAfterFromBuffer(before);
          pair.after_url = await uploadImageBuffer({
            buffer: after.imageBuffer, contentType: after.mimeType, pathPrefix: 'generated/reveal',
          });
        }
      } else {
        // scope === 'after': re-edit from the CURRENT before so the subject stays matched.
        if (!pair.before_url) return res.status(400).json({ error: 'Pair has no before image to restore from' });
        const before = await fetchImageAsGenerated(pair.before_url);
        const after = await generateAfterFromBuffer(before);
        pair.after_url = await uploadImageBuffer({
          buffer: after.imageBuffer, contentType: after.mimeType, pathPrefix: 'generated/reveal',
        });
      }

      pairs[idx] = pair;
      const update: Record<string, unknown> = { image_pairs: pairs };
      if (idx === 0) {
        // Keep legacy single-pair fields in sync — only for URLs this scope changed.
        if (scope === 'pair' || scope === 'before') update.before_image_url = pair.before_url;
        if (scope === 'pair' || scope === 'after') update.after_image_url = pair.after_url;
      }
      const { data: updated, error: updErr } = await supabase
        .from('tiktok_content_pool').update(update).eq('id', item.id).select().single();
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json(updated);
    }

    if (scope === 'tip-images') {
      if (item.content_type !== 'tip') {
        return res.status(400).json({ error: 'tip-images scope is only valid for tip items' });
      }

      // Multi-tip array path.
      if (Array.isArray(item.tips) && item.tips.length > 0) {
        const tips = [...item.tips];
        const tIdx = tipIndex === undefined ? null : Number(tipIndex);
        if (tIdx !== null && !Number.isInteger(tIdx)) {
          return res.status(400).json({ error: `Invalid tipIndex ${tipIndex}` });
        }
        const indices = tIdx === null ? tips.map((_: unknown, i: number) => i) : [tIdx];
        for (const i of indices) {
          if (i < 0 || i >= tips.length) return res.status(400).json({ error: `Invalid tipIndex ${i}` });
          const { tipImageUrl, tipImages } = await generateTipImages(
            tips[i].tipTitle || 'Photo restoration tip', tips[i].tipBody || '', 0
          );
          tips[i] = { ...tips[i], tipImageSrc: tipImageUrl, tipImages };
        }
        const { data: updated, error: updErr } = await supabase
          .from('tiktok_content_pool').update({ tips }).eq('id', item.id).select().single();
        if (updErr) return res.status(500).json({ error: updErr.message });
        return res.json(updated);
      }

      // Legacy single-tip path.
      const { tipImageUrl, tipImages } = await generateTipImages(
        item.tip_title || 'Photo restoration tip', item.tip_body || '', 0
      );
      const { data: updated, error: updErr } = await supabase
        .from('tiktok_content_pool')
        .update({ tip_image_url: tipImageUrl, tip_images: tipImages })
        .eq('id', item.id).select().single();
      if (updErr) return res.status(500).json({ error: updErr.message });
      return res.json(updated);
    }

    return res.status(400).json({ error: `Unsupported scope: ${scope}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Regenerate the two-beat captions for a reveal item (re-rolls copy only).
app.post('/api/content/:id/regenerate-captions', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set — caption generation unavailable.' });
  }

  const { data: item, error: fetchErr } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, photo_story, image_pairs')
    .eq('id', req.params.id)
    .single();
  if (fetchErr || !item) return res.status(404).json({ error: 'Item not found' });
  if (item.content_type !== 'reveal') {
    return res.status(400).json({ error: 'Caption regeneration is only valid for reveal items' });
  }

  const pairs = Array.isArray(item.image_pairs) ? [...item.image_pairs] : [];
  if (pairs.length === 0) return res.status(400).json({ error: 'Item has no pairs' });

  try {
    const captions = await generatePairCaptions(
      pairs.map((p: any) => ({
        label: p.label,
        era: p.era,
        location: p.location,
        story: p.story || item.photo_story,
        damage_notes: p.damage_notes,
      }))
    );
    const updatedPairs = pairs.map((p: any, i: number) => ({
      ...p,
      caption_before: captions[i]?.before || '',
      caption_after: captions[i]?.after || '',
    }));

    const { data: updated, error: updErr } = await supabase
      .from('tiktok_content_pool')
      .update({ image_pairs: updatedPairs })
      .eq('id', item.id)
      .select()
      .single();
    if (updErr) return res.status(500).json({ error: updErr.message });
    return res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Generate a multi-tip item with AI (Claude invents tips, Gemini makes backgrounds).
app.post('/api/generate-tip-content', async (req, res) => {
  if (!process.env.GOOGLE_API_KEY) {
    return res.status(400).json({ error: 'GOOGLE_API_KEY not set — image generation unavailable.' });
  }
  const { count = 4, hint, source } = req.body || {};
  try {
    const result = await generateTipContent({
      count: Math.max(1, Math.min(6, Number(count) || 4)),
      hint,
      source: normalizeSource(source),
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ============================================================
// Pipeline execution
// ============================================================

let pipelineProcess: ChildProcess | null = null;
let pipelineOutput = '';
let pipelineRunning = false;
let currentRunId: string | null = null;

async function runPipeline(opts: { dryRun?: boolean; postOnly?: boolean; contentId?: string } = {}): Promise<string | null> {
  if (pipelineRunning) return null;

  const { dryRun = false, postOnly = false, contentId } = opts;
  const args = ['--env-file=.env', '--import', 'tsx', 'scripts/render-video.ts'];
  if (dryRun) args.push('--dry-run');
  if (postOnly) args.push('--post-only');
  if (contentId) args.push(contentId);

  // Log run start
  const { data: run } = await supabase
    .from('pipeline_run_log')
    .insert({
      content_id: contentId || null,
      dry_run: dryRun,
    })
    .select('id')
    .single();

  currentRunId = run?.id || null;
  pipelineOutput = '';
  pipelineRunning = true;

  pipelineProcess = spawn('node', args, { cwd: ROOT });

  pipelineProcess.stdout?.on('data', (chunk: Buffer) => {
    pipelineOutput += chunk.toString();
  });

  pipelineProcess.stderr?.on('data', (chunk: Buffer) => {
    pipelineOutput += chunk.toString();
  });

  pipelineProcess.on('close', async (code) => {
    pipelineRunning = false;
    const success = code === 0;

    if (currentRunId) {
      await supabase
        .from('pipeline_run_log')
        .update({
          finished_at: new Date().toISOString(),
          success,
          output: pipelineOutput,
          error: success ? null : `Exit code ${code}`,
        })
        .eq('id', currentRunId);
    }

    pipelineProcess = null;
    currentRunId = null;
  });

  return currentRunId;
}

app.post('/api/pipeline/run', async (req, res) => {
  if (pipelineRunning) {
    return res.status(409).json({ error: 'Pipeline is already running' });
  }

  const { dryRun = true, postOnly = false, contentId } = req.body;
  const runId = await runPipeline({ dryRun, postOnly, contentId });
  res.json({ ok: true, runId });
});

app.get('/api/pipeline/status', (_req, res) => {
  res.json({ running: pipelineRunning, output: pipelineOutput });
});

app.get('/api/pipeline/history', async (_req, res) => {
  const { data, error } = await supabase
    .from('pipeline_run_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/pipeline/history/:id', async (req, res) => {
  const { id } = req.params;
  if (pipelineRunning && currentRunId === id) {
    return res.status(409).json({ error: 'Cannot delete an active run' });
  }
  const { error } = await supabase
    .from('pipeline_run_log')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

async function reconcileOrphanedRuns() {
  const { data, error } = await supabase
    .from('pipeline_run_log')
    .update({
      finished_at: new Date().toISOString(),
      success: false,
      error: 'Server restarted mid-run',
    })
    .is('finished_at', null)
    .select('id');

  if (error) {
    console.error('Failed to reconcile orphaned runs:', error.message);
    return;
  }
  if (data && data.length > 0) {
    console.log(`Reconciled ${data.length} orphaned pipeline run(s)`);
  }
}

// ============================================================
// TikTok token management
// ============================================================

app.get('/api/tiktok/token-status', async (_req, res) => {
  const { data, error } = await supabase
    .from('tiktok_tokens')
    .select('expires_at, scope, open_id, updated_at')
    .eq('id', 'default')
    .single();

  if (error || !data) {
    return res.json({
      hasToken: false,
      expiresAt: null,
      isExpired: true,
      scope: null,
      updatedAt: null,
    });
  }

  const expiresAt = new Date(data.expires_at);
  const isExpired = expiresAt.getTime() < Date.now();

  res.json({
    hasToken: true,
    expiresAt: data.expires_at,
    isExpired,
    scope: data.scope,
    openId: data.open_id,
    updatedAt: data.updated_at,
  });
});

app.post('/api/tiktok/refresh-token', async (_req, res) => {
  const { data } = await supabase
    .from('tiktok_tokens')
    .select('refresh_token')
    .eq('id', 'default')
    .single();

  if (!data?.refresh_token) {
    return res.status(404).json({ error: 'No refresh token found. Run: npm run tiktok:setup' });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!clientKey || !clientSecret) {
    return res.status(400).json({ error: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET required in .env' });
  }

  try {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: data.refresh_token,
      }),
    });

    const result = await response.json();

    if (result.error || !result.access_token) {
      return res.status(400).json({
        error: `Refresh failed: ${result.error_description || result.error}. Run: npm run tiktok:setup`,
      });
    }

    const expiresAt = new Date(Date.now() + result.expires_in * 1000);

    await supabase.from('tiktok_tokens').upsert({
      id: 'default',
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: expiresAt.toISOString(),
      scope: result.scope,
      open_id: result.open_id,
      updated_at: new Date().toISOString(),
    });

    res.json({ ok: true, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// In-memory state for the re-auth OAuth flow. Re-auth is rare and the
// dashboard is single-instance, so a process-local Map is sufficient;
// entries auto-expire after 10 minutes.
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingAuthStates = new Map<string, { codeVerifier: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingAuthStates) {
    if (entry.expiresAt < now) pendingAuthStates.delete(state);
  }
}, 5 * 60 * 1000).unref();

app.post('/api/tiktok/auth/start', (_req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'https://www.tiktok.com/';
  const scopes = process.env.TIKTOK_SCOPES || 'user.info.basic,video.upload,video.publish';

  if (!clientKey) {
    return res.status(400).json({ error: 'TIKTOK_CLIENT_KEY required in .env' });
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  pendingAuthStates.set(state, { codeVerifier, expiresAt: Date.now() + STATE_TTL_MS });

  const authUrl = buildAuthUrl({ clientKey, redirectUri, scopes, state, codeChallenge });
  res.json({ authUrl, state, redirectUri });
});

app.post('/api/tiktok/auth/complete', async (req, res) => {
  const { callbackUrl } = req.body;
  if (!callbackUrl || typeof callbackUrl !== 'string') {
    return res.status(400).json({ error: '`callbackUrl` is required' });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || 'https://www.tiktok.com/';

  if (!clientKey || !clientSecret) {
    return res
      .status(400)
      .json({ error: 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET required in .env' });
  }

  let parsed: { code: string; state: string | null };
  try {
    parsed = parseCallbackInput(callbackUrl);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid callback URL' });
  }

  if (!parsed.state) {
    return res.status(400).json({ error: 'Callback URL has no `state` parameter' });
  }

  const pending = pendingAuthStates.get(parsed.state);
  if (!pending) {
    return res
      .status(400)
      .json({ error: 'Auth state expired or unknown — start a new re-authorization.' });
  }
  if (pending.expiresAt < Date.now()) {
    pendingAuthStates.delete(parsed.state);
    return res.status(400).json({ error: 'Auth state expired — start a new re-authorization.' });
  }
  pendingAuthStates.delete(parsed.state);

  try {
    const tokens = await exchangeCodeForTokens({
      code: parsed.code,
      codeVerifier: pending.codeVerifier,
      clientKey,
      clientSecret,
      redirectUri,
    });

    const { error } = await supabase.from('tiktok_tokens').upsert({
      id: 'default',
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      open_id: tokens.openId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Failed to store tokens: ${error.message}`);

    res.json({
      ok: true,
      expiresAt: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      openId: tokens.openId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ============================================================
// Auto-post scheduler
// ============================================================

let schedulerEnabled = process.env.SCHEDULE_ENABLED !== 'false';
let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

// True if any item is due to post now (scheduled_for at or before this instant).
// 'rendered' is included so a pre-rendered item that is now due still counts.
async function hasScheduledItems(): Promise<boolean> {
  const { count } = await supabase
    .from('tiktok_content_pool')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'scripted', 'rendered'])
    .lte('scheduled_for', new Date().toISOString());

  return (count ?? 0) > 0;
}

// Shared by the poller tick and the startup catch-up: post the next due item if
// one exists and nothing is already running. `trigger` is only for logging.
async function runScheduledPipeline(trigger: string): Promise<void> {
  if (!schedulerEnabled) return;
  if (pipelineRunning) return; // quiet: this runs every minute

  const hasItems = await hasScheduledItems();
  if (!hasItems) return;

  console.log(`[scheduler] ${trigger}: posting next due item at ${new Date().toLocaleString()}`);
  const runId = await runPipeline({ dryRun: false });
  console.log(`[scheduler] Pipeline started (runId: ${runId})`);
}

function startScheduler() {
  if (schedulerTask) schedulerTask.stop();
  // Poll every minute and post whatever is due. Per-item scheduled_for
  // timestamps decide when something posts — there is no global post time.
  schedulerTask = cron.schedule('* * * * *', () => runScheduledPipeline('Poll'));
  console.log(`Scheduler started: per-minute poll (${schedulerEnabled ? 'enabled' : 'disabled'})`);
}

// ============================================================
// TikTok token refresh cron (independent of the post scheduler)
// ============================================================

const tokenRefreshCron = process.env.TIKTOK_REFRESH_CRON || '0 3 * * *';
let tokenRefreshTask: ReturnType<typeof cron.schedule> | null = null;

function startTokenRefreshCron() {
  if (tokenRefreshTask) tokenRefreshTask.stop();

  if (!cron.validate(tokenRefreshCron)) {
    console.error(`Invalid TIKTOK_REFRESH_CRON: "${tokenRefreshCron}"`);
    return;
  }

  tokenRefreshTask = cron.schedule(tokenRefreshCron, async () => {
    console.log(`[token-refresh] Cron fired at ${new Date().toLocaleString()}`);
    // Refresh every account row (default + client accounts) independently so
    // one failed account doesn't stop the others from rotating.
    const { data: accounts } = await supabase.from('tiktok_tokens').select('id');
    for (const { id } of accounts ?? []) {
      try {
        const client = new TikTokClient(supabase, id);
        // Threshold > 24h so each daily tick refreshes; this rotates the
        // refresh token regularly and prevents staleness from disuse.
        await client.ensureFreshToken(25 * 60 * 60 * 1000);
        console.log(`[token-refresh] OK (${id})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[token-refresh] FAILED (${id}): ${msg}`);
      }
    }
  });

  console.log(`Token refresh cron started: ${tokenRefreshCron}`);
}

// The next actual post: the soonest future scheduled_for among postable items.
async function getNextRun(): Promise<string | null> {
  if (!schedulerEnabled) return null;
  const { data } = await supabase
    .from('tiktok_content_pool')
    .select('scheduled_for')
    .in('status', ['queued', 'scripted', 'rendered'])
    .gt('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.scheduled_for ?? null;
}

app.get('/api/scheduler/status', async (_req, res) => {
  res.json({
    enabled: schedulerEnabled,
    nextRun: await getNextRun(),
    pipelineRunning,
  });
});

app.post('/api/scheduler/toggle', (_req, res) => {
  schedulerEnabled = !schedulerEnabled;
  console.log(`[scheduler] ${schedulerEnabled ? 'Enabled' : 'Disabled'}`);
  res.json({ enabled: schedulerEnabled });
});

app.patch('/api/scheduler/settings', async (req, res) => {
  const { enabled } = req.body;

  if (enabled !== undefined) {
    schedulerEnabled = Boolean(enabled);
    console.log(`[scheduler] ${schedulerEnabled ? 'Enabled' : 'Disabled'}`);
  }

  // Restart scheduler with new settings
  startScheduler();

  res.json({
    enabled: schedulerEnabled,
    nextRun: await getNextRun(),
  });
});

// ============================================================
// Start server
// ============================================================

app.listen(PORT, async () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  await reconcileOrphanedRuns();
  startScheduler();
  startTokenRefreshCron();

  // Catch-up: if the process was down at the scheduled cron time (e.g. laptop
  // asleep at 6 AM), node-cron silently misses that tick. On boot, post any
  // item that is already due so missed scheduled posts aren't lost.
  await runScheduledPipeline('Startup catch-up');
});
