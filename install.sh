#!/usr/bin/env bash
#
# AutoVis Runner installer for macOS and Linux.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Yuikij/autovis-runner/main/install.sh | bash          # macOS
#   curl -fsSL https://raw.githubusercontent.com/Yuikij/autovis-runner/main/install.sh | sudo bash     # Linux
#
# Options (pass after `bash -s --` when piping):
#   --version <x.y.z>     Install a specific release instead of the latest
#   --package-url <url>   Install from a custom tarball URL
#   --from-source         Build and install from the current source checkout
#   --no-service          Install files only; skip service registration
#   --uninstall           Remove the service and installed files
#   --purge               With --uninstall: also remove config and data
#
set -euo pipefail

REPO="${AUTOVIS_RUNNER_REPO:-Yuikij/autovis-runner}"
SERVICE_NAME="${AUTOVIS_SERVICE_NAME:-autovis-runner}"
LAUNCHD_LABEL="com.autovis.runner"
NODE_MAJOR_REQUIRED=25
PNPM_VERSION="${AUTOVIS_PNPM_VERSION:-10.20.0}"

OS="$(uname -s)"
ARCH="$(uname -m)"

# ── Platform-dependent defaults ─────────────────────────────────────────────
if [ "$OS" = "Darwin" ]; then
  INSTALL_DIR="${AUTOVIS_INSTALL_DIR:-$HOME/.autovis-runner}"
  CONFIG_DIR="${AUTOVIS_CONFIG_DIR:-$HOME/.autovis}"
  DATA_DIR="${AUTOVIS_DATA_DIR:-$HOME/.autovis-runner/data}"
else
  INSTALL_DIR="${AUTOVIS_INSTALL_DIR:-/opt/autovis-runner}"
  CONFIG_DIR="${AUTOVIS_CONFIG_DIR:-/etc/autovis}"
  DATA_DIR="${AUTOVIS_DATA_DIR:-/var/lib/autovis}"
fi
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"

# ── CLI arguments ───────────────────────────────────────────────────────────
ACTION="install"
PURGE=false
NO_SERVICE=false
FROM_SOURCE=false
REQUESTED_VERSION=""
PACKAGE_URL="${AUTOVIS_PACKAGE_URL:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --uninstall) ACTION="uninstall"; shift ;;
    --purge) PURGE=true; shift ;;
    --no-service) NO_SERVICE=true; shift ;;
    --from-source) FROM_SOURCE=true; shift ;;
    --version) REQUESTED_VERSION="${2:-}"; shift 2 ;;
    --package-url) PACKAGE_URL="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
AutoVis Runner installer for macOS and Linux.

usage: install.sh [options]

options:
  --version <x.y.z>     Install a specific release instead of the latest
  --package-url <url>   Install from a custom tarball URL
  --from-source         Build and install from the current source checkout
  --no-service          Install files only; skip service registration
  --uninstall           Remove the service and installed files
  --purge               With --uninstall: also remove config and data
USAGE
      exit 0
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  [OK] %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  [WARN] %s\033[0m\n' "$*"; }
err()  { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

require_root_on_linux() {
  if [ "$OS" = "Linux" ] && [ "$(id -u)" -ne 0 ]; then
    err "on Linux, please run with sudo (installs to $INSTALL_DIR and registers a systemd service)"
  fi
  if [ "$OS" = "Darwin" ] && [ "$(id -u)" -eq 0 ] && [ -z "${SUDO_USER:-}" ]; then
    warn "running as root on macOS; the launchd agent will be installed for root"
  fi
}

has_systemd() {
  [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

node_arch() {
  case "$ARCH" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) err "unsupported architecture: $ARCH" ;;
  esac
}

node_platform() {
  case "$OS" in
    Darwin) echo "darwin" ;;
    Linux) echo "linux" ;;
    *) err "unsupported OS: $OS (use install.ps1 on Windows)" ;;
  esac
}

# ── CLI symlink ─────────────────────────────────────────────────────────────
# Link bin/autovis-runner into a directory on PATH so `autovis-runner` works
# globally, the way brew-installed tools do.
CLI_LINK_DIRS="/opt/homebrew/bin /usr/local/bin $HOME/.local/bin"

