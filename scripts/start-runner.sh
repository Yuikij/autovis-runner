#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${AUTOVIS_APP_DIR:-$ROOT_DIR}"
NODE_BIN="${NODE_BIN:-node}"
CONFIG_FILE="${AUTOVIS_CONFIG_FILE:-${AUTOVIS_CONFIG_DIR:-$HOME/.autovis}/runner.env}"

if [ -f "$CONFIG_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
fi

export PORT="${PORT:-8787}"
export DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
export APP_ORIGIN="${APP_ORIGIN:-http://localhost:${PORT}}"

if [ -n "${AUTOVIS_DEVICE_TOKEN:-}" ] && [ -n "${AUTOVIS_CLOUD_URL:-}" ]; then
  echo "AutoVis Runner cloud binding configured for ${AUTOVIS_CLOUD_URL}"
fi

if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a "$NODE_BIN" "$APP_DIR/apps/server/dist/index.js"
fi

exec "$NODE_BIN" "$APP_DIR/apps/server/dist/index.js"
