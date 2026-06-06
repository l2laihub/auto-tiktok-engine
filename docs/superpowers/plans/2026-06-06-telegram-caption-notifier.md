# Telegram Caption Notifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a video is sent to the TikTok inbox via Inbox Upload, push a Telegram message with a copy-paste-ready caption + hashtags, content id/type, scheduled time, a thumbnail, and a dashboard deep link.

**Architecture:** A self-contained notifier module (`scripts/lib/telegram.ts`) with pure, unit-tested helpers (`buildInboxMessage`, `resolveThumbnail`, `buildDashboardUrl`) and a thin `notifyInboxVideo()` send wrapper that never throws. It is called from the existing `mode === 'inbox'` branch of `scripts/render-video.ts`, covering both scheduled and manual runs. A small deep-link handler in `dashboard/index.html` makes the message's link jump to the item. All config is optional — absent Telegram vars mean the notifier silently skips (same pattern as the music/image steps).

**Tech Stack:** TypeScript run via `tsx`, `node:test` for unit tests, Telegram Bot HTTP API via `fetch` (no new npm dependency), htm/React SPA for the dashboard.

---

## File Structure

- **Create** `scripts/lib/telegram.ts` — notifier: pure builders + types + `notifyInboxVideo` send wrapper. One responsibility: turning an inbox event into a Telegram message.
- **Create** `scripts/lib/__tests__/telegram.test.ts` — unit tests for the pure functions.
- **Modify** `scripts/render-video.ts` — add `scheduled_for` to `ContentRow`, import the notifier, call it in the `mode === 'inbox'` branch.
- **Modify** `dashboard/index.html` — row `id` anchor + `#item-<shortId>` deep-link `useEffect`.
- **Modify** `.env.example` — new optional vars with setup comments.
- **Modify** `CLAUDE.md` — document the notifier + env vars.

---

## Task 1: Pure message builder (`buildInboxMessage`)

**Files:**
- Create: `scripts/lib/telegram.ts`
- Test: `scripts/lib/__tests__/telegram.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/__tests__/telegram.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInboxMessage } from '../telegram';

const base = {
  caption: 'Grandma looked SO happy here 🥹 #photorestoration #familyhistory',
  contentId: 'a1b2c3d4e5f6',
  contentType: 'reveal',
};

test('buildInboxMessage puts the caption in a copyable <code> block', () => {
  const { text } = buildInboxMessage(base);
  assert.match(text, /<code>Grandma looked SO happy here 🥹 #photorestoration #familyhistory<\/code>/);
});

test('buildInboxMessage shows content type and short id', () => {
  const { text } = buildInboxMessage(base);
  assert.match(text, /reveal · a1b2c3d4/);
  assert.doesNotMatch(text, /a1b2c3d4e5f6/); // only the 8-char short id
});

test('buildInboxMessage HTML-escapes the caption', () => {
  const { text } = buildInboxMessage({ ...base, caption: 'Before & after <3' });
  assert.match(text, /<code>Before &amp; after &lt;3<\/code>/);
});

test('buildInboxMessage includes the Scheduled line only when scheduledFor is set', () => {
  const withTime = buildInboxMessage({ ...base, scheduledFor: '2026-06-06T16:00:00.000Z' });
  assert.match(withTime.text, /Scheduled:/);
  const without = buildInboxMessage(base);
  assert.doesNotMatch(without.text, /Scheduled:/);
});

test('buildInboxMessage includes the dashboard link only when dashboardUrl is set', () => {
  const withUrl = buildInboxMessage({ ...base, dashboardUrl: 'http://192.168.1.50:3001/#item-a1b2c3d4' });
  assert.match(withUrl.text, /<a href="http:\/\/192\.168\.1\.50:3001\/#item-a1b2c3d4">Open in dashboard<\/a>/);
  const without = buildInboxMessage(base);
  assert.doesNotMatch(without.text, /Open in dashboard/);
});

test('buildInboxMessage returns photoUrl when a thumbnailUrl is provided', () => {
  const { photoUrl } = buildInboxMessage({ ...base, thumbnailUrl: 'https://x.test/after.png' });
  assert.equal(photoUrl, 'https://x.test/after.png');
});

test('buildInboxMessage returns undefined photoUrl when no thumbnail', () => {
  const { photoUrl } = buildInboxMessage(base);
  assert.equal(photoUrl, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../telegram'` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/telegram.ts`:

```ts
// ============================================================
// Telegram notifier — pushes the caption + hashtags to your phone
// when a video lands in the TikTok inbox (Inbox Upload has no caption
// field, so it must be typed by hand when finishing the draft).
// Pure builders are unit-tested; the send wrapper is a thin fetch.
// ============================================================

