#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/worktree.sh list
  scripts/worktree.sh create <task-name> --branch <branch> [--base <ref>] [--environment <name>] [--no-setup]
  scripts/worktree.sh reuse <path> [--environment <name>] [--no-setup]
  scripts/worktree.sh setup [path] [--environment <name>] [--env-only]
  scripts/worktree.sh remove <path>

Worktrees are stored under ~/worktrees/<repository-name>/<task-name>.
Environment files are linked from ~/.config/<repository-name>/<environment>/.
EOF
}

die() {
  printf '%s\n' "$1" >&2
  exit 2
}

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
script_repo_root="$(git -C "$script_directory" rev-parse --show-toplevel 2>/dev/null)" || die "Not inside a Git repository."
git_common_dir="$(git -C "$script_repo_root" rev-parse --path-format=absolute --git-common-dir)"
repo_name="$(basename "$(dirname "$git_common_dir")")"
worktree_base="${HOME:?HOME must be set}/worktrees/$repo_name"
environment_name="development"

validate_task_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "Invalid task name: use letters, numbers, dots, underscores, and hyphens."
}

validate_environment_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "Invalid environment name."
}

canonical_worktree() {
  local input_path="$1"
  [[ -d "$input_path" ]] || die "Worktree directory not found: $input_path"
  local canonical_path
  canonical_path="$(cd "$input_path" && pwd -P)"
  git -C "$canonical_path" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not a Git worktree: $canonical_path"
  local target_common
  target_common="$(git -C "$canonical_path" rev-parse --path-format=absolute --git-common-dir)"
  [[ "$target_common" == "$git_common_dir" ]] || die "Worktree belongs to a different repository: $canonical_path"
  printf '%s\n' "$canonical_path"
}

show_worktree_state() {
  local target_path="$1"
  printf '\n[worktree] %s\n' "$target_path"
  git -C "$target_path" status --short --branch
  printf '[worktree] staged diff summary\n'
  git -C "$target_path" diff --cached --stat
  printf '[worktree] unstaged diff summary\n'
  git -C "$target_path" diff --stat
  printf '[worktree] untracked files\n'
  git -C "$target_path" ls-files --others --exclude-standard
}

link_environment_file() {
  local relative_path="$1"
  local source_path="$2/$relative_path"
  local target_path="$3/$relative_path"

  if [[ ! -e "$source_path" ]]; then
    return 0
  fi
  [[ -f "$source_path" && ! -L "$source_path" ]] || die "Environment source must be a regular file: $source_path"
  mkdir -p "$(dirname "$target_path")"
  if [[ -L "$target_path" ]]; then
    local current_target
    current_target="$(readlink "$target_path")"
    [[ "$current_target" == "$source_path" ]] || die "Refusing to replace an existing environment link: $target_path"
    return 0
  fi
  [[ ! -e "$target_path" ]] || die "Refusing to replace an existing file: $target_path"
  ln -s "$source_path" "$target_path"
  printf '[worktree-setup] Linked %s\n' "$relative_path"
}

setup_environment() {
  local target_path="$1"
  local source_dir="$HOME/.config/$repo_name/$environment_name"
  local found_source=0
  [[ -d "$source_dir" ]] || {
    printf '[worktree-setup] No environment directory configured: %s\n' "$source_dir"
    return 0
  }
  for relative_path in .env frontend/.env backend/.env; do
    if [[ -e "$source_dir/$relative_path" ]]; then
      found_source=1
    fi
    link_environment_file "$relative_path" "$source_dir" "$target_path"
  done
  if [[ "$found_source" -eq 0 ]]; then
    printf '[worktree-setup] No environment files configured in %s\n' "$source_dir"
  fi
}

setup_dependencies() {
  local target_path="$1"
  if [[ -f "$target_path/package-lock.json" ]]; then
    printf '[worktree-setup] Installing root dependencies\n'
    npm --prefix "$target_path" ci
  fi
  if [[ -f "$target_path/frontend/package-lock.json" ]]; then
    printf '[worktree-setup] Installing frontend dependencies\n'
    npm --prefix "$target_path/frontend" ci
  fi
  if [[ -f "$target_path/backend/pyproject.toml" ]]; then
    printf '[worktree-setup] Syncing backend dependencies\n'
    uv sync --directory "$target_path/backend"
  fi
}

setup_worktree() {
  local target_path="$1"
  local run_deps=1
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --environment) environment_name="${2:?missing value for --environment}"; shift 2 ;;
      --env-only) run_deps=0; shift ;;
      *) die "Unknown setup option: $1" ;;
    esac
  done
  validate_environment_name "$environment_name"
  target_path="$(canonical_worktree "$target_path")"
  if [[ "$run_deps" -eq 1 ]]; then
    setup_dependencies "$target_path"
  fi
  setup_environment "$target_path"
}

