#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-db-plan-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
repo="$test_root/home/web/receipt-manager"
config="$test_root/home/.config/receipt-manager/development"
bin="$test_root/bin"
log="$test_root/commands"
cwd_log="$test_root/cli-cwd"
foreign_cwd="$test_root/other-worktree"
allowed_ref='irgahixsuvtopiwmtkku'
wrong_ref='zyxwvutsrqponmlkjihg'
mkdir -p "$repo/scripts" "$repo/frontend" "$repo/supabase/migrations" "$config/frontend" "$bin" "$foreign_cwd"
chmod 700 "$config"
for script in db-plan.sh db-push.sh lib-supabase-target.sh supabase-target.py test-db-push-pty.py; do
  cp "$source_root/scripts/$script" "$repo/scripts/$script"
done
cp "$source_root/package.json" "$repo/package.json"
touch "$repo/supabase/migrations/20260101000000_test.sql"
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$allowed_ref" >"$config/frontend/.env"
chmod 600 "$config/frontend/.env"
ln -s "$config/frontend/.env" "$repo/frontend/.env"
git -C "$repo" init -b main >/dev/null
git -C "$repo" config user.name 'DB Plan Test'
git -C "$repo" config user.email 'db-plan-test@example.invalid'
git -C "$repo" add .
git -C "$repo" commit -m fixture >/dev/null

cat >"$bin/npx" <<EOF
#!/usr/bin/env bash
[[ "\$(pwd -P)" == "\${DB_PLAN_EXPECTED_CWD:?}" ]] || {
  printf 'Supabase CLI ran from an unexpected directory.\n' >&2
  exit 11
}
printf '%s\n' "\$(pwd -P)" >>"\${DB_PLAN_TEST_CWD_LOG:?}"
printf '%s\n' "\$*" >>"\${DB_PLAN_TEST_LOG:?}"
if [[ "\${1:-}" == --yes ]]; then shift; fi
if [[ "\${1:-}" == supabase ]]; then shift; fi
case "\$*" in
  'link --project-ref ${allowed_ref}') printf '${allowed_ref}\n' >"\$PWD/supabase/.temp/project-ref" ;;
  'migration list --linked') printf 'LOCAL │ REMOTE\n20260101000000 │\n' ;;
  'db push --linked --dry-run') printf 'DRY RUN: mock plan\n' ;;
  'db push --linked') printf 'MOCK PUSH\n' ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$bin/npx"
export HOME="$test_root/home" PATH="$bin:$PATH" DB_PLAN_TEST_LOG="$log" DB_PLAN_EXPECTED_CWD="$repo" DB_PLAN_TEST_CWD_LOG="$cwd_log"
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'

rm -f "$repo/frontend/.env"
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$allowed_ref" >"$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/tampered-env.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/tampered-env.log")" == *'must be a symlink'* ]]
rm -f "$repo/frontend/.env"
ln -s "$config/frontend/.env" "$repo/frontend/.env"

mkdir -p "$test_root/other-shared"
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$allowed_ref" >"$test_root/other-shared/.env"
ln -sf "$test_root/other-shared/.env" "$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/symlink-mismatch.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/symlink-mismatch.log")" == *'must symlink to the shared development frontend/.env'* ]]
ln -sf "$config/frontend/.env" "$repo/frontend/.env"

real_frontend="$test_root/real-frontend"
mv "$config/frontend" "$real_frontend"
ln -s "$real_frontend" "$config/frontend"
if bash "$repo/scripts/db-plan.sh" >"$test_root/shared-frontend-symlink.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/shared-frontend-symlink.log")" == *'frontend directory must not be a symlink'* ]]
rm "$config/frontend"
mv "$real_frontend" "$config/frontend"
ln -sf "$config/frontend/.env" "$repo/frontend/.env"

