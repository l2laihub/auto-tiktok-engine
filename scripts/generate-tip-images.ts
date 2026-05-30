#!/usr/bin/env tsx
// ============================================================
// Generate Tip Images — enrich a `tip` content item with AI imagery
// so tips videos are visual instead of plain text.
//
// Generates a primary background image (tip_image_url) plus a couple of
// b-roll images (tip_images) for a slideshow/montage behind the tip card.
// Idempotent: skips items that already have a tip_image_url.
// ============================================================
// Usage:
//   npm run generate:tip-images -- <content-id>
//   npm run generate:tip-images -- <content-id> --broll 2   # extra b-roll count
//   npm run generate:tip-images -- <content-id> --force      # regenerate
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { generateImage } from '../src/utils/image-gen';
import { uploadImageBuffer } from '../src/utils/storage';
import { buildTipImagePrompt } from './lib/image-prompts';

export interface TipImageResult {
  tipImageUrl: string;
  tipImages: string[];
}

/**
 * Generate `1 + brollCount` images for a tip and upload them.
 * `brollCount` extra images form the b-roll montage.
 */
export async function generateTipImages(
  tipTitle: string,
  tipBody: string,
  brollCount = 2
): Promise<TipImageResult> {
  const total = 1 + Math.max(0, brollCount);
  const urls: string[] = [];

  for (let i = 0; i < total; i++) {
    console.log(`  generating tip image ${i + 1}/${total}...`);
    const img = await generateImage({
      prompt: buildTipImagePrompt(tipTitle, tipBody, i),
      aspectRatio: '9:16',
    });
    const url = await uploadImageBuffer({
      buffer: img.imageBuffer,
      contentType: img.mimeType,
      pathPrefix: 'generated/tips',
    });
    urls.push(url);
  }

  return { tipImageUrl: urls[0], tipImages: urls.slice(1) };
}

// CLI entry point
async function main() {
  const argv = process.argv.slice(2);
  const contentId = argv.find((a) => !a.startsWith('--'));
  if (!contentId) {
    console.error('Usage: npm run generate:tip-images -- <content-id> [--broll N] [--force]');
    process.exit(1);
  }
  const brollIdx = argv.indexOf('--broll');
  const brollCount = brollIdx >= 0 ? parseInt(argv[brollIdx + 1], 10) : 2;
  const force = argv.includes('--force');

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: item, error } = await supabase
    .from('tiktok_content_pool')
    .select('id, content_type, tip_title, tip_body, tip_image_url')
    .eq('id', contentId)
    .single();

  if (error || !item) {
    console.error(`Item not found: ${error?.message || contentId}`);
    process.exit(1);
  }
  if (item.content_type !== 'tip') {
    console.error(`Item ${contentId} is a "${item.content_type}", not a tip.`);
    process.exit(1);
  }
  if (item.tip_image_url && !force) {
    console.log('Item already has images. Use --force to regenerate.');
    return;
  }

  console.log(`🖼️  Generating tip images for: ${item.tip_title}`);
  const { tipImageUrl, tipImages } = await generateTipImages(
    item.tip_title || 'Photo restoration tip',
    item.tip_body || '',
    brollCount
  );

  const { error: updateErr } = await supabase
    .from('tiktok_content_pool')
    .update({ tip_image_url: tipImageUrl, tip_images: tipImages })
    .eq('id', contentId);

  if (updateErr) {
    console.error(`Failed to update item: ${updateErr.message}`);
    process.exit(1);
  }

  console.log(`\n✅ Tip images saved (1 primary + ${tipImages.length} b-roll).`);
  console.log(`  primary: ${tipImageUrl}`);
  tipImages.forEach((u, i) => console.log(`  b-roll ${i + 1}: ${u}`));
}

const isDirectRun = process.argv[1]?.includes('generate-tip-images');
if (isDirectRun) {
  main().catch((err) => {
    console.error('Tip image generation failed:', err);
    process.exit(1);
  });
}
