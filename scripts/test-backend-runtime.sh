#!/usr/bin/env bash
set -euo pipefail

source_root="$(git rev-parse --show-toplevel)"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/receipt-manager-backend-runtime-test.XXXXXX")"
trap 'rm -rf "$test_root"' EXIT

fixture_repo="$test_root/repo"
mkdir -p "$fixture_repo/scripts" "$fixture_repo/backend"
fixture_repo="$(cd "$fixture_repo" && pwd -P)"
cp "$source_root/scripts/lib-backend-runtime.sh" "$fixture_repo/scripts/lib-backend-runtime.sh"
cp "$source_root/scripts/worktree.sh" "$fixture_repo/scripts/worktree.sh"
printf '[project]\nname = "backend"\n' > "$fixture_repo/backend/pyproject.toml"

create_uvicorn_stub() {
  local repo_root="$1" python_path="${2:-}"
  local venv_dir="$repo_root/backend/.venv"
  local system_python
  system_python="$(python3 -c 'import sys; print(sys.executable)')"
  mkdir -p "$venv_dir/bin"
  printf 'home = %s\n' "$(dirname "$system_python")" >"$venv_dir/pyvenv.cfg"
  if [[ -z "$python_path" ]]; then
    python_path="$venv_dir/bin/python"
    ln -sf "$system_python" "$python_path"
  fi
  cat >"$venv_dir/bin/uvicorn" <<PY
#!$python_path
import sys
if __name__ == "__main__":
    sys.exit(0 if "--version" in sys.argv else 0)
PY
  chmod +x "$venv_dir/bin/uvicorn"
}

fixture_bin="$test_root/bin"
mkdir -p "$fixture_bin"
cat >"$fixture_bin/uv" <<'EOF'
#!/usr/bin/env bash
repo="${RECEIPT_MANAGER_WORKTREE_ROOT:-${BACKEND_RUNTIME_TEST_REPO:?}}"
log="${BACKEND_RUNTIME_TEST_LOG:?}"
printf 'uv' >>"$log"
printf ' %q' "$@" >>"$log"
printf '\n' >>"$log"
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
chmod +x "$fixture_bin/uv"
export PATH="$fixture_bin:$PATH"
export UV_BIN="$fixture_bin/uv"
export BACKEND_RUNTIME_TEST_REPO="$fixture_repo"
export RECEIPT_MANAGER_WORKTREE_ROOT="$fixture_repo"
export BACKEND_RUNTIME_TEST_LOG="$test_root/uv.log"

# shellcheck source=lib-backend-runtime.sh
source "$fixture_repo/scripts/lib-backend-runtime.sh"

ensure_backend_python_runtime "$fixture_repo" 1
[[ -f "$fixture_repo/backend/.venv/.receipt-manager-managed-venv" ]]
[[ "$(backend_runtime_venv_class "$fixture_repo")" == directory ]]
healthy_setup_log_lines="$(wc -l <"$BACKEND_RUNTIME_TEST_LOG")"
ensure_backend_python_runtime "$fixture_repo" 1
[[ "$(wc -l <"$BACKEND_RUNTIME_TEST_LOG")" == "$healthy_setup_log_lines" ]]

stale_repo="$test_root/stale"
mkdir -p "$stale_repo/scripts" "$stale_repo/backend"
stale_repo="$(cd "$stale_repo" && pwd -P)"
cp "$fixture_repo/scripts/lib-backend-runtime.sh" "$stale_repo/scripts/"
printf '[project]\nname = "backend"\n' > "$stale_repo/backend/pyproject.toml"
create_uvicorn_stub "$stale_repo"
printf '/old/worktrees/receipt-manager/task\n' >"$stale_repo/backend/.venv/.receipt-manager-managed-venv"
export BACKEND_RUNTIME_TEST_REPO="$stale_repo"
export RECEIPT_MANAGER_WORKTREE_ROOT="$stale_repo"
if ensure_backend_python_runtime "$stale_repo" 0 >/dev/null 2>"$test_root/stale-no-repair.log"; then
  echo 'Expected stale managed venv without repair to fail.' >&2
  exit 1
fi
[[ "$(cat "$test_root/stale-no-repair.log")" == *'stale'* ]]
if ! ensure_backend_python_runtime "$stale_repo" 1 >"$test_root/stale-repair.log" 2>&1; then
  cat "$test_root/stale-repair.log" >&2
  echo 'Expected moved managed venv to repair in place.' >&2
  exit 1
