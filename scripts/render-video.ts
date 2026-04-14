#!/usr/bin/env tsx
// ============================================================
// Render Pipeline — Full pipeline for one content item:
// 1. Fetch from Supabase content pool
// 2. Generate AI script (if not already scripted)
// 3. Generate background music via Suno AI
// 4. Render video with Remotion
// 5. Upload to Supabase Storage
// 6. Post to TikTok (or save to review folder)
// ============================================================
// Usage:
//   npx tsx scripts/render-video.ts                   # process next queued item
//   npx tsx scripts/render-video.ts <content-id>      # process specific item
//   npx tsx scripts/render-video.ts --dry-run          # render without posting
//   npx tsx scripts/render-video.ts <id> --post-only   # skip render, post existing video
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { generateScript } from './generate-script';
import { generateMusicTrack, downloadAndTrim } from '../src/utils/suno';
import { createRevealTiming, createTipsTiming, VIDEO } from '../src/config';
import {
  TikTokClient,
  TikTokApiError,
  TokenExpiredError,
  ScopeError,
  RateLimitError,
  VideoProcessingError,
} from './lib/tiktok-api';
import path from 'path';
import fs from 'fs';

// --- Config ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const DRY_RUN = process.argv.includes('--dry-run');
const POST_ONLY = process.argv.includes('--post-only');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ImagePairRow {
  before_url: string;
  after_url: string;
  era?: string;
  label?: string;
}

interface ContentRow {
  id: string;
  content_type: 'reveal' | 'tip';
  status: string;
  // Legacy single-pair fields
  before_image_url?: string;
  after_image_url?: string;
  photo_era?: string;
  photo_story?: string;
  preset_used?: string;
  // Multi-pair field
  image_pairs?: ImagePairRow[];
  // Tip fields
  tip_title?: string;
  tip_body?: string;
  tip_source?: string;
  tip_image_url?: string;
  // Script fields
  hook_text?: string;
  caption?: string;
  hashtags?: string[];
  music_track?: string;
  // Audio fields
  music_style?: string;
  suno_audio_url?: string;
  music_file_path?: string;
  audio_volume?: number;
  // Render fields
  video_url?: string;
  // CTA
  slogan?: string;
}

// --- Step 1: Fetch next content item ---
async function fetchNextItem(specificId?: string): Promise<ContentRow | null> {
  if (specificId) {
    const { data, error } = await supabase
      .from('tiktok_content_pool')
      .select('*')
      .eq('id', specificId)
      .single();

    if (error) throw new Error(`Failed to fetch item: ${error.message}`);
    return data;
  }

  // Get next queued or scripted item
  const { data, error } = await supabase
    .from('tiktok_content_pool')
    .select('*')
    .in('status', ['queued', 'scripted'])
    .or('scheduled_for.is.null,scheduled_for.lte.now()')
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null; // no rows
  if (error) throw new Error(`Failed to fetch next item: ${error.message}`);
  return data;
}

// --- Step 2: Generate script if needed ---
async function ensureScript(item: ContentRow): Promise<ContentRow> {
  if (item.status !== 'queued' || item.hook_text) {
    console.log('  Script already exists, skipping generation');
    return item;
  }

  console.log('  Generating AI script...');
  const pairCount = item.image_pairs?.length || 1;
  const script = await generateScript({
    id: item.id,
    content_type: item.content_type,
    photo_era: item.photo_era,
    photo_story: item.photo_story,
    preset_used: item.preset_used,
    tip_title: item.tip_title,
    tip_body: item.tip_body,
    tip_source: item.tip_source,
    pair_count: pairCount,
    photo_stories: item.image_pairs?.map((p, i) =>
      `Pair ${i + 1}: ${p.era || 'unknown era'}`
    ),
  });

  // Update Supabase
  const { error } = await supabase
    .from('tiktok_content_pool')
    .update({
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      music_style: script.music_style,
      music_track: script.music_mood, // keep legacy field populated
      slogan: script.slogan,
      status: 'scripted',
    })
    .eq('id', item.id);

  if (error) throw new Error(`Failed to update script: ${error.message}`);

  return {
    ...item,
    hook_text: script.hook_text,
    caption: script.caption,
    hashtags: script.hashtags,
    music_style: script.music_style,
    slogan: script.slogan,
    status: 'scripted',
  };
}