export interface InboxMessagePayload {
  /** Full "caption #tag1 #tag2 …" string the user pastes into TikTok. */
  caption: string;
  /** Full content item id. */
  contentId: string;
  /** 'reveal' | 'tip'. */
  contentType: string;
  /** ISO timestamp the item was scheduled for; omitted line when absent. */
  scheduledFor?: string | null;
  /** Public image URL to attach as a photo; text-only when absent. */
  thumbnailUrl?: string;
  /** Dashboard deep link; omitted line when absent. */
  dashboardUrl?: string;
}

/** Escape the five HTML-sensitive chars for Telegram HTML parse mode. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Format an ISO timestamp in the server's local timezone, e.g. "Jun 6, 2026, 9:00 AM". */
function formatScheduled(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Build the Telegram message body (HTML parse mode) and pick the photo URL.
 * Pure — no I/O — so it is fully unit-testable.
 */
export function buildInboxMessage(p: InboxMessagePayload): { text: string; photoUrl?: string } {
  const shortId = p.contentId.slice(0, 8);
  const lines: string[] = [
    '📥 New TikTok draft ready to post',
    '',
    `${p.contentType} · ${shortId}`,
  ];
  if (p.scheduledFor) {
    lines.push(`🗓 Scheduled: ${formatScheduled(p.scheduledFor)}`);
  }
  lines.push('', 'Caption (tap to copy):', `<code>${escapeHtml(p.caption)}</code>`);
  if (p.dashboardUrl) {
    lines.push('', `🔗 <a href="${p.dashboardUrl}">Open in dashboard</a>`);
  }
  return { text: lines.join('\n'), photoUrl: p.thumbnailUrl };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `buildInboxMessage` tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/telegram.ts scripts/lib/__tests__/telegram.test.ts
git commit -m "feat: pure Telegram inbox message builder"
```

---

## Task 2: Pure helpers (`resolveThumbnail`, `buildDashboardUrl`) + `isTelegramConfigured`

**Files:**
- Modify: `scripts/lib/telegram.ts`
- Test: `scripts/lib/__tests__/telegram.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/lib/__tests__/telegram.test.ts`:

```ts
import { resolveThumbnail, buildDashboardUrl, isTelegramConfigured } from '../telegram';

test('resolveThumbnail picks the first reveal pair after_url', () => {
  const item = { id: 'x', content_type: 'reveal' as const, image_pairs: [{ after_url: 'https://x.test/a.png' }] };
  assert.equal(resolveThumbnail(item), 'https://x.test/a.png');
});

test('resolveThumbnail falls back to legacy after_image_url for reveals', () => {
  const item = { id: 'x', content_type: 'reveal' as const, after_image_url: 'https://x.test/legacy.png' };
  assert.equal(resolveThumbnail(item), 'https://x.test/legacy.png');
});

test('resolveThumbnail prefers tip_image_url for tips', () => {
  const item = { id: 'x', content_type: 'tip' as const, tip_image_url: 'https://x.test/tip.png', tip_images: ['https://x.test/other.png'] };
  assert.equal(resolveThumbnail(item), 'https://x.test/tip.png');
});

test('resolveThumbnail falls back to tip_images[0] then tips[0].tipImageSrc', () => {
  assert.equal(
    resolveThumbnail({ id: 'x', content_type: 'tip' as const, tip_images: ['https://x.test/i0.png'] }),
    'https://x.test/i0.png'
  );
  assert.equal(
    resolveThumbnail({ id: 'x', content_type: 'tip' as const, tips: [{ tipImageSrc: 'https://x.test/t0.png' }] }),
    'https://x.test/t0.png'
  );
});

test('resolveThumbnail returns undefined when nothing is available', () => {
  assert.equal(resolveThumbnail({ id: 'x', content_type: 'reveal' as const }), undefined);
});

test('buildDashboardUrl builds an #item-<shortId> deep link from a base url', () => {
  assert.equal(
    buildDashboardUrl('a1b2c3d4e5f6', 'http://192.168.1.50:3001'),
    'http://192.168.1.50:3001/#item-a1b2c3d4'
  );
});

test('buildDashboardUrl strips a trailing slash on the base url', () => {
  assert.equal(
    buildDashboardUrl('a1b2c3d4e5f6', 'http://192.168.1.50:3001/'),
    'http://192.168.1.50:3001/#item-a1b2c3d4'
  );
});

test('buildDashboardUrl returns undefined without a base url', () => {
  assert.equal(buildDashboardUrl('a1b2c3d4e5f6', undefined), undefined);
  assert.equal(buildDashboardUrl('a1b2c3d4e5f6', ''), undefined);
});

test('isTelegramConfigured reflects both env vars being present', () => {
  const origToken = process.env.TELEGRAM_BOT_TOKEN;
  const origChat = process.env.TELEGRAM_CHAT_ID;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(isTelegramConfigured(), false);
    process.env.TELEGRAM_BOT_TOKEN = 'tok';
    assert.equal(isTelegramConfigured(), false);
    process.env.TELEGRAM_CHAT_ID = '123';
    assert.equal(isTelegramConfigured(), true);
  } finally {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = origToken;
    if (origChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = origChat;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `resolveThumbnail`/`buildDashboardUrl`/`isTelegramConfigured` are not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/lib/telegram.ts`:

```ts
/** Minimal structural view of a content item — the fields the notifier reads. */
export interface NotifiableItem {
  id: string;
  content_type: 'reveal' | 'tip';
  scheduled_for?: string | null;
  image_pairs?: Array<{ after_url?: string }>;
  after_image_url?: string;
  tip_image_url?: string;
  tip_images?: string[];
  tips?: Array<{ tipImageSrc?: string; tipImages?: string[] }>;
}

/**
 * Resolve a representative public image URL for the item's thumbnail.
 * Reuses already-generated imagery — no frame extraction. Returns undefined
 * when nothing usable exists (caller then sends a text-only message).
 */
export function resolveThumbnail(item: NotifiableItem): string | undefined {
  if (item.content_type === 'reveal') {
    return item.image_pairs?.[0]?.after_url || item.after_image_url || undefined;
  }
  return (
    item.tip_image_url ||
    item.tip_images?.[0] ||
    item.tips?.[0]?.tipImageSrc ||
    item.tips?.[0]?.tipImages?.[0] ||
    undefined
  );
}

/** Build the dashboard deep link, or undefined when no base url is configured. */
export function buildDashboardUrl(contentId: string, baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, '')}/#item-${contentId.slice(0, 8)}`;
}

/** True when both Telegram env vars are present. */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all telegram tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/telegram.ts scripts/lib/__tests__/telegram.test.ts
git commit -m "feat: thumbnail + dashboard-url + config helpers for Telegram notifier"
```

---

## Task 3: Send wrapper (`notifyInboxVideo`)

**Files:**
- Modify: `scripts/lib/telegram.ts`

This task adds the network code. Per repo convention (pure functions only in `node:test`), the `fetch` wrapper is not unit-tested; it is verified manually in Task 6.

- [ ] **Step 1: Write the implementation**

Append to `scripts/lib/telegram.ts`:

```ts
const TELEGRAM_API = 'https://api.telegram.org';

/** POST a Telegram Bot API method as JSON; throw on transport or API error. */
async function postTelegram(token: string, method: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(`Telegram ${method} failed: HTTP ${res.status} ${json?.description || ''}`.trim());
  }
}

/**
 * Notify the operator that a video is in their TikTok inbox awaiting a manual
 * post. Sends a photo (with the message as its caption) when a thumbnail is
 * available, otherwise a text message. NEVER throws — a notifier failure must
 * not fail the post. Skips silently when Telegram is not configured.
 */
export async function notifyInboxVideo(payload: InboxMessagePayload): Promise<void> {
  if (!isTelegramConfigured()) {
    console.log('  Telegram not configured — skipping inbox notification');
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const { text, photoUrl } = buildInboxMessage(payload);

  try {
    if (photoUrl) {
      await postTelegram(token, 'sendPhoto', {
        chat_id: chatId,
        photo: photoUrl,
        caption: text,
        parse_mode: 'HTML',
      });
    } else {
      await postTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }
    console.log('  Telegram inbox notification sent');
  } catch (err) {
    console.warn(`  Telegram notification failed (non-fatal): ${err instanceof Error ? err.message : err}`);
  }
}
```

- [ ] **Step 2: Verify the module type-checks and tests still pass**

Run: `npx tsc --noEmit && npm test`
Expected: tsc reports no errors; all telegram tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/telegram.ts
git commit -m "feat: notifyInboxVideo Telegram send wrapper (never throws)"
```

---

## Task 4: Wire the notifier into the pipeline

**Files:**
- Modify: `scripts/render-video.ts` (interface at lines 61-103; inbox branch at lines 766-770)

- [ ] **Step 1: Add `scheduled_for` to the `ContentRow` interface**

In `scripts/render-video.ts`, find the `// CTA` block at the end of `ContentRow` (around line 101-102):

```ts
  // CTA
  slogan?: string;
}
```

Replace it with:

```ts
  // CTA
  slogan?: string;
  // Scheduling (TIMESTAMPTZ) — used for the Telegram inbox notification.
  scheduled_for?: string | null;
}
```

- [ ] **Step 2: Import the notifier**

In `scripts/render-video.ts`, find the local lib import (line 26):

```ts
import type { PhotoSubject } from './lib/image-prompts';
```

Add immediately after it:

```ts
import { notifyInboxVideo, resolveThumbnail, buildDashboardUrl } from './lib/telegram';
```

- [ ] **Step 3: Call the notifier in the inbox branch**

In `scripts/render-video.ts`, find the inbox branch (lines 766-770):

```ts
    if (mode === 'inbox') {
      console.log('  Video sent to your TikTok inbox!');
      console.log('  Open TikTok app → check inbox → review and post the video.');
      console.log(`  Caption to use: ${title}`);
    }
```

Replace it with:

```ts
    if (mode === 'inbox') {
      console.log('  Video sent to your TikTok inbox!');
      console.log('  Open TikTok app → check inbox → review and post the video.');
      console.log(`  Caption to use: ${title}`);
      await notifyInboxVideo({
        caption: title,
        contentId: item.id,
        contentType: item.content_type,
        scheduledFor: item.scheduled_for ?? null,
        thumbnailUrl: resolveThumbnail(item),
        dashboardUrl: buildDashboardUrl(item.id, process.env.DASHBOARD_BASE_URL),
      });
    }
```

- [ ] **Step 4: Verify it type-checks and tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: tsc reports no errors (`ContentRow` is structurally assignable to `NotifiableItem`); tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-video.ts
git commit -m "feat: send Telegram inbox notification after Inbox Upload"
```

---

## Task 5: Dashboard deep link

**Files:**
- Modify: `dashboard/index.html` (state/effects around lines 2285-2290; row `<tr>` at line 2385)

- [ ] **Step 1: Add an id anchor to each content row**

In `dashboard/index.html`, find the row (line 2385):

```js
                  <tr className=${expandedId === item.id ? 'expanded' : ''} style=${{cursor: 'pointer'}} onClick=${() => setExpandedId(expandedId === item.id ? null : item.id)}>
```

Replace it with (adds `id=`):

```js
                  <tr id=${'item-' + item.id.slice(0, 8)} className=${expandedId === item.id ? 'expanded' : ''} style=${{cursor: 'pointer'}} onClick=${() => setExpandedId(expandedId === item.id ? null : item.id)}>
```

- [ ] **Step 2: Add the deep-link effect**

In `dashboard/index.html`, find the polling effect (lines 2286-2290):

```js
      useEffect(() => {
        if (!hasActive) return;
        const interval = setInterval(fetchItems, 5000);
        return () => clearInterval(interval);
      }, [hasActive]);
```

Add immediately after it:

```js
      // Deep link from the Telegram notification: #item-<shortId> expands and
      // scrolls to that item once the list has loaded.
      useEffect(() => {
        if (!items.length) return;
        const m = (window.location.hash || '').match(/^#item-([0-9a-f]{8})/i);
        if (!m) return;
        const target = items.find(i => i.id.slice(0, 8) === m[1].toLowerCase());
        if (!target) return;
        setExpandedId(target.id);
        const el = document.getElementById('item-' + m[1].toLowerCase());
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, [items]);
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dashboard`
Then open `http://localhost:3001/#item-<first-8-chars-of-any-item-id>` in a browser.
Expected: the page loads, that item's row is expanded and scrolled into view. (Get a real short id from the content table first.)

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html
git commit -m "feat: #item-<id> dashboard deep link for Telegram notifications"
```

---

## Task 6: Config + docs + end-to-end verification

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add env vars to `.env.example`**

Append to `.env.example`:

```bash
# --- Telegram notifier (optional) ---
# Pushes the caption + hashtags to your phone when a video lands in your TikTok
# inbox (Inbox Upload can't carry a caption, so you type it when finishing the
# draft). All optional — if unset, the notifier is silently skipped.
# Setup:
#   1. Message @BotFather → /newbot → copy the token into TELEGRAM_BOT_TOKEN.
#   2. Send any message to your new bot, then open
#      https://api.telegram.org/bot<token>/getUpdates and copy
#      result[].message.chat.id into TELEGRAM_CHAT_ID.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
# Base URL for the dashboard deep link in the message, e.g. your laptop on the
# local network: http://192.168.1.50:3001 (omit to skip the link line).
DASHBOARD_BASE_URL=
```

- [ ] **Step 2: Document in `CLAUDE.md`**

In `CLAUDE.md`, find the Environment Variables `Optional:` line and add the three vars to it:

Find:

```
Optional: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_ACCESS_TOKEN`, `GOOGLE_API_KEY`, `IMAGE_MODEL`, `SUNO_API_URL`, `SUNO_COOKIE`, `OUTPUT_DIR`
```

Replace with:

```
Optional: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `TIKTOK_ACCESS_TOKEN`, `GOOGLE_API_KEY`, `IMAGE_MODEL`, `SUNO_API_URL`, `SUNO_COOKIE`, `OUTPUT_DIR`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_BASE_URL`
```

Then, in `CLAUDE.md`, find the end of the "### TikTok posting (scripts/lib/tiktok-api.ts)" paragraph and add this new subsection immediately after it:

```markdown
### Inbox caption notifier (scripts/lib/telegram.ts)
Because Direct Post requires the `video.publish` scope, posts fall back to **Inbox Upload**, which can't carry a caption — it must be typed by hand when finishing the draft in the TikTok app. When a video lands in the inbox (the `mode === 'inbox'` branch of `render-video.ts`), `notifyInboxVideo()` pushes a Telegram message with the copy-paste-ready caption + hashtags, content id/type, scheduled time, a thumbnail (reused public image URL), and a `#item-<shortId>` dashboard deep link. Pure builders (`buildInboxMessage`, `resolveThumbnail`, `buildDashboardUrl`) are unit-tested; the `fetch` send wrapper never throws so a notifier failure can't fail a post. Requires `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (and optional `DASHBOARD_BASE_URL` for the link); absent → silently skipped, like the music/image steps.
```

- [ ] **Step 3: End-to-end manual verification**

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `DASHBOARD_BASE_URL` in `.env`, then post an existing rendered item via the inbox path:

Run: `npm run pipeline -- <content-id> --post-only`
Expected:
- Console prints `Telegram inbox notification sent`.
- Your Telegram chat receives a message with the thumbnail, `reveal · <shortId>` (or `tip · …`), the scheduled time, the caption in a tappable code block, and an "Open in dashboard" link.
- Tapping the link opens the dashboard with that item expanded.

If `GOOGLE_API_KEY`/imagery is missing for the item, expect a text-only message (no photo) — still correct.

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document Telegram inbox notifier + env vars"
```

---

## Self-Review Notes

- **Spec coverage:** module (T1-T3), trigger only on inbox upload (T4), message contents — caption/code block (T1), id+type (T1), scheduled time (T1), thumbnail (T2/T3), dashboard link (T2/T5), config + degrade-gracefully (T2/T3/T6), tests (T1/T2), docs (T6). All spec sections map to a task.
- **Type consistency:** `InboxMessagePayload`, `NotifiableItem`, `buildInboxMessage`, `resolveThumbnail`, `buildDashboardUrl`, `isTelegramConfigured`, `notifyInboxVideo` are named identically across tasks; `ContentRow` (with added `scheduled_for`) is structurally assignable to `NotifiableItem`.
- **No placeholders:** every code/command step contains complete content.
