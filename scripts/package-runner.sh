#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_get_version() {
  cd "$ROOT_DIR"
  node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)" 2>/dev/null \
    || grep -m1 '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/'
}
VERSION="${AUTOVIS_VERSION:-$(_get_version)}"
DIST_DIR="$ROOT_DIR/dist-packages"
STAGE_DIR="$DIST_DIR/autovis-runner-$VERSION"
ARCHIVE="$DIST_DIR/autovis-runner-$VERSION.tar.gz"

cd "$ROOT_DIR"

pnpm install --frozen-lockfile
pnpm build

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/app/apps" "$STAGE_DIR/app/packages" "$STAGE_DIR/bin"

cp package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json "$STAGE_DIR/app/"
tar -cf - \
  --exclude="node_modules" \
  --exclude="src" \
  --exclude=".turbo" \
  --exclude=".vite" \
  apps/server apps/web packages/shared packages/runner scripts | \
  tar -C "$STAGE_DIR/app" -xf -

rm -rf "$STAGE_DIR/app/apps/server/screenshots"
rm -f "$STAGE_DIR/app/apps/server"/login-*.png "$STAGE_DIR/app/apps/server/last-llm-curl.sh"

cat > "$STAGE_DIR/bin/autovis-runner" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

# Resolve symlinks (e.g. /opt/homebrew/bin/autovis-runner) back to the real
# install location so relative paths like ../app work.
SOURCE="${BASH_SOURCE[0]:-$0}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac
done
HERE="$(cd "$(dirname "$SOURCE")" && pwd)"
APP_DIR="$(cd "$HERE/../app" && pwd)"
INSTALL_ROOT="$(cd "$HERE/.." && pwd)"
SERVICE_NAME="${AUTOVIS_SERVICE_NAME:-autovis-runner}"
LAUNCHD_LABEL="com.autovis.runner"
OS="$(uname -s)"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install pnpm." >&2
    exit 127
  fi
  npm install -g "pnpm@${AUTOVIS_PNPM_VERSION:-10.20.0}"
}

has_systemd() {
  [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

svc() {
  # Dispatch a service action to launchd (macOS) or systemd (Linux).
  local action="$1"
  if [ "$OS" = "Darwin" ]; then
    local target="gui/$(id -u)/$LAUNCHD_LABEL"
    local plist="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
    case "$action" in
      status)
        if launchctl print "$target" >/dev/null 2>&1; then
          launchctl print "$target" | grep -E "state|pid" | head -5
        else
          echo "$LAUNCHD_LABEL is not loaded"
          return 1
        fi
        ;;
      stop) launchctl bootout "$target" ;;
      restart)
        launchctl bootout "$target" >/dev/null 2>&1 || true
        launchctl bootstrap "gui/$(id -u)" "$plist"
        ;;
      enable)
        launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || launchctl load -w "$plist"
        ;;
      disable) launchctl bootout "$target" 2>/dev/null; launchctl unload -w "$plist" 2>/dev/null || true ;;
      logs) exec tail -f "$INSTALL_ROOT/logs/runner.log" ;;
    esac
  elif has_systemd; then
    case "$action" in
      status) systemctl status "$SERVICE_NAME" --no-pager ;;
      stop) sudo systemctl stop "$SERVICE_NAME" ;;
      restart) sudo systemctl restart "$SERVICE_NAME" ;;
      enable) sudo systemctl enable --now "$SERVICE_NAME" ;;
      disable) sudo systemctl disable --now "$SERVICE_NAME" ;;
      logs) exec journalctl -u "$SERVICE_NAME" -f ;;
    esac
  else
    echo "no supported service manager found (launchd/systemd); run 'autovis-runner start' in the foreground" >&2
    return 1
  fi
}

case "${1:-start}" in
  start)
    shift || true
    AUTOVIS_APP_DIR="$APP_DIR" "$APP_DIR/scripts/start-runner.sh" "$@"
    ;;
  status|stop|restart|logs|enable|disable)
    svc "$1"
    ;;
  install-deps)
    cd "$APP_DIR"
    ensure_pnpm
    pnpm install --prod --frozen-lockfile
    ;;
  register)
    shift || true
    token=""
    cloud_url=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --token)
          token="${2:-}"
          shift 2
          ;;
        --cloud-url)
          cloud_url="${2:-}"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    if [ -z "$token" ]; then
      echo "usage: autovis-runner register --token <device-token>" >&2
      exit 1
    fi
    mkdir -p "${AUTOVIS_CONFIG_DIR:-$HOME/.autovis}"
    {
      printf 'AUTOVIS_DEVICE_TOKEN=%s\n' "$token"
      if [ -n "$cloud_url" ]; then
        printf 'AUTOVIS_CLOUD_URL=%s\n' "$cloud_url"
      fi
    } > "${AUTOVIS_CONFIG_DIR:-$HOME/.autovis}/runner.env"
    echo "AutoVis Runner device token saved."
    ;;
  *)
    cat >&2 <<'USAGE'
usage: autovis-runner <command>

commands:
  start          run the runner in the foreground
  status         show service status (launchd/systemd)
  stop           stop the service
  restart        restart the service
  logs           follow service logs
  enable         enable the service and start it on boot/login
  disable        disable the service
  register       save cloud device token (--token <t> [--cloud-url <url>])
  install-deps   reinstall production dependencies
USAGE
    exit 1
    ;;
esac
EOF

chmod +x "$STAGE_DIR/bin/autovis-runner" "$STAGE_DIR/app/scripts/start-runner.sh"
# perl -i works on both GNU/Linux and macOS (BSD sed -i needs a suffix arg)
find "$STAGE_DIR" -type f \( -name "*.sh" -o -name "autovis-runner" \) -exec perl -i -pe 's/\r$//' {} +

tar -C "$DIST_DIR" -czf "$ARCHIVE" "autovis-runner-$VERSION"
echo "Created $ARCHIVE"
