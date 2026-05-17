#!/usr/bin/env bash
# Back-compat wrapper — same as ./install.sh (install + update).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT}/install.sh" "$@"
