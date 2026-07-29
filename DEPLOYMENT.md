# Deploying to an Azure Ubuntu VM

You already have the VM running. This walks through everything from SSH-ing in to a
working app at `http://<vm-public-ip>/`. Config files referenced below live in `deploy/`.

## Before you start: read this

The backend marks the login session cookie `Secure` whenever `ENVIRONMENT` is anything
other than `development` ([backend/app/api/routes/auth.py:18](backend/app/api/routes/auth.py)).
A `Secure` cookie is refused by the browser over plain HTTP. Since you're starting on the
VM's bare IP with no TLS certificate yet, **leave `ENVIRONMENT=development` in `backend/.env`
for now** — despite the name, this only controls that cookie flag, nothing else. Once you
point a domain at the VM and set up HTTPS (last section below), switch it to
`ENVIRONMENT=production` and the cookie will correctly become HTTPS-only.

## 1. Open the VM's firewall (Azure side)

In the Azure Portal, on the VM's **Networking** blade, add an inbound rule allowing TCP
port 80 (and 22 for SSH, if not already open). You don't need to open 8080 or 5432 — the
backend and Postgres only need to be reachable from nginx/the app itself, both on
`localhost`.

## 2. SSH in and install system packages

```bash
ssh <your-user>@<vm-public-ip>

sudo apt update
sudo apt install -y python3.12-venv python3-pip nodejs npm postgresql postgresql-contrib nginx git
```

If `apt` gives you an older Node (this app needs Node 20+), install it from NodeSource instead:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 3. Create a dedicated Linux user to run the app

Running the service as its own unpriviledged user (not root, not your login user) is
standard practice.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin pitracker
```

## 4. Set up PostgreSQL

```bash
sudo -u postgres psql
```

```sql
CREATE USER pi_tracker_app WITH PASSWORD 'choose-a-strong-password-here';
CREATE DATABASE pi_tracker OWNER pi_tracker_app;
\c pi_tracker
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL PRIVILEGES ON DATABASE pi_tracker TO pi_tracker_app;
\q
```

## 5. Clone the repo

```bash
sudo mkdir -p /opt/pi-tracker
sudo chown pitracker:pitracker /opt/pi-tracker
sudo -u pitracker git clone https://github.com/Staunch-Software/PI-TRACKER.git /opt/pi-tracker
cd /opt/pi-tracker
```

## 6. Backend: virtualenv, dependencies, env file

```bash
sudo -u pitracker python3 -m venv /opt/pi-tracker/backend/.venv
sudo -u pitracker /opt/pi-tracker/backend/.venv/bin/pip install -r /opt/pi-tracker/backend/requirements.txt
sudo -u pitracker cp /opt/pi-tracker/backend/.env.example /opt/pi-tracker/backend/.env
sudo -u pitracker nano /opt/pi-tracker/backend/.env
```

Fill in `.env`:

```
PORT=8080
ENVIRONMENT=development   # see the note above — flip to "production" once HTTPS is set up
DATABASE_URL=postgresql+psycopg2://pi_tracker_app:YOUR_PASSWORD@localhost:5432/pi_tracker
SESSION_SECRET=generate-a-long-random-string-here
CORS_ALLOWED_ORIGIN=http://<vm-public-ip>
AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true   # or a real Azure Blob connection string
AZURE_STORAGE_CONTAINER=invoice-attachments
```

(URL-encode any `@` or special characters in the DB password, e.g. `@` → `%40`. Generate a
session secret with `openssl rand -hex 32`.)

Seed the reference data and admin user (schema migrations run automatically on backend
startup, so this is the only manual DB step):

```bash
sudo -u pitracker /opt/pi-tracker/backend/.venv/bin/python /opt/pi-tracker/backend/seed.py
```

It prints the admin login it created — change that password after your first login.

## 7. Frontend: build

The frontend is served as static files by nginx, not run as its own server — no
`VITE_API_BASE_URL` needed since `/api` is same-origin (see `deploy/nginx.conf`).

```bash
cd /opt/pi-tracker/frontend
sudo -u pitracker npm install
sudo -u pitracker npm run build
```

This produces `/opt/pi-tracker/frontend/dist`. Nginx doesn't serve that path directly — copy it to
`/var/www/pi-tracker` (kept separate from the repo checkout so multiple projects on the same VM
each get their own directory under `/var/www/`, matching this VM's existing convention):

```bash
sudo mkdir -p /var/www/pi-tracker
sudo rsync -a --delete /opt/pi-tracker/frontend/dist/ /var/www/pi-tracker/
```

## 8. Run the backend as a systemd service

```bash
sudo cp /opt/pi-tracker/deploy/pi-tracker-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-tracker-backend
sudo systemctl status pi-tracker-backend   # should show "active (running)"
```

Logs: `sudo journalctl -u pi-tracker-backend -f`

## 9. Configure nginx

```bash
sudo cp /opt/pi-tracker/deploy/nginx.conf /etc/nginx/sites-available/pi-tracker
sudo ln -s /etc/nginx/sites-available/pi-tracker /etc/nginx/sites-enabled/pi-tracker
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 10. Verify

- `curl http://localhost/api/health` on the VM should return `{"status":"ok","db":"connected"}`.
- Visit `http://<vm-public-ip>/` in a browser — you should see the login page.

## Redeploying after code changes

```bash
cd /opt/pi-tracker
sudo -u pitracker git pull
sudo -u pitracker /opt/pi-tracker/backend/.venv/bin/pip install -r backend/requirements.txt
cd frontend && sudo -u pitracker npm install && sudo -u pitracker npm run build
sudo rsync -a --delete /opt/pi-tracker/frontend/dist/ /var/www/pi-tracker/
sudo systemctl restart pi-tracker-backend
```

(Nginx doesn't need restarting — it just serves whatever's currently in `/var/www/pi-tracker`.)

## Domain + HTTPS

This VM already has a wildcard TLS certificate for `*.ozellar.com` (`/etc/ssl/ozellar/`), shared
across all the projects hosted here — no certbot issuance needed for a `*.ozellar.com`
subdomain like this one. `deploy/nginx.conf` is already set up for `pitracker.ozellar.com` using
that certificate: an HTTP→HTTPS redirect block plus the real HTTPS server block, matching the
pattern the VM's other projects (`workplace.ozellar.com`, `drs.ozellar.com`, etc.) already use.

DNS for `ozellar.com` is not wildcarded — each subdomain needs its own explicit `A` record. Add
one for `pitracker.ozellar.com` pointing at this VM's public IP (with whoever manages `ozellar.com`'s
DNS), then once it resolves (`dig +short pitracker.ozellar.com` returns the VM's IP):

1. `sudo cp deploy/nginx.conf /etc/nginx/sites-available/pi_tracker && sudo nginx -t && sudo systemctl reload nginx`
2. Update `backend/.env`: set `CORS_ALLOWED_ORIGIN=https://pitracker.ozellar.com` and
   `ENVIRONMENT=production` (this is what turns the session cookie `Secure`, which now works
   correctly since you have HTTPS).
3. `sudo systemctl restart pi_tracker`

Note this config has no `default_server` / bare-IP fallback — like every other project here,
it's only reachable via its own domain. If you were previously testing via the bare public IP
before this domain existed, that stops working once this config is deployed (by design — matches
how the rest of this VM's projects behave).

If you ever need a brand-new domain that ISN'T a `*.ozellar.com` subdomain (so the existing
wildcard cert doesn't cover it), use certbot instead:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```
