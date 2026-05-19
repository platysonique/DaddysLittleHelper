#!/usr/bin/env bash
# DaddysLittleHelper — ONE script: extension, MCP, bridge (systemd), verify.
# You never run systemctl, dlh-bridge, or setup-service by hand — only this file.
#
#   git clone … && cd DaddysLittleHelper && ./install.sh    # first install
#   cd DaddysLittleHelper && ./install.sh                     # update / repair in place
#   ./install.sh --pull                                     # install/update + git pull
#   ./install.sh --no-pull                                  # skip git pull on update
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DLH_HOME="${DLH_HOME:-${HOME}/.local/share/daddyslittlehelper}"
CONFIG_DIR="${HOME}/.config/daddyslittlehelper"
STATE_FILE="${CONFIG_DIR}/install.env"
LOG_DIR="${CONFIG_DIR}/logs"

MODE="install"
DLH_PULL=""   # empty = use mode default; 0 = off; 1 = on
DLH_NO_GIT=0
SKIP_DOCTOR=0
BRIDGE_ONLY=0

INSTALLED_AT=""
PREV_VERSION=""
OLD_ROOT=""

usage() {
  cat <<'EOF'
DaddysLittleHelper install.sh — install or update (same script)

Usage:
  ./install.sh              Install, or update if already installed
  ./install.sh --pull       Always git pull --ff-only before install/update
  ./install.sh --no-pull      Never git pull (use local tree only)
  ./install.sh --help         Show this help

Update flow (when ~/.config/daddyslittlehelper/install.env exists):
  1. Optional git pull (default on update when repo is clean)
  2. npm dependencies
  3. Sync extension + re-register with Vivaldi
  4. Refresh MCP config + restart bridge service

Environment:
  DLH_HOME    Install data dir (default: ~/.local/share/daddyslittlehelper)
EOF
}

log() {
  echo "[dlh] $*"
}

warn() {
  echo "[dlh] WARN: $*" >&2
}

die() {
  echo "[dlh] ERROR: $*" >&2
  exit 1
}

read_state_var() {
  local key="$1"
  if [ ! -f "${STATE_FILE}" ]; then
    return 1
  fi
  grep -E "^${key}=" "${STATE_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || return 1
}

package_version() {
  if [ -f "${ROOT}/package.json" ]; then
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('${ROOT}/package.json','utf8'));process.stdout.write(p.version||'0.0.0')" 2>/dev/null \
      || sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${ROOT}/package.json" | head -1
  else
    echo "unknown"
  fi
}

extension_version() {
  if [ -f "${ROOT}/extension/manifest.json" ]; then
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${ROOT}/extension/manifest.json" | head -1
  else
    echo "unknown"
  fi
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h)
        usage
        exit 0
        ;;
      --pull)
        DLH_PULL=1
        ;;
      --no-pull)
        DLH_PULL=0
        ;;
      --no-git)
        DLH_NO_GIT=1
        ;;
      --skip-doctor)
        SKIP_DOCTOR=1
        ;;
      --bridge-only)
        BRIDGE_ONLY=1
        ;;
      *)
        die "Unknown option: $1 (try --help)"
        ;;
    esac
    shift
  done
}

detect_mode() {
  if [ -f "${STATE_FILE}" ]; then
    MODE="update"
    INSTALLED_AT="$(read_state_var INSTALLED_AT || true)"
    PREV_VERSION="$(read_state_var DLH_VERSION || true)"
    OLD_ROOT="$(read_state_var DLH_ROOT || true)"
    # Default: pull on update unless --no-pull was passed
    if [ -z "${DLH_PULL}" ]; then
      DLH_PULL=1
    fi
    if [ -n "${OLD_ROOT}" ] && [ "${OLD_ROOT}" != "${ROOT}" ]; then
      warn "Install path changed: ${OLD_ROOT} → ${ROOT}"
    fi
  else
    MODE="install"
    INSTALLED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    if [ -z "${DLH_PULL}" ]; then
      DLH_PULL=0
    fi
  fi
}

