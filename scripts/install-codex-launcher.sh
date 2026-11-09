#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
destination="${CODEX_LAUNCHER_DIR:-$HOME/.local/bin}"
mkdir -p "$destination"
install -m 0755 "$script_dir/receipt-manager-codex" "$destination/receipt-manager-codex"
printf 'Installed %s\n' "$destination/receipt-manager-codex"
printf 'Launcher source SHA: %s\n' "$(git -C "$script_dir/.." rev-parse HEAD 2>/dev/null || printf 'unknown (source is not in Git)')"
printf 'Ensure %s is on PATH, then start sessions with: receipt-manager-codex\n' "$destination"
