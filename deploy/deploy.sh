#!/usr/bin/env bash
# PI Tracker release deploy.
#
#   ./deploy.sh                build origin/main into a new release, migrate, flip, restart, health-check
#   ./deploy.sh <git-ref>      same, for a specific branch / tag / commit
#   ./deploy.sh --build-only   build a release and stop (no migration, no flip, no restart)
#   ./deploy.sh --rollback     flip back to the release before the current one
#
# Layout:
#   /opt/pi_tracker/repo       git clone used only to fetch code
#   /opt/pi_tracker/releases   one directory per deploy (code + venv + built frontend)
#   /opt/pi_tracker/shared     state that survives deploys (.env, scraper auth.json files, constraints.txt)
#   /opt/pi_tracker/current    symlink to the live release
#
# Anything that fails before the flip leaves production untouched.

set -euo pipefail

BASE=${PI_TRACKER_BASE:-/opt/pi_tracker}
REPO=$BASE/repo
RELEASES=$BASE/releases
SHARED=$BASE/shared
CURRENT=$BASE/current
SERVICE=pi_tracker.service
HEALTH_URL=http://127.0.0.1:8080/
KEEP=5

# Exact package versions (pip freeze). When present, every release installs these versions.
CONSTRAINTS=$SHARED/constraints.txt

# Files kept in shared/ and symlinked into every release (paths relative to the repo root).
SHARED_FILES=(
  backend/.env
  backend/app/services/pir_scraper/auth.json
  backend/app/services/approved_invoice_scraper/auth.json
)

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

releases() { find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' | sort; }

flip() {
  ln -sfn "$1" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
}

# Alive = any HTTP answer below 500 (a 404 on / still proves the app booted).
healthy() {
  local code
  for _ in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$HEALTH_URL" || true)
    if [[ "$code" =~ ^[1-4][0-9][0-9]$ ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

restart_and_check() {
  sudo systemctl restart "$SERVICE"
  healthy
}

MODE=deploy
case "${1:-}" in
  --rollback)   MODE=rollback; shift ;;
  --build-only) MODE=build; shift ;;
  -*)           die "unknown option: $1" ;;
esac

# ---------- guards ----------

mkdir -p "$RELEASES"
exec 9>"$BASE/.deploy.lock"
flock -n 9 || die "another deploy is already running"

if [[ "$MODE" != build ]]; then
  # A scraper started from the old release should finish before code or schema changes under it.
  running=$(systemctl list-units --type=service --no-legend --plain 'pi_tracker_*' \
    | awk '$3=="activating" || $3=="active" {print $1}')
  [[ -z "$running" ]] || die "scraper running, try again when it finishes: $running"
fi

# ---------- rollback ----------

if [[ "$MODE" == rollback ]]; then
  [[ -L "$CURRENT" ]] || die "no current release to roll back from"
  cur=$(readlink -f "$CURRENT")
  prev=$(releases | grep -B1 -Fx "$cur" | head -n1)
  [[ -n "$prev" && "$prev" != "$cur" ]] || die "no earlier release to roll back to"

  log "Rolling back: $(basename "$cur") -> $(basename "$prev")"
  flip "$prev"
  restart_and_check || die "service is not healthy after rollback, check: journalctl -u $SERVICE -n 50"
  log "Rolled back to $(basename "$prev"). Database schema was not changed."
  exit 0
fi

# ---------- preflight ----------

[[ -d "$REPO/.git" ]] || die "$REPO is not a git clone"
for f in "${SHARED_FILES[@]}"; do
  [[ -f "$SHARED/$f" ]] || die "missing shared file: $SHARED/$f"
done

REF=${1:-origin/main}

log "Fetching"
git -C "$REPO" fetch --prune origin
SHA=$(git -C "$REPO" rev-parse --short "$REF^{commit}") || die "unknown ref: $REF"

REL=$RELEASES/$(date +%Y%m%d-%H%M%S)-$SHA
KEEP_RELEASE=0

cleanup() {
  if [[ "$KEEP_RELEASE" == 0 && -d "$REL" ]]; then
    rm -rf -- "$REL"
    printf '\nRemoved unfinished release %s. Production was not touched.\n' "$(basename "$REL")" >&2
  fi
}
trap cleanup EXIT

# ---------- build ----------

log "Exporting $REF ($SHA) to $REL"
mkdir -p "$REL"
git -C "$REPO" archive "$SHA" | tar -x -C "$REL"
echo "$SHA" > "$REL/REVISION"

log "Linking shared files"
for f in "${SHARED_FILES[@]}"; do
  mkdir -p "$(dirname "$REL/$f")"
  ln -sfn "$SHARED/$f" "$REL/$f"
done

log "Backend: venv + dependencies"
cd "$REL/backend"
python3 -m venv venv
venv/bin/python -m pip install --quiet --upgrade pip
if [[ -f "$CONSTRAINTS" ]]; then
  venv/bin/python -m pip install --quiet -r requirements.txt -c "$CONSTRAINTS"
else
  echo "No $CONSTRAINTS found: unpinned packages will install at their latest versions."
  venv/bin/python -m pip install --quiet -r requirements.txt
fi
if venv/bin/python -m pip show playwright >/dev/null 2>&1; then
  # No-op when the browser for this Playwright version is already downloaded.
  venv/bin/python -m playwright install chromium
fi

log "Frontend: build"
cd "$REL/frontend"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build
[[ -f dist/index.html ]] || die "frontend build produced no dist/index.html"
rm -rf node_modules

if [[ "$MODE" == build ]]; then
  KEEP_RELEASE=1
  log "Built $REL (not live: no migration, no flip, no restart)"
  exit 0
fi

# ---------- migrate + flip ----------

if [[ -f "$REL/backend/alembic.ini" ]]; then
  log "Database migrations"
  cd "$REL/backend"
  venv/bin/alembic upgrade head
fi

PREV=""
if [[ -L "$CURRENT" ]]; then
  PREV=$(readlink -f "$CURRENT")
fi

log "Switching current -> $(basename "$REL")"
flip "$REL"
KEEP_RELEASE=1

log "Restarting $SERVICE"
if ! restart_and_check; then
  if [[ -n "$PREV" ]]; then
    printf '\nHealth check failed. Rolling back to %s\n' "$(basename "$PREV")" >&2
    flip "$PREV"
    sudo systemctl restart "$SERVICE"
    rm -rf -- "$REL"
    die "deploy failed and was rolled back (code only, not schema). Check: journalctl -u $SERVICE -n 50"
  fi
  die "health check failed and there is no previous release. Check: journalctl -u $SERVICE -n 50"
fi

# ---------- prune ----------

cur=$(readlink -f "$CURRENT")
releases | head -n -"$KEEP" | while read -r old; do
  [[ "$old" == "$cur" ]] && continue
  rm -rf -- "$old"
  echo "Pruned $(basename "$old")"
done

log "Deployed $(basename "$REL")"
