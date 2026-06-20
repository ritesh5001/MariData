# Always-on Windows PC + Cloudflare Tunnel deployment

This runbook turns a dedicated Windows PC into a 24/7 host for MariData: Postgres holds
all the data locally, the API runs as an auto-starting service, and a Cloudflare Tunnel
publishes a public **HTTPS** URL so other platforms can fetch data anytime.

Consumers use the **public read-only API**: `GET https://<your-host>/public/v1/...` with an
API key in `Authorization: Bearer <key>`. The cookie-protected admin API (`/api`) and the
frontend stay private to you.

---

## 0. Prerequisites

- A domain managed in Cloudflare (free plan is fine).
- Node.js LTS and Git installed on the PC.
- This repo checked out on the PC.

## 1. Keep the PC awake 24/7

Settings → System → Power & battery → Screen and sleep → set **"When plugged in, put my
device to sleep"** to **Never**. Also in Control Panel → Power Options → change plan
settings → **Turn off hard disk: Never**. (Optional) BIOS "Restore on AC power loss" so the
PC reboots itself after an outage.

## 2. Postgres (the data lives here)

Either native or Docker — both auto-start on boot.

- **Native:** install PostgreSQL 16, set a **strong** password for the `maridata` user,
  create the `maridata` database. The installer registers a Windows service that starts on
  boot.
- **Docker Desktop:** `docker compose up -d` using the repo [docker-compose.yml](../docker-compose.yml)
  (`restart: unless-stopped` brings it back after reboots). Set Docker Desktop to start at
  login.

Then run migrations once:

```
cd backend
npm install
npm run migrate
```

## 3. Build + production environment

Create the repo-root `.env` (see [.env.example](../.env.example)) with production values:

```
DATABASE_URL=postgresql://maridata:<strong-password>@localhost:5432/maridata
PORT=4000
NODE_ENV=production
JWT_SECRET=<long random string>
ADMIN_PASSWORD_HASH=<from: npm run hash-password -- 'your-admin-password'>

# One key per consuming platform (comma-separated). Generate each with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEYS=<key-for-platform-A>,<key-for-platform-B>
PUBLIC_RATE_WINDOW_MS=60000
PUBLIC_RATE_MAX=60

# Allow your own frontend origin(s) if you host the admin UI somewhere:
CLIENT_ORIGIN=http://localhost:5173
```

Build the backend:

```
cd backend
npm run build      # produces dist/, including the start entry dist/src/server.js
```

## 4. Run the API 24/7 as a Windows service (NSSM)

Download [NSSM](https://nssm.cc/), then from an **Administrator** prompt:

```
nssm install MariDataAPI
```

In the dialog:
- **Path:** the full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`)
- **Startup directory:** `...\MariData\backend`
- **Arguments:** `dist\src\server.js`
- Details tab → **Startup type: Automatic**
- Exit actions tab → restart on failure (NSSM default)

Start it: `nssm start MariDataAPI`. Verify locally:

```
curl http://localhost:4000/health                                   # {"status":"ok",...}
curl -H "Authorization: Bearer <key>" http://localhost:4000/public/v1/persons
```

(Alternative to NSSM: `npm i -g pm2 pm2-windows-startup`, `pm2 start dist/src/server.js
--name maridata`, `pm2 save`, `pm2-startup install`.)

## 5. Publish it with a Cloudflare Tunnel

Install `cloudflared` (winget: `winget install --id Cloudflare.cloudflared`), then:

```
cloudflared tunnel login                       # authorize your Cloudflare domain
cloudflared tunnel create maridata             # creates a tunnel + credentials file
cloudflared tunnel route dns maridata api.yourdomain.com
```

Create `C:\Users\<you>\.cloudflared\config.yml`:

```yaml
tunnel: maridata
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:4000
  - service: http_status:404
```

Install the tunnel as an auto-starting Windows service so it survives reboots:

```
cloudflared service install
```

Cloudflare terminates TLS, so `https://api.yourdomain.com` is live with no router/port-
forwarding and your home IP stays hidden.

## 6. Hand off to consumers

Give each platform:
- Base URL: `https://api.yourdomain.com/public/v1`
- Their API key, sent as `Authorization: Bearer <key>`

Example call:

```
curl -H "Authorization: Bearer <key>" \
  "https://api.yourdomain.com/public/v1/persons?q=acme&limit=50"
```

Available read endpoints: `/persons` (search/filter/paginate), `/persons/:id`, `/stats`,
`/facets`. To revoke a platform, remove its key from `API_KEYS` and restart the service
(`nssm restart MariDataAPI`).

## 7. Verify resilience

Reboot the PC. Without touching anything, confirm Postgres, the `MariDataAPI` service, and
the `cloudflared` service all come back and `https://api.yourdomain.com/public/v1/persons`
(with a key) returns data from a different network (e.g. your phone on cellular).
