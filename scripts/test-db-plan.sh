#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-db-plan-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT
repo="$test_root/home/web/receipt-manager"
config="$test_root/home/.config/receipt-manager/development"
bin="$test_root/bin"
log="$test_root/commands"
env_log="$test_root/cli-env"
cwd_log="$test_root/cli-cwd"
foreign_cwd="$test_root/other-worktree"
allowed_ref='irgahixsuvtopiwmtkku'
wrong_ref='zyxwvutsrqponmlkjihg'
mkdir -p "$repo/scripts" "$repo/frontend" "$repo/supabase/migrations" "$config/frontend" "$bin" "$foreign_cwd"
chmod 700 "$config"
for script in db-plan.sh db-push.sh db-env-prepare.sh lib-supabase-target.sh supabase-target.py test-db-push-pty.py; do
  cp "$source_root/scripts/$script" "$repo/scripts/$script"
done
chmod +x "$repo/scripts/db-env-prepare.sh"
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
if [[ -n "\${DB_PLAN_TEST_ENV_LOG:-}" ]]; then
  if [[ -n "\${SUPABASE_DB_PASSWORD:-}" ]]; then
    printf 'SUPABASE_DB_PASSWORD=present\n' >>"\$DB_PLAN_TEST_ENV_LOG"
  else
    printf 'SUPABASE_DB_PASSWORD=missing\n' >>"\$DB_PLAN_TEST_ENV_LOG"
  fi
fi
case "\$*" in
  *do-not-print-test-secret*) printf 'password leaked into CLI args\n' >&2; exit 13 ;;
esac
if [[ "\${1:-}" == --yes ]]; then shift; fi
if [[ "\${1:-}" == supabase ]]; then shift; fi
case "\$*" in
  'link --project-ref ${allowed_ref}')
    [[ -n "\${SUPABASE_DB_PASSWORD:-}" ]] || {
      printf 'link did not receive the database password environment variable\n' >&2
      exit 13
    }
    printf '${allowed_ref}\n' >"\$PWD/supabase/.temp/project-ref"
    ;;
  'migration list --linked') printf 'LOCAL │ REMOTE\n20260101000000 │\n' ;;
  'db push --linked --dry-run')
    printf 'DRY RUN: mock plan\n'
    if [[ "\${DB_PLAN_TEST_MUTATE_LINK:-}" == 'wrong' ]]; then
      printf '${wrong_ref}\n' >"\$PWD/supabase/.temp/project-ref"
    fi
    ;;
  'db push --linked --yes') printf 'MOCK PUSH\n' ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$bin/npx"
export HOME="$test_root/home" PATH="$bin:$PATH" DB_PLAN_TEST_LOG="$log" DB_PLAN_EXPECTED_CWD="$repo" DB_PLAN_TEST_CWD_LOG="$cwd_log" DB_PLAN_TEST_ENV_LOG="$env_log"
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'

rm -f "$repo/frontend/.env"
printf 'VITE_SUPABASE_URL=https://%s.supabase.co\n' "$allowed_ref" >"$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/tampered-env.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/tampered-env.log")" == *'must be a symlink'* ]]
rm -f "$repo/frontend/.env"
ln -s "$config/frontend/.env" "$repo/frontend/.env"

ln -sf /tmp/receipt-manager-db-broken-env-target "$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/broken-symlink.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/broken-symlink.log")" == *'Broken frontend/.env symlink'* ]]
ln -sf "$config/frontend/.env" "$repo/frontend/.env"

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
: >"$env_log"
unset SUPABASE_DB_PASSWORD
if bash "$repo/scripts/db-plan.sh" >"$test_root/unlinked-no-password.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/unlinked-no-password.log")" == *'SUPABASE_DB_PASSWORD is not set'* ]]
[[ ! -s "$log" ]]
[[ ! -s "$env_log" ]]
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'
if bash "$repo/scripts/db-plan.sh" >"$test_root/unlinked.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/unlinked.log")" == *'interactive terminal'* ]]
[[ ! -s "$log" ]]
[[ ! -s "$env_log" ]]