fi
grep -Fq 'uv sync --reinstall' "$BACKEND_RUNTIME_TEST_LOG" || {
  echo 'Expected a moved venv repair to reinstall dependencies.' >&2
  cat "$BACKEND_RUNTIME_TEST_LOG" >&2
  exit 1
}
backend_runtime_verify_uvicorn "$stale_repo"

shebang_stale_repo="$test_root/shebang-stale"
mkdir -p "$shebang_stale_repo/backend"
printf '[project]\nname = "backend"\n' > "$shebang_stale_repo/backend/pyproject.toml"
shebang_stale_repo="$(cd "$shebang_stale_repo" && pwd -P)"
create_uvicorn_stub "$shebang_stale_repo" "/old/worktrees/receipt-manager/task/backend/.venv/bin/python"
export RECEIPT_MANAGER_WORKTREE_ROOT="$shebang_stale_repo"
export BACKEND_RUNTIME_TEST_REPO="$shebang_stale_repo"
if ! backend_runtime_shebang_stale "$shebang_stale_repo"; then
  echo 'Expected shebang mismatch to be detected.' >&2
  exit 1
fi
ensure_backend_python_runtime "$shebang_stale_repo" 1 >/dev/null
backend_runtime_verify_uvicorn "$shebang_stale_repo"

symlink_repo="$test_root/symlink"
mkdir -p "$symlink_repo/backend" "$test_root/external-venv/bin"
printf '[project]\nname = "backend"\n' > "$symlink_repo/backend/pyproject.toml"
printf '#!/usr/bin/env bash\nexit 1\n' >"$test_root/external-venv/bin/uvicorn"
chmod +x "$test_root/external-venv/bin/uvicorn"
ln -s "$test_root/external-venv" "$symlink_repo/backend/.venv"
if ensure_backend_python_runtime "$symlink_repo" 1 >/dev/null 2>"$test_root/symlink.log"; then
  echo 'Expected symlinked backend/.venv repair to be refused.' >&2
  exit 1
fi
[[ "$(cat "$test_root/symlink.log")" == *'symlink'* ]]

ambiguous_repo="$test_root/ambiguous"
mkdir -p "$ambiguous_repo/backend/.venv/bin"
cat >"$ambiguous_repo/backend/.venv/bin/uvicorn" <<'PY'
#!/old/path/python
import sys
if __name__ == "__main__":
    sys.exit(0)
PY
chmod +x "$ambiguous_repo/backend/.venv/bin/uvicorn"
printf '[project]\nname = "backend"\n' > "$ambiguous_repo/backend/pyproject.toml"
if check_backend_python_runtime_preflight "$ambiguous_repo" >/dev/null 2>"$test_root/ambiguous.log"; then
  echo 'Expected ambiguous stale venv to fail preflight.' >&2
  exit 1
fi
[[ "$(cat "$test_root/ambiguous.log")" == *'managed marker'* ]]

healthy_repo="$test_root/healthy"
mkdir -p "$healthy_repo/backend"
printf '[project]\nname = "backend"\n' > "$healthy_repo/backend/pyproject.toml"
create_uvicorn_stub "$healthy_repo"
before_healthy_check="$(wc -l <"$BACKEND_RUNTIME_TEST_LOG")"
check_backend_python_runtime_preflight "$healthy_repo"
after_healthy_check="$(wc -l <"$BACKEND_RUNTIME_TEST_LOG")"
[[ "$before_healthy_check" == "$after_healthy_check" ]]

broken_link_repo="$test_root/broken-link"
mkdir -p "$broken_link_repo/backend"
printf '[project]\nname = "backend"\n' >"$broken_link_repo/backend/pyproject.toml"
ln -s "$test_root/not-created" "$broken_link_repo/backend/.venv"
if ensure_backend_python_runtime "$broken_link_repo" 1 >/dev/null 2>"$test_root/broken-link.log"; then
  echo 'Expected a broken backend/.venv symlink to be refused.' >&2
  exit 1
fi
[[ "$(cat "$test_root/broken-link.log")" == *'symlink'* ]]
[[ -L "$broken_link_repo/backend/.venv" ]]

echo 'Backend runtime tests passed.'
