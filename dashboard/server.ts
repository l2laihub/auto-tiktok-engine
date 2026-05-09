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
import { generateScript } from '../scripts/generate-script';
import { generateMusicTrack as generateLyriaTrack, trimAudioFile } from '../src/utils/lyria';
import { generateMusicTrack as generateSunoTrack, downloadAndTrim } from '../src/utils/suno';
import { createRevealTiming, createTipsTiming, VIDEO } from '../src/config';
import { withRetry } from '../scripts/lib/retry';

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
    .select('id, content_type, music_style, music_track, music_file_path, image_pairs')
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
    const timing = createTipsTiming(1);
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

const anthropic = new Anthropic();

app.post('/api/analyze-photos', async (req, res) => {
  const { beforeUrl, afterUrl } = req.body;
  if (!beforeUrl || !afterUrl) return res.status(400).json({ error: 'Both beforeUrl and afterUrl are required' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
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

// ============================================================
// Auto-post scheduler
// ============================================================

let scheduleCron = process.env.SCHEDULE_CRON || '0 10 * * 1,3,5'; // Mon/Wed/Fri 10 AM
let schedulerEnabled = process.env.SCHEDULE_ENABLED !== 'false';
let schedulerTask: ReturnType<typeof cron.schedule> | null = null;

async function hasScheduledItems(): Promise<boolean> {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const { count } = await supabase
    .from('tiktok_content_pool')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'scripted'])
    .lte('scheduled_for', todayStr);

  return (count ?? 0) > 0;
}

function startScheduler() {
  if (schedulerTask) schedulerTask.stop();

  if (!cron.validate(scheduleCron)) {
    console.error(`Invalid SCHEDULE_CRON: "${scheduleCron}"`);
    return;
  }

  schedulerTask = cron.schedule(scheduleCron, async () => {
    if (!schedulerEnabled) return;
    console.log(`[scheduler] Cron fired at ${new Date().toLocaleString()}`);

    if (pipelineRunning) {
      console.log('[scheduler] Pipeline already running, skipping');
      return;
    }

    const hasItems = await hasScheduledItems();
    if (!hasItems) {
      console.log('[scheduler] No scheduled items due today, skipping');
      return;
    }

    console.log('[scheduler] Starting pipeline for scheduled content...');
    const runId = await runPipeline({ dryRun: false });
    console.log(`[scheduler] Pipeline started (runId: ${runId})`);
  });

  console.log(`Scheduler started: ${scheduleCron} (${schedulerEnabled ? 'enabled' : 'disabled'})`);
}

function getNextRun(): string | null {
  if (!schedulerEnabled || !schedulerTask) return null;
  try {
    const now = new Date();
    const [min, hour, , , dow] = scheduleCron.split(' ');
    // Check next 14 days for a match
    for (let i = 1; i < 14 * 24 * 60; i++) {
      const candidate = new Date(now.getTime() + i * 60_000);
      const minMatch = min === '*' || min === String(candidate.getMinutes());
      const hourMatch = hour === '*' || hour === String(candidate.getHours());
      const dowParts = dow === '*' ? null : dow.split(',').map(Number);
      const dowMatch = !dowParts || dowParts.includes(candidate.getDay());
      if (minMatch && hourMatch && dowMatch && candidate > now) {
        return candidate.toISOString();
      }
    }
  } catch { /* ignore */ }
  return null;
}

app.get('/api/scheduler/status', (_req, res) => {
  res.json({
    enabled: schedulerEnabled,
    cron: scheduleCron,
    nextRun: getNextRun(),
    pipelineRunning,
  });
});

app.post('/api/scheduler/toggle', (_req, res) => {
  schedulerEnabled = !schedulerEnabled;
  console.log(`[scheduler] ${schedulerEnabled ? 'Enabled' : 'Disabled'}`);
  res.json({ enabled: schedulerEnabled });
});

app.patch('/api/scheduler/settings', (req, res) => {
  const { cronExpression, enabled } = req.body;

  if (cronExpression !== undefined) {
    if (!cron.validate(cronExpression)) {
      return res.status(400).json({ error: `Invalid cron expression: "${cronExpression}"` });
    }
    scheduleCron = cronExpression;
    console.log(`[scheduler] Cron updated to: ${scheduleCron}`);
  }

  if (enabled !== undefined) {
    schedulerEnabled = Boolean(enabled);
    console.log(`[scheduler] ${schedulerEnabled ? 'Enabled' : 'Disabled'}`);
  }

  // Restart scheduler with new settings
  startScheduler();

  res.json({
    enabled: schedulerEnabled,
    cron: scheduleCron,
    nextRun: getNextRun(),
  });
});

// ============================================================
// Start server
// ============================================================

app.listen(PORT, async () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  await reconcileOrphanedRuns();
  startScheduler();
});
