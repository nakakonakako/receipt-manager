#!/usr/bin/env bash

supabase_target_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

validate_development_supabase_target() {
  local repo_root="$1" allow_unlinked="${2:-linked}"
  local config_root="${HOME:?HOME must be set}/.config/receipt-manager/development"
  python3 "$supabase_target_script_dir/supabase-target.py" validate \
    "$repo_root" "$config_root" "$allow_unlinked"
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
  local development_ref="$1" answer
  [[ -t 0 && -t 1 ]] || {
    printf '%s\n' '[db:push] An interactive terminal is required; no push was run.' >&2
    return 2
  }
  printf '[db:push] This applies pending migrations to the allowed development project. Type the development ref to continue: '
  read -r answer
  [[ "$answer" == "$development_ref" ]] || {
    printf '%s\n' '[db:push] Confirmation did not match; no push was run.' >&2
    return 2
  }
}