// --- Step 3: Generate background music via Suno AI ---
async function generateAudio(item: ContentRow): Promise<ContentRow> {
  // Skip if already has a music file
  if (item.music_file_path && fs.existsSync(item.music_file_path)) {
    console.log(`  Music already exists: ${item.music_file_path}`);
    return item;
  }

  // Skip if no Suno API configured
  if (!process.env.SUNO_API_URL) {
    console.log('  No SUNO_API_URL set. Skipping music generation.');
    return item;
  }

  const musicPrompt = item.music_style || item.music_track || 'warm nostalgic instrumental, gentle piano';

  // Calculate target duration based on content
  const pairCount = item.image_pairs?.length || 1;
  let durationMs: number;
  if (item.content_type === 'reveal') {
    const timing = createRevealTiming(pairCount);
    durationMs = Math.ceil(timing.totalDuration / VIDEO.fps * 1000);
  } else {
    const timing = createTipsTiming(1); // TODO: support multi-tip count from DB
    durationMs = Math.ceil(timing.totalDuration / VIDEO.fps * 1000);
  }

  console.log(`  Generating Suno AI music (~${(durationMs / 1000).toFixed(0)}s target)...`);
  console.log(`  Prompt: "${musicPrompt}"`);

  try {
    const track = await generateMusicTrack({
      prompt: musicPrompt,
      instrumental: true,
      title: `EternalFrame - ${item.content_type} - ${item.id.slice(0, 8)}`,
    });

    // Download and trim to video duration
    // Save into public/music/ so Remotion's staticFile() can serve it
    const musicDir = path.resolve(__dirname, '../public/music');
    fs.mkdirSync(musicDir, { recursive: true });
    const musicFilename = `${item.id.slice(0, 8)}.mp3`;
    const outputPath = path.join(musicDir, musicFilename);

    await downloadAndTrim({
      audioUrl: track.audioUrl,
      targetDurationMs: durationMs,
      outputPath,
    });

    // Update DB with audio info
    await supabase
      .from('tiktok_content_pool')
      .update({
        suno_audio_url: track.audioUrl,
        music_file_path: outputPath,
      })
      .eq('id', item.id);

    return {
      ...item,
      suno_audio_url: track.audioUrl,
      music_file_path: outputPath,
    };
  } catch (err) {
    console.warn(`  Suno music generation failed: ${err instanceof Error ? err.message : err}`);
    console.log('  Proceeding without background music.');
    // Clear stale audio URL so Remotion doesn't try to use an expired Suno link
    if (item.suno_audio_url) {
      await supabase
        .from('tiktok_content_pool')
        .update({ suno_audio_url: null })
        .eq('id', item.id);
    }
    return { ...item, suno_audio_url: undefined, music_file_path: undefined };
  }
}

// --- Step 4: Render video with Remotion ---
async function renderVideo(item: ContentRow): Promise<string> {
  console.log('  Bundling Remotion project...');

  // Update status
  await supabase
    .from('tiktok_content_pool')
    .update({ status: 'rendering' })
    .eq('id', item.id);

  const entryPoint = path.resolve(__dirname, '../src/index.ts');
  const bundled = await bundle({ entryPoint });

  const compositionId =
    item.content_type === 'reveal' ? 'BeforeAfterReveal' : 'TipsEducational';

  // Resolve music file: prefer local file in public/ for staticFile(), fall back to URL
  let musicFile: string | undefined;
  if (item.music_file_path && fs.existsSync(item.music_file_path)) {
    // music_file_path is an absolute path in public/music/
    // Pass just the relative path from public/ so staticFile() can find it
    const publicDir = path.resolve(__dirname, '../public');
    const relativePath = path.relative(publicDir, item.music_file_path);
    musicFile = relativePath; // e.g. "music/a6346d1b.mp3"
  } else if (item.suno_audio_url) {
    musicFile = item.suno_audio_url; // direct URL — compositions handle http:// prefix
  } else if (item.music_track?.includes('.')) {
    musicFile = item.music_track; // legacy filename in public/
  }

  // Build input props based on content type
  let inputProps: Record<string, unknown>;

  if (item.content_type === 'reveal') {
    // Build imagePairs from new field or fall back to legacy
    const imagePairs = item.image_pairs?.map((p) => ({
      beforeImageSrc: p.before_url,
      afterImageSrc: p.after_url,
      photoEra: p.era,
      label: p.label,
    })) || [{
      beforeImageSrc: item.before_image_url || '',
      afterImageSrc: item.after_image_url || '',
      photoEra: item.photo_era,
    }];

    inputProps = {
      hookText: item.hook_text || 'A forgotten memory...',
      imagePairs,
      musicFile,
      audioVolume: item.audio_volume ?? 0.6,
      slogan: item.slogan,
    };
  } else {
    inputProps = {
      hookText: item.hook_text || 'Did you know?',
      tipTitle: item.tip_title || '',
      tipBody: item.tip_body || '',
      takeaway: item.hook_text || '', // reuse hook as takeaway fallback
      tipImageSrc: item.tip_image_url,
      musicFile,
      audioVolume: item.audio_volume ?? 0.5,
      slogan: item.slogan,
    };
  }

  console.log(`  Rendering composition: ${compositionId}`);
  const composition = await selectComposition({
    serveUrl: bundled,
    id: compositionId,
    inputProps,
  });

  // Ensure output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputPath = path.join(
    OUTPUT_DIR,
    `${item.content_type}-${item.id.slice(0, 8)}.mp4`
  );

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps,
    // TikTok-optimized encoding
    videoBitrate: '8M',
    audioBitrate: '192k',
  });

  // Update video duration in DB
  const durationMs = Math.ceil(composition.durationInFrames / composition.fps * 1000);
  await supabase
    .from('tiktok_content_pool')
    .update({ video_duration_ms: durationMs })
    .eq('id', item.id);

  console.log(`  Video rendered: ${outputPath} (${(durationMs / 1000).toFixed(1)}s)`);
  return outputPath;
}