command_name="${1:-}"
[[ -n "$command_name" ]] || { usage >&2; exit 2; }
shift

case "$command_name" in
  list)
    [[ $# -eq 0 ]] || die "list takes no arguments."
    git -C "$script_repo_root" worktree list
    ;;
  create)
    [[ $# -ge 1 ]] || die "create requires a task name."
    task_name="$1"
    shift
    validate_task_name "$task_name"
    branch_name=""
    base_ref="HEAD"
    no_setup=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --branch) branch_name="${2:?missing value for --branch}"; shift 2 ;;
        --base) base_ref="${2:?missing value for --base}"; shift 2 ;;
        --environment) environment_name="${2:?missing value for --environment}"; shift 2 ;;
        --no-setup) no_setup=1; shift ;;
        *) die "Unknown create option: $1" ;;
      esac
    done
    [[ -n "$branch_name" ]] || die "create requires --branch."
    git -C "$script_repo_root" check-ref-format --branch "$branch_name" >/dev/null 2>&1 || die "Invalid branch name: $branch_name"
    validate_environment_name "$environment_name"
    target_path="$worktree_base/$task_name"
    mkdir -p "$worktree_base"
    if [[ -e "$target_path" ]]; then
      if git -C "$target_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        registered_path="$(canonical_worktree "$target_path")"
        show_worktree_state "$registered_path"
        existing_branch="$(git -C "$registered_path" symbolic-ref --quiet --short HEAD || true)"
        if [[ "$existing_branch" != "$branch_name" ]]; then
          die "Task path is already using branch '${existing_branch:-detached HEAD}', expected '$branch_name'. Reuse it explicitly if intended."
        fi
        printf '[worktree] Reusing existing worktree; no checkout or deletion performed.\n'
        if [[ "$no_setup" -eq 0 ]]; then
          setup_worktree "$registered_path" --environment "$environment_name"
        fi
        exit 0
      fi
      die "Refusing to replace an existing path: $target_path"
    fi
    branch_ref="refs/heads/$branch_name"
    if git -C "$script_repo_root" show-ref --verify --quiet "$branch_ref"; then
      branch_in_use=0
      while IFS= read -r worktree_record; do
        if [[ "$worktree_record" == "branch $branch_ref" ]]; then
          branch_in_use=1
          break
        fi
      done < <(git -C "$script_repo_root" worktree list --porcelain)
      if [[ "$branch_in_use" -eq 1 ]]; then
        git -C "$script_repo_root" worktree list
        die "Branch is already checked out. Reuse its listed worktree instead of forcing checkout."
      fi
      git -C "$script_repo_root" worktree add "$target_path" "$branch_name"
    else
      git -C "$script_repo_root" rev-parse --verify "$base_ref^{commit}" >/dev/null 2>&1 || die "Base ref is not a commit: $base_ref"
      git -C "$script_repo_root" worktree add -b "$branch_name" "$target_path" "$base_ref"
    fi
    show_worktree_state "$target_path"
    if [[ "$no_setup" -eq 0 ]]; then
      setup_worktree "$target_path" --environment "$environment_name"
    fi
    ;;
  reuse)
    [[ $# -ge 1 ]] || die "reuse requires an existing path."
    target_path="$1"
    shift
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --environment) environment_name="${2:?missing value for --environment}"; shift 2 ;;
        --no-setup) no_setup=1; shift ;;
        *) die "Unknown reuse option: $1" ;;
      esac
    done
    validate_environment_name "$environment_name"
    target_path="$(canonical_worktree "$target_path")"
    show_worktree_state "$target_path"
    if [[ "${no_setup:-0}" -eq 0 ]]; then
      setup_worktree "$target_path" --environment "$environment_name"
    fi
    ;;
  setup)
    target_path="$script_repo_root"
    if [[ $# -gt 0 && "$1" != --* ]]; then
      target_path="$1"
      shift
    fi
    setup_worktree "$target_path" "$@"
    ;;
  remove)
    [[ $# -eq 1 ]] || die "remove requires exactly one path."
    target_path="$(canonical_worktree "$1")"
    case "$target_path" in
      "$worktree_base"/*) ;;
      *) die "Only worktrees under $worktree_base can be removed by this command." ;;
    esac
    show_worktree_state "$target_path"
    if [[ -n "$(git -C "$target_path" status --porcelain)" ]]; then
      die "Refusing to remove a worktree with staged, unstaged, or untracked changes."
    fi
    printf 'Remove this clean worktree only? Type remove to confirm: '
    read -r confirmation
    [[ "$confirmation" == "remove" ]] || die "Removal cancelled."
    git -C "$script_repo_root" worktree remove "$target_path"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    die "Unknown command: $command_name"
    ;;
esac
