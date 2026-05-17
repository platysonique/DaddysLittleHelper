#!/usr/bin/env bash
# Back-compat wrapper — use ./install.sh at repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT}/install.sh" "$@"
