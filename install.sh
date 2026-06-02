#!/usr/bin/env bash
set -euo pipefail

REPO="${AUTOVIS_RUNNER_REPO:-Yuikij/autovis-runner}"
INSTALL_DIR="${AUTOVIS_INSTALL_DIR:-/opt/autovis-runner}"
CONFIG_DIR="${AUTOVIS_CONFIG_DIR:-/etc/autovis}"
DATA_DIR="${AUTOVIS_DATA_DIR:-/var/lib/autovis}"
SERVICE_NAME="${AUTOVIS_SERVICE_NAME:-autovis-runner}"

err() {
  echo "error: $*" >&2
  exit 1
}

# Fetch the latest release version if package url is not specified
if [ -z "${AUTOVIS_PACKAGE_URL:-}" ]; then
  LATEST_TAG=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep -o '"tag_name": ".*"' | cut -d'"' -f4)
  if [ -z "$LATEST_TAG" ]; then
    err "Failed to determine latest release tag for ${REPO}"
  fi
  VERSION="${LATEST_TAG#v}"
  PACKAGE_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/autovis-runner-${VERSION}.tar.gz"
else
  PACKAGE_URL="$AUTOVIS_PACKAGE_URL"
fi

install_system_deps() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y curl ca-certificates tar xz-utils xvfb xauth fonts-noto-cjk fonts-liberation \
      libnss3 libatk-bridge2.0-0 libgtk-3-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates tar xz xorg-x11-server-Xvfb xorg-x11-xauth google-noto-sans-cjk-fonts liberation-fonts
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates tar xz xorg-x11-server-Xvfb xorg-x11-xauth google-noto-sans-cjk-fonts liberation-fonts
  else
    echo "Skipping system dependency installation: unsupported package manager."
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$major" -ge 22 ]; then
      return
    fi
  fi
  err "Node.js 22+ is required. Install Node.js first, then rerun this installer."
}

main() {
  if [ "$(id -u)" -ne 0 ]; then
    err "please run with sudo"
  fi

  install_system_deps
  ensure_node
  corepack enable >/dev/null 2>&1 || true

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "Downloading $PACKAGE_URL"
  curl -fsSL "$PACKAGE_URL" -o "$tmp/autovis-runner.tar.gz"

  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR"
  tar -xzf "$tmp/autovis-runner.tar.gz" -C "$tmp"
  mv "$tmp"/autovis-runner-*/* "$INSTALL_DIR/"

  if [ ! -f "$CONFIG_DIR/runner.env" ]; then
    cat > "$CONFIG_DIR/runner.env" <<EOF
PORT=${PORT:-8787}
DATA_DIR=$DATA_DIR
APP_ORIGIN=${APP_ORIGIN:-http://localhost:${PORT:-8787}}
HEADLESS=${HEADLESS:-false}
BROWSER_BACKEND=${BROWSER_BACKEND:-playwright}
AUTOVIS_DEVICE_TOKEN=${AUTOVIS_DEVICE_TOKEN:-}
EOF
  fi

  cd "$INSTALL_DIR/app"
  pnpm install --prod --frozen-lockfile
  pnpm --filter @autovis/server exec playwright install chromium

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=AutoVis Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_DIR/runner.env
WorkingDirectory=$INSTALL_DIR/app
ExecStart=$INSTALL_DIR/bin/autovis-runner start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"

  echo "AutoVis Runner installed."
  echo "Local URL: http://localhost:${PORT:-8787}"
  echo "Config: $CONFIG_DIR/runner.env"
}

main "$@"
