#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
repository_name="$(basename "$source_root")"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/${repository_name}-worktree-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture_home="$test_root/home"
fixture_repo="$test_root/source/$repository_name"
fixture_config="$fixture_home/.config/$repository_name/development"
fixture_bin="$test_root/bin"
command_log="$test_root/setup-commands.log"
mkdir -p "$fixture_repo/scripts" "$fixture_config/frontend" "$fixture_config/backend" "$fixture_bin"
mkdir -p "$fixture_config/secrets/ai-quota-ca"
cp "$source_root/scripts/worktree.sh" "$fixture_repo/scripts/worktree.sh"
cp "$source_root/scripts/worktree-env-validate.py" "$fixture_repo/scripts/worktree-env-validate.py"
cp "$source_root/scripts/worktree-remove-inspect.py" "$fixture_repo/scripts/worktree-remove-inspect.py"
cp "$source_root/scripts/lib-backend-runtime.sh" "$fixture_repo/scripts/lib-backend-runtime.sh"
cp "$source_root/scripts/delegate-cursor-monitor.py" "$fixture_repo/scripts/delegate-cursor-monitor.py"

git -C "$fixture_repo" init -b main >/dev/null
git -C "$fixture_repo" config user.name "Worktree Test"
git -C "$fixture_repo" config user.email "worktree-test@example.invalid"
mkdir -p "$fixture_repo/frontend" "$fixture_repo/backend"
: > "$fixture_repo/package-lock.json"
: > "$fixture_repo/frontend/package-lock.json"
: > "$fixture_repo/backend/pyproject.toml"
printf 'tracked\n' > "$fixture_repo/README.md"
printf '.env\nfrontend/.env\nfrontend/.env.local\nbackend/.env\n.venv/\nbackend/.venv/\n' > "$fixture_repo/.gitignore"
git -C "$fixture_repo" add .
git -C "$fixture_repo" commit -m "test fixture" >/dev/null
git init --bare "$test_root/origin.git" >/dev/null
git -C "$fixture_repo" remote add origin "$test_root/origin.git"
git -C "$fixture_repo" push origin main >/dev/null 2>&1
git -C "$fixture_repo" fetch origin refs/heads/main:refs/remotes/origin/main >/dev/null 2>&1
printf 'local-only\n' >> "$fixture_repo/README.md"
git -C "$fixture_repo" add README.md
git -C "$fixture_repo" commit -m "local branch only" >/dev/null

