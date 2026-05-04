# Deployment Guide — Contabo VPS

Walkthrough for deploying the dashboard to a Contabo VPS (Ubuntu 22.04/24.04) at a public HTTPS subdomain (`tiktok.huybuilds.app` in the examples — swap if you use a different name).

Stack: **Node.js + tsx** (app) → **systemd** (process manager) → **Caddy** (reverse proxy + auto HTTPS) → **HTTP Basic Auth** (access control).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [DNS — point a subdomain at the VPS](#2-dns--point-a-subdomain-at-the-vps)
3. [VPS prep](#3-vps-prep)
4. [Firewall](#4-firewall)
5. [Deploy the app](#5-deploy-the-app)
6. [systemd service](#6-systemd-service)
7. [Caddy reverse proxy](#7-caddy-reverse-proxy)
8. [Verify](#8-verify)
9. [Hardening](#9-hardening)
10. [Operations / quick reference](#10-operations--quick-reference)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

Before you start, gather:

- **VPS IP** (IPv4, and IPv6 if available) — Contabo control panel.
- **Sudo SSH access** to the VPS, ideally with key-based login.
- **Domain registrar access** for `huybuilds.app` (Namecheap / Cloudflare / wherever the nameservers live).
- The **repo URL** for this project.
- A **strong dashboard password** generated locally:
  ```bash
  openssl rand -base64 24
  ```
  Save it somewhere safe (1Password / Bitwarden) — you'll set it as `DASHBOARD_PASS` later.

> **Code prerequisite:** The dashboard now requires `DASHBOARD_USER` and `DASHBOARD_PASS` env vars (basic auth) and depends on `express-basic-auth`. Make sure your branch has these changes before deploying.

---

## 2. DNS — point a subdomain at the VPS

In your registrar's DNS panel for `huybuilds.app`, add **one A record**:

| Type | Name     | Value (IPv4)         | TTL  |
|------|----------|----------------------|------|
| A    | `tiktok` | `<your VPS IPv4>`    | 300  |

If your VPS has IPv6, add an **AAAA** record with the same name pointing at the IPv6 address.

> Don't proxy through Cloudflare yet — Caddy needs to see real traffic on port 80 to issue the Let's Encrypt cert. You can enable the Cloudflare proxy later (see [Hardening](#9-hardening)).

Wait 1–5 min, then verify from your Mac:

```bash
dig +short tiktok.huybuilds.app
```

You should see your VPS IP. Don't move on until DNS resolves.

---

## 3. VPS prep

SSH into the VPS as a sudo user:

```bash
ssh youruser@<vps-ip>
```

Install everything in one go:

```bash
sudo apt update && sudo apt -y upgrade

# Build tools, ffmpeg, and Chromium runtime deps for Remotion
sudo apt install -y git ufw ffmpeg \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
  libcairo2 libasound2t64

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Caddy (auto HTTPS reverse proxy)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

> **Ubuntu 22.04 note:** the asound package is `libasound2`, not `libasound2t64`. If apt complains, swap that one package and re-run.

Sanity check:

```bash
node --version    # v20.x
ffmpeg -version
caddy version
```

---

## 4. Firewall

Open SSH + HTTP + HTTPS only. Port `3001` (the Express dashboard) stays bound to localhost — Caddy is the only thing that talks to it.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 5. Deploy the app

Run as your normal sudo user (don't run the app as root). Examples use the username `huy` — substitute yours.

```bash
cd ~
git clone <your-repo-url> auto-tiktok-engine
cd auto-tiktok-engine
npm install
```

Create a production `.env` from the example, then edit:

```bash
cp .env.example .env
nano .env
```

Required values:

| Var | Notes |
|-----|-------|
| `SUPABASE_URL` | From Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase project settings (server-side only — keep secret) |
| `ANTHROPIC_API_KEY` | For AI script generation |
| `DASHBOARD_USER` | e.g. `huy` |
| `DASHBOARD_PASS` | The strong password you generated in step 1 |

Optional but commonly set: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `SUNO_API_URL`, `SUNO_COOKIE`, `OUTPUT_DIR`.

> **TikTok redirect URI:** The current OAuth setup script (`npm run tiktok:setup`) has you paste the auth code manually, so you don't need a publicly reachable callback. If you later switch to a callback-based flow on this server, set `TIKTOK_REDIRECT_URI=https://tiktok.huybuilds.app/<your-callback-path>` and add it to your TikTok app's allowed redirect URIs.

Smoke test before wiring up systemd:

```bash
npm run dashboard
# expect: "listening on 3001"
# Ctrl-C to stop
```

If it fails to start with a `DASHBOARD_USER and DASHBOARD_PASS must be set` error, your `.env` is missing those vars — fix and retry.

---

## 6. systemd service

Create the unit file:

```bash
sudo nano /etc/systemd/system/auto-tiktok-dashboard.service
```

Paste this, replacing `huy` with your VPS username and the working directory if different:

```ini
[Unit]
Description=Auto TikTok Engine — dashboard
After=network.target

[Service]
Type=simple
User=huy
WorkingDirectory=/home/huy/auto-tiktok-engine
ExecStart=/usr/bin/node --env-file=.env --import tsx dashboard/server.ts
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now auto-tiktok-dashboard
sudo systemctl status auto-tiktok-dashboard   # should show "active (running)"
```

Tail the logs to confirm a clean startup:

```bash
journalctl -u auto-tiktok-dashboard -f
# Ctrl-C to detach
```

---

## 7. Caddy reverse proxy

Caddy gives you HTTPS automatically (Let's Encrypt) in one config file.

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the file's contents with:

```caddy
tiktok.huybuilds.app {
    encode zstd gzip

    # Allow larger uploads (photo upload endpoint)
    request_body {
        max_size 50MB
    }

    reverse_proxy localhost:3001 {
        # Long-running render endpoints can stream output
        transport http {
            read_timeout 10m
            write_timeout 10m
        }
    }
}
```

Reload Caddy and watch for the cert issuance:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -n 50 --no-pager
```

You should see `certificate obtained successfully` for `tiktok.huybuilds.app` within ~10 seconds. If it fails, check [Troubleshooting](#11-troubleshooting).

---

## 8. Verify

From your Mac:

```bash
curl -I https://tiktok.huybuilds.app
```

Expected response:

```
HTTP/2 401
www-authenticate: Basic realm="auto-tiktok-engine"
```

The 401 is correct — it proves both HTTPS and basic auth are wired up. Now open `https://tiktok.huybuilds.app` in a browser, enter your `DASHBOARD_USER` / `DASHBOARD_PASS`, and you should see the dashboard.

---

## 9. Hardening

Things you didn't ask for but should do once the deploy works.

### SSH key-only login

```bash
sudo nano /etc/ssh/sshd_config
# set:
#   PasswordAuthentication no
#   PermitRootLogin no
sudo systemctl restart ssh
```

> **Make sure your pubkey is in `~/.ssh/authorized_keys` on the VPS first**, or you'll lock yourself out. Test with a second SSH session before logging out of your current one.

### Unattended security updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### fail2ban (SSH brute-force protection)

```bash
sudo apt install -y fail2ban
# default jail config is fine for SSH
```

### Disk hygiene

Remotion renders, Suno mp3s, and Chromium cache add up. Check periodically:

```bash
df -h
du -sh ~/auto-tiktok-engine/output ~/auto-tiktok-engine/public/music
```

Optional: a cron to delete files older than 7 days from `output/`:

```bash
crontab -e
# add:
0 4 * * * find /home/huy/auto-tiktok-engine/output -type f -mtime +7 -delete
```

### `.env` safety

Confirm `.env` is in `.gitignore` (it should be). Never commit it. Save a copy of your production `.env` in a secrets manager — your data lives in Supabase, but credentials don't.

### Optional: Cloudflare in front

Once the cert is issued and the site works, you can turn on Cloudflare proxying for DDoS protection and caching:

1. In Cloudflare DNS, flip the record's proxy from "DNS only" (gray cloud) to "Proxied" (orange cloud).
2. SSL/TLS mode: **Full (strict)** — so Cloudflare talks to Caddy over the real cert, not a self-signed one.

---

## 10. Operations / quick reference

```bash
# Pull updates and restart
cd ~/auto-tiktok-engine && git pull && npm install
sudo systemctl restart auto-tiktok-dashboard

# Tail logs
journalctl -u auto-tiktok-dashboard -f
journalctl -u caddy -f

# Restart / status
sudo systemctl restart auto-tiktok-dashboard
sudo systemctl status auto-tiktok-dashboard

# Rotate the dashboard password
nano .env                                          # change DASHBOARD_PASS
sudo systemctl restart auto-tiktok-dashboard

# Reload Caddy after Caddyfile edits
sudo systemctl reload caddy

# Disk usage check
df -h
du -sh ~/auto-tiktok-engine/output
```

---

## 11. Troubleshooting

### Caddy fails to obtain a certificate

- Confirm DNS resolves to the VPS: `dig +short tiktok.huybuilds.app`
- Confirm port 80 is reachable from the public internet — not blocked by Contabo's network firewall (check the panel) or by `ufw`.
- Check Caddy logs: `journalctl -u caddy -n 200 --no-pager`.
- If you previously hit Let's Encrypt rate limits, wait an hour and retry.

### Dashboard service won't start

```bash
sudo systemctl status auto-tiktok-dashboard
journalctl -u auto-tiktok-dashboard -n 100 --no-pager
```

Most common causes:
- Missing `.env` values (especially `DASHBOARD_USER` / `DASHBOARD_PASS`)
- Wrong `WorkingDirectory` or `User` in the unit file
- `node` not at `/usr/bin/node` — check with `which node`

### Browser shows the login prompt but credentials are rejected

- The values in `.env` must match what you type. Watch out for trailing spaces, newlines, or quotes around the password.
- After editing `.env`, you must `sudo systemctl restart auto-tiktok-dashboard` for the new values to load.

### Remotion renders fail with Chromium errors

- Re-run the libnss3/libatk/libgbm/etc. install line from [§3](#3-vps-prep). A missing shared lib is almost always the cause.
- Check available memory: `free -h`. Renders need ~1–2 GB free.

### Pipeline runs are slow

- Contabo's smaller plans have shared CPU. Renders are CPU-bound. Bigger plan = faster renders.
- Check `top` during a render — if CPU is pegged at 100% and you want faster, you need a beefier plan.
