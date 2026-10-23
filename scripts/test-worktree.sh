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
cp "$source_root/scripts/worktree-remove-inspect.py" "$fixture_repo/scripts/worktree-remove-inspect.py"
cp "$source_root/scripts/lib-backend-runtime.sh" "$fixture_repo/scripts/lib-backend-runtime.sh"

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

export HOME="$fixture_home"
export PATH="$fixture_bin:$PATH"
export UV_BIN="$fixture_bin/uv"
export WORKTREE_TEST_LOG="$command_log"

"$fixture_repo/scripts/worktree.sh" create default-base --branch feature/default-base --no-setup >/dev/null
default_base_path="$fixture_home/worktrees/$repository_name/default-base"
[[ "$(git -C "$default_base_path" rev-parse HEAD)" == "$(git -C "$fixture_repo" rev-parse origin/main)" ]]
[[ "$(git -C "$default_base_path" rev-parse HEAD)" != "$(git -C "$fixture_repo" rev-parse HEAD)" ]]

worktree_path="$fixture_home/worktrees/$repository_name/review-task"
create_output="$("$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main --no-setup)"
export RECEIPT_MANAGER_WORKTREE_ROOT="$(cd "$worktree_path" && pwd -P)"
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

reuse_output="$("$fixture_repo/scripts/worktree.sh" reuse "$worktree_path" --no-setup)"
[[ "$reuse_output" == *"feature/review-task"* ]]
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

echo "Worktree workflow tests passed."
