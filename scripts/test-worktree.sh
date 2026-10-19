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

git -C "$fixture_repo" init -b main >/dev/null
git -C "$fixture_repo" config user.name "Worktree Test"
git -C "$fixture_repo" config user.email "worktree-test@example.invalid"
mkdir -p "$fixture_repo/frontend" "$fixture_repo/backend"
: > "$fixture_repo/package-lock.json"
: > "$fixture_repo/frontend/package-lock.json"
: > "$fixture_repo/backend/pyproject.toml"
printf 'tracked\n' > "$fixture_repo/README.md"
printf '.env\nfrontend/.env\nbackend/.env\n' > "$fixture_repo/.gitignore"
git -C "$fixture_repo" add .
git -C "$fixture_repo" commit -m "test fixture" >/dev/null

printf 'VITE_TEST_VALUE=fixture-only\n' > "$fixture_config/frontend/.env"
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
EOF
chmod +x "$fixture_bin/npm" "$fixture_bin/uv"

export HOME="$fixture_home"
export PATH="$fixture_bin:$PATH"
export WORKTREE_TEST_LOG="$command_log"

create_output="$("$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main)"
worktree_path="$fixture_home/worktrees/$repository_name/review-task"
[[ -d "$worktree_path" ]]
[[ "$(readlink "$worktree_path/.env")" == "$fixture_config/.env" ]]
[[ "$(readlink "$worktree_path/frontend/.env")" == "$fixture_config/frontend/.env" ]]
[[ ! -e "$worktree_path/.env.ai-quota" ]]
[[ ! -e "$worktree_path/service_account.json" ]]
[[ ! -e "$worktree_path/secrets/ai-quota-ca/root.crt" ]]
[[ "$(wc -l < "$command_log")" -eq 3 ]]
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

reuse_output="$("$fixture_repo/scripts/worktree.sh" reuse "$worktree_path" --no-setup)"
[[ "$reuse_output" == *"feature/review-task"* ]]
create_reuse_output="$("$fixture_repo/scripts/worktree.sh" create review-task --branch feature/review-task --base main --no-setup)"
[[ "$create_reuse_output" == *"Reusing existing worktree"* ]]
if "$fixture_repo/scripts/worktree.sh" create review-task --branch feature/other --base main --no-setup >/dev/null 2>&1; then
  echo "Expected an existing task path with another branch to be rejected." >&2
  exit 1
fi

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

echo "Worktree workflow tests passed."
