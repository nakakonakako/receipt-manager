#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-db-plan-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
repo="$test_root/home/web/receipt-manager"
config="$test_root/home/.config/receipt-manager/development"
bin="$test_root/bin"
log="$test_root/commands"
mkdir -p "$repo/scripts" "$repo/frontend" "$repo/supabase/migrations" "$config" "$bin"
chmod 700 "$config"
for script in db-plan.sh db-push.sh lib-supabase-target.sh supabase-target.py test-db-push-pty.py; do
  cp "$source_root/scripts/$script" "$repo/scripts/$script"
done
cp "$source_root/package.json" "$repo/package.json"
touch "$repo/supabase/migrations/20260101000000_test.sql"
printf 'VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n' >"$repo/frontend/.env"
git -C "$repo" init -b main >/dev/null
git -C "$repo" config user.name 'DB Plan Test'
git -C "$repo" config user.email 'db-plan-test@example.invalid'
git -C "$repo" add .
git -C "$repo" commit -m fixture >/dev/null

cat >"$bin/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${DB_PLAN_TEST_LOG:?}"
if [[ "${1:-}" == --yes ]]; then shift; fi
if [[ "${1:-}" == supabase ]]; then shift; fi
case "$*" in
  'link --project-ref abcdefghijklmnopqrst') printf 'abcdefghijklmnopqrst\n' >"${DB_PLAN_FIXTURE_REPO:?}/supabase/.temp/project-ref" ;;
  'migration list --linked') printf 'LOCAL │ REMOTE\n20260101000000 │\n' ;;
  'db push --linked --dry-run') printf 'DRY RUN: mock plan\n' ;;
  'db push --linked') printf 'MOCK PUSH\n' ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$bin/npx"
export HOME="$test_root/home" PATH="$bin:$PATH" DB_PLAN_TEST_LOG="$log" DB_PLAN_FIXTURE_REPO="$repo"
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'
if bash "$repo/scripts/db-plan.sh" >"$test_root/unregistered.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/unregistered.log")" == *'not registered'* ]]
printf 'development=abcdefghijklmnopqrst\nproduction=abcdefghijklmnopqrst\n' >"$config/supabase-project-refs"
chmod 600 "$config/supabase-project-refs"
if bash "$repo/scripts/db-plan.sh" >"$test_root/same.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/same.log")" == *'must be different'* ]]

printf 'development=abcdefghijklmnopqrst\nproduction=zyxwvutsrqponmlkjihg\n' >"$config/supabase-project-refs"
chmod 600 "$config/supabase-project-refs"
mkdir -p "$repo/supabase/.temp"
printf 'abcdefghijklmnopqrst\n' >"$repo/supabase/.temp/project-ref"
rm "$repo/supabase/.temp/project-ref"
: >"$log"
if bash "$repo/scripts/db-plan.sh" >"$test_root/unlinked.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/unlinked.log")" == *'interactive terminal'* ]]
[[ ! -s "$log" ]]
python3 "$repo/scripts/test-db-push-pty.py" "$repo" link 0 db-plan.sh
[[ "$(cat "$log")" == $'--yes supabase link --project-ref abcdefghijklmnopqrst\n--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
printf 'abcdefghijklmnopqrst\n' >"$repo/supabase/.temp/project-ref"
: >"$log"
printf 'abcdefghijklmnopqrst\n' >"$repo/supabase/.temp/project-ref"
if VITE_SUPABASE_URL='https://zyxwvutsrqponmlkjihg.supabase.co' bash "$repo/scripts/db-plan.sh" >"$test_root/env.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/env.log")" == *'process override'* ]]
if SUPABASE_PROJECT_ID='zyxwvutsrqponmlkjihg' bash "$repo/scripts/db-plan.sh" >"$test_root/project.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/project.log")" == *'SUPABASE_PROJECT_ID override'* ]]
for override in SUPABASE_DB_URL SUPABASE_WORKDIR; do
  if env "$override=ambiguous-target" bash "$repo/scripts/db-plan.sh" >"$test_root/$override.log" 2>&1; then exit 1; fi
  [[ "$(cat "$test_root/$override.log")" == *"$override override"* ]]
done
if PROD_SUPABASE_PROJECT_ID='abcdefghijklmnopqrst' bash "$repo/scripts/db-plan.sh" >"$test_root/prod-env-mismatch.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/prod-env-mismatch.log")" == *'does not match the registered production ref'* ]]

printf 'VITE_SUPABASE_URL=https://zyxwvutsrqponmlkjihg.supabase.co\n' >"$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/url.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/url.log")" == *'does not match'* ]]
printf 'VITE_SUPABASE_URL=https://custom.example.test\n' >"$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/custom-url.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/custom-url.log")" == *'must use https://<project-ref>.supabase.co'* ]]
printf 'VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n' >"$repo/frontend/.env"
printf 'zyxwvutsrqponmlkjihg\n' >"$repo/supabase/.temp/project-ref"
if bash "$repo/scripts/db-plan.sh" >"$test_root/link.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/link.log")" == *'does not match the registered development target'* ]]
printf 'abcdefghijklmnopqrst\n' >"$repo/supabase/.temp/project-ref"
printf 'VITE_SUPABASE_URL=https://zyxwvutsrqponmlkjihg.supabase.co\n' >"$repo/frontend/.env.local"
if bash "$repo/scripts/db-plan.sh" >"$test_root/override.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/override.log")" == *'override exists'* ]]
rm "$repo/frontend/.env.local"

: >"$log"
bash "$repo/scripts/db-plan.sh" >"$test_root/plan.log"
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
[[ "$(cat "$test_root/plan.log")" == *'Dry-run only'* ]]
[[ "$(cat "$test_root/plan.log")" != *'do-not-print-test-secret'* ]]

: >"$log"
if bash "$repo/scripts/db-push.sh" >"$test_root/nontty.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/nontty.log")" == *'no DB request or push was run'* ]]
[[ ! -s "$log" ]]

: >"$log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" abcdefghijklmnopqrst 0
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run\n--yes supabase db push --linked' ]]
: >"$log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" wrong-confirmation 2
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
grep -Fq 'run: supabase db push --yes --linked' "$source_root/.github/workflows/deploy.yml"
if grep -Fq 'npm run db:push' "$source_root/.github/workflows/deploy.yml"; then
  echo 'Production deployment must keep its existing direct Supabase CLI migration path.' >&2
  exit 1
fi
echo 'db target and push guard tests passed.'
