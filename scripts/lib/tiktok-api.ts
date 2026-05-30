// ============================================================
// TikTok Content Posting API v2 Client
// Handles: token lifecycle, FILE_UPLOAD flow, status polling, retry
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';

// --- Error Classes ---

export class TikTokApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public httpStatus?: number
  ) {
    super(message);
    this.name = 'TikTokApiError';
  }
}

export class TokenExpiredError extends TikTokApiError {
  constructor(message = 'TikTok token expired and refresh failed. Run: npm run tiktok:setup') {
    super(message, 'token_expired');
    this.name = 'TokenExpiredError';
  }
}

export class ScopeError extends TikTokApiError {
  constructor(message: string, public scope?: string) {
    super(message, 'scope_not_authorized', 401);
    this.name = 'ScopeError';
  }
}

export class RateLimitError extends TikTokApiError {
  constructor(
    public retryAfterSeconds: number,
    message = `Rate limited. Retry after ${retryAfterSeconds}s`
  ) {
    super(message, 'rate_limited', 429);
    this.name = 'RateLimitError';
  }
}

export class VideoProcessingError extends TikTokApiError {
  constructor(public failReason: string) {
    super(`TikTok rejected video: ${failReason}`, 'video_processing_failed');
    this.name = 'VideoProcessingError';
  }
}

// --- Types ---

interface TokenRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface FileUploadInitResponse {
  publish_id: string;
  upload_url: string;
}

export type PublishStatus =
  | 'PROCESSING_UPLOAD'
  | 'PROCESSING_DOWNLOAD'
  | 'PUBLISH_COMPLETE'
  | 'SEND_TO_USER_INBOX'
  | 'FAILED';

export interface PublishStatusResult {
  status: PublishStatus;
  publish_id?: string;
  fail_reason?: string;
}

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermanentError(err: Error): boolean {
  if (err instanceof TokenExpiredError) return true;
  if (err instanceof ScopeError) return true;
  if (err instanceof VideoProcessingError) return true;
  if (err instanceof TikTokApiError) {
    // 400 (bad request), 403 (forbidden) are permanent
    if (err.httpStatus === 400 || err.httpStatus === 403) return true;
  }
  return false;
}

// --- Chunked upload sizing ---

// TikTok FILE_UPLOAD chunk constraints: 5MB min, 64MB max per chunk.
const TIKTOK_MAX_CHUNK_SIZE = 64_000_000;
const TIKTOK_MULTI_CHUNK_SIZE = 10_000_000; // chunk size used only when splitting

/**
 * Compute chunk_size / total_chunk_count for the publish init + the upload loop.
 * TikTok requires chunk_size === video_size when total_chunk_count is 1, so any
 * video up to the 64MB max goes as a single chunk. Larger videos are split into
 * 10MB chunks; the final chunk absorbs the remainder (kept well under 64MB).
 */
export function computeVideoChunking(videoSize: number): {
  chunkSize: number;
  totalChunkCount: number;
} {
  if (videoSize <= TIKTOK_MAX_CHUNK_SIZE) {
    return { chunkSize: videoSize, totalChunkCount: 1 };
  }
  const chunkSize = TIKTOK_MULTI_CHUNK_SIZE;
  return { chunkSize, totalChunkCount: Math.floor(videoSize / chunkSize) };
}

// --- TikTok Client ---

