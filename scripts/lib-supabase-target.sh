#!/usr/bin/env bash

supabase_target_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEVELOPMENT_DB_PUSH_CONFIRMATION_WORD="apply"

prepare_database_command_environment() {
  local repo_root="$1"
  local config_root="${HOME:?HOME must be set}/.config/receipt-manager/development"
  python3 "$supabase_target_script_dir/supabase-target.py" prepare \
    "$repo_root" "$config_root"
  ensure_supabase_db_password
}

validate_development_supabase_target() {
  local repo_root="$1" allow_unlinked="${2:-linked}"
  local config_root="${HOME:?HOME must be set}/.config/receipt-manager/development"
  python3 "$supabase_target_script_dir/supabase-target.py" validate \
    "$repo_root" "$config_root" "$allow_unlinked"
}

ensure_supabase_db_password() {
  if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
    return 0
  fi
  if [[ -t 0 && -t 1 ]]; then
    local password
    printf '[db] Enter the development database password (input hidden): ' >&2
    if ! read -r -s password </dev/tty; then
      printf '\n%s\n' '[db] Password input cancelled; no DB command was run.' >&2
      return 2
    fi
    printf '\n' >&2
    if [[ -z "$password" ]]; then
      printf '%s\n' '[db] Password input cancelled; no DB command was run.' >&2
      return 2
    fi
    export SUPABASE_DB_PASSWORD="$password"
    return 0
  fi
  printf '%s\n' \
    '[db] SUPABASE_DB_PASSWORD is not set and this session is not interactive.' \
    '[db] Run the DB command from a terminal, or set the password only for that command, for example:' \
    '[db]   read -r -s SUPABASE_DB_PASSWORD && export SUPABASE_DB_PASSWORD && npm run db:plan' \
    '[db] Do not put the password in files, logs, shell history, or CLI arguments.' >&2
  return 2
}

confirm_development_link() {
  local development_ref="$1" answer
  [[ -t 0 && -t 1 ]] || {
    printf '%s\n' '[db] Linking requires an interactive terminal.' >&2
    return 2
  }
  printf '[db] Link this worktree to the allowed development project? Type link: '
  read -r answer
  [[ "$answer" == link ]] || {
    printf '%s\n' '[db] Link cancelled.' >&2
    return 2
  }
  npx --yes supabase link --project-ref "$development_ref"
}

require_interactive_database_push() {
  [[ -t 0 && -t 1 ]] || {
    printf '%s\n' '[db:push] An interactive terminal is required; no DB request or push was run.' >&2
    return 2
  }
}

require_development_push_confirmation() {
  local answer
  [[ -t 0 && -t 1 ]] || {
    printf '%s\n' '[db:push] An interactive terminal is required; no push was run.' >&2
    return 2
  }
  printf '[db:push] This applies pending migrations to the allowed development project. Type %s to continue: ' \
    "$DEVELOPMENT_DB_PUSH_CONFIRMATION_WORD"
  read -r answer
  [[ "$answer" == "$DEVELOPMENT_DB_PUSH_CONFIRMATION_WORD" ]] || {
    printf '%s\n' '[db:push] Confirmation did not match; no push was run.' >&2
    return 2
  }
}
