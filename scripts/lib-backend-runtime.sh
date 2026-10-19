#!/usr/bin/env bash
# Shared backend/.venv management for worktree setup and dev preflight.
# Source from other scripts; do not execute directly.

backend_runtime_die() {
  printf '%s\n' "$1" >&2
  exit 2
}

backend_runtime_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}")" && pwd -P)"
  cd "$script_dir/.." && pwd -P
}

BACKEND_VENV_MARKER='.receipt-manager-managed-venv'

backend_runtime_venv_dir() {
  printf '%s/backend/.venv\n' "$1"
}

backend_runtime_uvicorn_path() {
  printf '%s/bin/uvicorn\n' "$(backend_runtime_venv_dir "$1")"
}

backend_runtime_read_shebang_interpreter() {
  local script_path="$1"
  [[ -f "$script_path" ]] || return 1
  local first_line
  IFS= read -r first_line <"$script_path" || return 1
  [[ "$first_line" == '#!'* ]] || return 1
  printf '%s\n' "${first_line#'#!'}"
}

backend_runtime_expected_python() {
  local repo_root="$1"
  local venv_dir
  venv_dir="$(backend_runtime_venv_dir "$repo_root")"
  printf '%s/bin/python\n' "$(cd "$venv_dir" && pwd -P 2>/dev/null || printf '%s' "$venv_dir")"
}

backend_runtime_marker_path() {
  printf '%s/%s\n' "$(backend_runtime_venv_dir "$1")" "$BACKEND_VENV_MARKER"
}

backend_runtime_read_marker_root() {
  local marker_path
  marker_path="$(backend_runtime_marker_path "$1")"
  [[ -f "$marker_path" ]] || return 1
  local recorded
  IFS= read -r recorded <"$marker_path" || return 1
  [[ -n "$recorded" ]] || return 1
  printf '%s\n' "$recorded"
}

backend_runtime_write_marker() {
  local repo_root="$1"
  local marker_path canonical_root
  canonical_root="$(cd "$repo_root" && pwd -P)"
  marker_path="$(backend_runtime_marker_path "$repo_root")"
  mkdir -p "$(dirname "$marker_path")"
  printf '%s\n' "$canonical_root" >"$marker_path"
}

backend_runtime_venv_class() {
  local repo_root="$1"
  local venv_dir
  venv_dir="$(backend_runtime_venv_dir "$repo_root")"
  if [[ -L "$venv_dir" ]]; then
    printf 'symlink\n'
    return 0
  fi
  if [[ ! -e "$venv_dir" ]]; then
    printf 'missing\n'
    return 0
  fi
  if [[ ! -d "$venv_dir" ]]; then
    printf 'ambiguous\n'
    return 0
  fi
  case "$venv_dir" in
    "$repo_root"/backend/.venv) printf 'directory\n' ;;
    *) printf 'outside\n' ;;
  esac
}

backend_runtime_shebang_stale() {
  local repo_root="$1"
  local uvicorn_path expected actual
  uvicorn_path="$(backend_runtime_uvicorn_path "$repo_root")"
  [[ -f "$uvicorn_path" ]] || return 0
  expected="$(backend_runtime_expected_python "$repo_root")"
  actual="$(backend_runtime_read_shebang_interpreter "$uvicorn_path")" || return 0
  [[ "$actual" != "$expected" ]]
}

backend_runtime_python_prefix_stale() {
  local repo_root="$1" python_path expected actual
  python_path="$(backend_runtime_venv_dir "$repo_root")/bin/python"
  [[ -x "$python_path" ]] || return 0
  expected="$(cd "$repo_root" && pwd -P)/backend/.venv"
  actual="$("$python_path" -c 'import sys; print(sys.prefix)' 2>/dev/null)" || return 0
  actual="$(cd "$actual" 2>/dev/null && pwd -P)" || return 0
  [[ "$actual" != "$expected" ]]
}

backend_runtime_marker_stale() {
  local repo_root="$1"
  local recorded canonical_root
  recorded="$(backend_runtime_read_marker_root "$repo_root")" || return 1
  canonical_root="$(cd "$repo_root" && pwd -P)"
  [[ "$recorded" != "$canonical_root" ]]
}

backend_runtime_verify_uvicorn() {
  local repo_root="$1"
  local uvicorn_path
  uvicorn_path="$(backend_runtime_uvicorn_path "$repo_root")"
  [[ -x "$uvicorn_path" ]] || return 1
  "$uvicorn_path" --version >/dev/null 2>&1
}

backend_runtime_print_unsafe_recovery() {
  local repo_root="$1" reason="$2"
  printf '[backend-runtime] Unsafe to repair automatically (%s).\n' "$reason" >&2
  printf '[backend-runtime] Recovery options:\n' >&2
  printf '  1. Stop any process using this virtual environment.\n' >&2
  printf '  2. If backend/.venv is a symlink or custom layout, fix it manually or point it at a valid environment.\n' >&2
  printf '  3. For a standard in-tree virtualenv, run: scripts/worktree.sh setup %s\n' "$repo_root" >&2
  printf '  4. For a custom or shared environment, repair it manually and rerun setup.\n' >&2
}

backend_runtime_sync_backend() {
  local repo_root="$1" reinstall="$2"
  local uv_bin="${UV_BIN:-uv}"
  if [[ "$reinstall" == 1 ]]; then
    "$uv_bin" sync --reinstall --directory "$repo_root/backend"
  else
    "$uv_bin" sync --directory "$repo_root/backend"
  fi
}

