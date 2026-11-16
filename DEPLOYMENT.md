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

## 5. Set up the release layout

Production no longer runs out of a single `git pull`-in-place checkout. Everything lives under
`/opt/pi_tracker`:

```
/opt/pi_tracker/repo       git clone used only to fetch code — nothing runs out of here directly
/opt/pi_tracker/releases   one directory per deploy (code + its own venv + built frontend)
/opt/pi_tracker/shared     state that survives every deploy: backend/.env, the two scraper
                           auth.json files, constraints.txt (pinned dependency versions)
/opt/pi_tracker/current    symlink to whichever release directory is live
```

`deploy/deploy.sh` (installed as `/opt/pi_tracker/deploy.sh`, see step 6) builds a new release
into `releases/`, runs `alembic upgrade head` against it, flips `current` to point at it, restarts
the service, and health-checks it — auto-rolling back the symlink if the health check fails.
Anything that fails before the flip leaves the running app untouched.

```bash
sudo mkdir -p /opt/pi_tracker/{repo,releases,shared}
sudo chown -R pitracker:pitracker /opt/pi_tracker
sudo -u pitracker git clone https://github.com/Staunch-Software/PI-TRACKER.git /opt/pi_tracker/repo
```

Create the files that live in `shared/` and are symlinked into every release (paths are relative
to the repo root — see `SHARED_FILES` in `deploy/deploy.sh` if this list changes):

```bash
sudo -u pitracker mkdir -p /opt/pi_tracker/shared/backend/app/services/pir_scraper
sudo -u pitracker mkdir -p /opt/pi_tracker/shared/backend/app/services/approved_invoice_scraper
sudo -u pitracker cp /opt/pi_tracker/repo/backend/.env.example \
  /opt/pi_tracker/shared/backend/.env
sudo -u pitracker nano /opt/pi_tracker/shared/backend/.env
```

Fill in `backend/.env` as before:

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

Put the two scraper `auth.json` files (SmartPAL session state) at
`shared/backend/app/services/pir_scraper/auth.json` and
`shared/backend/app/services/approved_invoice_scraper/auth.json`. `deploy.sh` refuses to build a
release if any shared file is missing.

`constraints.txt` (a `pip freeze` of a known-good venv) is optional on the very first deploy —
`deploy.sh` just installs `requirements.txt` unpinned and prints a warning if it's absent. See
"Upgrading a pinned dependency" below for how to create/refresh it.

## 6. Install `deploy.sh` and the systemd units

```bash
sudo cp /opt/pi_tracker/repo/deploy/deploy.sh /opt/pi_tracker/deploy.sh
sudo chmod +x /opt/pi_tracker/deploy.sh
```

Install the systemd unit files from `deploy/` the same way — `cp` into `/etc/systemd/system/`,
then `daemon-reload`. This includes `pi_tracker.service`, the backend web service that
`deploy.sh` builds, restarts, and health-checks on every deploy:

```bash
sudo cp /opt/pi_tracker/repo/deploy/pi_tracker.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_pir_scrape.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_pir_scrape.timer \
        /opt/pi_tracker/repo/deploy/pi_tracker_smartpal_invoice_scrape.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_smartpal_invoice_scrape.timer \
        /opt/pi_tracker/repo/deploy/pi_tracker_invoice_registration_scrape.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_invoice_registration_scrape.timer \
        /opt/pi_tracker/repo/deploy/pi_tracker_po_scrape.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_po_scrape.timer \
        /opt/pi_tracker/repo/deploy/pi_tracker_vendor_master_scrape.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_vendor_master_scrape.timer \
        /opt/pi_tracker/repo/deploy/pi_tracker_soa_ingest.service \
        /opt/pi_tracker/repo/deploy/pi_tracker_soa_ingest.timer \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi_tracker.service
sudo systemctl enable --now pi_tracker_pir_scrape.timer
sudo systemctl enable --now pi_tracker_smartpal_invoice_scrape.timer
sudo systemctl enable --now pi_tracker_invoice_registration_scrape.timer
sudo systemctl enable --now pi_tracker_po_scrape.timer
sudo systemctl enable --now pi_tracker_vendor_master_scrape.timer
```

