#!/usr/bin/env tsx
// ============================================================
// TikTok OAuth Setup — One-time script to acquire tokens
// ============================================================
// Usage:
//   npm run tiktok:setup                  # full OAuth flow (manual code paste)
//   npm run tiktok:setup -- --refresh-only # refresh existing token
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'readline';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  buildAuthUrl,
  exchangeCodeForTokens as exchangeOAuthCode,
  parseCallbackInput,
  type TikTokTokenResponse,
} from './lib/tiktok-oauth';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
// Scopes must match products enabled in your TikTok Developer app.
// Override via env var if needed, e.g. TIKTOK_SCOPES=user.info.basic,video.upload,video.publish
const SCOPES = process.env.TIKTOK_SCOPES || 'user.info.basic,video.upload,video.publish';

// TikTok requires HTTPS redirect URIs. For desktop/CLI apps, use their
// special desktop redirect URI or a registered HTTPS domain.
// You must register this exact URI in your TikTok app settings.
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || 'https://www.tiktok.com/';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error('Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET in .env');
  console.error('Get these from https://developers.tiktok.com → your app → App Info');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Readline Helper ---

function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Token Exchange ---

async function persistTokens(tokens: TikTokTokenResponse): Promise<void> {
  const { error } = await supabase.from('tiktok_tokens').upsert({
    id: 'default',
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt.toISOString(),
    scope: tokens.scope,
    open_id: tokens.openId,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to store tokens in Supabase:', error.message);
    process.exit(1);
  }
}

async function exchangeAndPersist(code: string, codeVerifier: string): Promise<void> {
  console.log('\nExchanging authorization code for tokens...');

  let tokens: TikTokTokenResponse;
  try {
    tokens = await exchangeOAuthCode({
      code,
      codeVerifier,
      clientKey: CLIENT_KEY!,
      clientSecret: CLIENT_SECRET!,
      redirectUri: REDIRECT_URI,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  await persistTokens(tokens);

  console.log('\nTokens stored successfully!');
  console.log(`  Open ID: ${tokens.openId}`);
  console.log(`  Scope: ${tokens.scope}`);
  console.log(`  Expires at: ${tokens.expiresAt.toISOString()}`);
  console.log(`  Refresh token: ${tokens.refreshToken ? 'received' : 'NOT received'}`);
}

// --- Refresh Only ---

async function refreshOnly(): Promise<void> {
  console.log('Refreshing existing token...');

  const { data } = await supabase
    .from('tiktok_tokens')
    .select('refresh_token')
    .eq('id', 'default')
    .single();

  if (!data?.refresh_token) {
    console.error('No refresh token found in tiktok_tokens table.');
    console.error('Run without --refresh-only to do the full OAuth flow first.');
    process.exit(1);
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: CLIENT_KEY!,
      client_secret: CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: data.refresh_token,
    }),
  });

  const result = await response.json();

  if (result.error || !result.access_token) {
    console.error('Refresh failed:', result.error_description || result.error);
    console.error('The refresh token may have expired. Run the full OAuth flow again.');
    process.exit(1);
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

  console.log('Token refreshed successfully!');
  console.log(`  Expires at: ${expiresAt.toISOString()}`);
}

// --- Full OAuth Flow (Manual Code Paste) ---

async function fullOAuthFlow(): Promise<void> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const authUrl = buildAuthUrl({
    clientKey: CLIENT_KEY!,
    redirectUri: REDIRECT_URI,
    scopes: SCOPES,
    state,
    codeChallenge,
  });

  console.log('\n=== TikTok OAuth Setup ===\n');
  console.log('Step 1: Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nStep 2: Authorize the app on TikTok.');
  console.log('\nStep 3: After authorizing, you will be redirected to a URL.');
  console.log(`        It will look like: ${REDIRECT_URI}?code=XXXXX&state=XXXXX`);
  console.log('\nStep 4: Copy the ENTIRE redirect URL from your browser address bar');
  console.log('        and paste it below.\n');

  // Try to open browser automatically — execFile avoids shell interpolation.
  try {
    const { execFile } = await import('child_process');
    if (process.platform === 'darwin') {
      execFile('open', [authUrl]);
    } else if (process.platform === 'win32') {
      execFile('cmd', ['/c', 'start', '', authUrl]);
    } else {
      execFile('xdg-open', [authUrl]);
    }
    console.log('(Browser should open automatically)\n');
  } catch {
    // Best-effort
  }

  const input = await askQuestion('Paste the redirect URL here: ');

  let code: string;
  try {
    code = parseCallbackInput(input, state).code;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(`  Authorization code: ${code.slice(0, 10)}...`);
  await exchangeAndPersist(code, codeVerifier);
}

// --- Main ---
async function main() {
  if (process.argv.includes('--refresh-only')) {
    await refreshOnly();
  } else {
    await fullOAuthFlow();
  }

  console.log('\nDone! You can now run the pipeline:');
  console.log('  npm run pipeline       # full pipeline with TikTok posting');
  console.log('  npm run pipeline:dry   # dry run (no posting)');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
