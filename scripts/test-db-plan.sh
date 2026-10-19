#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-db-plan-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture_home="$test_root/home"
fixture_repo="$fixture_home/web/receipt-manager"
fixture_config="$fixture_home/.config/receipt-manager/development"
fixture_bin="$test_root/bin"
command_log="$test_root/supabase-commands.log"
mkdir -p "$fixture_repo/scripts" "$fixture_repo/supabase/migrations" "$fixture_config" "$fixture_bin"
cp "$source_root/scripts/db-plan.sh" "$fixture_repo/scripts/db-plan.sh"
cp "$source_root/package.json" "$fixture_repo/package.json"
printf '20260101000000_test.sql\n' >"$fixture_repo/supabase/migrations/20260101000000_test.sql"

git -C "$fixture_repo" init -b main >/dev/null
git -C "$fixture_repo" config user.name 'DB Plan Test'
git -C "$fixture_repo" config user.email 'db-plan-test@example.invalid'
git -C "$fixture_repo" add .
git -C "$fixture_repo" commit -m 'fixture' >/dev/null

wrong_repo="$test_root/wrong-repo"
mkdir -p "$wrong_repo/scripts" "$wrong_repo/supabase/migrations"
cp "$source_root/scripts/db-plan.sh" "$wrong_repo/scripts/db-plan.sh"
printf '{"name":"price-memo","private":true}\n' >"$wrong_repo/package.json"
printf '20260101000000_test.sql\n' >"$wrong_repo/supabase/migrations/20260101000000_test.sql"
git -C "$wrong_repo" init -b main >/dev/null
git -C "$wrong_repo" config user.name 'DB Plan Test'
git -C "$wrong_repo" config user.email 'db-plan-test@example.invalid'
git -C "$wrong_repo" add .
git -C "$wrong_repo" commit -m 'fixture' >/dev/null

cat >"$fixture_bin/npx" <<'EOF'
#!/usr/bin/env bash
log="${DB_PLAN_TEST_LOG:?}"
printf 'npx' >>"$log"
printf ' %s' "$@" >>"$log"
printf '\n' >>"$log"
if [[ "${1:-}" == --yes && "${2:-}" == supabase ]]; then
  shift 2
else
  shift
fi
case "$*" in
  "link --project-ref abcdefghijklmnopqrst")
    mkdir -p "$DB_PLAN_FIXTURE_REPO/supabase/.temp"
    printf 'abcdefghijklmnopqrst\n' >"$DB_PLAN_FIXTURE_REPO/supabase/.temp/project-ref"
    ;;
  'migration list --linked')
    printf 'LOCAL          │ REMOTE         │ TIME (UTC)\n'
    printf '───────────────┼────────────────┼───────────────────\n'
    printf '20260101000000 │                │ 2026-01-01 00:00:00\n'
    ;;
  'db push --linked --dry-run')
    printf 'DRY RUN: migrations would be applied\n'
    ;;
  *)
    printf 'unexpected supabase command: %s\n' "$*" >&2
    exit 9
    ;;
esac
EOF
chmod +x "$fixture_bin/npx"

export HOME="$fixture_home"
export PATH="$fixture_bin:$PATH"
export DB_PLAN_TEST_LOG="$command_log"
export DB_PLAN_FIXTURE_REPO="$fixture_repo"
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'

if HOME="$fixture_home" bash "$wrong_repo/scripts/db-plan.sh" >"$test_root/wrong-repo.log" 2>&1; then
  echo 'Expected wrong repository to be rejected.' >&2
  exit 1
fi
[[ "$(cat "$test_root/wrong-repo.log")" == *'Refusing to run db:plan'* ]]

if bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/missing-registration.log" 2>&1; then
  echo 'Expected missing registration to be rejected.' >&2
  exit 1
fi
[[ "$(cat "$test_root/missing-registration.log")" == *'register-supabase-project-ref'* ]]

printf 'abcdefghijklmnopqrst\n' >"$fixture_config/supabase-development-project-ref"
chmod 600 "$fixture_config/supabase-development-project-ref"

if PROD_SUPABASE_PROJECT_ID='abcdefghijklmnopqrst' bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/production-ref.log" 2>&1; then
  echo 'Expected registered production ref to be rejected before link setup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/production-ref.log")" == *'matches PROD_SUPABASE_PROJECT_ID'* ]]
