#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Not inside a Git repository." >&2
  exit 2
}
exec python3 "$repo_root/scripts/cursor-devserver.py" "${1:-}"