printf 'VITE_TEST_VALUE=fixture-only\n' > "$fixture_config/frontend/.env"
printf 'VITE_LOCAL_TEST_VALUE=fixture-only\n' > "$fixture_config/frontend/.env.local"
printf 'TEST_SECRET_MARKER=fixture-only\n' > "$fixture_config/.env"
printf 'excluded quota marker\n' > "$fixture_config/.env.ai-quota"
printf 'excluded service marker\n' > "$fixture_config/service_account.json"
printf 'excluded CA marker\n' > "$fixture_config/secrets/ai-quota-ca/root.crt"
cat > "$fixture_bin/npm" <<'EOF'
#!/usr/bin/env bash
printf 'npm' >> "$WORKTREE_TEST_LOG"
printf ' %s' "$@" >> "$WORKTREE_TEST_LOG"
printf '\n' >> "$WORKTREE_TEST_LOG"
EOF
cat > "$fixture_bin/uv" <<'EOF'
#!/usr/bin/env bash
printf 'uv' >> "$WORKTREE_TEST_LOG"
printf ' %s' "$@" >> "$WORKTREE_TEST_LOG"
printf '\n' >> "$WORKTREE_TEST_LOG"
repo="${RECEIPT_MANAGER_WORKTREE_ROOT:-${WORKTREE_TEST_REPO:?}}"
repo="$(cd "$repo" && pwd -P)"
if [[ "${1:-}" == sync ]]; then
  sync_directory=""
  sync_args=("$@")
  for ((i = 0; i < ${#sync_args[@]}; i++)); do
    if [[ "${sync_args[i]}" == --directory && $((i + 1)) -lt ${#sync_args[@]} ]]; then
      sync_directory="${sync_args[i + 1]}"
      break
    fi
  done
  if [[ -n "$sync_directory" ]]; then
    repo="$(cd "${sync_directory%/backend}" && pwd -P)"
  fi
  mkdir -p "$repo/backend/.venv/bin"
  system_python="$(python3 -c 'import sys; print(sys.executable)')"
  ln -sf "$system_python" "$repo/backend/.venv/bin/python"
  cat >"$repo/backend/.venv/bin/uvicorn" <<PY
#!$repo/backend/.venv/bin/python
import sys
if __name__ == "__main__":
    sys.exit(0 if "--version" in sys.argv else 0)
PY
  chmod +x "$repo/backend/.venv/bin/uvicorn"
  printf 'home = %s\n' "$(dirname "$system_python")" >"$repo/backend/.venv/pyvenv.cfg"
fi
EOF
chmod +x "$fixture_bin/npm" "$fixture_bin/uv"

real_git="$(command -v git)"
cat > "$fixture_bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\${WORKTREE_TEST_FETCH_FAIL:-}" == 1 ]]; then
  for arg in "\$@"; do
    if [[ "\$arg" == "fetch" ]]; then
      exit 1
    fi
  done
fi
if [[ -n "\${WORKTREE_TEST_LOG:-}" ]]; then
  if [[ "\$*" == *" fetch "* && "\$*" == *refs/heads/main:refs/remotes/origin/main* ]]; then
    printf 'git fetch origin-main\n' >> "\$WORKTREE_TEST_LOG"
  fi
fi
exec "$real_git" "\$@"
EOF
chmod +x "$fixture_bin/git"

export HOME="$fixture_home"
export PATH="$fixture_bin:$PATH"
export UV_BIN="$fixture_bin/uv"
export WORKTREE_TEST_LOG="$command_log"

"$fixture_repo/scripts/worktree.sh" create default-base --branch feature/default-base --no-setup >/dev/null
default_base_path="$fixture_home/worktrees/$repository_name/default-base"
[[ "$(git -C "$default_base_path" rev-parse HEAD)" == "$(git -C "$fixture_repo" rev-parse origin/main)" ]]
[[ "$(git -C "$default_base_path" rev-parse HEAD)" != "$(git -C "$fixture_repo" rev-parse HEAD)" ]]

stale_origin_main="$(git -C "$fixture_repo" rev-parse origin/main)"
git -C "$fixture_repo" push origin main >/dev/null 2>&1
latest_origin_main="$(git -C "$fixture_repo" rev-parse main)"
[[ "$stale_origin_main" != "$latest_origin_main" ]]
git -C "$fixture_repo" update-ref refs/remotes/origin/main "$stale_origin_main"
: > "$command_log"
"$fixture_repo/scripts/worktree.sh" create fresh-remote --branch feature/fresh-remote --no-setup >/dev/null
fresh_remote_path="$fixture_home/worktrees/$repository_name/fresh-remote"
[[ "$(git -C "$fresh_remote_path" rev-parse HEAD)" == "$latest_origin_main" ]]
grep -Fq 'git fetch origin-main' "$command_log" || {
  echo "Expected origin/main fetch when creating from a stale remote-tracking ref." >&2
  exit 1
}

: > "$command_log"
"$fixture_repo/scripts/worktree.sh" create fresh-local-main --branch feature/fresh-local-main --base main --no-setup >/dev/null
fresh_local_main_path="$fixture_home/worktrees/$repository_name/fresh-local-main"
[[ "$(git -C "$fresh_local_main_path" rev-parse HEAD)" == "$(git -C "$fixture_repo" rev-parse main)" ]]
if grep -Fq 'git fetch origin-main' "$command_log"; then
  echo "Expected no origin/main fetch for explicit --base main." >&2
  exit 1
fi

export WORKTREE_TEST_FETCH_FAIL=1
if "$fixture_repo/scripts/worktree.sh" create fetch-fail-task --branch feature/fetch-fail --no-setup >/dev/null 2>&1; then
  echo "Expected worktree create to fail when origin/main fetch fails." >&2
  exit 1
fi
unset WORKTREE_TEST_FETCH_FAIL
if git -C "$fixture_repo" show-ref --verify --quiet refs/heads/feature/fetch-fail; then
  echo "Expected no branch after fetch failure." >&2
  exit 1
fi
[[ ! -d "$fixture_home/worktrees/$repository_name/fetch-fail-task" ]]

git -C "$fixture_repo" remote rename origin origin-backup
if "$fixture_repo/scripts/worktree.sh" create no-origin-task --branch feature/no-origin --no-setup >/dev/null 2>&1; then
  echo "Expected worktree create to fail when origin remote is missing." >&2
  exit 1
fi
if git -C "$fixture_repo" show-ref --verify --quiet refs/heads/feature/no-origin; then
  echo "Expected no branch when origin is unavailable." >&2
  exit 1
fi
[[ ! -d "$fixture_home/worktrees/$repository_name/no-origin-task" ]]
git -C "$fixture_repo" remote rename origin-backup origin

git -C "$fixture_repo" branch feature/local-existing "$latest_origin_main"
: > "$command_log"
"$fixture_repo/scripts/worktree.sh" create local-existing-task --branch feature/local-existing --no-setup >/dev/null
local_existing_path="$fixture_home/worktrees/$repository_name/local-existing-task"
[[ -d "$local_existing_path" ]]
if grep -Fq 'git fetch origin-main' "$command_log"; then
  echo "Expected no fetch when checking out an existing local branch." >&2
  exit 1
fi

git -C "$fixture_repo" update-ref refs/remotes/origin/main "$stale_origin_main"
: > "$command_log"
"$fixture_repo/scripts/worktree.sh" create fresh-local-main --branch feature/fresh-local-main --base main --no-setup >/dev/null
if grep -Fq 'git fetch origin-main' "$command_log"; then
  echo "Expected no fetch when reusing an existing worktree path." >&2
  exit 1
fi
[[ "$(git -C "$fixture_repo" rev-parse main)" == "$latest_origin_main" ]]

worktree_path="$fixture_home/worktrees/$repository_name/review-task"
create_output="$("$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main --no-setup)"
export RECEIPT_MANAGER_WORKTREE_ROOT="$(cd "$worktree_path" && pwd -P)"
: > "$command_log"
"$fixture_repo/scripts/worktree.sh" setup "$worktree_path" --environment development
[[ -d "$worktree_path" ]]
[[ "$(readlink "$worktree_path/.env")" == "$fixture_config/.env" ]]
[[ "$(readlink "$worktree_path/frontend/.env")" == "$fixture_config/frontend/.env" ]]
[[ "$(readlink "$worktree_path/frontend/.env.local")" == "$fixture_config/frontend/.env.local" ]]
[[ ! -e "$worktree_path/.env.ai-quota" ]]
[[ ! -e "$worktree_path/service_account.json" ]]
[[ ! -e "$worktree_path/secrets/ai-quota-ca/root.crt" ]]
[[ "$(wc -l < "$command_log")" -ge 3 ]]
[[ -f "$worktree_path/backend/.venv/.receipt-manager-managed-venv" ]]
[[ "$create_output" != *"TEST_SECRET_MARKER=fixture-only"* ]]

rm "$worktree_path/.env"
printf 'existing target\n' > "$worktree_path/.env"
if "$fixture_repo/scripts/worktree.sh" setup "$worktree_path" --env-only >/dev/null 2>&1; then
  echo "Expected an existing environment file to be preserved." >&2
  exit 1
fi
[[ "$(cat "$worktree_path/.env")" == "existing target" ]]
rm "$worktree_path/.env"
"$fixture_repo/scripts/worktree.sh" setup "$worktree_path" --env-only >/dev/null
if "$fixture_repo/scripts/worktree.sh" create review-task --branch feature/other --base main --no-setup >/dev/null 2>&1; then
  echo "Expected an existing task path with another branch to be rejected." >&2
  exit 1
fi

reuse_output="$("$fixture_repo/scripts/worktree.sh" reuse "$worktree_path" --no-setup)"
[[ "$reuse_output" == *"feature/review-task"* ]]
create_reuse_output="$("$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main --no-setup)"
[[ "$create_reuse_output" == *"Reusing existing worktree"* ]]

moved_worktree_path="$fixture_home/worktrees/$repository_name/review-task-moved"
git -C "$fixture_repo" worktree move "$worktree_path" "$moved_worktree_path" >/dev/null
worktree_path="$moved_worktree_path"
: >"$command_log"
"$fixture_repo/scripts/worktree.sh" setup "$worktree_path" >/dev/null
grep -Fq 'uv sync --reinstall' "$command_log" || {
  echo 'Expected git worktree move to trigger a targeted venv repair.' >&2
  cat "$command_log" >&2
  exit 1
}
[[ "$(cat "$worktree_path/backend/.venv/.receipt-manager-managed-venv")" == "$worktree_path" ]]
"$worktree_path/backend/.venv/bin/uvicorn" --version >/dev/null
: >"$command_log"
"$fixture_repo/scripts/worktree.sh" reuse "$worktree_path" >/dev/null
if grep -Fq 'uv sync' "$command_log"; then
  echo 'Expected a healthy existing worktree to reuse its virtualenv without sync.' >&2
  cat "$command_log" >&2
  exit 1
fi

if "$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main --no-setup >"$test_root/moved-branch.log" 2>&1; then
  echo 'Expected create to refuse a branch already checked out at the moved worktree path.' >&2
  exit 1
fi
[[ "$(cat "$test_root/moved-branch.log")" == *'Branch is already checked out'* ]]
git -C "$fixture_repo" worktree list | grep -Fq "$worktree_path"

if "$fixture_repo/scripts/worktree.sh" create another-task --branch feature/review-task --base main >/dev/null 2>&1; then
  echo "Expected an in-use branch to be rejected." >&2
  exit 1
fi

printf 'dirty\n' > "$worktree_path/untracked-test-file"
if printf 'remove\n' | "$fixture_repo/scripts/worktree.sh" remove "$worktree_path" >/dev/null 2>&1; then
  echo "Expected a dirty worktree removal to be rejected." >&2
  exit 1
fi
[[ -d "$worktree_path" ]]

rm "$worktree_path/untracked-test-file"
printf 'remove\n' | "$fixture_repo/scripts/worktree.sh" remove "$worktree_path" >/dev/null
git -C "$fixture_repo" show-ref --verify --quiet refs/heads/feature/review-task

python3 "$source_root/scripts/test-worktree-remove-guard.py"

cat > "$fixture_bin/agent" <<'EOF'
#!/usr/bin/env bash
if [[ -n "${WORKER_STARTED_FILE:-}" ]]; then
  : > "$WORKER_STARTED_FILE"
fi
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"session_id":"worktree-test"}'
exit 0
EOF
chmod +x "$fixture_bin/agent"

git -C "$fixture_repo" update-ref refs/remotes/origin/main "$stale_origin_main"
: > "$command_log"
cd "$fixture_repo"
if ! "$source_root/scripts/delegate-cursor.sh" --prompt "worktree fixture" --worktree delegate-fresh >"$test_root/delegate-create.log" 2>&1; then
  echo "Expected delegate-cursor to create a worktree." >&2
  cat "$test_root/delegate-create.log" >&2
  exit 1
fi
delegate_workspace="$fixture_home/worktrees/$repository_name/delegate-fresh"
[[ -d "$delegate_workspace" ]]
git -C "$fixture_repo" show-ref --verify --quiet refs/heads/codex/delegate-fresh
grep -Fq 'git fetch origin-main' "$command_log" || {
  echo "Expected delegate-cursor new worktree path to fetch via worktree.sh." >&2
  exit 1
}
[[ "$(git -C "$delegate_workspace" rev-parse HEAD)" == "$latest_origin_main" ]]
grep -Fq "npm --prefix $delegate_workspace ci" "$command_log" || {
  echo "Expected setup to run dependencies after accepting not-yet-created environment links." >&2
  exit 1
}
[[ "$(readlink "$delegate_workspace/frontend/.env")" == "$fixture_config/frontend/.env" ]]

: > "$command_log"
if ! "$source_root/scripts/delegate-cursor.sh" --prompt "worktree fixture" --worktree delegate-fresh >"$test_root/delegate-reuse.log" 2>&1; then
  echo "Expected delegate-cursor to reuse an existing worktree." >&2
  cat "$test_root/delegate-reuse.log" >&2
  exit 1
fi
if grep -Fq 'git fetch origin-main' "$command_log"; then
  echo "Expected delegate-cursor reuse not to fetch origin/main." >&2
  exit 1
fi

"$fixture_repo/scripts/worktree.sh" validate-env "$delegate_workspace" >/dev/null

staging_config="$fixture_home/.config/$repository_name/staging/frontend/.env"
mkdir -p "$(dirname "$staging_config")"
touch "$staging_config"
staging_worktree="$fixture_home/worktrees/$repository_name/manual-staging"
"$fixture_repo/scripts/worktree.sh" create manual-staging --branch feature/manual-staging --base main --environment staging >/dev/null
[[ "$(readlink "$staging_worktree/frontend/.env")" == "$staging_config" ]]
"$fixture_repo/scripts/worktree.sh" reuse "$staging_worktree" --environment staging >/dev/null
[[ "$(readlink "$staging_worktree/frontend/.env")" == "$staging_config" ]]
"$fixture_repo/scripts/worktree.sh" validate-env "$staging_worktree" --environment staging >/dev/null

production_source="$fixture_home/.config/$repository_name/production/frontend/.env"
mkdir -p "$(dirname "$production_source")"
touch "$production_source"
validation_target="$delegate_workspace/frontend/.env"

rm "$validation_target"
ln -s "$production_source" "$validation_target"
: > "$command_log"
if "$fixture_repo/scripts/worktree.sh" setup "$delegate_workspace" --environment development >"$test_root/pre-setup-alternate-env.log" 2>&1; then
  echo 'Expected a different-environment link to be rejected before dependency setup.' >&2
  exit 1
fi
[[ ! -s "$command_log" ]]
grep -Fq 'does not directly target selected settings' "$test_root/pre-setup-alternate-env.log"
rm "$validation_target"
ln -s "$fixture_config/frontend/.env" "$validation_target"

indirect_source="$test_root/environment-link-alias"
ln -s "$fixture_config/frontend/.env" "$indirect_source"
rm "$validation_target"
ln -s "$indirect_source" "$validation_target"
: > "$command_log"
if "$fixture_repo/scripts/worktree.sh" setup "$delegate_workspace" --environment development >"$test_root/pre-setup-indirect-env.log" 2>&1; then
  echo 'Expected an indirect environment link to be rejected before dependency setup.' >&2
  exit 1
fi
[[ ! -s "$command_log" ]]
grep -Fq 'does not directly target selected settings' "$test_root/pre-setup-indirect-env.log"
rm "$validation_target"
ln -s "$fixture_config/frontend/.env" "$validation_target"

rm "$validation_target"
printf 'SECRET_VALUE_MUST_NOT_APPEAR\n' > "$validation_target"
: > "$command_log"
if "$fixture_repo/scripts/worktree.sh" setup "$delegate_workspace" --environment development >"$test_root/pre-setup-regular-env.log" 2>&1; then
  echo 'Expected a regular environment file to be rejected before dependency setup.' >&2
  exit 1
fi
[[ ! -s "$command_log" ]]
grep -Fq 'Environment path is not a symlink' "$test_root/pre-setup-regular-env.log"
if grep -Fq 'SECRET_VALUE_MUST_NOT_APPEAR' "$test_root/pre-setup-regular-env.log"; then
  echo 'Environment file contents must not be included in validation errors.' >&2
  exit 1
fi
rm "$validation_target"
ln -s "$fixture_config/frontend/.env" "$validation_target"

unexpected_env="$delegate_workspace/.env.ai-quota"
touch "$unexpected_env"
: > "$command_log"
if "$fixture_repo/scripts/worktree.sh" setup "$delegate_workspace" --environment development >"$test_root/pre-setup-unexpected-env.log" 2>&1; then
  echo 'Expected an unexpected .env path to be rejected before dependency setup.' >&2
  exit 1
fi
[[ ! -s "$command_log" ]]
grep -Fq 'Unexpected .env-related path in workspace' "$test_root/pre-setup-unexpected-env.log"
rm "$unexpected_env"

real_worktree_script="$fixture_repo/scripts/worktree-real.sh"
mv "$fixture_repo/scripts/worktree.sh" "$real_worktree_script"
cat > "$fixture_repo/scripts/worktree.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
real_script="${WORKTREE_TEST_REAL_WORKTREE:?}"
if [[ "${1:-}" == reuse ]]; then
  workspace="${2:?missing workspace}"
  "$real_script" "$@"
  touch "$workspace/.env.ai-quota"
else
  exec "$real_script" "$@"
fi
EOF
chmod +x "$fixture_repo/scripts/worktree.sh"
worker_started_after_setup="$test_root/worker-started-after-setup"
if WORKTREE_TEST_REAL_WORKTREE="$real_worktree_script" WORKER_STARTED_FILE="$worker_started_after_setup" \
  "$source_root/scripts/delegate-cursor.sh" --prompt 'post-setup validation fixture' --workspace "$delegate_workspace" \
  >"$test_root/post-setup-validation.log" 2>&1; then
  echo 'Expected the final environment validation to reject a path added after setup.' >&2
  exit 1
fi
[[ ! -e "$worker_started_after_setup" ]]
grep -Fq 'Unexpected .env-related path in workspace' "$test_root/post-setup-validation.log"
rm "$delegate_workspace/.env.ai-quota"
mv "$real_worktree_script" "$fixture_repo/scripts/worktree.sh"
chmod +x "$fixture_repo/scripts/worktree.sh"

empty_home="$test_root/empty-home"
mkdir -p "$empty_home"
HOME="$empty_home" "$fixture_repo/scripts/worktree.sh" validate-env "$fixture_repo" >/dev/null

validation_target="$delegate_workspace/frontend/.env"
development_source="$fixture_config/frontend/.env"

rm "$validation_target"
ln -s "$production_source" "$validation_target"
if "$fixture_repo/scripts/worktree.sh" validate-env "$delegate_workspace" >"$test_root/alternate-env.log" 2>&1; then
  echo 'Expected an environment link to a different environment to be rejected.' >&2
  exit 1
fi
grep -Fq 'does not directly target selected settings' "$test_root/alternate-env.log"

rm "$validation_target"
ln -s "$fixture_config/frontend/missing.env" "$validation_target"
if "$fixture_repo/scripts/worktree.sh" validate-env "$delegate_workspace" >"$test_root/broken-env.log" 2>&1; then
  echo 'Expected a broken environment link to be rejected.' >&2
  exit 1
fi
grep -Fq 'Broken environment symlink' "$test_root/broken-env.log"

rm "$validation_target"
touch "$validation_target"
if "$fixture_repo/scripts/worktree.sh" validate-env "$delegate_workspace" >"$test_root/regular-env.log" 2>&1; then
  echo 'Expected an existing regular environment file to be rejected.' >&2
  exit 1
fi
grep -Fq 'Environment path is not a symlink' "$test_root/regular-env.log"

rm "$validation_target"
ln -s "$development_source" "$validation_target"
mv "$development_source" "$development_source.saved"
if "$fixture_repo/scripts/worktree.sh" validate-env "$delegate_workspace" >"$test_root/missing-source-env.log" 2>&1; then
  echo 'Expected a stale link with a missing development source to be rejected.' >&2
  exit 1
fi
grep -Fq 'Broken environment symlink' "$test_root/missing-source-env.log"
mv "$development_source.saved" "$development_source"

unexpected_env="$delegate_workspace/.env.ai-quota"
printf 'SECRET_VALUE_MUST_NOT_APPEAR\n' > "$unexpected_env"
worker_started="$test_root/unexpected-env-worker-started"
if WORKER_STARTED_FILE="$worker_started" "$source_root/scripts/delegate-cursor.sh" \
  --prompt 'unexpected env fixture' --workspace "$delegate_workspace" >"$test_root/unexpected-env-delegate.log" 2>&1; then
  echo 'Expected Cursor delegation to stop for an unexpected environment file.' >&2
  exit 1
fi
[[ ! -e "$worker_started" ]]
grep -Fq 'Unexpected .env-related path in workspace' "$test_root/unexpected-env-delegate.log"
if grep -Fq 'SECRET_VALUE_MUST_NOT_APPEAR' "$test_root/unexpected-env-delegate.log"; then
  echo 'Environment file contents must not be included in validation errors.' >&2
  exit 1
fi
rm "$unexpected_env"

echo "Worktree workflow tests passed."