export class TikTokClient {
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private supabase: SupabaseClient) {}

  /**
   * Get a valid access token. Checks Supabase first, auto-refreshes if
   * expired, falls back to TIKTOK_ACCESS_TOKEN env var.
   * Returns null if no token is available anywhere.
   */
  async getAccessToken(): Promise<string | null> {
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;
    if (this.cachedToken && this.tokenExpiresAt - now > bufferMs) {
      return this.cachedToken;
    }

    const { data, error } = await this.supabase
      .from('tiktok_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('id', 'default')
      .single();

    if (error) {
      console.log(`  tiktok_tokens lookup: ${error.message}`);
    }

    if (data) {
      const expiresAt = new Date(data.expires_at).getTime();
      const remainingMs = expiresAt - now;
      console.log(`  Token found, expires in ${Math.round(remainingMs / 1000 / 60)} minutes`);

      if (remainingMs > bufferMs) {
        this.cachedToken = data.access_token;
        this.tokenExpiresAt = expiresAt;
        return data.access_token;
      }

      if (remainingMs > 0) {
        console.log('  Token expiring soon, attempting refresh...');
        try {
          return await this.refreshToken(data.refresh_token);
        } catch (err) {
          console.log('  Refresh failed, using current token:', err instanceof Error ? err.message : err);
          this.cachedToken = data.access_token;
          this.tokenExpiresAt = expiresAt;
          return data.access_token;
        }
      }

      console.log('  Token expired, refreshing...');
      try {
        return await this.refreshToken(data.refresh_token);
      } catch (err) {
        console.error('  Token refresh failed:', err instanceof Error ? err.message : err);
      }
    }

    const envToken = process.env.TIKTOK_ACCESS_TOKEN;
    if (envToken) {
      console.log('  Using static TIKTOK_ACCESS_TOKEN from env (no auto-refresh)');
      return envToken;
    }

    return null;
  }

  /**
   * Refresh the access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<string> {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey || !clientSecret) {
      throw new TokenExpiredError(
        'Cannot refresh token: TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET required. Run: npm run tiktok:setup'
      );
    }

    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const result = await response.json();

    if (result.error || !result.access_token) {
      throw new TokenExpiredError(
        `Token refresh failed: ${result.error_description || result.error || 'unknown error'}. Run: npm run tiktok:setup`
      );
    }

    const expiresAt = new Date(Date.now() + result.expires_in * 1000);

    await this.supabase.from('tiktok_tokens').upsert({
      id: 'default',
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: expiresAt.toISOString(),
      scope: result.scope,
      open_id: result.open_id,
      updated_at: new Date().toISOString(),
    });

    this.cachedToken = result.access_token;
    this.tokenExpiresAt = expiresAt.getTime();

    console.log('  TikTok token refreshed successfully');
    return result.access_token;
  }

  /**
   * Make an authenticated fetch request to TikTok API.
   * Handles 401 by checking if it's a scope issue vs token expiry.
   */
  private async fetchWithAuth(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new TikTokApiError('No TikTok access token available');
    }

    const makeRequest = async (accessToken: string) => {
      return fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    };

    let response = await makeRequest(token);
    const endpoint = url.split('/').slice(-3).join('/');
    console.log(`  TikTok API ${endpoint}: HTTP ${response.status}`);

    if (response.status === 401) {
      // Read the error to determine if it's scope vs token expiry
      const errorBody = await response.text();
      console.log(`  401 response: ${errorBody}`);

      let parsed: any = {};
      try { parsed = JSON.parse(errorBody); } catch {}

      // scope_not_authorized = permanent error, don't bother refreshing
      if (parsed.error?.code === 'scope_not_authorized') {
        throw new ScopeError(
          `Scope not authorized: ${parsed.error.message}. Your token scopes may not include the required permission.`,
          parsed.error.code
        );
      }

      // Otherwise try token refresh
      console.log('  Attempting token refresh...');
      const { data } = await this.supabase
        .from('tiktok_tokens')
        .select('refresh_token, scope')
        .eq('id', 'default')
        .single();

      if (data?.scope) {
        console.log(`  Token scopes: ${data.scope}`);
      }

      if (!data?.refresh_token) {
        throw new TokenExpiredError();
      }

      try {
        const newToken = await this.refreshToken(data.refresh_token);
        response = await makeRequest(newToken);
        console.log(`  Retry after refresh: HTTP ${response.status}`);

        if (response.status === 401) {
          const retryBody = await response.text();
          let retryParsed: any = {};
          try { retryParsed = JSON.parse(retryBody); } catch {}

          if (retryParsed.error?.code === 'scope_not_authorized') {
            throw new ScopeError(
              `Scope not authorized even after refresh: ${retryParsed.error.message}`,
              retryParsed.error.code
            );
          }
          throw new TokenExpiredError('Token invalid even after refresh.');
        }
      } catch (err) {
        if (err instanceof TikTokApiError) throw err;
        throw new TokenExpiredError(
          `Token refresh failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
      throw new RateLimitError(retryAfter);
    }

    return response;
  }

  /**
   * Generic retry wrapper with exponential backoff.
   * Permanent errors (scope, 403, token expired) are NOT retried.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    opts: RetryOptions = DEFAULT_RETRY
  ): Promise<T> {
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry permanent errors
        if (isPermanentError(lastError)) {
          throw lastError;
        }

        if (attempt === opts.maxRetries) break;

        if (lastError instanceof RateLimitError) {
          console.log(`  Rate limited, waiting ${lastError.retryAfterSeconds}s...`);
          await sleep(lastError.retryAfterSeconds * 1000);
          continue;
        }

        const delay = Math.min(
          opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 500,
          opts.maxDelayMs
        );
        console.log(`  Retry ${attempt + 1}/${opts.maxRetries} after ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Initialize a Direct Post via FILE_UPLOAD.
   * Requires 'video.publish' scope.
   */
  async initDirectPost(
    videoSize: number,
    title: string
  ): Promise<FileUploadInitResponse> {
    const { chunkSize, totalChunkCount } = computeVideoChunking(videoSize);

    return this.withRetry(async () => {
      const requestBody = {
        post_info: {
          title,
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_stitch: false,
          disable_comment: false,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      };

      console.log(`  Direct post request body:`, JSON.stringify(requestBody));

      const response = await this.fetchWithAuth(
        'https://open.tiktokapis.com/v2/post/publish/video/init/',
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
        }
      );

      const result = await response.json();
      console.log(`  TikTok direct post response:`, JSON.stringify(result, null, 2));

      if (result.error?.code && result.error.code !== 'ok') {
        const errMsg = result.error.message || result.error.code;
        throw new TikTokApiError(`TikTok API error: ${errMsg}`, result.error.code, response.status);
      }

      if (!result.data?.publish_id || !result.data?.upload_url) {
        throw new TikTokApiError('Missing publish_id or upload_url in TikTok response');
      }

      return {
        publish_id: result.data.publish_id,
        upload_url: result.data.upload_url,
      };
    });
  }

  /**
   * Initialize an Inbox Upload via FILE_UPLOAD.
   * Requires 'video.upload' scope (works in sandbox).
   * Video appears in creator's TikTok inbox for review before posting.
   */
  async initInboxUpload(
    videoSize: number
  ): Promise<FileUploadInitResponse> {
    const { chunkSize, totalChunkCount } = computeVideoChunking(videoSize);

    return this.withRetry(async () => {
      const requestBody = {
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: videoSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
      };

      console.log(`  Inbox upload request body:`, JSON.stringify(requestBody));

      const response = await this.fetchWithAuth(
        'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/',
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
        }
      );

      const result = await response.json();
      console.log(`  TikTok inbox upload response:`, JSON.stringify(result, null, 2));

      if (result.error?.code && result.error.code !== 'ok') {
        const errMsg = result.error.message || result.error.code;
        throw new TikTokApiError(`TikTok API error: ${errMsg}`, result.error.code, response.status);
      }

      if (!result.data?.publish_id || !result.data?.upload_url) {
        throw new TikTokApiError('Missing publish_id or upload_url in TikTok response');
      }

      return {
        publish_id: result.data.publish_id,
        upload_url: result.data.upload_url,
      };
    });
  }

  /**
   * Upload the video file to TikTok's upload URL in chunks.
   * Uses 10MB chunks; files under 10MB go as a single chunk.
   */
  async uploadVideoFile(uploadUrl: string, filePath: string): Promise<void> {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize = fileBuffer.length;
    // Must match the init request exactly (last chunk absorbs the remainder).
    const { chunkSize, totalChunkCount: totalChunks } = computeVideoChunking(fileSize);

    console.log(`  Uploading ${(fileSize / 1024 / 1024).toFixed(1)}MB to TikTok (${totalChunks} chunk${totalChunks > 1 ? 's' : ''})...`);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      // Last chunk gets all remaining bytes (may be larger than chunkSize)
      const end = (i === totalChunks - 1) ? fileSize : start + chunkSize;
      const chunk = fileBuffer.subarray(start, end);

      console.log(`  Chunk ${i + 1}/${totalChunks}: bytes ${start}-${end - 1}/${fileSize}`);

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${start}-${end - 1}/${fileSize}`,
          'Content-Length': String(chunk.length),
          'Content-Type': 'video/mp4',
        },
        body: chunk,
      });

      console.log(`  Chunk ${i + 1} response: HTTP ${response.status}`);

      if (!response.ok) {
        const body = await response.text();
        console.log(`  Upload error body: ${body}`);
        throw new TikTokApiError(
          `Video upload failed at chunk ${i + 1}: HTTP ${response.status}`,
          'upload_failed',
          response.status
        );
      }
    }

    console.log('  Video uploaded successfully');
  }

  /**
   * Proactively refresh the token if it expires within the given window.
   * Call this before large uploads to avoid mid-upload expiry.
   */
  async ensureFreshToken(minRemainingMs = 30 * 60 * 1000): Promise<void> {
    const { data } = await this.supabase
      .from('tiktok_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('id', 'default')
      .single();

    if (!data) return;

    const remainingMs = new Date(data.expires_at).getTime() - Date.now();
    if (remainingMs < minRemainingMs && data.refresh_token) {
      console.log(`  Token expires in ${Math.round(remainingMs / 1000 / 60)} min, proactively refreshing...`);
      try {
        await this.refreshToken(data.refresh_token);
      } catch (err) {
        console.warn('  Proactive refresh failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  /**
   * Full publish flow: init → upload file → return publish_id.
   * Tries Direct Post first (video.publish), falls back to Inbox Upload (video.upload).
   */
  async initVideoPublish(
    filePath: string,
    title: string
  ): Promise<{ publish_id: string; mode: 'direct' | 'inbox' }> {
    const fileSize = fs.statSync(filePath).size;
    console.log(`  Video file: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

    // Try Direct Post first
    try {
      const { publish_id, upload_url } = await this.initDirectPost(fileSize, title);
      await this.uploadVideoFile(upload_url, filePath);
      return { publish_id, mode: 'direct' };
    } catch (err) {
      if (err instanceof ScopeError) {
        console.log('  Direct Post not available (scope), falling back to Inbox Upload...');
      } else if (err instanceof TikTokApiError && err.httpStatus === 403) {
        console.log(`  Direct Post blocked (${err.code || '403'}), falling back to Inbox Upload...`);
      } else {
        throw err;
      }
    }

    // Fall back to Inbox Upload
    console.log('  Using Inbox Upload (video will appear in your TikTok inbox)');
    const { publish_id, upload_url } = await this.initInboxUpload(fileSize);
    await this.uploadVideoFile(upload_url, filePath);
    return { publish_id, mode: 'inbox' };
  }

  /**
   * Poll TikTok for the publish status of a video.
   * Intervals: 5s, 10s, 15s, 20s, then 30s until timeout (~5 min total).
   */
  async pollPublishStatus(
    publishId: string,
    maxWaitMs = 5 * 60 * 1000
  ): Promise<PublishStatusResult> {
    const intervals = [5000, 10000, 15000, 20000];
    const startTime = Date.now();
    let pollIndex = 0;

    while (Date.now() - startTime < maxWaitMs) {
      const waitMs =
        pollIndex < intervals.length ? intervals[pollIndex] : 30000;
      await sleep(waitMs);
      pollIndex++;

      try {
        const response = await this.fetchWithAuth(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            body: JSON.stringify({ publish_id: publishId }),
          }
        );

        const result = await response.json();

        if (result.error?.code && result.error.code !== 'ok') {
          console.log(`  Poll error: ${result.error.message}, continuing...`);
          continue;
        }

        const status = result.data?.status as PublishStatus | undefined;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Poll ${pollIndex}: status=${status} (${elapsed}s elapsed)`);

        if (status === 'PUBLISH_COMPLETE') {
          return {
            status: 'PUBLISH_COMPLETE',
            publish_id: result.data?.publish_id || publishId,
          };
        }

        // Inbox uploads terminate here — the video is in the user's inbox and
        // never reaches PUBLISH_COMPLETE (they post it manually). Stop polling.
        if (status === 'SEND_TO_USER_INBOX') {
          return {
            status: 'SEND_TO_USER_INBOX',
            publish_id: result.data?.publish_id || publishId,
          };
        }

        if (status === 'FAILED') {
          const reason = result.data?.fail_reason || 'unknown';
          return { status: 'FAILED', fail_reason: reason };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  Poll error (will retry): ${msg}`);
        if (err instanceof TokenExpiredError) throw err;
      }
    }

    console.log(`  Polling timed out after ${Math.round(maxWaitMs / 1000)}s`);
    return {
      status: 'PROCESSING_DOWNLOAD',
      publish_id: publishId,
    };
  }
}
