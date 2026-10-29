#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-db-plan-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
repo="$test_root/receipt-manager"
bin="$test_root/bin"
cli_log="$test_root/supabase-cli.log"
mkdir -p "$repo/scripts" "$repo/supabase/migrations" "$bin"
cp "$source_root/package.json" "$repo/package.json"
cp "$source_root/scripts/db-plan.sh" "$source_root/scripts/db-list.sh" "$source_root/scripts/db-push.sh" "$source_root/scripts/test-db-push-pty.py" "$repo/scripts/"
touch "$repo/supabase/migrations/20260101000000_local.sql"
cat >"$bin/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${DB_PLAN_TEST_CLI_LOG:?}"
exit 99
EOF
chmod +x "$bin/npx"
export PATH="$bin:$PATH" DB_PLAN_TEST_CLI_LOG="$cli_log"
workflow_url='https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml'

for command in db:plan db:list; do
  unset SUPABASE_DB_PASSWORD PGHOST PGUSER PGPASSWORD SUPABASE_DB_URL || true
  output="$(npm --prefix "$repo" run "$command" 2>&1)"
  [[ "$output" == *"$workflow_url"* ]]
  [[ "$output" == *'NOT checked'* || "$output" == *'NOT the Dev DB history'* ]]
  [[ "$output" != *'password'* && "$output" != *'Password'* ]]

  # Supplying legacy-looking credentials and target overrides must not activate a CLI path.
  output="$(SUPABASE_DB_PASSWORD='do-not-print-test-secret' PGHOST=example.invalid PGUSER=postgres PGPASSWORD='do-not-print-test-secret' npm --prefix "$repo" run "$command" 2>&1)"
  [[ "$output" == *"$workflow_url"* ]]
  [[ "$output" != *'do-not-print-test-secret'* ]]
done
[[ ! -s "$cli_log" ]]

list_output="$(npm --prefix "$repo" run db:list 2>&1)"
[[ "$list_output" == *'20260101000000_local.sql'* ]]
[[ "$list_output" == *'Local receipt-manager migration files only'* ]]
[[ "$list_output" != *'REMOTE'* && "$list_output" != *'IN_SYNC'* ]]

# The legacy writer command remains closed before prompting, environment prep, or CLI use.
if npm --prefix "$repo" run db:push >"$test_root/disabled-push.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/disabled-push.log")" == *'applied only by shared-supabase-db'* ]]
[[ "$(cat "$test_root/disabled-push.log")" == *'No database connection or migration was attempted'* ]]
python3 "$repo/scripts/test-db-push-pty.py" "$repo" apply 2 db-push.sh "$test_root"
[[ ! -s "$cli_log" ]]

node - "$source_root/package.json" <<'NODE'
const fs = require('node:fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!p.scripts.dev.startsWith('bash scripts/dev-env.sh prepare')) throw new Error('npm run dev changed');
if (!p.scripts.check.includes('check:frontend') || !p.scripts.check.includes('check:backend')) throw new Error('npm run check changed');
NODE

grep -Fq 'supabase db push --db-url "$SUPABASE_DB_URL" --yes' "$source_root/.github/workflows/deploy.yml"
if grep -Fq 'npm run db:push' "$source_root/.github/workflows/deploy.yml"; then
  echo 'Production deployment must keep its existing direct Supabase CLI migration path.' >&2
  exit 1
fi
echo 'db plan/list isolation and push guard tests passed.'
