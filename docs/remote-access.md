# Remote Access Setup (Cloudflare Tunnel)

Access the EternalFrame dashboard from anywhere via HTTPS using Cloudflare Tunnel.

## Prerequisites

- A domain managed by Cloudflare (free plan works)
- `cloudflared` CLI installed

## 1. Install cloudflared

```bash
brew install cloudflared
```

## 2. Authenticate

```bash
cloudflared tunnel login
```

This opens a browser to authorize your Cloudflare account. Select the domain you want to use.

## 3. Create the tunnel

```bash
cloudflared tunnel create eternalframe-dash
```

Note the tunnel ID from the output (e.g., `a1b2c3d4-...`).

## 4. Route DNS

```bash
cloudflared tunnel route dns eternalframe-dash dashboard.yourdomain.com
```

Replace `dashboard.yourdomain.com` with your actual subdomain.

## 5. Configure

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/<you>/.cloudflared/<your-tunnel-id>.json

ingress:
  - hostname: dashboard.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

## 6. Set dashboard credentials

In your `.env` file:

```
DASHBOARD_USER=your-username
DASHBOARD_PASS=your-secure-password
```

Auth is only active when these are set. Localhost access always bypasses auth.

## 7. Start the tunnel

```bash
# Terminal 1: Start the dashboard
npm run dashboard

# Terminal 2: Start the tunnel
cloudflared tunnel run eternalframe-dash
```

Visit `https://dashboard.yourdomain.com` -- you'll be prompted for basic auth credentials.

## Optional: Run tunnel as a system service

```bash
sudo cloudflared service install
```

This starts the tunnel on boot. See [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/as-a-service/) for details.

## Troubleshooting

- **502 Bad Gateway**: Dashboard server isn't running. Start it with `npm run dashboard`.
- **Auth not working**: Check `DASHBOARD_USER` and `DASHBOARD_PASS` are set in `.env` and restart the dashboard.
- **Tunnel not connecting**: Run `cloudflared tunnel info eternalframe-dash` to check status.
