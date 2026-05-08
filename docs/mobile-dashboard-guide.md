# Mobile Dashboard Guide

Walk-through for accessing the EternalFrame dashboard from your phone. The dashboard's UI is already mobile-responsive (bottom tab bar under 768px wide) — you just need to get your phone to it.

## Two ways to connect

| Method | When to use | Requires | URL type |
|---|---|---|---|
| **Same-WiFi (LAN)** | Quick, at home/office | Phone + laptop on same network | `http://<laptop-ip>:3001` |
| **Cloudflare Tunnel** | Anywhere, on cellular | Cloudflare-managed domain, `cloudflared` CLI | `https://dashboard.yourdomain.com` |

Both use the same dashboard server (`npm run dashboard`, port 3001). Auth behavior is identical: **localhost bypasses auth, all other requests require basic auth when `DASHBOARD_USER`/`DASHBOARD_PASS` are set** (`dashboard/server.ts:29-40`).

---

## Option A: Same-WiFi (LAN)

Fastest path. Works because `app.listen(3001)` binds all interfaces by default.

### 1. Set credentials in `.env`

Even on LAN, anyone on your WiFi can reach the dashboard. Set credentials:

```
DASHBOARD_USER=you
DASHBOARD_PASS=a-strong-password
```

> Skip this only if you're on a trusted network and accept the risk. Without these vars, auth middleware isn't mounted (`server.ts:29`), so the dashboard is fully open to anyone on your LAN.

### 2. Find your laptop's LAN IP

```bash
ipconfig getifaddr en0    # macOS, Wi-Fi
```

Expect something like `192.168.1.42`. If `en0` is empty, try `en1` or `ifconfig | grep "inet "`.

### 3. Start the dashboard

```bash
npm run dashboard
```

Leave this terminal running.

### 4. Open on your phone

Browser → `http://192.168.1.42:3001` (replace with your IP).

Enter the `DASHBOARD_USER` / `DASHBOARD_PASS` at the prompt. iOS/Android will offer to save them in the keychain.

### Caveats

- **HTTP only** — no TLS on LAN. Fine for home use; don't use on public WiFi.
- **IP can change** when your router renews the DHCP lease. If the URL stops working, rerun step 2.
- **Firewall** — macOS may prompt to allow incoming connections the first time; click Allow.

---

## Option B: Cloudflare Tunnel (anywhere)

For cellular, coffee shops, or sharing with a collaborator. HTTPS + public hostname.

Follow `docs/remote-access.md` for one-time setup (install `cloudflared`, create tunnel, map DNS, set credentials). Then each session:

```bash
# Terminal 1
npm run dashboard

# Terminal 2
cloudflared tunnel run eternalframe-dash
```

On your phone: `https://dashboard.yourdomain.com` → basic auth prompt → in.

> **Important:** the Cloudflare path exposes the dashboard to the public internet. `DASHBOARD_USER`/`DASHBOARD_PASS` in `.env` are what stops strangers from reaching it — do not skip them. Without both set, auth middleware is never mounted and the tunnel leaves the dashboard wide open.

---

## What you can do from your phone

The SPA collapses to a mobile layout with a **bottom tab bar** (`index.html:3148`) at four tabs:

| Tab | What you can do |
|---|---|
| **Pool** | Browse content items; tap a card to edit script, hook, hashtags, music style, schedule |
| **Schedule** | See upcoming scheduled posts; toggle scheduler on/off; edit cron |
| **Add** | Create a new item: upload before/after photos (camera or gallery), AI auto-fills era/story/preset |
| **Pipeline** | Run the pipeline (dry-run or live), watch stdout stream, view run history |

Photo upload uses the phone's file picker, which on iOS/Android offers **Take Photo** or **Photo Library** directly. That makes the "Add" flow genuinely useful on mobile.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone can't reach `http://<ip>:3001` | Same WiFi? Firewall allowing Node? IP still current? |
| Browser keeps prompting for password | You mistyped. Clear saved creds and retry. On iOS: Settings → Passwords. |
| `502 Bad Gateway` on Cloudflare URL | Dashboard isn't running. `npm run dashboard`. |
| No auth prompt but you expected one | `DASHBOARD_USER` or `DASHBOARD_PASS` missing in `.env`. Add both, restart dashboard. |
| Pipeline tab shows "already running" forever | A prior run crashed mid-flight. Restart the dashboard to reset `pipelineRunning`. |
| Photo upload fails | 10MB limit (`server.ts:293`). Resize or retake smaller. |

---

## Security notes

- **Auth is all-or-nothing.** If either `DASHBOARD_USER` or `DASHBOARD_PASS` is missing, no middleware is mounted — every non-localhost request gets through. Always set **both**.
- **Localhost bypass is strict** (`server.ts:32`): only `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, `localhost`. LAN IPs like `192.168.x.x` do *not* bypass.
- **No rate limiting / lockout.** Use a long password; brute-force protection is not implemented.
- **Trust proxy not configured.** Under Cloudflare, `req.ip` resolves to the Cloudflare edge IP (non-local), so the localhost bypass correctly does *not* trigger — you still get prompted for auth. Don't enable `app.set('trust proxy', true)` without also tightening the localhost check, or a spoofed `X-Forwarded-For: 127.0.0.1` could skip auth.
