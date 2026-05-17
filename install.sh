#!/usr/bin/env bash
# DaddysLittleHelper — all-in-one install & updater (idempotent, safe to rerun).
#
#   git clone … && cd DaddysLittleHelper && ./install.sh    # first install
#   cd DaddysLittleHelper && ./install.sh                     # update in place
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

install_cursor_cli() {
  if command -v agent >/dev/null 2>&1; then
    log "Cursor CLI: $(agent --version 2>/dev/null | head -1 || echo present)"
    return 0
  fi
  if [ "${MODE}" = update ]; then
    warn "Cursor CLI not found — install manually: curl -fsSL https://cursor.com/install | bash"
    return 0
  fi
  log "Installing Cursor CLI…"
  curl -fsSL https://cursor.com/install | bash
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
  if ! command -v agent >/dev/null 2>&1; then
    log "Skip agent mcp enable (Cursor CLI not available)"
    return 0
  fi
  node "${ROOT}/scripts/ensure-mcp.js"
  if agent mcp enable dlh-browser 2>/dev/null; then
    log "dlh-browser MCP enabled"
  else
    log "Run after login: agent mcp enable dlh-browser"
  fi
}

run_core_setup() {
  export DLH_HOME DLH_ROOT="${ROOT}"
  log "Sync extension → ${DLH_HOME}/extension"
  node "${ROOT}/scripts/install-extension.js"
  enable_mcp
  log "Bridge service (systemd user)…"
  node "${ROOT}/scripts/setup-service.js"
  chmod +x "${ROOT}/install.sh" "${ROOT}/scripts/install-dlh.sh" "${ROOT}/mcp/dlh-browser.js" 2>/dev/null || true
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
  log "Bridge: http://127.0.0.1:3847 (systemd: daddyslittlehelper)"
  log "Fallback: vivaldi-dlh"
  log "Re-run ./install.sh anytime to update again."
  echo ""
}

main() {
  mkdir -p "${CONFIG_DIR}" "${LOG_DIR}" "${HOME}/.local/bin" "${HOME}/.cursor"
  chmod +x "${ROOT}/install.sh" "${ROOT}/scripts/install-dlh.sh" "${ROOT}/mcp/dlh-browser.js" 2>/dev/null || true

  parse_args "$@"
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
  print_summary

  if [ "${SKIP_DOCTOR}" = 1 ]; then
    return 0
  fi
  if command -v agent >/dev/null 2>&1; then
    node "${ROOT}/scripts/doctor.js" || true
  else
    log "Doctor skipped — install Cursor CLI first."
  fi
}

main "$@"
