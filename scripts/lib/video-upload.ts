// Shared TUS resumable upload to the Supabase `videos` bucket.
// Supabase recommends TUS for anything >6MB; chunks are sent independently and
// retried per-chunk with exponential backoff, sidestepping the "fetch failed"
// failure mode of a single buffered supabase-js upload on Node 20.
// Used by the render pipeline (step 5) and the dashboard's external-video upload.

import * as tus from 'tus-js-client';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

// Supabase's project-wide upload cap (50MB on the Free plan; the `videos` bucket
// sets no limit of its own). Over it, the TUS create request 413s. Raise via env
// after raising the global limit in Supabase → Storage → Settings (Pro plan).
const STORAGE_MAX_BYTES = Number(process.env.STORAGE_MAX_BYTES) || 50 * 1024 * 1024;

/** Video bitrate (kbps) that lands a `durationSec` clip at ~90% of `maxBytes` after 128k audio. */
export function targetVideoKbps(maxBytes: number, durationSec: number): number {
  return Math.max(300, Math.floor((maxBytes * 8 * 0.9) / durationSec / 1000) - 128);
}

// ponytail: single-pass ABR, can land a little over target; switch to 2-pass if that ever bites
function shrinkToFit(localPath: string, maxBytes: number): string {
  const duration = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', localPath,
  ]).toString().trim());
  const kbps = targetVideoKbps(maxBytes, duration);
  const out = path.join(os.tmpdir(), `shrunk-${Date.now()}-${path.basename(localPath, path.extname(localPath))}.mp4`);
  console.log(`  Video over ${(maxBytes / 1024 / 1024).toFixed(0)}MB storage cap — re-encoding at ${kbps}kbps`);
  execFileSync('ffmpeg', [
    '-y', '-i', localPath,
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out,
  ], { stdio: 'pipe' });
  return out;
}

export async function uploadVideoTus(localPath: string, storagePath: string, fileSize: number): Promise<void> {
  if (fileSize <= STORAGE_MAX_BYTES) return tusUpload(localPath, storagePath, fileSize);
  const shrunk = shrinkToFit(localPath, STORAGE_MAX_BYTES);
  try {
    const size = fs.statSync(shrunk).size;
    if (size > STORAGE_MAX_BYTES) {
      throw new Error(`re-encoded video is still ${(size / 1024 / 1024).toFixed(1)}MB, over the ${(STORAGE_MAX_BYTES / 1024 / 1024).toFixed(0)}MB storage cap`);
    }
    await tusUpload(shrunk, storagePath, size);
  } finally {
    fs.unlink(shrunk, () => {});
  }
}

function tusUpload(localPath: string, storagePath: string, fileSize: number): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(localPath);
    let lastLoggedPct = -10;

    const upload = new tus.Upload(fileStream, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
      headers: {
        authorization: `Bearer ${supabaseKey}`,
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: 'videos',
        objectName: storagePath,
        contentType: 'video/mp4',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024,
      uploadSize: fileSize,
      onError: (err) => reject(new Error(`TUS upload failed: ${err.message}`)),
      onProgress: (bytesUploaded, bytesTotal) => {
        const pct = Math.floor((bytesUploaded / bytesTotal) * 100);
        if (pct >= lastLoggedPct + 10) {
          lastLoggedPct = pct;
          console.log(`  Upload progress: ${pct}% (${(bytesUploaded / 1024 / 1024).toFixed(1)}/${(bytesTotal / 1024 / 1024).toFixed(1)} MB)`);
        }
      },
      onSuccess: () => {
        console.log('  Upload complete');
        resolve();
      },
    });

    upload.start();
  });
}
