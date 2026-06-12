# Deploying MariData on a VPS (Ubuntu/Debian)

Goal: the platform is your primary database for ~8M+ people (20 GB TSV), running on your
own server, and **everything comes back by itself after a reboot** — Postgres data lives
on disk, the database container auto-restarts, and the API runs under systemd.

## 1. Prerequisites

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nodejs npm   # node 20+ required
sudo systemctl enable --now docker                            # docker starts on boot
```

## 2. Get the code and configure

```bash
git clone <your-repo> /opt/maridata && cd /opt/maridata
npm run install:all

cp .env.example .env
# In .env set:
#   DATABASE_URL=postgresql://maridata:maridata@localhost:5432/maridata
#   JWT_SECRET=<long random string:  openssl rand -hex 48>
#   ADMIN_PASSWORD_HASH=<output of: npm run hash-password -- 'your-admin-password'>
#   CLIENT_ORIGIN=http://your-server-ip   (or your domain)
#   VITE_API_URL=http://your-server-ip:4000
```

Change the Postgres password in `docker-compose.yml` for anything internet-facing, and
mirror it in `DATABASE_URL`.

## 3. Start Postgres (persistent + auto-restart)

```bash
docker compose up -d        # data in the maridata_pgdata volume, restart: unless-stopped
npm run migrate
```

The named volume lives under `/var/lib/docker/volumes/` — container restarts, image
upgrades, and reboots do not touch it. Postgres also keeps full crash safety (WAL), so a
power cut mid-write does not corrupt committed data.

## 4. Build and run the API under systemd

```bash
npm --prefix backend run build          # compiles to backend/dist
sudo tee /etc/systemd/system/maridata-api.service > /dev/null <<'EOF'
[Unit]
Description=MariData API
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/maridata/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now maridata-api    # starts now AND on every boot
```

`Restart=always` also revives the API if it ever crashes. The API tolerates Postgres
starting after it (the pool reconnects; `/health` reports `db: down` until then).

## 5. Serve the frontend

```bash
npm --prefix frontend run build             # static files in frontend/dist
sudo apt install -y nginx
sudo tee /etc/nginx/sites-available/maridata > /dev/null <<'EOF'
server {
  listen 80;
  root /opt/maridata/frontend/dist;
  index index.html;
  location / { try_files $uri /index.html; }
  location /api/    { proxy_pass http://127.0.0.1:4000; proxy_buffering off; }
  location /auth/   { proxy_pass http://127.0.0.1:4000; }
  location /health  { proxy_pass http://127.0.0.1:4000; }
  client_max_body_size 25g;     # allow huge TSV uploads
  proxy_read_timeout 1h;        # long imports/exports
}
EOF
sudo ln -sf /etc/nginx/sites-available/maridata /etc/nginx/sites-enabled/default
sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

With nginx proxying, set `VITE_API_URL=` (empty/same-origin) and
`CLIENT_ORIGIN=http://your-domain` in `.env`, then rebuild the frontend.

## 6. Import the 20 GB TSV

Copy the file onto the server (`scp`/`rsync`), then use the Import page with **Server
path** (e.g. `/data/people.tsv`) — the file streams straight into Postgres via COPY
without an HTTP upload. Expect tens of minutes; progress streams live in the UI. Indexes
build automatically after the first load.

## 7. Reboot checklist (what happens automatically)

| Component | Comes back via |
|---|---|
| Postgres + your data | Docker `restart: unless-stopped` + named volume |
| API | systemd `enable` + `Restart=always` |
| Frontend | nginx (systemd-enabled), static files on disk |

Test it once: `sudo reboot`, wait a minute, open the site — dashboard should show your
row count unchanged.

## 8. Backups (recommended)

Your platform is the primary store, so keep an off-box copy:

```bash
# nightly dump (cron):  0 3 * * *
docker exec maridata-db pg_dump -U maridata -Fc maridata > /backups/maridata-$(date +%F).dump
```

Restore with `pg_restore -U maridata -d maridata --clean <file>`.