# ensure_backend_python_runtime <repo_root> [repair]
# repair=1 allows in-place synchronization of a confirmed in-tree virtualenv.
ensure_backend_python_runtime() {
  local repo_root="$1" repair="${2:-0}"
  if [[ ! -f "$repo_root/backend/pyproject.toml" ]]; then
    printf '%s\n' "backend/pyproject.toml not found: $repo_root" >&2
    return 1
  fi

  local class_name
  class_name="$(backend_runtime_venv_class "$repo_root")"

  case "$class_name" in
    missing)
      printf '[backend-runtime] Creating managed backend/.venv\n'
      backend_runtime_sync_backend "$repo_root" 0
      backend_runtime_write_marker "$repo_root"
      ;;
    symlink|outside|ambiguous)
      if backend_runtime_verify_uvicorn "$repo_root"; then
        printf '[backend-runtime] Using existing non-managed backend/.venv (verify ok)\n'
        return 0
      fi
      backend_runtime_print_unsafe_recovery "$repo_root" "backend/.venv type is $class_name"
      return 1
      ;;
    directory)
      local managed=0
      if [[ -f "$(backend_runtime_marker_path "$repo_root")" ]]; then
        managed=1
      fi
      local stale=0
      if backend_runtime_shebang_stale "$repo_root" || backend_runtime_python_prefix_stale "$repo_root"; then
        stale=1
      fi
      if backend_runtime_marker_stale "$repo_root"; then
        stale=1
      fi
      if [[ "$stale" -eq 1 ]]; then
        if [[ ! -f "$(backend_runtime_venv_dir "$repo_root")/pyvenv.cfg" ]]; then
          backend_runtime_print_unsafe_recovery "$repo_root" 'relocation detected but backend/.venv is not a standard Python virtualenv'
          return 1
        fi
        if [[ "$repair" -ne 1 ]]; then
          printf '[backend-runtime] Managed backend/.venv is stale; rerun with repair enabled (worktree setup repairs automatically).\n' >&2
          return 1
        fi
        printf '[backend-runtime] Repairing stale backend/.venv in place\n'
        backend_runtime_sync_backend "$repo_root" 1
        backend_runtime_write_marker "$repo_root"
      elif ! backend_runtime_verify_uvicorn "$repo_root"; then
        if [[ "$managed" -eq 0 ]]; then
          backend_runtime_print_unsafe_recovery "$repo_root" 'uvicorn verify failed without managed marker'
          return 1
        fi
        if [[ "$repair" -ne 1 ]]; then
          printf '[backend-runtime] Managed backend/.venv failed verification; worktree setup can repair it.\n' >&2
          return 1
        fi
        printf '[backend-runtime] Reinstalling managed backend/.venv after verify failure\n'
        if [[ ! -f "$(backend_runtime_venv_dir "$repo_root")/pyvenv.cfg" ]]; then
          backend_runtime_print_unsafe_recovery "$repo_root" 'uvicorn failed and backend/.venv is not a standard Python virtualenv'
          return 1
        fi
        backend_runtime_sync_backend "$repo_root" 1
        backend_runtime_write_marker "$repo_root"
      else
        if [[ "$managed" -eq 0 ]]; then
          backend_runtime_write_marker "$repo_root"
        fi
      fi
      ;;
  esac

  if ! backend_runtime_verify_uvicorn "$repo_root"; then
    printf '%s\n' '[backend-runtime] uvicorn verification failed after sync' >&2
    return 1
  fi
  return 0
}

# Fast check for npm run dev preflight: no npm ci / uv sync when healthy.
check_backend_python_runtime_preflight() {
  local repo_root="$1"
  [[ -f "$repo_root/backend/pyproject.toml" ]] || return 0
  local class_name
  class_name="$(backend_runtime_venv_class "$repo_root")"
  case "$class_name" in
    missing)
      printf '[dev-env] Backend runtime is not ready (no backend/.venv).\n' >&2
      printf '[dev-env] Run: scripts/worktree.sh setup %s\n' "$repo_root" >&2
      printf '[dev-env] Or: uv sync --directory %s/backend\n' "$repo_root" >&2
      return 1
      ;;
    symlink|outside|ambiguous)
      if backend_runtime_verify_uvicorn "$repo_root"; then
        return 0
      fi
      backend_runtime_print_unsafe_recovery "$repo_root" "backend/.venv type is $class_name"
      return 1
      ;;
    directory)
      if backend_runtime_shebang_stale "$repo_root" || backend_runtime_python_prefix_stale "$repo_root" || backend_runtime_marker_stale "$repo_root"; then
        if [[ -f "$(backend_runtime_marker_path "$repo_root")" ]]; then
          printf '[dev-env] Backend runtime is stale for this worktree.\n' >&2
          printf '[dev-env] Run: scripts/worktree.sh setup %s\n' "$repo_root" >&2
        else
          backend_runtime_print_unsafe_recovery "$repo_root" 'relocation detected without managed marker'
        fi
        return 1
      fi
      if ! backend_runtime_verify_uvicorn "$repo_root"; then
        printf '[dev-env] Backend runtime failed uvicorn verification.\n' >&2
        printf '[dev-env] Run: scripts/worktree.sh setup %s\n' "$repo_root" >&2
        return 1
      fi
      return 0
      ;;
  esac
}
