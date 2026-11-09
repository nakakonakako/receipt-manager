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
unauth = mcp["mcpServers"]["playwright-unauth"]
assert server["command"] == "bash"
assert server["args"] == [".cursor/playwright-mcp.sh"]
assert unauth["args"] == [".cursor/playwright-unauth-mcp.sh"]
allow = cli["permissions"]["allow"]
deny = cli["permissions"]["deny"]
assert "Mcp(playwright:*)" in allow
assert "Mcp(playwright-unauth:*)" in allow
assert "Mcp(*:*)" not in allow
assert "Shell(pwd)" in allow
assert "Shell(*)" not in allow
assert "Shell(bash)" not in allow and "Shell(sh)" not in allow
assert "Shell(sudo)" in deny and "Shell(rm)" in deny
assert playwright["browser"]["browserName"] == "chromium"
assert playwright["snapshot"]["mode"] == "none"
PYCONFIG

cat > "$test_root/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${PLAYWRIGHT_MCP_STORAGE_STATE:-}" ]]; then
  echo "Unexpected storage-state environment variable." >&2
  exit 19
fi
printf '%s\n' "$*" >> "$PLAYWRIGHT_MCP_TEST_LOG"
if [[ "$*" == *"playwright install chromium"* ]]; then
  [[ "${PLAYWRIGHT_MCP_TEST_INSTALL_FAIL:-0}" != 1 ]] || exit 17
  mkdir -p "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64" "$PLAYWRIGHT_BROWSERS_PATH/chromium-1247/chrome-linux64"
  touch "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell" "$PLAYWRIGHT_BROWSERS_PATH/chromium-1247/chrome-linux64/chrome"
  chmod +x "$PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell" "$PLAYWRIGHT_BROWSERS_PATH/chromium-1247/chrome-linux64/chrome"
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

# The mock refuses any auth state passed to either launcher.


# First launch installs only the matching revision, then invokes the pinned MCP.
bash "$source_root/.cursor/playwright-mcp.sh"
grep -Fq -- '--package=playwright@1.64.0-alpha-1790635538000 playwright install chromium' "$log_file"
grep -Fq -- '@playwright/mcp@0.0.83 --config ' "$log_file"
grep -Fq -- "--user-data-dir $HOME/.local/state/receipt-manager/playwright-profile" "$log_file"
if grep -Fq -- '--headless' "$log_file"; then
  echo "Authenticated MCP must stay headed for manual login." >&2
  exit 1
fi
[[ "$(wc -l < "$log_file")" -eq 2 ]]

# Subsequent launches reuse the installed binary and do not reinstall it.
: > "$log_file"
bash "$source_root/.cursor/playwright-mcp.sh"
[[ "$(wc -l < "$log_file")" -eq 1 ]]
grep -Fq -- '@playwright/mcp@0.0.83' "$log_file"

# Unauthenticated MCP is isolated, headless, and never uses the persistent profile.
: > "$log_file"
export PLAYWRIGHT_MCP_STORAGE_STATE="$test_root/forbidden-state.json"
bash "$source_root/.cursor/playwright-unauth-mcp.sh"
unset PLAYWRIGHT_MCP_STORAGE_STATE
grep -Fq -- '--isolated --headless' "$log_file"
if grep -Fq -- 'playwright-profile' "$log_file"; then
  echo "Unauthenticated MCP must not use the persistent profile." >&2
  exit 1
fi

# An unsuccessful matching-browser install must prevent MCP startup.
rm -rf "$test_root/cache"
mkdir -p "$test_root/cache"
: > "$log_file"
if PLAYWRIGHT_MCP_TEST_INSTALL_FAIL=1 bash "$source_root/.cursor/playwright-unauth-mcp.sh" >/dev/null 2>&1; then
  echo "Expected MCP startup to stop when matching Chromium installation fails." >&2
  exit 1
fi
if grep -Fq -- '@playwright/mcp@0.0.83' "$log_file"; then
  echo "Expected MCP not to start after Chromium installation failure." >&2
  exit 1
fi

python3 - "$source_root" <<'PYTEST'
import pathlib, sys, tomllib
root = pathlib.Path(sys.argv[1])
config = tomllib.loads((root / ".codex/config.toml").read_text())
assert config["agents"]["enabled"] is True
assert config["agents"]["max_concurrent_threads_per_session"] == 1
for name in ("playwright", "playwright-unauth"):
    server = config["mcp_servers"][name]
    assert server["command"] == "bash"
    assert server["args"] == [f".cursor/{name}-mcp.sh"]
    assert "cwd" not in server
PYTEST

echo "Playwright MCP configuration tests passed."