write_state() {
  local version ext_version now
  version="$(package_version)"
  ext_version="$(extension_version)"
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  mkdir -p "${CONFIG_DIR}"
  cat >"${STATE_FILE}" <<EOF
# DaddysLittleHelper install state (managed by install.sh)
DLH_ROOT=${ROOT}
DLH_HOME=${DLH_HOME}
DLH_BRIDGE_URL=http://127.0.0.1:3847
DLH_VERSION=${version}
DLH_EXTENSION_VERSION=${ext_version}
INSTALLED_AT=${INSTALLED_AT}
UPDATED_AT=${now}
PREVIOUS_VERSION=${PREV_VERSION:-}
EOF
}

git_pull() {
  if [ "${DLH_NO_GIT}" = 1 ]; then
    log "Git pull skipped (--no-git)"
    return 0
  fi
  if [ "${DLH_PULL}" != 1 ]; then
    return 0
  fi
  if [ ! -d "${ROOT}/.git" ]; then
    log "Not a git repository — using files in ${ROOT} as-is"
    return 0
  fi
  if ! command -v git >/dev/null 2>&1; then
    warn "git not found — skip pull"
    return 0
  fi

  cd "${ROOT}"
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    warn "Local git changes present — skip pull (commit/stash first, or use --no-pull)"
    return 0
  fi

  local branch upstream
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  upstream="$(git rev-parse --abbrev-ref "@{u}" 2>/dev/null || true)"

  log "Git pull (${branch}${upstream:+ → ${upstream}})…"
  if git pull --ff-only 2>&1 | tee -a "${LOG_DIR}/git-pull.log"; then
    log "Git pull OK"
    PREV_VERSION="$(read_state_var DLH_VERSION || echo "${PREV_VERSION}")"
  else
    warn "git pull failed — continuing with current tree"
  fi
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "Node.js 20+ is required. Install Node LTS, then rerun ./install.sh"
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "${major}" -lt 20 ]; then
    die "Node.js 20+ is required; found $(node --version)"
  fi
}

resolve_agent_bin() {
  if [ -n "${DLH_AGENT_BIN:-}" ] && [ -x "${DLH_AGENT_BIN}" ]; then
    printf '%s\n' "${DLH_AGENT_BIN}"
    return 0
  fi
  if command -v agent >/dev/null 2>&1; then
    command -v agent
    return 0
  fi
  if [ -x "${HOME}/.local/bin/agent" ]; then
    printf '%s\n' "${HOME}/.local/bin/agent"
    return 0
  fi
  return 1
}

install_cursor_cli() {
  local agent_bin
  if agent_bin="$(resolve_agent_bin)"; then
    export DLH_AGENT_BIN="${agent_bin}"
    log "Cursor CLI: ${agent_bin} ($("${agent_bin}" --version 2>/dev/null || echo present))"
    return 0
  fi
  if [ "${MODE}" = update ]; then
    die "Cursor CLI 'agent' not found. Run ./install.sh from a shell where agent works, or install Cursor CLI."
  fi
  log "Installing Cursor CLI…"
  curl -fsSL https://cursor.com/install | bash
  if agent_bin="$(resolve_agent_bin)"; then
    export DLH_AGENT_BIN="${agent_bin}"
    log "Cursor CLI: ${agent_bin} ($("${agent_bin}" --version 2>/dev/null || echo present))"
    return 0
  fi
  die "Cursor CLI install finished, but 'agent' is still not on PATH."
}

