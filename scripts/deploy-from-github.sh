#!/usr/bin/env bash
set -Eeuo pipefail

# Pull the release from GitHub, update the portal and WHMCS bridge, then restart
# the service. This script deliberately never pushes to GitHub: coding agents
# own the commit/push step; the deployer only consumes origin/main.

APP_DIR="${APP_DIR:-/opt/whmcs-portal-new}"
REPO_URL="${REPO_URL:-https://github.com/yeaminlabs/whmcs-portal.git}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-whmcs-portal.service}"
HEALTH_URL="${HEALTH_URL:-https://app.snbdhost.com/login}"
MODULE_DIR="${MODULE_DIR:-/home/snbdhost-portal/htdocs/portal.snbdhost.com/modules/addons/snbd_portal_bridge}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/whmcs-portal}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/deploy-from-github.sh [--dry-run]

Environment overrides:
  APP_DIR, REPO_URL, BRANCH, SERVICE_NAME, HEALTH_URL, MODULE_DIR, BACKUP_DIR

The production .env, data/, and node_modules/ are preserved. The release is
always cloned from GitHub; no local production checkout is trusted as source.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
run() {
  if "$DRY_RUN"; then
    printf '[deploy] dry-run:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

for command in git rsync npm curl; do
  command -v "$command" >/dev/null 2>&1 || die "required command not found: $command"
done

if [[ "$APP_DIR" == "/" || "$APP_DIR" == "" || "$MODULE_DIR" == "/" || "$MODULE_DIR" == "" ]]; then
  die "refusing unsafe empty or root deployment path"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/whmcs-portal-deploy.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

RELEASE_DIR="$TMP_DIR/release"
log "Cloning $REPO_URL ($BRANCH)"
run git clone --depth 1 --branch "$BRANCH" --single-branch "$REPO_URL" "$RELEASE_DIR"

if "$DRY_RUN"; then
  COMMIT='dry-run'
else
  COMMIT="$(git -C "$RELEASE_DIR" rev-parse --short HEAD)"
fi
log "Release: $COMMIT"

if [[ ! -d "$APP_DIR" ]]; then
  run mkdir -p "$APP_DIR"
fi

# Keep a code-only rollback copy when possible. Secrets and customer data are
# explicitly excluded from the archive.
if [[ -d "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  if [[ "$(id -u)" -eq 0 ]]; then
    run mkdir -p "$BACKUP_DIR"
    run tar -C "$APP_DIR" --exclude=.env --exclude=data --exclude=node_modules -czf "$BACKUP_DIR/portal-before-${COMMIT}.tar.gz" .
  else
    log "Skipping rollback archive (not running as root)"
  fi
fi

# --delete removes stale tracked files, while the excludes protect production
# secrets, durable OAuth/session data, and installed dependencies.
run rsync -a --delete \
  --exclude='.env' \
  --exclude='data/' \
  --exclude='node_modules/' \
  --exclude='.deploy-backups/' \
  "$RELEASE_DIR/" "$APP_DIR/"

log "Installing locked dependencies and building the client"
run npm --prefix "$APP_DIR" ci
run npm --prefix "$APP_DIR" run build

if [[ -d "$RELEASE_DIR/whmcs-module/modules/addons/snbd_portal_bridge" ]]; then
  log "Syncing WHMCS bridge addon"
  run mkdir -p "$MODULE_DIR"
  run rsync -a --delete \
    "$RELEASE_DIR/whmcs-module/modules/addons/snbd_portal_bridge/" \
    "$MODULE_DIR/"
fi

if [[ "$DRY_RUN" == false ]]; then
  if [[ ! -f "$APP_DIR/.env" ]]; then
    die "missing $APP_DIR/.env; refusing to start production without secrets"
  fi
  log "Restarting $SERVICE_NAME"
  run systemctl restart "$SERVICE_NAME"
  run systemctl is-active --quiet "$SERVICE_NAME"
  log "Checking $HEALTH_URL"
  run curl --fail --silent --show-error --max-time 20 --output /dev/null "$HEALTH_URL"
fi

log "Deployment complete: $COMMIT"
