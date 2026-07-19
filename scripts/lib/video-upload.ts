// Shared TUS resumable upload to the Supabase `videos` bucket.
// Supabase recommends TUS for anything >6MB; chunks are sent independently and
// retried per-chunk with exponential backoff, sidestepping the "fetch failed"
// failure mode of a single buffered supabase-js upload on Node 20.
// Used by the render pipeline (step 5) and the dashboard's external-video upload.

import * as tus from 'tus-js-client';
import fs from 'fs';

export function uploadVideoTus(localPath: string, storagePath: string, fileSize: number): Promise<void> {
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
