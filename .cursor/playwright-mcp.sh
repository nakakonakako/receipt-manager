#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$workspace_root"
if [[ "${1:-}" != --mode-locked || $# -ne 1 ]]; then
  [[ $# -eq 0 ]] || { echo 'Unexpected Playwright MCP arguments.' >&2; exit 1; }
  exec python3 "$workspace_root/scripts/playwright-mcp-mode.py" run "$workspace_root/.cursor/playwright-mcp.sh"
fi
mode="${RECEIPT_MANAGER_PLAYWRIGHT_MODE:?mode must be selected by the launcher}"
case "$mode" in
  headless) export PLAYWRIGHT_MCP_HEADLESS=true ;;
  gui) export PLAYWRIGHT_MCP_HEADLESS=false ;;
  *) echo 'Invalid authenticated Playwright MCP mode.' >&2; exit 1 ;;
esac
# Codex may start MCP servers without the WSLg display environment. Use the
# standard WSLg X11 socket only when no display was supplied by the caller.
if [[ "$mode" == gui && "$(uname -s)" == Linux ]]; then
  if [[ -z "${DISPLAY:-}" ]]; then
    if [[ "$(uname -r)" == *[Mm]icrosoft* && -S /mnt/wslg/.X11-unix/X0 && -S /tmp/.X11-unix/X0 ]]; then
      export DISPLAY=:0
    else
      echo "GUI Playwright MCP requires a graphical DISPLAY; see docs/worktree-development.md." >&2
      exit 1
    fi
  fi
  if ! command -v xdpyinfo >/dev/null || ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "GUI Playwright MCP cannot connect to DISPLAY (xdpyinfo required); see docs/worktree-development.md." >&2
    exit 1
  fi
fi
source "$workspace_root/.cursor/playwright-output-dir.sh"
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
  --output-dir "$output_dir" \
  --user-data-dir "$profile_dir"
