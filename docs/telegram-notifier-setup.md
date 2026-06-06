# Telegram Caption Notifier — Setup Guide

## What this is

Because TikTok Direct Post isn't available (it needs the `video.publish` scope),
videos are published via **Inbox Upload** — they land in your TikTok inbox as a
draft, and TikTok's inbox flow **can't carry a caption**. You have to type the
caption + hashtags by hand when finishing the draft in the TikTok app.

This notifier solves that: when a video lands in your TikTok inbox, it pushes a
**Telegram** message to your phone with:

- the caption + hashtags in a **tap-to-copy** block,
- the content id + type (e.g. `reveal · a1b2c3d4`),
- the scheduled time,
- a **thumbnail** of the video, and
- a **deep link** that opens the item in your dashboard.

So you copy the caption from Telegram and paste it straight into TikTok.

Everything below is a **one-time setup**. All config is optional — if the
Telegram vars aren't set, the notifier silently does nothing (same as the
music/image steps).

---

## Step 0: Install Telegram & make an account

Telegram is a free messaging app (like WhatsApp/iMessage). You need an account
before you can create a bot.

1. **Install the app:**
   - **Phone (recommended):** search "Telegram" in the App Store (iPhone) or
     Play Store (Android) and install it.
   - **Or on your Mac:** download from <https://telegram.org/dl>
2. **Sign up:** open the app → **Start Messaging** → enter your **phone number**
   → Telegram texts you a code → type it in → set a name. Done.

> Install it on your **phone** specifically — that's where you'll get the caption
> notifications and finish posting in the TikTok app.

---

## Step 1: Find "BotFather"

BotFather is Telegram's official tool for creating bots. It's itself a bot you
chat with.

1. In Telegram, tap the **search icon** (🔍).
2. Type **`BotFather`**.
3. Tap the result named **BotFather** with a **blue checkmark** ✓ (the official
   one — ignore look-alikes without the checkmark).
4. Tap **Start** at the bottom (or send `/start`).

---

## Step 2: Create your bot

1. Send **`/newbot`**.
2. BotFather asks for a **name** — the display name, anything works, e.g.
   `EternalFrame Captions`.
3. BotFather asks for a **username** — must be unique and **end in `bot`**, e.g.
   `eternalframe_captions_bot`. If it's taken, try another.
4. On success, BotFather sends your **token**, which looks like:
   ```
   8123456789:AAHk9x...long-random-string...
   ```
   **That whole string is your `TELEGRAM_BOT_TOKEN`.** Treat it like a password —
   anyone with it can control your bot.

---

## Step 3: Say hi to your new bot

In the success message, BotFather includes a link like
`t.me/eternalframe_captions_bot`.

1. Tap the link → it opens your bot's chat.
2. Tap **Start** (or send any message, e.g. "hi").

This matters because **a bot can't message you until you've messaged it first.**

---

## Step 4: Get your chat ID

This is the address the bot sends messages *to* (your personal chat with it).

1. In a browser, go to this URL — replace `<YOUR_TOKEN>` with your token:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Keep the literal word `bot` immediately before the token, so it reads
   `.../bot8123456789:AAH.../getUpdates`.
2. In the JSON that loads, find:
   ```
   "chat":{"id":123456789,
   ```
   That number is your **`TELEGRAM_CHAT_ID`**.
3. If the page shows `"result":[]` (empty), send your bot another message in
   Telegram, then refresh the URL.

---

## Step 5: Add the values to `.env`

```bash
TELEGRAM_BOT_TOKEN=8123456789:AAHk9x...
TELEGRAM_CHAT_ID=123456789
# Optional — laptop's LAN IP, so the dashboard deep link opens on your phone.
# Find it with: ipconfig getifaddr en0
DASHBOARD_BASE_URL=http://192.168.1.50:3001
```

`DASHBOARD_BASE_URL` is optional; omit it and the message simply won't include
the "Open in dashboard" link.

---

## Step 6: Test it

### Quick check — confirms the token + chat ID work

Replace the placeholders and run:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage" \
  -d chat_id=<YOUR_CHAT_ID> \
  -d text="EternalFrame test ✅"
```

If the message arrives in your Telegram chat, your credentials are good.

### Full end-to-end — a real post that lands in your TikTok inbox

```bash
npm run pipeline -- <content-id> --post-only
```

The logs print `Telegram inbox notification sent`, and the message arrives on
your phone with the thumbnail, caption code block, and dashboard link.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `getUpdates` returns `"result":[]` | You haven't messaged the bot yet, or did so before opening `getUpdates`. Send the bot a message and refresh. |
| `401 Unauthorized` from the API | The token is wrong or has a typo. Re-copy it from BotFather. |
| `400 chat not found` | Wrong `TELEGRAM_CHAT_ID`, or you never tapped **Start** on the bot. |
| Logs say `Telegram not configured — skipping inbox notification` | `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing/blank in `.env`. |
| Message arrives but has no thumbnail | The item has no generated imagery yet — expected; you still get a text message with the caption. |
| Message arrives but no dashboard link | `DASHBOARD_BASE_URL` is unset — optional, add it to enable the link. |

---

## How it works (for reference)

- Implementation lives in `scripts/lib/telegram.ts`
  (`notifyInboxVideo`, `buildInboxMessage`, `resolveThumbnail`,
  `buildDashboardUrl`).
- It's called from the `mode === 'inbox'` branch of `scripts/render-video.ts`,
  so it fires on **both** scheduled posts and manual `npm run pipeline` runs.
- The send wrapper **never throws** — a Telegram failure logs a warning and
  cannot fail the post.
- The dashboard deep link works via a `#item-<shortId>` hash handled in
  `dashboard/index.html` (expands + scrolls to that item on load).