// --- Step 5: Upload to Supabase Storage ---
async function uploadVideo(
  item: ContentRow,
  localPath: string
): Promise<string> {
  const filename = path.basename(localPath);
  const storagePath = `tiktok-videos/${filename}`;

  console.log(`  Uploading to Supabase Storage: ${storagePath}`);

  const fileBuffer = fs.readFileSync(localPath);
  const { error } = await supabase.storage
    .from('videos')
    .upload(storagePath, fileBuffer, {
      contentType: 'video/mp4',
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from('videos').getPublicUrl(storagePath);

  // Append cache-busting param so re-renders aren't served stale by browser/CDN
  const videoUrl = `${publicUrl}?v=${Date.now()}`;

  // Update row
  await supabase
    .from('tiktok_content_pool')
    .update({
      video_url: videoUrl,
      status: 'rendered',
    })
    .eq('id', item.id);

  return videoUrl;
}

// --- Step 6: Post to TikTok ---
async function postToTikTok(item: ContentRow, videoUrl: string, videoPath?: string): Promise<void> {
  if (DRY_RUN) {
    console.log('  [DRY RUN] Skipping TikTok post');
    console.log(`  Caption: ${item.caption}`);
    console.log(`  Hashtags: ${item.hashtags?.join(' ')}`);
    return;
  }

  const client = new TikTokClient(supabase);
  const token = await client.getAccessToken();

  if (!token) {
    console.log('  No TikTok token available. Video saved for manual upload.');
    console.log(`  Caption: ${item.caption}`);
    console.log(`  Hashtags: ${item.hashtags?.join(' ')}`);
    return;
  }

  // Resolve local video file path for FILE_UPLOAD
  let localPath = videoPath;
  if (!localPath || !fs.existsSync(localPath)) {
    // Derive path from content ID (standard naming convention)
    const derivedPath = path.join(OUTPUT_DIR, `${item.content_type}-${item.id.slice(0, 8)}.mp4`);
    if (fs.existsSync(derivedPath)) {
      localPath = derivedPath;
      console.log(`  Using local video file: ${localPath}`);
    }
  }

  // If no local file, download from Supabase Storage
  if (!localPath || !fs.existsSync(localPath)) {
    if (!videoUrl) {
      console.error('  No video file or URL available. Cannot post.');
      return;
    }
    console.log('  Local video not found, downloading from Supabase Storage...');
    const downloadPath = path.join(OUTPUT_DIR, `${item.content_type}-${item.id.slice(0, 8)}.mp4`);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const resp = await fetch(videoUrl);
    if (!resp.ok) {
      console.error(`  Download failed: HTTP ${resp.status}`);
      return;
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(downloadPath, buffer);
    localPath = downloadPath;
    console.log(`  Downloaded to ${localPath} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
  }

  const title = `${item.caption} ${item.hashtags?.map((h) => `#${h}`).join(' ') || ''}`;

  try {
    // FILE_UPLOAD: init → upload file → done
    // Tries Direct Post first, falls back to Inbox Upload if scope is insufficient
    const { publish_id, mode } = await client.initVideoPublish(localPath, title);

    console.log(`  Publish initiated via ${mode === 'direct' ? 'Direct Post' : 'Inbox Upload'}! ID: ${publish_id}`);

    // Mark as posted with processing status
    await supabase
      .from('tiktok_content_pool')
      .update({
        tiktok_post_id: publish_id,
        posted_at: new Date().toISOString(),
        status: 'posted',
        publish_status: mode === 'inbox' ? 'inbox' : 'processing',
      })
      .eq('id', item.id);

    if (mode === 'inbox') {
      console.log('  Video sent to your TikTok inbox!');
      console.log('  Open TikTok app → check inbox → review and post the video.');
      console.log(`  Caption to use: ${title}`);
      return;
    }

    // Poll for completion (Direct Post only)
    console.log('  Polling for publish status...');
    const result = await client.pollPublishStatus(publish_id);

    if (result.status === 'PUBLISH_COMPLETE') {
      await supabase
        .from('tiktok_content_pool')
        .update({ publish_status: 'published' })
        .eq('id', item.id);
      console.log(`  Published successfully on TikTok!`);
    } else if (result.status === 'FAILED') {
      await supabase
        .from('tiktok_content_pool')
        .update({
          publish_status: 'publish_failed',
          post_error: result.fail_reason || 'Unknown processing failure',
          status: 'failed',
        })
        .eq('id', item.id);
      console.error(`  TikTok publishing failed: ${result.fail_reason}`);
    } else {
      await supabase
        .from('tiktok_content_pool')
        .update({ publish_status: 'processing' })
        .eq('id', item.id);
      console.log('  Still processing — check TikTok creator portal manually.');
    }
  } catch (err) {
    let errorMsg: string;

    if (err instanceof TokenExpiredError) {
      errorMsg = 'TikTok token expired. Run: npm run tiktok:setup';
    } else if (err instanceof ScopeError) {
      errorMsg = `TikTok scope error: ${err.message}`;
    } else if (err instanceof RateLimitError) {
      errorMsg = `Rate limited by TikTok. Retry after ${err.retryAfterSeconds}s`;
    } else if (err instanceof VideoProcessingError) {
      errorMsg = `TikTok rejected video: ${err.failReason}`;
    } else if (err instanceof TikTokApiError) {
      errorMsg = `TikTok API error: ${err.message}`;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    await supabase
      .from('tiktok_content_pool')
      .update({
        post_error: errorMsg,
        status: 'failed',
        publish_status: 'publish_failed',
      })
      .eq('id', item.id);

    console.error(`  TikTok post failed: ${errorMsg}`);
  }
}

// --- Main ---
async function main() {
  console.log('🎬 EternalFrame Auto-TikTok Engine\n');

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const specificId = args[0];

  // Step 1: Get content
  console.log('Step 1: Fetching content...');
  const item = await fetchNextItem(specificId);

  if (!item) {
    console.log('  No content items in queue. Add items to tiktok_content_pool.');
    return;
  }

  console.log(
    `  Found: ${item.content_type} (${item.id.slice(0, 8)}...) — status: ${item.status}`
  );

  // --post-only: skip rendering if video already exists
  if (POST_ONLY && item.video_url) {
    console.log('\n  --post-only: Skipping steps 2-5 (video already rendered)');
    console.log(`  Video URL: ${item.video_url}`);
    console.log('\nStep 6: Posting to TikTok...');
    await postToTikTok(item, item.video_url); // videoPath resolved inside from OUTPUT_DIR or downloaded
    console.log('\n✅ Pipeline complete!');
    return;
  }

  if (POST_ONLY && !item.video_url) {
    console.log('\n  --post-only used but no video_url found. Running full pipeline.');
  }

  // Step 2: Script
  console.log('\nStep 2: Script generation...');
  const scripted = await ensureScript(item);

  // Step 3: Music
  console.log('\nStep 3: Music generation (Suno AI)...');
  const withMusic = await generateAudio(scripted);

  // Step 4: Render
  console.log('\nStep 4: Video rendering...');
  const videoPath = await renderVideo(withMusic);

  // Step 5: Upload
  console.log('\nStep 5: Uploading video...');
  const videoUrl = await uploadVideo(withMusic, videoPath);

  // Step 6: Post
  console.log('\nStep 6: Posting to TikTok...');
  await postToTikTok(withMusic, videoUrl, videoPath);

  console.log('\n✅ Pipeline complete!');
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