mkdir -p "$repo/supabase/.temp"
printf '%s\n' "$allowed_ref" >"$repo/supabase/.temp/project-ref"
rm "$repo/supabase/.temp/project-ref"
: >"$log"
if bash "$repo/scripts/db-plan.sh" >"$test_root/unlinked.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/unlinked.log")" == *'interactive terminal'* ]]
[[ ! -s "$log" ]]
python3 "$repo/scripts/test-db-push-pty.py" "$repo" link 0 db-plan.sh "$foreign_cwd"
[[ "$(cat "$log")" == $'--yes supabase link --project-ref irgahixsuvtopiwmtkku\n--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
[[ "$(cat "$cwd_log")" == "$repo"$'\n'"$repo"$'\n'"$repo" ]]
printf '%s\n' "$allowed_ref" >"$repo/supabase/.temp/project-ref"
: >"$log"
printf '%s\n' "$allowed_ref" >"$repo/supabase/.temp/project-ref"
if VITE_SUPABASE_URL="https://${wrong_ref}.supabase.co" bash "$repo/scripts/db-plan.sh" >"$test_root/env.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/env.log")" == *'process override'* ]]
if SUPABASE_PROJECT_ID="$wrong_ref" bash "$repo/scripts/db-plan.sh" >"$test_root/project.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/project.log")" == *'SUPABASE_PROJECT_ID override'* ]]
for override in SUPABASE_DB_URL SUPABASE_WORKDIR; do
  if env "$override=ambiguous-target" bash "$repo/scripts/db-plan.sh" >"$test_root/$override.log" 2>&1; then exit 1; fi
  [[ "$(cat "$test_root/$override.log")" == *"$override override"* ]]
done

printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$wrong_ref" >"$config/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/url.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/url.log")" == *'does not match the allowed development project ref'* ]]
printf 'VITE_SUPABASE_URL=https://custom.example.test\n' >"$config/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/custom-url.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/custom-url.log")" == *'must use https://<project-ref>.supabase.co'* ]]
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$allowed_ref" >"$config/frontend/.env"
printf '%s\n' "$wrong_ref" >"$repo/supabase/.temp/project-ref"
if bash "$repo/scripts/db-plan.sh" >"$test_root/link.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/link.log")" == *'does not match the allowed development target'* ]]
printf '%s\n' "$allowed_ref" >"$repo/supabase/.temp/project-ref"
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$wrong_ref" >"$repo/frontend/.env.local"
if bash "$repo/scripts/db-plan.sh" >"$test_root/override.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/override.log")" == *'override exists'* ]]
rm "$repo/frontend/.env.local"

printf 'development=%s\nproduction=%s\n' "$allowed_ref" "$wrong_ref" >"$config/supabase-project-refs"
chmod 600 "$config/supabase-project-refs"
: >"$log"
: >"$cwd_log"
(cd "$foreign_cwd" && bash "$repo/scripts/db-plan.sh") >"$test_root/plan.log"
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
[[ "$(cat "$cwd_log")" == "$repo"$'\n'"$repo" ]]
[[ "$(cat "$test_root/plan.log")" == *'Dry-run only'* ]]
[[ "$(cat "$test_root/plan.log")" != *'do-not-print-test-secret'* ]]

: >"$log"
if bash "$repo/scripts/db-push.sh" >"$test_root/nontty.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/nontty.log")" == *'no DB request or push was run'* ]]
[[ ! -s "$log" ]]

: >"$log"
: >"$cwd_log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" "$allowed_ref" 0 db-push.sh "$foreign_cwd"
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run\n--yes supabase db push --linked' ]]
[[ "$(cat "$cwd_log")" == "$repo"$'\n'"$repo"$'\n'"$repo" ]]
: >"$log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" wrong-confirmation 2
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
grep -Fq 'run: supabase db push --yes --linked' "$source_root/.github/workflows/deploy.yml"
if grep -Fq 'npm run db:push' "$source_root/.github/workflows/deploy.yml"; then
  echo 'Production deployment must keep its existing direct Supabase CLI migration path.' >&2
  exit 1
fi
echo 'db target and push guard tests passed.'
