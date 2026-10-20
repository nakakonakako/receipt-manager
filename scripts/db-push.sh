#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
cd -- "$repo_root"
source "$script_dir/lib-supabase-target.sh"
prepare_database_command_environment "$repo_root"

git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
repo_name="$(basename "$(dirname "$git_common_dir")")"
[[ "$repo_name" == 'receipt-manager' ]] || {
  printf '%s\n' '[db:push] Refusing to run outside receipt-manager.' >&2
  exit 2
}

migrations_dir="$repo_root/supabase/migrations"
[[ -d "$migrations_dir" ]] || {
  printf '%s\n' '[db:push] Missing supabase/migrations in this worktree.' >&2
  exit 2
}
if ! find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print -quit | grep -q .; then
  printf '%s\n' '[db:push] No local SQL migration files under supabase/migrations.' >&2
  exit 2
fi

development_ref="$(validate_development_supabase_target "$repo_root")"
require_interactive_database_push
printf '%s\n' '[db:push] Review current migration status:'
npx --yes supabase migration list --linked
printf '\n%s\n' '[db:push] Review the apply plan (dry-run; no changes applied):'
npx --yes supabase db push --linked --dry-run
require_development_push_confirmation

# Recheck immediately before the write in case the link or local settings changed
# while the migration plan was being reviewed.
development_ref="$(validate_development_supabase_target "$repo_root")"
npx --yes supabase db push --linked
