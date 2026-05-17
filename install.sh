#!/usr/bin/env bash
# DaddysLittleHelper — idempotent installer (safe to rerun).
# Usage: git clone <repo> && cd DaddysLittleHelper && ./install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DLH_HOME="${DLH_HOME:-${HOME}/.local/share/daddyslittlehelper}"
CONFIG_DIR="${HOME}/.config/daddyslittlehelper"
STATE_FILE="${CONFIG_DIR}/install.env"
LOG_DIR="${CONFIG_DIR}/logs"

mkdir -p "${CONFIG_DIR}" "${LOG_DIR}" "${HOME}/.local/bin" "${HOME}/.cursor"

write_state() {
  cat >"${STATE_FILE}" <<EOF
# Written by install.sh — do not edit unless you know why.
DLH_ROOT=${ROOT}
DLH_HOME=${DLH_HOME}
DLH_BRIDGE_URL=http://127.0.0.1:3847
INSTALLED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
}

log() {
  echo "[dlh-install] $*"
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 20+ is required. Install Node LTS, then rerun ./install.sh" >&2
    exit 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "${major}" -lt 20 ]; then
    echo "Node.js 20+ is required; found $(node --version)" >&2
    exit 1
  fi
}

install_cursor_cli() {
  if command -v agent >/dev/null 2>&1; then
    log "Cursor CLI: $(agent --version 2>/dev/null | head -1 || echo present)"
    return 0
  fi
  log "Installing Cursor CLI..."
  curl -fsSL https://cursor.com/install | bash
}

install_npm_deps() {
  cd "${ROOT}"
  if [ -f package-lock.json ]; then
    log "npm ci"
    npm ci --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log" || npm install --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log"
  else
    log "npm install"
    npm install --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log"
  fi
}

enable_mcp() {
  if ! command -v agent >/dev/null 2>&1; then
    log "Skip agent mcp enable (Cursor CLI not available)"
    return 0
  fi
  node "${ROOT}/scripts/ensure-mcp.js"
  if agent mcp enable dlh-browser 2>/dev/null; then
    log "Enabled dlh-browser MCP in Cursor CLI"
  else
    log "Run once after login: agent mcp enable dlh-browser"
  fi
}

main() {
  log "DaddysLittleHelper install"
  log "Project: ${ROOT}"
  log "DLH_HOME: ${DLH_HOME}"

  write_state
  require_node
  install_cursor_cli
  install_npm_deps

  export DLH_HOME DLH_ROOT="${ROOT}"
  node "${ROOT}/scripts/install-extension.js"
  enable_mcp
  node "${ROOT}/scripts/setup-service.js"

  chmod +x "${ROOT}/install.sh" "${ROOT}/scripts/install-dlh.sh" "${ROOT}/mcp/dlh-browser.js" 2>/dev/null || true

  log ""
  log "Install finished."
  log ""
  log "Next (one-time if needed):"
  log "  1. agent login"
  log "  2. agent mcp enable dlh-browser   (if not already enabled)"
  log "  3. Restart Vivaldi (extension loads automatically)"
  log "  4. npm run doctor"
  log ""
  log "Bridge: systemd user service daddyslittlehelper (127.0.0.1:3847)"
  log "Fallback launcher: vivaldi-dlh  (always loads extension via --load-extension)"
  log ""

  if command -v agent >/dev/null 2>&1; then
    node "${ROOT}/scripts/doctor.js" || true
  else
    log "Doctor skipped — install Cursor CLI first."
  fi
}

main "$@"
