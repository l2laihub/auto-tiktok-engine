# Coolify Deployment

Deploy the EternalFrame dashboard + pipeline to a VPS managed by Coolify. The container runs the dashboard (port 3001) and renders videos in-place using a bundled headless Chrome.

## Prerequisites

- Coolify installed and running on your VPS
- A domain (or subdomain) with an A record pointing to your VPS public IP
- The repo pushed to a Git host Coolify can pull from (GitHub/GitLab/etc.)

## 1. Push Docker files to the repo

This repo includes:

- `Dockerfile` — Node 20 + ffmpeg + Chromium runtime libs
- `docker-entrypoint.sh` — materialises `.env` from runtime env vars (the dashboard spawns `node --env-file=.env` for the pipeline)
- `.dockerignore` — keeps the image small

Commit and push these files to the branch Coolify will track.

## 2. Create the application in Coolify

1. **+ New Resource** → **Application** → **Public Repository** (or **Private Repository** with a deploy key).
2. Repository URL: your repo. Branch: `main` (or your deploy branch).
3. **Build Pack**: `Dockerfile`.
4. **Ports Exposes**: `3001`.
5. Save.

## 3. Set environment variables

In the application's **Environment Variables** tab, add (mark secrets as *Build Variable: No*, *Is Preview: No*):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | secret |
| `ANTHROPIC_API_KEY` | yes | secret |
| `DASHBOARD_USER` | yes for remote | basic-auth username |
| `DASHBOARD_PASS` | yes for remote | basic-auth password |
| `GOOGLE_API_KEY` | optional | Lyria 3 music |
| `SUNO_API_URL` | optional | fallback music |
| `SUNO_COOKIE` | optional | only with Suno |
| `TIKTOK_CLIENT_KEY` | optional | OAuth posting |
| `TIKTOK_CLIENT_SECRET` | optional | OAuth posting |
| `TIKTOK_REDIRECT_URI` | optional | must match TikTok app config |
| `TIKTOK_ACCESS_TOKEN` | optional | static token fallback |
| `SCHEDULE_CRON` | optional | default `0 10 * * 1,3,5` |
| `SCHEDULE_ENABLED` | optional | default `true` |

Without `DASHBOARD_USER` / `DASHBOARD_PASS` the dashboard is publicly accessible — set them.

## 4. Configure persistent storage

In the **Storages** tab, add two volume mounts so renders and generated music survive redeploys:

| Mount path | Purpose |
|---|---|
| `/app/output` | rendered MP4 videos |
| `/app/public/music` | generated music tracks |

Use **Volume** type (Coolify-managed). Coolify creates the volumes on first deploy.

## 5. Configure the domain

In **Domains**, set `https://dashboard.yourdomain.com` (or whatever subdomain you DNS'd). Coolify's Traefik handles Let's Encrypt automatically once DNS resolves.

## 6. Deploy

Click **Deploy**. First build takes 5-8 minutes (downloading Chromium during `ensureBrowser`). Subsequent builds reuse cached layers.

Watch the build logs. On success, visit `https://dashboard.yourdomain.com` — basic auth prompt → in.

## 7. TikTok OAuth (optional)

OAuth setup requires a one-time interactive flow (`npm run tiktok:setup`) that's awkward inside a container. Easiest path:

1. Run `npm run tiktok:setup` once on a machine with a browser (your laptop) using the same Supabase credentials. This writes the refresh token to the `tiktok_tokens` table.
2. The deployed container reads/refreshes that token from Supabase automatically — no extra config needed.

## Troubleshooting

**Build fails at `ensureBrowser`** — Coolify build host is out of disk or memory. Free space or bump build resources, then redeploy.

**Render fails with `Failed to launch the browser process`** — a Chromium runtime lib is missing. Check container logs; the missing `lib*.so` will be named. Add it to the `apt-get install` list in `Dockerfile` and redeploy.

**`npm run dashboard` exits immediately** — usually a missing required env var. Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in Coolify.

**502 Bad Gateway via the domain** — the container is starting but Traefik hit it before port 3001 was listening. Wait 30s and retry. If persistent, check container status in Coolify.

**Auth prompt loops forever** — `DASHBOARD_USER` / `DASHBOARD_PASS` mismatch with what you're typing, or env vars aren't actually set. Verify in **Environment Variables** and redeploy.

**Pipeline runs but videos vanish on redeploy** — the persistent volumes weren't configured (step 4). Renders write to `/app/output` and need to survive container replacement.

## Updating

Push to the deploy branch → Coolify auto-deploys (if **Automatic Deployment** is on) or click **Redeploy**. Volumes persist; only the application layer rebuilds.
