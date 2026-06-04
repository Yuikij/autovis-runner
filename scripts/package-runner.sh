#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${AUTOVIS_VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
DIST_DIR="$ROOT_DIR/dist-packages"
STAGE_DIR="$DIST_DIR/autovis-runner-$VERSION"
ARCHIVE="$DIST_DIR/autovis-runner-$VERSION.tar.gz"

cd "$ROOT_DIR"

pnpm install --frozen-lockfile
pnpm build

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR/app/apps" "$STAGE_DIR/app/packages" "$STAGE_DIR/bin"

cp package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json "$STAGE_DIR/app/"
cp -R apps/server "$STAGE_DIR/app/apps/server"
cp -R apps/web "$STAGE_DIR/app/apps/web"
cp -R packages/shared "$STAGE_DIR/app/packages/shared"
cp -R packages/runner "$STAGE_DIR/app/packages/runner"
cp -R scripts "$STAGE_DIR/app/scripts"

find "$STAGE_DIR/app" \
  \( -name node_modules -o -name src -o -name .turbo -o -name .vite \) \
  -prune -exec rm -rf {} +

rm -rf "$STAGE_DIR/app/apps/server/screenshots"
rm -f "$STAGE_DIR/app/apps/server"/login-*.png "$STAGE_DIR/app/apps/server/last-llm-curl.sh"

cat > "$STAGE_DIR/bin/autovis-runner" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$HERE/../app" && pwd)"

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

case "${1:-start}" in
  start)
    shift || true
    AUTOVIS_APP_DIR="$APP_DIR" "$APP_DIR/scripts/start-runner.sh" "$@"
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
    echo "usage: autovis-runner [start|install-deps|register]" >&2
    exit 1
    ;;
esac
EOF

chmod +x "$STAGE_DIR/bin/autovis-runner" "$STAGE_DIR/app/scripts/start-runner.sh"

tar -C "$DIST_DIR" -czf "$ARCHIVE" "autovis-runner-$VERSION"
echo "Created $ARCHIVE"