install_cli_link() {
  local target="$INSTALL_DIR/bin/autovis-runner"
  local link_dir=""
  for dir in $CLI_LINK_DIRS; do
    if [ -d "$dir" ] && [ -w "$dir" ]; then
      link_dir="$dir"
      break
    fi
  done
  if [ -z "$link_dir" ]; then
    if [ "$(id -u)" -eq 0 ]; then
      link_dir="/usr/local/bin"
    else
      link_dir="$HOME/.local/bin"
    fi
    mkdir -p "$link_dir"
  fi
  ln -sf "$target" "$link_dir/autovis-runner"
  ok "command linked: $link_dir/autovis-runner"
  case ":$PATH:" in
    *":$link_dir:"*) ;;
    *)
      warn "$link_dir is not on your PATH. Add it with:"
      warn "  echo 'export PATH=\"$link_dir:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
      ;;
  esac
}

remove_cli_link() {
  for dir in $CLI_LINK_DIRS; do
    if [ -L "$dir/autovis-runner" ]; then
      case "$(readlink "$dir/autovis-runner")" in
        "$INSTALL_DIR"/*) rm -f "$dir/autovis-runner" ;;
      esac
    fi
  done
}

# ── Uninstall ───────────────────────────────────────────────────────────────
uninstall() {
  log "Uninstalling AutoVis Runner..."
  remove_cli_link
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
    rm -f "$LAUNCHD_PLIST"
    ok "launchd agent removed"
  elif has_systemd; then
    systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    ok "systemd service removed"
  fi
  rm -rf "$INSTALL_DIR"
  ok "removed $INSTALL_DIR"
  if [ "$PURGE" = true ]; then
    rm -rf "$CONFIG_DIR" "$DATA_DIR"
    ok "removed config ($CONFIG_DIR) and data ($DATA_DIR)"
  else
    echo "Config ($CONFIG_DIR) and data ($DATA_DIR) were kept. Re-run with --uninstall --purge to remove them."
  fi
  echo "AutoVis Runner has been uninstalled."
}

# ── System dependencies (Linux browser libs, Xvfb, fonts) ───────────────────
install_system_deps() {
  [ "$OS" = "Linux" ] || return 0
  log "Installing system dependencies..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y curl ca-certificates tar xz-utils xvfb xauth fonts-noto-cjk fonts-liberation \
      libnss3 libatk-bridge2.0-0 libgtk-3-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates tar xz xorg-x11-server-Xvfb xorg-x11-xauth google-noto-sans-cjk-fonts liberation-fonts
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates tar xz xorg-x11-server-Xvfb xorg-x11-xauth google-noto-sans-cjk-fonts liberation-fonts
  else
    warn "unsupported package manager; skipping system dependencies (browser execution may need extra libs)"
  fi
}

# ── Node.js runtime ─────────────────────────────────────────────────────────
# Prefers a system Node >= 25; otherwise downloads an official Node build into
# $INSTALL_DIR/node so the user does not have to install anything manually.
NODE_BIN=""
NODE_DIR="$INSTALL_DIR/node"

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [ "$major" -ge "$NODE_MAJOR_REQUIRED" ]; then
      NODE_BIN="$(command -v node)"
      ok "using system Node.js $(node -v)"
      return
    fi
  fi
  if [ -x "$NODE_DIR/bin/node" ]; then
    local major
    major="$("$NODE_DIR/bin/node" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [ "$major" -ge "$NODE_MAJOR_REQUIRED" ]; then
      NODE_BIN="$NODE_DIR/bin/node"
      ok "using bundled Node.js $("$NODE_BIN" -v)"
      return
    fi
  fi

  log "Node.js ${NODE_MAJOR_REQUIRED}+ not found; downloading a bundled runtime..."
  local platform arch base file
  platform="$(node_platform)"
  arch="$(node_arch)"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR_REQUIRED}.x"
  file="$(curl -fsSL "$base/SHASUMS256.txt" | grep -o "node-v[0-9.]*-${platform}-${arch}\.tar\.gz" | head -1)"
  [ -n "$file" ] && [ "$file" != "node-v-" ] || err "could not resolve a Node.js ${NODE_MAJOR_REQUIRED}.x build for ${platform}-${arch}"

  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  curl -fsSL "$base/$file" | tar -xz -C "$NODE_DIR" --strip-components=1
  NODE_BIN="$NODE_DIR/bin/node"
  ok "bundled Node.js $("$NODE_BIN" -v) installed to $NODE_DIR"
}

PNPM_BIN=""

ensure_pnpm() {
  export PATH="$(dirname "$NODE_BIN"):$PATH"
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_BIN="$(command -v pnpm)"
    return
  fi
  log "Installing pnpm ${PNPM_VERSION}..."
  "$(dirname "$NODE_BIN")/npm" install -g "pnpm@${PNPM_VERSION}" >/dev/null 2>&1 || {
    # Fallback: standalone pnpm binary (no npm global prefix needed)
    local platform arch target
    platform="$(node_platform)"
    case "$platform" in darwin) platform="macos" ;; esac
    arch="$(node_arch)"
    target="$INSTALL_DIR/tools/pnpm"
    mkdir -p "$INSTALL_DIR/tools"
    curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-${platform}-${arch}" -o "$target"
    chmod +x "$target"
    PNPM_BIN="$target"
    ok "standalone pnpm installed to $target"
    return
  }
  PNPM_BIN="$(command -v pnpm || echo "$(dirname "$NODE_BIN")/pnpm")"
  ok "pnpm $("$PNPM_BIN" --version) ready"
}

# ── Fetch or build the release package ──────────────────────────────────────
resolve_package() {
  local tmp="$1"
  if [ "$FROM_SOURCE" = true ]; then
    local src_dir
    src_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
    [ -f "$src_dir/scripts/package-runner.sh" ] || err "--from-source requires running install.sh from a source checkout"
    log "Building release package from source ($src_dir)..."
    (cd "$src_dir" && bash scripts/package-runner.sh)
    # Copy the exact version just built; stale tarballs may exist in dist-packages
    local version
    version="$(cd "$src_dir" && node -p "require('./package.json').version")"
    cp "$src_dir/dist-packages/autovis-runner-${version}.tar.gz" "$tmp/autovis-runner.tar.gz"
    return
  fi

  if [ -z "$PACKAGE_URL" ]; then
    local tag
    if [ -n "$REQUESTED_VERSION" ]; then
      tag="v${REQUESTED_VERSION#v}"
    else
      tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)"
      [ -n "$tag" ] || err "failed to determine latest release tag for ${REPO}"
    fi
    PACKAGE_URL="https://github.com/${REPO}/releases/download/${tag}/autovis-runner-${tag#v}.tar.gz"
  fi
  log "Downloading $PACKAGE_URL"
  curl -fsSL "$PACKAGE_URL" -o "$tmp/autovis-runner.tar.gz"
}

# ── Service registration ────────────────────────────────────────────────────
install_service_linux() {
  if ! has_systemd; then
    warn "systemd not detected; skipping service registration"
    warn "start manually with: $INSTALL_DIR/bin/autovis-runner start"
    return
  fi
  log "Registering systemd service '${SERVICE_NAME}'..."
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=AutoVis Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_DIR/runner.env
Environment=NODE_BIN=$NODE_BIN
Environment=AUTOVIS_CONFIG_FILE=$CONFIG_DIR/runner.env
WorkingDirectory=$INSTALL_DIR/app
ExecStart=$INSTALL_DIR/bin/autovis-runner start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  ok "service enabled and started (autostarts on boot)"
}

install_service_macos() {
  log "Registering launchd agent '${LAUNCHD_LABEL}'..."
  mkdir -p "$HOME/Library/LaunchAgents" "$INSTALL_DIR/logs"
  cat > "$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$INSTALL_DIR/bin/autovis-runner</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key>
    <string>$NODE_BIN</string>
    <key>AUTOVIS_CONFIG_FILE</key>
    <string>$CONFIG_DIR/runner.env</string>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR/app</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$INSTALL_DIR/logs/runner.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_DIR/logs/runner.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
  if launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST" >/dev/null 2>&1; then
    :
  else
    launchctl load -w "$LAUNCHD_PLIST"
  fi
  ok "launchd agent loaded (starts at login, restarts on crash)"
}

stop_existing_service() {
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1 || true
  elif has_systemd; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
}

# ── Install ─────────────────────────────────────────────────────────────────
install() {
  require_root_on_linux

  echo ""
  echo "================================================="
  echo "        AutoVis Runner Installer ($OS)"
  echo "================================================="
  echo ""

  install_system_deps

  mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR"
  ensure_node
  ensure_pnpm

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  resolve_package "$tmp"

  log "Installing files to $INSTALL_DIR..."
  stop_existing_service
  tar -xzf "$tmp/autovis-runner.tar.gz" -C "$tmp"
  # Replace app/ and bin/ but keep node/, tools/, logs/ across upgrades.
  rm -rf "$INSTALL_DIR/app" "$INSTALL_DIR/bin"
  mv "$tmp"/autovis-runner-*/app "$INSTALL_DIR/app"
  mv "$tmp"/autovis-runner-*/bin "$INSTALL_DIR/bin"
  ok "files installed"
  install_cli_link

  if [ ! -f "$CONFIG_DIR/runner.env" ]; then
    log "Writing default config to $CONFIG_DIR/runner.env..."
    cat > "$CONFIG_DIR/runner.env" <<EOF
PORT=${PORT:-8787}
DATA_DIR=$DATA_DIR
APP_ORIGIN=${APP_ORIGIN:-http://localhost:${PORT:-8787}}
HEADLESS=${HEADLESS:-false}
BROWSER_BACKEND=${BROWSER_BACKEND:-patchright}
AUTOVIS_AUTH_ENABLED=${AUTOVIS_AUTH_ENABLED:-false}
AUTOVIS_LLM_SCOPE=${AUTOVIS_LLM_SCOPE:-shared}
AUTOVIS_ADMIN_USER=${AUTOVIS_ADMIN_USER:-admin}
AUTOVIS_ADMIN_PASSWORD=${AUTOVIS_ADMIN_PASSWORD:-}
AUTOVIS_CLOUD_URL=${AUTOVIS_CLOUD_URL:-}
AUTOVIS_DEVICE_TOKEN=${AUTOVIS_DEVICE_TOKEN:-}
EOF
  else
    ok "existing config preserved: $CONFIG_DIR/runner.env"
  fi

  log "Installing application dependencies..."
  export PATH="$(dirname "$NODE_BIN"):$PATH"
  (cd "$INSTALL_DIR/app" && "$PNPM_BIN" install --prod --frozen-lockfile)

  log "Installing browsers (Playwright + Patchright)..."
  (cd "$INSTALL_DIR/app" && "$PNPM_BIN" --filter @autovis/server exec playwright install chromium chrome) \
    || warn "Playwright browser install failed (non-fatal); rerun later with: cd $INSTALL_DIR/app && pnpm --filter @autovis/server exec playwright install chromium chrome"
  (cd "$INSTALL_DIR/app" && "$PNPM_BIN" --filter @autovis/server exec patchright install chromium) \
    || warn "Patchright browser install failed (non-fatal)"

  if [ "$NO_SERVICE" = true ]; then
    warn "--no-service given; skipping service registration"
  elif [ "$OS" = "Darwin" ]; then
    install_service_macos
  else
    install_service_linux
  fi

  echo ""
  echo "================================================="
  echo "   AutoVis Runner installed successfully!"
  echo "================================================="
  echo ""
  echo "  URL:     http://localhost:${PORT:-8787}"
  echo "  Config:  $CONFIG_DIR/runner.env"
  echo "  CLI:     autovis-runner {status|restart|stop|logs}"
  if [ "$OS" = "Darwin" ]; then
    echo "  Service: launchctl print gui/\$(id -u)/$LAUNCHD_LABEL"
    echo "  Logs:    tail -f $INSTALL_DIR/logs/runner.log"
  elif has_systemd; then
    echo "  Service: systemctl status $SERVICE_NAME"
    echo "  Logs:    journalctl -u $SERVICE_NAME -f"
  fi
  echo ""
}

case "$ACTION" in
  uninstall)
    require_root_on_linux
    uninstall
    ;;
  install)
    install
    ;;
esac
