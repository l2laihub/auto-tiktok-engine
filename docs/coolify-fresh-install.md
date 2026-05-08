# Coolify Fresh Install on VPS

End-to-end guide to wipe an existing Coolify install and set up a fresh one on a Debian/Ubuntu VPS. After this, follow `docs/coolify-deployment.md` to deploy the dashboard.

## Prerequisites

- VPS running Debian 11/12 or Ubuntu 22.04/24.04
- Root SSH access (or a sudoer)
- A domain you can point at the VPS (for Coolify itself + apps)
- Minimum specs: 2 CPU, 2 GB RAM, 30 GB disk (Coolify recommends 4 GB RAM if you'll deploy multiple apps)

## 1. Back up anything worth keeping (optional)

If your old Coolify deployed apps you want to keep configurations for:

```bash
# Database snapshot (Postgres dump for app metadata)
docker exec coolify-db pg_dumpall -U postgres > ~/coolify-backup-$(date +%F).sql

# App data — Coolify stores everything under /data/coolify
sudo tar czf ~/coolify-data-$(date +%F).tar.gz /data/coolify

# Copy to your laptop
# From laptop: scp root@your-vps:~/coolify-backup-*.sql ./
```

If you don't care about the old data, skip this.

## 2. Stop and remove the old Coolify

### Try the official uninstall first

```bash
curl -fsSL https://cdn.coollabs.io/coolify/uninstall.sh | sudo bash
```

### Then nuke whatever it left behind

The uninstall script doesn't always fully clean up Docker state. Belt-and-suspenders:

```bash
# Stop and remove ALL containers (Coolify-related and any orphans)
docker ps -aq | xargs -r docker stop
docker ps -aq | xargs -r docker rm

# Remove all images, networks, and unnamed volumes
docker system prune -a --volumes -f

# Remove Coolify's data directory
sudo rm -rf /data/coolify

# Remove Coolify cron jobs (if any survived)
sudo crontab -l 2>/dev/null | grep -v coolify | sudo crontab -

# Remove leftover systemd unit (rare, but check)
sudo systemctl list-units --all | grep -i coolify
# If anything shows: sudo systemctl disable --now <unit-name>
```

Verify ports 80, 443, 8000 are free:

```bash
sudo ss -tlnp | grep -E ':(80|443|8000)\s'
```

Should print nothing. If something's still bound, identify and stop it (e.g. nginx, apache2, leftover Traefik).

## 3. Update the system

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y curl wget git ca-certificates ufw
```

## 4. Set up swap (recommended on small VPS)

If your VPS has < 4 GB RAM, add swap so Docker builds don't OOM:

```bash
# Skip if 'swapon --show' already prints something
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Configure the firewall

Coolify needs ports 22 (SSH), 80 (HTTP), 443 (HTTPS), and 8000 (Coolify dashboard, until you set a domain).

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 6001/tcp   # Coolify realtime (websocket)
sudo ufw allow 6002/tcp   # Coolify terminal (websocket)
sudo ufw --force enable
sudo ufw status
```

## 6. Point DNS

Before installing, set up DNS records at your domain registrar so Let's Encrypt works:

| Record | Host | Value |
|---|---|---|
| A | `coolify` (or whatever subdomain you want) | your VPS public IP |
| A | `dashboard` (for the auto-tiktok-engine app) | your VPS public IP |
| A | `*` (optional wildcard for future apps) | your VPS public IP |

Wait 1-5 min for propagation. Verify:

```bash
dig +short coolify.yourdomain.com
dig +short dashboard.yourdomain.com
```

Both should return your VPS IP.

## 7. Install Coolify

The official one-liner installs Docker (if missing) and Coolify:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

This takes 2-5 minutes. At the end it prints something like:

```
Coolify is installed!
Visit http://<your-vps-ip>:8000 to register
```

## 8. Register the admin account

Open `http://<your-vps-ip>:8000` in your browser. You'll see a registration form — **the first account becomes the admin**. Use a strong password and a real email (used for Let's Encrypt notifications).

Once logged in, you land on the Coolify dashboard.

## 9. Set Coolify's own domain (HTTPS for the dashboard itself)

By default Coolify is only on `http://<ip>:8000`. To get HTTPS for the admin UI:

1. **Settings** (left nav, gear icon) → **Configuration**
2. **Instance's Domain**: `https://coolify.yourdomain.com`
3. Click **Save**.

Coolify will request a Let's Encrypt cert. Wait ~30s and reload — you should now reach `https://coolify.yourdomain.com`. The `:8000` URL will redirect.

If the cert fails: confirm DNS propagated (step 6) and that ports 80/443 are open (step 5).

## 10. Verify the server is healthy

In the Coolify UI:

- **Servers** → **localhost** → status should be green
- **Resources** tab on the server → CPU/RAM/disk all show numbers

If localhost is red, check `docker logs coolify` and `sudo journalctl -u docker -n 50`.

## 11. Deploy the auto-tiktok-engine

Switch to `docs/coolify-deployment.md` and follow it. Quick recap:

1. **+ New Resource** → **Application** → **Public Repository** → paste the GitHub URL
2. Build pack: **Dockerfile**, port: **3001**
3. Domain: `https://dashboard.yourdomain.com`
4. Env vars from `.env.example`
5. Mount volumes: `/app/output` and `/app/public/music`
6. Deploy

## Common gotchas

**Coolify install fails at Docker step** — Docker is already installed but at an incompatible version. Run `sudo apt-get remove -y docker docker-engine docker.io containerd runc` first, then re-run the installer.

**`http://<ip>:8000` doesn't load after install** — wait another 60s; Coolify takes time to spin up its own containers. Then check `docker ps | grep coolify` — you should see `coolify`, `coolify-db`, `coolify-redis`, `coolify-realtime`, and `coolify-proxy`.

**Let's Encrypt fails for the Coolify domain** — DNS hasn't propagated yet, or your A record points to the wrong IP. Check `dig +short coolify.yourdomain.com` and confirm it matches `curl -s ifconfig.me` on the VPS.

**Old Traefik/nginx still on 80/443** — `sudo ss -tlnp | grep -E ':(80|443)\s'` will show what's bound. `sudo systemctl disable --now <service>` to stop it permanently.

**Forgot admin password** — SSH in and run:
```bash
docker exec -it coolify php artisan password:reset your@email.com
```

## Maintenance

**Update Coolify** — Settings → check for updates, or:
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```
The same script handles updates safely (preserves data).

**Backups** — Settings → S3 Storages to configure automated backups of the Coolify database to S3-compatible storage.

**Logs** — `docker logs coolify -f` for the main app, or use the Logs tab in any deployed resource.
