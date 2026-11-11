# Shared private location for artifacts produced by both Playwright MCP servers.
umask 077
output_dir="${HOME:?HOME must be set}/.local/state/receipt-manager/playwright-mcp-output"
if [[ -L "$output_dir" ]]; then
  echo "Playwright MCP output directory must not be a symlink." >&2
  exit 1
fi
mkdir -p "$output_dir"
chmod 700 "$output_dir"