`pi_tracker_soa_ingest.timer` is installed above but **not** enabled — it's not currently running
on production. Only `enable --now` it once SOA mailbox ingestion is ready to go live.

## 7. First deploy

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh
```

This fetches `origin/main`, builds it into a new `releases/<timestamp>-<sha>` directory (venv +
`pip install`, frontend `npm ci && npm run build`), runs `alembic upgrade head`, flips
`/opt/pi_tracker/current` to the new release, restarts the backend service, and polls
`http://127.0.0.1:8080/` until it answers (or rolls the symlink back and restarts the previous
release if it doesn't). It keeps the last 5 releases and prunes older ones automatically.

You can deploy a specific branch/tag/commit instead of `origin/main`:

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh some-branch-or-tag-or-sha
```

Or build a release without making it live (no migration, no flip, no restart) — useful for
smoke-testing a build before it goes out:

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh --build-only
```

**Deploys are refused while a scraper is running.** `deploy.sh` checks for any active/activating
`pi_tracker_*` systemd unit before touching anything (other than `--build-only`, which doesn't
flip or restart, so it's always allowed) — a scraper started under the old release should finish
before the code or schema underneath it changes. If a deploy is refused for this reason, just
re-run it once the scraper's run completes (see the schedule table below for about when that is).

## 8. Configure nginx

```bash
sudo cp /opt/pi_tracker/repo/deploy/nginx.conf /etc/nginx/sites-available/pi_tracker
sudo ln -s /etc/nginx/sites-available/pi_tracker /etc/nginx/sites-enabled/pi_tracker
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 9. Verify

- `curl http://localhost/api/health` on the VM should return `{"status":"ok","db":"connected"}`.
- Visit `http://<vm-public-ip>/` in a browser — you should see the login page.

## 10. Scheduled SmartPAL scrapers

Five standalone scripts run on their own schedule via systemd timers, independent of the backend
web service:

| Timer | Runs | Schedule | What it does |
|---|---|---|---|
| `pi_tracker_pir_scrape` | `app.services.pir_scraper.scraper` | 06:00 / 18:00 | PIR entries sweep + `pir_rejections` ("Rejected By") |
| `pi_tracker_smartpal_invoice_scrape` | `app.services.smartpal_invoice_scraper.scraper` | 06:30 / 18:30 | All-vessel/all-status invoice sweep for SOA reconciliation |
| `pi_tracker_invoice_registration_scrape` | `app.services.approved_invoice_scraper.scraper` | 07:00 / 19:00 | AMNS-fleet approved invoices + `invoice_registrations` ("Registered By") |
| `pi_tracker_po_scrape` | `app.services.po_scraper.scraper` | 07:30 / 19:30 | Fleet-wide `pr_entries`/`po_entries` sweep (from 01-Jul-2026) feeding the DD Tracker module |
| `pi_tracker_vendor_master_scrape` | `app.services.vendor_master_scraper.scraper` | 08:00 / 20:00 | Fleet-wide `vendor_master_entries` list sweep (~1,098 vendors) feeding the Vendor Management module's picker |

All five log into the same SmartPAL account (just different modules — `AccountsPALApp` for the
first, `PurchasePALApp` for the other three), and a second concurrent login can kick out the first
one's session — confirmed live. The 30-minute stagger above is deliberate; don't schedule any of
these back-to-back or overlapping.

Each unit now runs out of `/opt/pi_tracker/current/backend` (updated by every deploy), not a
fixed checkout, so their code is kept current automatically — no separate `git pull` or restart
needed for scraper changes, they just pick up whatever `current` points to next time their timer
fires.

There's also `pi_tracker_soa_ingest` (`app.services.soa_scraper.ingest`, every 4 hours — SOA
mailbox ingestion via Graph + Ollama extraction). Its unit and timer are in `deploy/` and get
installed in step 6, but the timer is **not currently enabled on production** — it's not live
yet.

