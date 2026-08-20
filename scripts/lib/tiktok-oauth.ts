// ============================================================
// TikTok OAuth helpers — PKCE generation, auth URL builder,
// and authorization-code → token exchange.
// Pure (no Supabase persistence). Caller decides what to do
// with the returned tokens.
// ============================================================

import crypto from 'crypto';

export interface TikTokTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string | null;
  openId: string | null;
}

export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
}

export interface BuildAuthUrlParams {
  clientKey: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').slice(0, 128);
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function buildAuthUrl(params: BuildAuthUrlParams): string {
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', params.clientKey);
  url.searchParams.set('scope', params.scopes);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCodeForTokens(
  params: ExchangeCodeParams
): Promise<TikTokTokenResponse> {
  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: params.clientKey,
      client_secret: params.clientSecret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
  });

  const result = await response.json();

  if (result.error || !result.access_token) {
    const detail = result.error_description || result.error || JSON.stringify(result);
    throw new Error(`TikTok token exchange failed: ${detail}`);
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: new Date(Date.now() + result.expires_in * 1000),
    scope: result.scope ?? null,
    openId: result.open_id ?? null,
  };
}

// Parse a pasted callback URL (or raw code) and return { code, state } if present.
// Throws if state mismatch is detected.
export function parseCallbackInput(
  input: string,
  expectedState?: string
): { code: string; state: string | null } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('No URL or code provided');

  if (trimmed.startsWith('http')) {
    const redirectUrl = new URL(trimmed);
    const code = redirectUrl.searchParams.get('code') || '';
    const state = redirectUrl.searchParams.get('state');
    if (!code) throw new Error('No `code` parameter found in callback URL');
    if (expectedState && state && state !== expectedState) {
      throw new Error('State mismatch — the URL may be from a different auth attempt');
    }
    return { code, state };
  }

  return { code: trimmed, state: null };
}

// Account ids are the tiktok_tokens primary key and the content pool's
// tiktok_account value, so keep them to a simple slug. Empty input means the
// default account (@huybuilds). Returns null when the input is unusable.
export function normalizeAccountId(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return 'default';
  if (typeof input !== 'string') return null;
  const id = input.trim().toLowerCase();
  if (!id) return 'default';
  return /^[a-z0-9][a-z0-9._-]{0,39}$/.test(id) ? id : null;
}

export interface TikTokUserInfo {
  openId: string | null;
  displayName: string | null;
  username: string | null;
}

// Which TikTok profile a token actually belongs to. Best-effort: a missing
// label is never worth failing an authorization over, so errors return nulls.
// `username` lives behind the user.info.profile scope and asking for it without
// that scope fails the WHOLE request, so it is only requested when granted.
export async function fetchUserInfo(
  accessToken: string,
  grantedScope?: string | null
): Promise<TikTokUserInfo> {
  const fields = ['open_id', 'display_name'];
  if (grantedScope?.includes('user.info.profile')) fields.push('username');

  try {
    const response = await fetch(
      `https://open.tiktokapis.com/v2/user/info/?fields=${fields.join(',')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const result = await response.json();
    const user = result?.data?.user;
    return {
      openId: user?.open_id ?? null,
      displayName: user?.display_name ?? null,
      username: user?.username ?? null,
    };
  } catch {
    return { openId: null, displayName: null, username: null };
  }
}
