import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import { generateScript } from '../scripts/generate-script';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3001;
const ROOT = path.resolve(__dirname, '..');

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const app = express();
app.use(express.json());

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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload-photo', upload.single('photo'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const storagePath = `uploads/${filename}`;

  const { error } = await supabase.storage
    .from('photos')
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) return res.status(500).json({ error: error.message });

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

app.post('/api/pipeline/run', async (req, res) => {
  if (pipelineRunning) {
    return res.status(409).json({ error: 'Pipeline is already running' });
  }

  const { dryRun = true, postOnly = false, contentId } = req.body;
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

  res.json({ ok: true, runId: currentRunId });
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
// Start server
// ============================================================

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