[[ ! -e "$fixture_repo/supabase/.temp/project-ref" ]]
[[ ! -s "$command_log" ]]

mkdir -p "$fixture_repo/supabase/.temp"
printf 'partial metadata\n' >"$fixture_repo/supabase/.temp/legacy-config"
if bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/partial-link.log" 2>&1; then
  echo 'Expected partial Supabase link metadata to stop automatic setup.' >&2
  exit 1
fi
[[ "$(cat "$test_root/partial-link.log")" == *'metadata exists without project-ref'* ]]
[[ ! -s "$command_log" ]]
rm -rf "$fixture_repo/supabase/.temp"

if ! missing_link_output="$(bash "$fixture_repo/scripts/db-plan.sh" 2>"$test_root/missing-link.err")"; then
  cat "$test_root/missing-link.err" >&2
  echo 'Expected safe development linking and dry-run planning for an unlinked worktree.' >&2
  exit 1
fi
[[ "$missing_link_output" == *'Pending local migrations: 1'* ]]
[[ "$(cat "$command_log")" == *'link --project-ref abcdefghijklmnopqrst'* ]]
[[ "$(cat "$command_log")" == *'migration list --linked'* ]]
[[ "$(cat "$command_log")" == *'db push --linked --dry-run'* ]]
[[ "$missing_link_output$(cat "$test_root/missing-link.err")" != *'do-not-print-test-secret'* ]]

mkdir -p "$fixture_repo/supabase/.temp"
printf 'zyxwvutsrqponmlkjihg\n' >"$fixture_repo/supabase/.temp/project-ref"
: >"$command_log"
if bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/wrong-link.log" 2>&1; then
  echo 'Expected mismatched linked project ref to be rejected.' >&2
  exit 1
fi
[[ "$(cat "$test_root/wrong-link.log")" == *'does not match'* ]]
[[ ! -s "$command_log" ]]

printf 'abcdefghijklmnopqrst\n' >"$fixture_repo/supabase/.temp/project-ref"
if SUPABASE_PROJECT_ID='some-other-target' bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/override.log" 2>&1; then
  echo 'Expected project override to be rejected.' >&2
  exit 1
fi
[[ "$(cat "$test_root/override.log")" == *'overrides are present'* ]]

if ! success_output="$(bash "$fixture_repo/scripts/db-plan.sh" 2>"$test_root/db-plan-success.err")"; then
  cat "$test_root/db-plan-success.err" >&2
  exit 1
fi
[[ "$success_output" == *'Pending local migrations: 1'* ]]
[[ "$success_output" == *'DRY RUN'* ]]
[[ "$(cat "$command_log")" == *'migration list --linked'* ]]
[[ "$(cat "$command_log")" == *'db push --linked --dry-run'* ]]
if grep -E 'db push --linked( |$)' "$command_log" | grep -qv 'dry-run'; then
  echo 'Non-dry-run db push must not run.' >&2
  exit 1
fi
[[ "$success_output" != *'do-not-print-test-secret'* ]]

cat >"$fixture_bin/npx" <<'EOF'
#!/usr/bin/env bash
log="${DB_PLAN_TEST_LOG:?}"
printf 'npx %s\n' "$*" >>"$log"
if [[ "${1:-}" == --yes ]]; then shift 2; else shift; fi
case "$*" in
  'migration list --linked')
    printf 'LOCAL          │ REMOTE         │ TIME (UTC)\n'
    printf '───────────────┼────────────────┼───────────────────\n'
    printf '20260101000000 │ 20260101000000 │ 2026-01-01 00:00:00\n'
    ;;
  'db push --linked --dry-run') printf 'DRY RUN\n' ;;
esac
EOF
chmod +x "$fixture_bin/npx"
: >"$command_log"
if bash "$fixture_repo/scripts/db-plan.sh" >"$test_root/no-pending.log" 2>&1; then
  echo 'Expected no pending migrations to fail.' >&2
  exit 1
fi
[[ "$(cat "$test_root/no-pending.log")" == *'No pending migrations'* ]]

echo 'db:plan tests passed.'