install_npm_deps() {
  cd "${ROOT}"
  mkdir -p "${LOG_DIR}"
  # --ignore-scripts: never run package.json "install"/lifecycle hooks (avoids recursion with setup).
  if [ -f package-lock.json ]; then
    log "npm ci --ignore-scripts"
    npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log" \
      || npm install --ignore-scripts --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log"
  else
    log "npm install --ignore-scripts"
    npm install --ignore-scripts --no-audit --no-fund 2>&1 | tee -a "${LOG_DIR}/npm-install.log"
  fi
}

enable_mcp() {
  local agent_bin
  agent_bin="$(resolve_agent_bin)" || die "Cursor CLI 'agent' not found; bridge cannot run chat."
  export DLH_AGENT_BIN="${agent_bin}"
  node "${ROOT}/scripts/ensure-mcp.js"
  if "${agent_bin}" mcp enable dlh-browser 2>/dev/null; then
    log "dlh-browser MCP enabled"
  else
    log "Run after login: ${agent_bin} mcp enable dlh-browser"
  fi
}

bridge_health_ok() {
  curl -sf --max-time 2 "http://127.0.0.1:3847/health" >/dev/null 2>&1
}

install_bridge_service() {
  local unit_dir="${HOME}/.config/systemd/user"
  local unit_path="${unit_dir}/daddyslittlehelper.service"
  local bridge_script="${ROOT}/scripts/run-bridge.sh"
  local agent_bin

  if ! command -v systemctl >/dev/null 2>&1; then
    die "systemd is required (user session). Cannot install bridge."
  fi

  chmod +x "${bridge_script}"
  bash -n "${bridge_script}" || die "Bridge launcher script is invalid: ${bridge_script}"
  agent_bin="$(resolve_agent_bin)" || die "Cursor CLI 'agent' not found; cannot install bridge."
  export DLH_AGENT_BIN="${agent_bin}"

  mkdir -p "${unit_dir}" "${LOG_DIR}"
  cat >"${unit_path}" <<UNIT
[Unit]
Description=DaddysLittleHelper local bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${bridge_script}
Restart=on-failure
RestartSec=2
StandardOutput=journal
StandardError=journal
Environment=PATH=${HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=DLH_HOST=127.0.0.1
Environment=DLH_PORT=3847
Environment=DLH_ROOT=${ROOT}
Environment=DLH_AGENT_BIN=${agent_bin}

[Install]
WantedBy=default.target
UNIT

  log "Bridge unit → ${unit_path}"
  log "Bridge Cursor CLI → ${agent_bin}"

  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(whoami)" 2>&1 | tee -a "${LOG_DIR}/linger.log" || true
  fi

  systemctl --user daemon-reload
  systemctl --user reset-failed daddyslittlehelper 2>/dev/null || true
  systemctl --user enable daddyslittlehelper
  systemctl --user restart daddyslittlehelper 2>&1 | tee -a "${LOG_DIR}/bridge-start.log"
}

free_bridge_port() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 3847/tcp 2>/dev/null || true
  fi
}

preflight_bridge_syntax() {
  log "Checking bridge/server.js syntax…"
  if ! node --check "${ROOT}/bridge/server.js" 2>"${LOG_DIR}/bridge-syntax.log"; then
    cat "${LOG_DIR}/bridge-syntax.log" >&2 || true
    die "bridge/server.js failed syntax check (see ${LOG_DIR}/bridge-syntax.log)"
  fi
}

ensure_bridge_running() {
  local attempt wait_i

  log "Installing/restarting bridge (systemd user service)…"
  install_bridge_service

  for attempt in 1 2 3; do
    for wait_i in $(seq 1 12); do
      if bridge_health_ok; then
        log "Bridge OK — http://127.0.0.1:3847"
        return 0
      fi
      sleep 1
    done
    warn "Bridge not responding (attempt ${attempt}/3) — retrying…"
    free_bridge_port
    systemctl --user reset-failed daddyslittlehelper 2>/dev/null || true
    systemctl --user restart daddyslittlehelper 2>&1 | tee -a "${LOG_DIR}/bridge-restart.log" || true
  done

  {
    echo "=== systemctl status ==="
    systemctl --user status daddyslittlehelper --no-pager -l || true
    echo "=== journal ==="
    journalctl --user -u daddyslittlehelper -n 40 --no-pager || true
  } >>"${LOG_DIR}/bridge-journal.log" 2>&1

  die "Bridge failed to start. Logs: ${LOG_DIR}/bridge-journal.log — re-run ./install.sh from ${ROOT}"
}

