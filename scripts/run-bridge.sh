#!/usr/bin/env bash
# Start DaddysLittleHelper bridge (used by systemd and manual/debug runs).
set -euo pipefail

ROOT="${DLH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "${ROOT}"

export PATH="${HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

if [ -s "${HOME}/.nvm/nvm.sh" ]; then
  export NVM_DIR="${HOME}/.nvm"
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh"
fi

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash 2>/dev/null)" || true
fi

NODE="${DLH_NODE:-}"
if [ -z "${NODE}" ]; then
  NODE="$(command -v node 2>/dev/null || true)"
fi
if [ -z "${NODE}" ] || [ ! -x "${NODE}" ]; then
  echo "[dlh-bridge] Node.js 20+ not found. Install Node LTS or set DLH_NODE to your node binary." >&2
  exit 127
fi

major="$("${NODE}" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "${major}" -lt 20 ]; then
  echo "[dlh-bridge] Node 20+ required; got $("${NODE}" --version 2>/dev/null || echo unknown)" >&2
  exit 1
fi

if [ -z "${DLH_AGENT_BIN:-}" ]; then
  DLH_AGENT_BIN="$(command -v agent 2>/dev/null || true)"
  export DLH_AGENT_BIN
fi

exec "${NODE}" "${ROOT}/bridge/server.js"
