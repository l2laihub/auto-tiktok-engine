#!/usr/bin/env tsx
// ============================================================
// Render Pipeline — Full pipeline for one content item:
// 1. Fetch from Supabase content pool
// 2. Generate AI script (if not already scripted)
// 3. Render video with Remotion
// 4. Upload to Supabase Storage
// 5. Post to TikTok (or save to review folder)
// ============================================================
// Usage:
//   npx tsx scripts/render-video.ts                   # process next queued item
//   npx tsx scripts/render-video.ts <content-id>      # process specific item
//   npx tsx scripts/render-video.ts --dry-run          # render without posting
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { generateScript } from './generate-script';
import path from 'path';
import fs from 'fs';

// --- Config ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ContentRow {
  id: string;
  content_type: 'reveal' | 'tip';
  status: string;
  before_image_url?: string;
  after_image_url?: string;
  photo_era?: string;
  photo_story?: string;
  preset_used?: string;
  tip_title?: string;
  tip_body?: string;
  tip_source?: string;
  tip_image_url?: string;
  hook_text?: string;
  caption?: string;
  hashtags?: string[];
  music_track?: string;
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
  const script = await generateScript({
    id: item.id,
    content_type: item.content_type,
    photo_era: item.photo_era,
    photo_story: item.photo_story,
    preset_used: item.preset_used,
    tip_title: item.tip_title,
    tip_body: item.tip_body,
    tip_source: item.tip_source,
  });

  // Update Supabase
  const { error } = await supabase
    .from('tiktok_content_pool')
    .update({
      hook_text: script.hook_text,
      caption: script.caption,
      hashtags: script.hashtags,
      // TODO(phase-2): resolve mood → filename via tiktok_music_library table
      music_track: script.music_mood,
      status: 'scripted',
    })
    .eq('id', item.id);

  if (error) throw new Error(`Failed to update script: ${error.message}`);

  return {
    ...item,
    hook_text: script.hook_text,
    caption: script.caption,
    hashtags: script.hashtags,
    status: 'scripted',
  };
}

// --- Step 3: Render video with Remotion ---
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

  // Build input props based on content type
  const inputProps =
    item.content_type === 'reveal'
      ? {
          hookText: item.hook_text || 'A forgotten memory...',
          beforeImageSrc: item.before_image_url || '',
          afterImageSrc: item.after_image_url || '',
          photoEra: item.photo_era,
          musicFile: item.music_track,
        }
      : {
          hookText: item.hook_text || 'Did you know?',
          tipTitle: item.tip_title || '',
          tipBody: item.tip_body || '',
          takeaway: item.hook_text || '', // reuse hook as takeaway fallback
          tipImageSrc: item.tip_image_url,
          musicFile: item.music_track,
        };

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

  console.log(`  Video rendered: ${outputPath}`);
  return outputPath;
}

// --- Step 4: Upload to Supabase Storage ---
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

  // Update row
  await supabase
    .from('tiktok_content_pool')
    .update({
      video_url: publicUrl,
      status: 'rendered',
    })
    .eq('id', item.id);

  return publicUrl;
}

// --- Step 5: Post to TikTok ---
// TODO(phase-2): Current implementation only calls the init endpoint.
// Full TikTok Content Posting API v2 requires: init → upload → publish.
// For now, use --dry-run and upload manually via TikTok app.
async function postToTikTok(item: ContentRow, videoUrl: string): Promise<void> {
  if (DRY_RUN) {
    console.log('  [DRY RUN] Skipping TikTok post');
    console.log(`  Caption: ${item.caption}`);
    console.log(`  Hashtags: ${item.hashtags?.join(' ')}`);
    return;
  }

  // TikTok Content Posting API v2
  // Requires: TIKTOK_ACCESS_TOKEN env var
  // App must be approved for content.publish scope
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('  No TIKTOK_ACCESS_TOKEN set. Video saved for manual upload.');
    console.log(`  Caption: ${item.caption}`);
    console.log(`  Hashtags: ${item.hashtags?.join(' ')}`);
    return;
  }

  try {
    // Step 1: Initialize upload
    const initResponse = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          post_info: {
            title: `${item.caption} ${item.hashtags?.map((h) => `#${h}`).join(' ') || ''}`,
            privacy_level: 'PUBLIC_TO_EVERYONE',
            disable_duet: false,
            disable_stitch: false,
            disable_comment: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: videoUrl,
          },
        }),
      }
    );

    const result = await initResponse.json();

    if (result.error?.code) {
      throw new Error(`TikTok API error: ${result.error.message}`);
    }

    // Update row with post ID
    await supabase
      .from('tiktok_content_pool')
      .update({
        tiktok_post_id: result.data?.publish_id,
        posted_at: new Date().toISOString(),
        status: 'posted',
      })
      .eq('id', item.id);

    console.log(`  Posted to TikTok! Publish ID: ${result.data?.publish_id}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('tiktok_content_pool')
      .update({
        post_error: errorMsg,
        status: 'failed',
      })
      .eq('id', item.id);

    console.error(`  TikTok post failed: ${errorMsg}`);
  }
}

// --- Main ---
async function main() {
  console.log('🎬 EternalFrame Auto-TikTok Engine\n');

  // Parse positional content ID (first non-flag arg after the script name)
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

  // Step 2: Script
  console.log('\nStep 2: Script generation...');
  const scripted = await ensureScript(item);

  // Step 3: Render
  console.log('\nStep 3: Video rendering...');
  const videoPath = await renderVideo(scripted);

  // Step 4: Upload
  console.log('\nStep 4: Uploading video...');
  const videoUrl = await uploadVideo(scripted, videoPath);

  // Step 5: Post
  console.log('\nStep 5: Posting to TikTok...');
  await postToTikTok(scripted, videoUrl);

  console.log('\n✅ Pipeline complete!');
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
