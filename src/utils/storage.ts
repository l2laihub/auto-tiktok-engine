// ============================================================
// Supabase Storage helper — upload an in-memory buffer to the
// public `photos` bucket and return its public URL.
// Used by the image-generation scripts/pipeline steps.
// Mirrors the upload + retry pattern in dashboard/server.ts.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '../../scripts/lib/retry';

let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    }
    _client = createClient(url, key);
  }
  return _client;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export interface UploadImageOptions {
  buffer: Buffer;
  contentType: string;
  /** Folder prefix within the `photos` bucket, e.g. 'generated/reveal'. */
  pathPrefix: string;
  /** Optional explicit filename (without folder). A random name is used otherwise. */
  filename?: string;
}

/**
 * Upload an image buffer to the `photos` bucket and return its public URL.
 * Retries transient failures with the shared backoff helper.
 */
export async function uploadImageBuffer(opts: UploadImageOptions): Promise<string> {
  const { buffer, contentType, pathPrefix } = opts;
  const ext = EXT_BY_MIME[contentType.toLowerCase()] || 'png';
  const name = opts.filename || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `${pathPrefix.replace(/\/$/, '')}/${name}`;

  await withRetry(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const { error } = await client().storage
          .from('photos')
          .upload(storagePath, buffer, {
            contentType,
            upsert: true,
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
      onAttempt: (attempt, err, delay) => {
        console.log(`  [storage] upload attempt ${attempt} failed (${err.message}); retrying in ${Math.round(delay)}ms`);
      },
    }
  );

  const { data: { publicUrl } } = client().storage.from('photos').getPublicUrl(storagePath);
  return publicUrl;
}
