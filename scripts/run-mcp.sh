#!/usr/bin/env bash
set -euo pipefail

ROOT="${DLH_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [ -n "${DLH_NODE_BIN:-}" ] && [ -x "${DLH_NODE_BIN}" ]; then
  NODE_BIN="${DLH_NODE_BIN}"
elif [ -x /usr/bin/node ]; then
  NODE_BIN=/usr/bin/node
elif [ -x "${HOME}/.nvm/versions/node/v23.11.1/bin/node" ]; then
  NODE_BIN="${HOME}/.nvm/versions/node/v23.11.1/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  echo "Node.js 20+ not found for dlh-browser MCP." >&2
  exit 127
fi

exec "${NODE_BIN}" "${ROOT}/mcp/dlh-browser.js"