run_core_setup() {
  export DLH_HOME DLH_ROOT="${ROOT}"
  preflight_bridge_syntax
  log "Sync extension → ${DLH_HOME}/extension"
  node "${ROOT}/scripts/install-extension.js"
  enable_mcp
  ensure_bridge_running
  chmod +x "${ROOT}/install.sh" "${ROOT}/scripts/install-dlh.sh" "${ROOT}/scripts/run-bridge.sh" "${ROOT}/mcp/dlh-browser.js" 2>/dev/null || true
}

print_summary() {
  local version ext_version
  version="$(package_version)"
  ext_version="$(extension_version)"

  echo ""
  if [ "${MODE}" = update ]; then
    log "Update complete."
    if [ -n "${PREV_VERSION}" ] && [ "${PREV_VERSION}" != "${version}" ]; then
      log "  Package: ${PREV_VERSION} → ${version}"
    else
      log "  Package: ${version}"
    fi
    log "  Extension: ${ext_version}"
    log ""
    log "Recommended:"
    log "  • Restart Vivaldi (picks up extension + CRX changes)"
    log "  • Bridge was restarted automatically"
    log "  • npm run doctor"
  else
    log "Install complete."
    log "  Package: ${version} · Extension: ${ext_version}"
    log ""
    log "Next (one-time):"
    log "  1. agent login"
    log "  2. agent mcp enable dlh-browser   (if not already)"
    log "  3. Restart Vivaldi"
    log "  4. Side panel → turn Browser automation ON (security default: off)"
    log "  5. npm run doctor"
  fi
  log ""
  log "Bridge: http://127.0.0.1:3847 (running — started by this install)"
  log "If the side panel says offline: re-run ./install.sh then Restart Vivaldi."
  log "Re-run ./install.sh anytime to install, update, or repair."
  echo ""
  echo "================================================================"
  echo "  FINISHED — you can close this terminal window."
  echo "  The bridge keeps running in the background (systemd user"
  echo "  service: daddyslittlehelper). You do NOT need this terminal"
  echo "  open for DaddysLittleHelper to work."
  echo "================================================================"
  echo ""
}

main() {
  mkdir -p "${CONFIG_DIR}" "${LOG_DIR}" "${HOME}/.local/bin" "${HOME}/.cursor"
  chmod +x "${ROOT}/install.sh" "${ROOT}/scripts/install-dlh.sh" "${ROOT}/mcp/dlh-browser.js" 2>/dev/null || true

  parse_args "$@"
  if [ "${BRIDGE_ONLY}" = 1 ]; then
    export DLH_ROOT="${ROOT}"
    require_node
    ensure_bridge_running
    log "Bridge-only repair complete."
    exit 0
  fi

  detect_mode

  local version
  version="$(package_version)"

  if [ "${MODE}" = update ]; then
    log "Update mode (already installed)"
  else
    log "Install mode (first run)"
  fi
  log "Project: ${ROOT}"
  log "Version: ${version}${PREV_VERSION:+ (was ${PREV_VERSION})}"
  log "DLH_HOME: ${DLH_HOME}"

  git_pull
  write_state
  require_node
  install_cursor_cli
  install_npm_deps
  run_core_setup

  if [ "${SKIP_DOCTOR}" != 1 ] && command -v agent >/dev/null 2>&1; then
    log "Running doctor (optional health check)…"
    node "${ROOT}/scripts/doctor.js" || true
  fi

  print_summary
}

main "$@"
