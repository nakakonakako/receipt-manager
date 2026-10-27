#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$workspace_root"
config_file="$workspace_root/.cursor/playwright-mcp.json"
browser_cache="${PLAYWRIGHT_BROWSERS_PATH:-${HOME:?HOME must be set}/.cache/ms-playwright}"

# Keep these aligned with the exact Playwright dependency and browsers.json
# published for the pinned MCP package.
mcp_version="0.0.83"
playwright_version="1.64.0-alpha-1790635538000"
chromium_revision="1247"

export PLAYWRIGHT_BROWSERS_PATH="$browser_cache"
headless_shell="$browser_cache/chromium_headless_shell-$chromium_revision/chrome-headless-shell-linux64/chrome-headless-shell"
if [[ ! -x "$headless_shell" ]]; then
  npx --yes --package="playwright@$playwright_version" playwright install chromium >&2
fi
if [[ ! -x "$headless_shell" ]]; then
  echo "Playwright Chromium headless shell revision $chromium_revision is unavailable at the configured browser cache." >&2
  exit 1
fi

exec npx --yes "@playwright/mcp@$mcp_version" \
  --config "$config_file" \
  --headless
