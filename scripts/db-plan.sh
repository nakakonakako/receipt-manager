#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
source "$script_dir/lib-supabase-target.sh"

git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$git_common_dir" ]]; then
  repo_name="$(basename "$(dirname "$git_common_dir")")"
else
  repo_name="$(node -p "require('$repo_root/package.json').name" 2>/dev/null || basename "$repo_root")"
fi
[[ "$repo_name" == 'receipt-manager' ]] || {
  printf '%s\n' '[db:plan] Refusing to run outside receipt-manager.' >&2
  exit 2
}

migrations_dir="$repo_root/supabase/migrations"
[[ -d "$migrations_dir" ]] || {
  printf '%s\n' '[db:plan] Missing supabase/migrations in this worktree.' >&2
  exit 2
}
if ! find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print -quit | grep -q .; then
  printf '%s\n' '[db:plan] No local SQL migration files under supabase/migrations.' >&2
  exit 2
fi

development_ref="$(validate_development_supabase_target "$repo_root" allow-unlinked)"
if [[ ! -f "$repo_root/supabase/.temp/project-ref" ]]; then
  confirm_development_link "$development_ref"
  development_ref="$(validate_development_supabase_target "$repo_root")"
fi

printf '%s\n' '[db:plan] Migration status for the validated development project:'
npx --yes supabase migration list --linked
printf '\n%s\n' '[db:plan] Dry-run only; no migrations are applied:'
npx --yes supabase db push --linked --dry-run
