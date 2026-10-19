#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$git_common_dir" ]]; then
  repo_name="$(basename "$(dirname "$git_common_dir")")"
else
  repo_name="$(basename "$repo_root")"
fi
environment_name="development"
config_root="${HOME:?HOME must be set}/.config/$repo_name/$environment_name"
standard_checkout="$HOME/web/$repo_name"
env_paths=(.env frontend/.env frontend/.env.local backend/.env)

die() { printf '%s\n' "$1" >&2; exit 2; }
mode_of() { stat -c '%a' -- "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
has_private_mode() {
  local mode
  mode="$(mode_of "$1")" || return 1
  (( (8#$mode & 077) == 0 ))
}

env_keys() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  awk '
    /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
      line=$0
      sub(/^[[:space:]]*/, "", line)
      sub(/^export[[:space:]]+/, "", line)
      sub(/[[:space:]]*=.*/, "", line)
      gsub(/[[:space:]]/, "", line)
      if (line != "") print line
    }
  ' "$file" | sort -u
}

show_key_overlap() {
  local first="$1" second="$2" first_keys second_keys overlap
  first_keys="$(env_keys "$first")"
  second_keys="$(env_keys "$second")"
  overlap="$(comm -12 <(printf '%s\n' "$first_keys" | sed '/^$/d') <(printf '%s\n' "$second_keys" | sed '/^$/d'))"
  if [[ -n "$overlap" ]]; then
    printf 'Vite override conflict (variable names only):\n%s\n' "$overlap"
    return 1
  fi
  return 0
}

print_migration_plan() {
  local source destination source_mode destination_state
  printf 'Source checkout: %s\nCommon settings: %s\n' "$standard_checkout" "$config_root"
  for relative_path in "${env_paths[@]}"; do
    source="$standard_checkout/$relative_path"
    destination="$config_root/$relative_path"
    if [[ -f "$source" && ! -L "$source" ]]; then
      source_mode="$(mode_of "$source")"
      if [[ -e "$destination" || -L "$destination" ]]; then
        destination_state='CONFLICT (will not overwrite)'
      else
        destination_state='available'
      fi
      printf 'SOURCE %s (mode %s) -> DEST %s [%s]\n' "$source" "$source_mode" "$destination" "$destination_state"
    elif [[ -e "$source" || -L "$source" ]]; then
      printf 'SOURCE %s [not a regular file; will not copy]\n' "$source"
    else
      printf 'SOURCE %s [not present]\n' "$source"
    fi
  done
  if [[ -f "$standard_checkout/frontend/.env" && -f "$standard_checkout/frontend/.env.local" ]]; then
    show_key_overlap "$standard_checkout/frontend/.env" "$standard_checkout/frontend/.env.local" || true
  fi
  printf 'No environment values are displayed. Only explicitly selected files are copied; source files are retained.\n'
}

copy_without_overwrite() {
  local source="$1" destination="$2" directory
  directory="$(dirname "$destination")"
  mkdir -p "$directory"
  chmod 700 "$directory"
  if ! (set -o noclobber; : > "$destination") 2>/dev/null; then
    die "Refusing to overwrite existing destination: $destination"
  fi
  if ! cat -- "$source" > "$destination"; then
    rm -f -- "$destination"
    die "Copy failed for $source"
  fi
  chmod 600 "$destination"
  printf 'Copied %s -> %s (mode 600); source retained\n' "$source" "$destination"
}

migrate_env() {
  local action="${1:-}"; shift || true
  case "$action" in
    --preview)
      [[ $# -eq 0 ]] || die 'migrate --preview takes no file arguments.'
      print_migration_plan
      ;;
    --apply)
      [[ $# -gt 0 ]] || die 'Choose one or more files from the preview; no files are copied implicitly.'
      local selected=() candidate source destination answer
      print_migration_plan
      for candidate in "$@"; do
        case " ${env_paths[*]} " in *" $candidate "*) ;; *) die "Unsupported environment file: $candidate" ;; esac
        for prior in "${selected[@]}"; do [[ "$prior" != "$candidate" ]] || die "File selected more than once: $candidate"; done
        source="$standard_checkout/$candidate"
        destination="$config_root/$candidate"
        [[ -f "$source" && ! -L "$source" ]] || die "Source is not a regular file: $source"
        [[ ! -e "$destination" && ! -L "$destination" ]] || die "Destination already exists; no files copied: $destination"
        selected+=("$candidate")
      done
      printf 'Confirm these selected files contain development-only credentials (never production credentials for Cursor workers). Type copy to continue: '
      read -r answer
      [[ "$answer" == copy ]] || die 'Migration cancelled.'
      umask 077
      mkdir -p "$config_root"
      chmod 700 "$config_root"
      for candidate in "${selected[@]}"; do
        copy_without_overwrite "$standard_checkout/$candidate" "$config_root/$candidate"
      done
      ;;
    *) die 'Use migrate --preview or migrate --apply <explicit-file> [<explicit-file> ...].' ;;
  esac
}

link_configured_file() {
  local relative_path="$1" target_path="$repo_root/$relative_path" source_path="$config_root/$relative_path"
  [[ -f "$source_path" ]] || return 0
  [[ ! -L "$source_path" ]] || die "Common environment source must be a regular file: $source_path"
  has_private_mode "$config_root" || die "Environment directory permissions must be 0700 or stricter: $config_root"
  has_private_mode "$source_path" || die "Environment file permissions must be 0600 or stricter: $source_path (run the explicit migration or chmod it after review)"
  if [[ -L "$target_path" ]]; then
    [[ -e "$target_path" ]] || die "Broken environment symlink; inspect before changing: $target_path"
    [[ "$(readlink "$target_path")" == "$source_path" ]] || die "Refusing to replace a different environment symlink: $target_path"
  elif [[ -e "$target_path" ]]; then
    if cmp -s -- "$target_path" "$source_path"; then
      printf '[dev-env] Keeping existing file with identical settings: %s\n' "$relative_path"
    else
      die "Existing file differs from common settings; refusing to overwrite: $target_path"
    fi
  else
    mkdir -p "$(dirname "$target_path")"
    ln -s "$source_path" "$target_path"
    printf '[dev-env] Linked %s\n' "$relative_path"
  fi
}

prepare() {
  for relative_path in "${env_paths[@]}"; do link_configured_file "$relative_path"; done
  local env_file="$repo_root/frontend/.env" local_file="$repo_root/frontend/.env.local"
  if [[ -f "$env_file" && -f "$local_file" ]]; then
    show_key_overlap "$env_file" "$local_file" || die 'Resolve the frontend/.env.local override before starting Vite. Values are never displayed.'
  fi
  local all_keys
  all_keys="$( { env_keys "$env_file"; env_keys "$local_file"; env_keys "$repo_root/frontend/.env.development"; env_keys "$repo_root/frontend/.env.development.local"; } | sort -u )"
  for key in VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY; do
    if ! grep -Fxq "$key" <<<"$all_keys" && [[ -z "${!key:-}" ]]; then
      printf '[dev-env] Required setting is missing: %s (value hidden)\n' "$key" >&2
      printf '[dev-env] Review existing files with: bash scripts/dev-env.sh migrate --preview\n' >&2
      printf '[dev-env] Copy only reviewed development files with: bash scripts/dev-env.sh migrate --apply <relative-file> [...]\n' >&2
      exit 2
    fi
  done
}

case "${1:-}" in
  migrate) shift; migrate_env "$@" ;;
  prepare) [[ $# -eq 1 ]] || die 'prepare takes no arguments.'; prepare ;;
  *) die 'Usage: scripts/dev-env.sh prepare | migrate --preview | migrate --apply <explicit-relative-file> [...]' ;;
esac
