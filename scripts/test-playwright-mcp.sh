#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-playwright-mcp-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/home" "$test_root/bin" "$test_root/cache"
log_file="$test_root/npx.log"

python3 - "$source_root/.cursor/mcp.json" "$source_root/.cursor/cli.json" "$source_root/.cursor/playwright-mcp.json" <<'PYCONFIG'
import json
import sys
from pathlib import Path

mcp = json.loads(Path(sys.argv[1]).read_text())
cli = json.loads(Path(sys.argv[2]).read_text())
playwright = json.loads(Path(sys.argv[3]).read_text())
server = mcp["mcpServers"]["playwright"]
assert server["command"] == "bash"
assert server["args"] == [".cursor/playwright-mcp.sh"]
allow = cli["permissions"]["allow"]
deny = cli["permissions"]["deny"]
assert "Mcp(playwright:*)" in allow
assert "Mcp(*:*)" not in allow
assert "Shell(sudo)" in deny and "Shell(rm)" in deny
assert playwright["browser"]["browserName"] == "chromium"
assert playwright["snapshot"]["mode"] == "none"
PYCONFIG

cat > "$test_root/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PLAYWRIGHT_MCP_TEST_LOG"
if [[ "$*" == *"playwright install chromium"* ]]; then
  [[ "${PLAYWRIGHT_MCP_TEST_INSTALL_FAIL:-0}" != 1 ]] || exit 17
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64"
  touch "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell"
  chmod +x "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell"
elif [[ "$*" != *"@playwright/mcp@0.0.83"* ]]; then
  echo "Unexpected npx invocation: $*" >&2
  exit 18
fi
EOF
chmod +x "$test_root/bin/npx"
export HOME="$test_root/home"
export PATH="$test_root/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$test_root/cache"
export PLAYWRIGHT_MCP_TEST_LOG="$log_file"

# First launch installs only the matching revision, then invokes the pinned MCP.
bash "$source_root/.cursor/playwright-mcp.sh"
grep -Fq -- '--package=playwright@1.64.0-alpha-1790635538000 playwright install chromium' "$log_file"
grep -Fq -- '@playwright/mcp@0.0.83 --config ' "$log_file"
grep -Fq -- '--headless' "$log_file"
[[ "$(wc -l < "$log_file")" -eq 2 ]]

# Subsequent launches reuse the installed binary and do not reinstall it.
: > "$log_file"
bash "$source_root/.cursor/playwright-mcp.sh"
[[ "$(wc -l < "$log_file")" -eq 1 ]]
grep -Fq -- '@playwright/mcp@0.0.83' "$log_file"

# An unsuccessful matching-browser install must prevent MCP startup.
rm -rf "$test_root/cache"
mkdir -p "$test_root/cache"
: > "$log_file"
if PLAYWRIGHT_MCP_TEST_INSTALL_FAIL=1 bash "$source_root/.cursor/playwright-mcp.sh" >/dev/null 2>&1; then
  echo "Expected MCP startup to stop when matching Chromium installation fails." >&2
  exit 1
fi
if grep -Fq -- '@playwright/mcp@0.0.83' "$log_file"; then
  echo "Expected MCP not to start after Chromium installation failure." >&2
  exit 1
fi

echo "Playwright MCP configuration tests passed."
