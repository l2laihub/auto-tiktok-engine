#!/usr/bin/env tsx
// ============================================================
// Verify image generation — smoke test for the Gemini image util.
// Generates a damaged "before", then restores it to an "after",
// and writes both to output/ for visual inspection.
// No Supabase / no DB writes.
// ============================================================
// Usage: npm run verify:image-gen
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { generateImage } from '../src/utils/image-gen';
import { buildBeforePrompt, buildRestoreEditPrompt } from './lib/image-prompts';

async function main() {
  const outDir = path.resolve(process.cwd(), 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const subject = {
    subject: 'a smiling young couple on their wedding day, standing outside a small church',
    era: '1950s',
    story: 'A wedding portrait from the 1950s.',
    label: 'Wedding day',
  };

  console.log('1/2 Generating damaged "before"...');
  const before = await generateImage({ prompt: buildBeforePrompt(subject), aspectRatio: '9:16' });
  const beforePath = path.join(outDir, 'verify-before.png');
  fs.writeFileSync(beforePath, before.imageBuffer);
  console.log(`    wrote ${beforePath} (${(before.imageBuffer.length / 1024).toFixed(0)}KB, ${before.mimeType})`);

  console.log('2/2 Restoring → "after"...');
  const after = await generateImage({
    prompt: buildRestoreEditPrompt(),
    referenceImage: { buffer: before.imageBuffer, mimeType: before.mimeType },
    aspectRatio: '9:16',
  });
  const afterPath = path.join(outDir, 'verify-after.png');
  fs.writeFileSync(afterPath, after.imageBuffer);
  console.log(`    wrote ${afterPath} (${(after.imageBuffer.length / 1024).toFixed(0)}KB, ${after.mimeType})`);

  console.log('\n✅ Done. Open output/verify-before.png and output/verify-after.png to inspect.');
}

main().catch((err) => {
  console.error('Image-gen verification failed:', err);
  process.exit(1);
});
