#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$workspace_root"
# Codex may start MCP servers without the WSLg display environment. Use the
# standard WSLg X11 socket only when no display was supplied by the caller.
if [[ -z "${DISPLAY:-}" && "$(uname -s)" == Linux ]]; then
  if [[ "$(uname -r)" == *[Mm]icrosoft* && -S /mnt/wslg/.X11-unix/X0 && -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
  else
    echo "Authenticated Playwright MCP requires a graphical DISPLAY; see docs/worktree-development.md." >&2
    exit 1
  fi
fi
# Do not silently fall back to a headless browser when a GUI is required.
export PLAYWRIGHT_MCP_HEADLESS=false
config_file="$workspace_root/.cursor/playwright-mcp.json"
profile_dir="${HOME:?HOME must be set}/.local/state/receipt-manager/playwright-profile"
browser_cache="${PLAYWRIGHT_BROWSERS_PATH:-${HOME:?HOME must be set}/.cache/ms-playwright}"

# Keep these aligned with the exact Playwright dependency and browsers.json
# published for the pinned MCP package.
mcp_version="0.0.83"
playwright_version="1.64.0-alpha-1790635538000"
chromium_revision="1247"

export PLAYWRIGHT_BROWSERS_PATH="$browser_cache"
headless_shell="$browser_cache/chromium_headless_shell-$chromium_revision/chrome-headless-shell-linux64/chrome-headless-shell"
chromium="$browser_cache/chromium-$chromium_revision/chrome-linux64/chrome"
if [[ ! -x "$headless_shell" || ! -x "$chromium" ]]; then
  npx --yes --package="playwright@$playwright_version" playwright install chromium >&2
fi
if [[ ! -x "$headless_shell" || ! -x "$chromium" ]]; then
  echo "Playwright Chromium revision $chromium_revision is unavailable at the configured browser cache." >&2
  exit 1
fi

mkdir -p "$(dirname "$profile_dir")"
if [[ -L "$profile_dir" ]]; then
  echo "Receipt Manager Playwright profile must not be a symlink." >&2
  exit 1
fi
mkdir -p "$profile_dir"
chmod 700 "$profile_dir"

exec npx --yes "@playwright/mcp@$mcp_version" \
  --config "$config_file" \
  --user-data-dir "$profile_dir"
