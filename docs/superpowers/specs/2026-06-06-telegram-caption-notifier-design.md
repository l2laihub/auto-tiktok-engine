# Telegram caption notifier for inbox-uploaded videos

**Date:** 2026-06-06
**Status:** Approved (design)

## Problem

The pipeline can't use TikTok Direct Post (the `video.publish` scope isn't
available), so videos are published via **Inbox Upload**
(`initInboxUpload`, `scripts/lib/tiktok-api.ts`). TikTok's inbox flow has no
`post_info` field — it cannot carry a caption or hashtags. The video lands in
the creator's TikTok inbox as a draft, and the caption + hashtags must be typed
by hand when finalizing the draft in the TikTok app on the phone.

The caption + hashtags already exist per content item and are assembled into the
`title` string at `scripts/render-video.ts:746`
(`"<caption> #tag1 #tag2 …"`), but today that string is only printed to the
pipeline logs — it never reaches the phone.

## Goal

When a video (scheduled or manual) is sent to the TikTok inbox, push a **Telegram**
message containing:

- the full caption + hashtags as a **copy-paste-ready** block,
- content id + type (e.g. `reveal · a1b2c3d4`),
- the item's scheduled time,
- a **thumbnail** image, and
- a **deep link** to the item in the dashboard.

So the caption can be copied on the phone at the exact moment the draft is being
finished in the TikTok app.

## Non-goals (YAGNI)

- No retry/queue for failed notifications — log a warning and move on.
- No email channel yet (the notifier module is shaped so email is easy to add later).
- No video-frame thumbnail extraction — reuse an existing public image URL.
- Notifications fire **only** on inbox upload, not on direct posts or failures.

## Design

### 1. New module — `scripts/lib/telegram.ts`

Self-contained notifier following the repo's "degrade gracefully when
unconfigured" pattern (same as the music/image steps).

```
isTelegramConfigured(): boolean
  → true when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are both set.

buildInboxMessage(payload): { text: string; photoUrl?: string }   // PURE
  → formats the message body + picks the thumbnail URL. Unit-tested.

notifyInboxVideo(payload): Promise<void>
  → if unconfigured: log "skipped", return.
  → build message, then:
      photoUrl present → POST sendPhoto (text as `caption`)
      else            → POST sendMessage
  → NEVER throws: catches all errors and logs a warning, so a notifier
    failure can never fail a post.
```

`payload` shape (assembled by the caller):

```ts
{
  caption: string;       // the full "caption #tag1 #tag2 …" title string
  contentId: string;     // item.id
  contentType: string;   // 'reveal' | 'tip'
  scheduledFor?: string; // item.scheduled_for (ISO) — may be null
  thumbnailUrl?: string; // resolved public image URL, may be undefined
  dashboardUrl?: string; // DASHBOARD_BASE_URL + '/#item-<shortId>', if base set
}
```

Network calls are plain `fetch()` POSTs to
`https://api.telegram.org/bot<token>/sendPhoto|sendMessage`. **No new npm
dependency.**

### 2. Message format

Use Telegram **HTML** parse mode (simpler escaping than MarkdownV2). The
caption+hashtags sits in a `<code>` block so a single tap copies the whole
string.

```
📥 New TikTok draft ready to post

reveal · a1b2c3d4
🗓 Scheduled: Jun 6, 2026, 9:00 AM

Caption (tap to copy):
<code>{full caption + hashtags string, HTML-escaped}</code>

🔗 Open in dashboard: {dashboardUrl}
```

- Scheduled-time line omitted when `scheduledFor` is null.
- Dashboard line omitted when `DASHBOARD_BASE_URL` is unset.
- When a `photoUrl` is present the body becomes the photo's `caption`
  (Telegram caption limit 1024 chars; our text is well under).

### 3. Thumbnail source (no extra processing)

Reuse an existing **public Supabase image URL** — no ffmpeg frame extraction.
Resolution order by content type:

- **reveal** → `image_pairs[0].after_url` (or `after_image_url`), fallback
  `item.after_url`.
- **tip** → `tip_image_url`, else `tip_images[0]`, else first `tips[].background`.
- none found → `photoUrl` undefined → text-only `sendMessage`.

The exact field names are confirmed against the `ContentItem` interface in
`scripts/render-video.ts` during implementation.

### 4. Integration point — `scripts/render-video.ts`

Inside the existing `if (mode === 'inbox')` block (around line 766), after the
console logs, call:

```ts
await notifyInboxVideo({
  caption: title,
  contentId: item.id,
  contentType: item.content_type,
  scheduledFor: item.scheduled_for,
  thumbnailUrl: resolveThumbnail(item),
  dashboardUrl: buildDashboardUrl(item.id),
});
```

This single site covers **both** the scheduler-driven path and manual runs,
because the scheduler executes this same pipeline. `notifyInboxVideo` never
throws, so it cannot break the post.

### 5. Dashboard deep link — `dashboard/index.html`

The dashboard is a single-page app with no per-item route (items expand via the
`expandedId` client state; the server serves `index.html` for all routes). Add a
small on-load handler:

- On mount, read `location.hash`. If it matches `#item-<shortId>`, find the item
  whose `id` starts with `<shortId>`, set `expandedId` to it, and scroll it into
  view.
- The link in the Telegram message is `{DASHBOARD_BASE_URL}/#item-<shortId>`
  where `<shortId>` is `item.id.slice(0, 8)` (consistent with how ids are shown
  elsewhere).

If the deep-link proves fiddly, the fallback is to link to the dashboard root —
but the deep link is the intended v1 behavior.

### 6. Configuration

New **optional** env vars (added to `.env.example`, documented in `CLAUDE.md`):

- `TELEGRAM_BOT_TOKEN` — from @BotFather.
- `TELEGRAM_CHAT_ID` — the target chat/DM id.
- `DASHBOARD_BASE_URL` — e.g. `http://192.168.x.x:3001` (local-Wi-Fi mobile
  setup). Used only to build the deep link.

All optional: if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are absent the notifier
logs "skipped" and does nothing (today's behavior). If `DASHBOARD_BASE_URL` is
absent the dashboard link line is omitted.

Setup steps to document:
1. Message @BotFather → `/newbot` → copy the bot token.
2. Send any message to the new bot, then visit
   `https://api.telegram.org/bot<token>/getUpdates` and read
   `result[].message.chat.id` → that's `TELEGRAM_CHAT_ID`.

### 7. Testing

- Unit test (`node:test` via `tsx`, matching repo convention of pure-function
  tests only) for `buildInboxMessage`:
  - asserts the formatted text, HTML escaping, the `<code>` copyable block,
  - asserts scheduled-time / dashboard-link lines are included/omitted correctly,
  - asserts the thumbnail-vs-text branch (photoUrl present vs undefined).
- The network `fetch` send wrapper is **not** unit-tested (no pure logic; matches
  the repo's testing convention).

## Files touched

- **new** `scripts/lib/telegram.ts` — notifier + pure message builder.
- **new** `scripts/lib/__tests__/telegram.test.ts` — unit tests for
  `buildInboxMessage` (matches the existing test location + the
  `node --import tsx --test scripts/lib/__tests__/*.test.ts` glob).
- `scripts/render-video.ts` — call `notifyInboxVideo` in the `mode === 'inbox'`
  branch; add `resolveThumbnail` / `buildDashboardUrl` helpers (or inline).
- `dashboard/index.html` — `#item-<shortId>` deep-link handler.
- `.env.example` — new optional vars + comments.
- `CLAUDE.md` — document the Telegram notifier + setup steps.