Check status/logs for any of them:

```bash
systemctl list-timers --all | grep pi_tracker
sudo journalctl -u pi_tracker_invoice_registration_scrape.service -n 60 --no-pager
```

To run one immediately instead of waiting for its next scheduled fire:

```bash
sudo systemctl start pi_tracker_invoice_registration_scrape.service
```

## Redeploying after code changes

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh
```

That's it — see step 7 above for what this does, `--build-only`, and the scraper-running guard.
Logs for the live release: `sudo journalctl -u pi_tracker.service -f`.

## Rolling back

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh --rollback
```

Flips `current` back to the release before the one that's live now, restarts the service, and
health-checks it. This only ever moves the `current` symlink and restarts the service — **it does
not undo a database migration**, so a rollback after a deploy that included a schema change will
leave the database ahead of the code. If that happens, write and apply a compensating migration
rather than trying to hand-revert the schema.

## Upgrading a pinned dependency

`constraints.txt` in `shared/` pins every package to the exact version currently installed in
production, so a routine deploy never silently picks up a newer release of a dependency. To take
a deliberate upgrade:

```bash
sudo -u pitracker /opt/pi_tracker/deploy.sh --build-only   # build a release with requirements.txt as-is
sudo /opt/pi_tracker/releases/<the-new-release>/backend/venv/bin/pip install --upgrade <package>
sudo -u pitracker /opt/pi_tracker/releases/<the-new-release>/backend/venv/bin/pip freeze \
  > /opt/pi_tracker/shared/constraints.txt
```

Then deploy normally — every release from now on will install that pinned set until you refresh
`constraints.txt` again. (If the upgrade needs testing first, do that against the `--build-only`
release before promoting it, or just deploy normally once you're confident and let the health
check/auto-rollback be the safety net.)

## Installing an updated `deploy.sh` or unit file

`deploy.sh` and the systemd unit files are not part of what a regular deploy touches — they live
in `/opt/pi_tracker/deploy.sh` and `/etc/systemd/system/`, outside the `releases/`/`current`
mechanism, so changing them needs a manual step after you've pulled the new version into a
release (or reviewed the diff in the repo):

```bash
sudo cp /opt/pi_tracker/current/deploy/deploy.sh /opt/pi_tracker/deploy.sh
sudo chmod +x /opt/pi_tracker/deploy.sh

# for a changed unit file, e.g. the PIR scrape timer:
sudo cp /opt/pi_tracker/current/deploy/pi_tracker_pir_scrape.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart pi_tracker_pir_scrape.timer   # or the .service, if it's a oneshot you want to re-trigger now
```

## Domain + HTTPS

This VM already has a wildcard TLS certificate for `*.ozellar.com` (`/etc/ssl/ozellar/`), shared
across all the projects hosted here — no certbot issuance needed for a `*.ozellar.com`
subdomain like this one. `deploy/nginx.conf` is already set up for `pitracker.ozellar.com` using
that certificate: an HTTP→HTTPS redirect block plus the real HTTPS server block, matching the
pattern the VM's other projects (`workplace.ozellar.com`, `drs.ozellar.com`, etc.) already use.

DNS for `ozellar.com` is not wildcarded — each subdomain needs its own explicit `A` record. Add
one for `pitracker.ozellar.com` pointing at this VM's public IP (with whoever manages `ozellar.com`'s
DNS), then once it resolves (`dig +short pitracker.ozellar.com` returns the VM's IP):

1. `sudo cp /opt/pi_tracker/current/deploy/nginx.conf /etc/nginx/sites-available/pi_tracker && sudo nginx -t && sudo systemctl reload nginx`
2. Update `/opt/pi_tracker/shared/backend/.env`: set `CORS_ALLOWED_ORIGIN=https://pitracker.ozellar.com`
   and `ENVIRONMENT=production` (this is what turns the session cookie `Secure`, which now works
   correctly since you have HTTPS).
3. `sudo systemctl restart pi_tracker.service`

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