: >"$env_log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" link 0 db-plan.sh "$foreign_cwd"
[[ "$(cat "$log")" == $'--yes supabase link --project-ref irgahixsuvtopiwmtkku\n--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
[[ "$(cat "$env_log")" == $'SUPABASE_DB_PASSWORD=present\nSUPABASE_DB_PASSWORD=present\nSUPABASE_DB_PASSWORD=present' ]]
[[ "$(cat "$cwd_log")" == "$repo"$'\n'"$repo"$'\n'"$repo" ]]
printf '%s\n' "$allowed_ref" >"$repo/supabase/.temp/project-ref"
rm -f "$repo/frontend/.env"
: >"$log"
: >"$cwd_log"
: >"$env_log"
bash "$repo/scripts/db-plan.sh" >"$test_root/missing-symlink.log"
[[ -L "$repo/frontend/.env" ]]
[[ "$(readlink -f "$repo/frontend/.env")" == "$(readlink -f "$config/frontend/.env")" ]]
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
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
rm -f "$repo/frontend/.env"
if bash "$repo/scripts/db-plan.sh" >"$test_root/url.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/url.log")" == *'does not match the allowed development project ref'* ]]
[[ ! -e "$repo/frontend/.env" && ! -L "$repo/frontend/.env" ]]
ln -s "$config/frontend/.env" "$repo/frontend/.env"
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
: >"$env_log"
(cd "$foreign_cwd" && bash "$repo/scripts/db-plan.sh") >"$test_root/plan.log"
[[ "$(cat "$log")" == $'--yes supabase migration list --linked\n--yes supabase db push --linked --dry-run' ]]
[[ "$(cat "$cwd_log")" == "$repo"$'\n'"$repo" ]]
[[ "$(cat "$test_root/plan.log")" == *'Dry-run only'* ]]
[[ "$(cat "$test_root/plan.log")" != *'do-not-print-test-secret'* ]]
[[ "$(cat "$log")" != *'do-not-print-test-secret'* ]]
[[ "$(cat "$env_log")" == $'SUPABASE_DB_PASSWORD=present\nSUPABASE_DB_PASSWORD=present' ]]

unset SUPABASE_DB_PASSWORD
: >"$log"
if bash "$repo/scripts/db-plan.sh" >"$test_root/nontty-password.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/nontty-password.log")" == *'SUPABASE_DB_PASSWORD is not set'* ]]
[[ "$(cat "$test_root/nontty-password.log")" == *'read -r -s SUPABASE_DB_PASSWORD'* ]]
[[ ! -s "$log" ]]

unset SUPABASE_DB_PASSWORD
: >"$log"
: >"$cwd_log"
: >"$env_log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" 'do-not-print-test-secret' 0 db-plan.sh "$foreign_cwd"
[[ "$(cat "$env_log")" == $'SUPABASE_DB_PASSWORD=present\nSUPABASE_DB_PASSWORD=present' ]]
[[ "$(cat "$log")" != *'do-not-print-test-secret'* ]]

: >"$log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" '__EOF__' 2 db-plan.sh "$foreign_cwd"
[[ ! -s "$log" ]]
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'

# The legacy writer command is closed before env preparation, prompts, or CLI use.
: >"$log"
: >"$env_log"
export SUPABASE_DB_PASSWORD='do-not-print-test-secret'
if bash "$repo/scripts/db-push.sh" >"$test_root/disabled-push.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/disabled-push.log")" == *'applied only by shared-supabase-db'* ]]
[[ "$(cat "$test_root/disabled-push.log")" == *'No database connection or migration was attempted'* ]]
[[ "$(cat "$test_root/disabled-push.log")" != *'do-not-print-test-secret'* ]]
[[ ! -s "$log" && ! -s "$env_log" ]]
if npm --prefix "$repo" run db:push >"$test_root/npm-disabled-push.log" 2>&1; then exit 1; fi
[[ "$(cat "$test_root/npm-disabled-push.log")" == *'applied only by shared-supabase-db'* ]]
[[ ! -s "$log" && ! -s "$env_log" ]]

# Even an interactive caller typing the former confirmation cannot reach Supabase.
: >"$log"
: >"$env_log"
python3 "$repo/scripts/test-db-push-pty.py" "$repo" apply 2 db-push.sh "$foreign_cwd"
[[ ! -s "$log" && ! -s "$env_log" ]]

grep -Fq 'supabase db push --db-url "$SUPABASE_DB_URL" --yes' "$source_root/.github/workflows/deploy.yml"
if grep -Fq 'npm run db:push' "$source_root/.github/workflows/deploy.yml"; then
  echo 'Production deployment must keep its existing direct Supabase CLI migration path.' >&2
  exit 1
fi
echo 'db target and push guard tests passed.'
