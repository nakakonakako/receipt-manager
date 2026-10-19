#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
expected_repo_name='receipt-manager'
registration_relative='supabase-development-project-ref'

die() { printf '%s\n' "$1" >&2; exit 2; }

git_common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$git_common_dir" ]]; then
  repo_name="$(basename "$(dirname "$git_common_dir")")"
else
  repo_name="$(node -p "require('$repo_root/package.json').name" 2>/dev/null || basename "$repo_root")"
fi

[[ "$repo_name" == "$expected_repo_name" ]] || die "Refusing to run db:plan outside $expected_repo_name (current: $repo_name)."

environment_name='development'
config_root="${HOME:?HOME must be set}/.config/$expected_repo_name/$environment_name"
registration_path="$config_root/$registration_relative"

migrations_dir="$repo_root/supabase/migrations"
if [[ ! -d "$migrations_dir" ]]; then
  die 'Missing supabase/migrations in the current worktree.'
fi
local_migration_count="$(find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
[[ "$local_migration_count" -gt 0 ]] || die 'No local SQL migration files under supabase/migrations.'

if [[ ! -f "$registration_path" ]]; then
  die "Development Supabase project ref is not registered. Register once with: bash scripts/dev-env.sh register-supabase-project-ref <project-ref>"
fi
registration_mode="$(stat -c '%a' -- "$registration_path" 2>/dev/null || stat -f '%Lp' "$registration_path")"
(( (8#$registration_mode & 077) == 0 )) || die "Development project ref file must be mode 0600 or stricter: $registration_path"
registered_ref="$(tr -d '[:space:]' <"$registration_path")"
[[ "$registered_ref" =~ ^[a-z0-9]{20}$ ]] || die 'Registered development project ref must be a 20-character Supabase project ref.'

if [[ -n "${PROD_SUPABASE_PROJECT_ID:-}" && "${PROD_SUPABASE_PROJECT_ID}" == "$registered_ref" ]]; then
  die 'Refusing to use a registered ref that matches PROD_SUPABASE_PROJECT_ID.'
fi
if [[ -n "${SUPABASE_PROJECT_ID:-}" || -n "${SUPABASE_DB_URL:-}" ]]; then
  die 'Refusing to run db:plan while SUPABASE_PROJECT_ID or SUPABASE_DB_URL overrides are present.'
fi

linked_ref_path="$repo_root/supabase/.temp/project-ref"
if [[ ! -f "$linked_ref_path" ]]; then
  if [[ -d "$repo_root/supabase/.temp" ]] && find "$repo_root/supabase/.temp" -mindepth 1 -print -quit | grep -q .; then
    die 'Supabase link metadata exists without project-ref; inspect supabase/.temp manually before linking.'
  fi
  printf '[db-plan] This worktree is unlinked; linking only to the registered development project.\n'
  printf '[db-plan] Supabase CLI authentication may prompt. Keep database passwords out of command arguments and logs.\n'
  npx --yes supabase link --project-ref "$registered_ref"
  [[ -f "$linked_ref_path" ]] || die 'Supabase link did not create this worktree project ref; inspect CLI output and retry manually.'
fi
linked_ref="$(tr -d '[:space:]' <"$linked_ref_path")"
[[ -n "$linked_ref" ]] || die 'Linked Supabase project ref file is empty.'
[[ "$linked_ref" == "$registered_ref" ]] || die 'Linked Supabase project ref does not match the registered development project ref. Inspect supabase/.temp/project-ref and ~/.config/receipt-manager/development/supabase-development-project-ref without using production credentials.'

if [[ -n "${PROD_SUPABASE_PROJECT_ID:-}" ]]; then
  if [[ "${PROD_SUPABASE_PROJECT_ID}" == "$linked_ref" || "${PROD_SUPABASE_PROJECT_ID}" == "$registered_ref" ]]; then
    die 'Refusing to run db:plan while PROD_SUPABASE_PROJECT_ID matches the linked or registered ref.'
  fi
fi

supabase_bin=(npx --yes supabase)
run_supabase() {
  local log_label="$1"
  shift
  local allowed=0
  case "$log_label" in
    'migration list --linked'|'db push --linked --dry-run') allowed=1 ;;
  esac
  [[ "$allowed" -eq 1 ]] || die "Internal error: disallowed supabase invocation ($log_label)."
  "${supabase_bin[@]}" "$@"
}

list_output="$(run_supabase 'migration list --linked' migration list --linked)"
printf '%s\n' "$list_output"

pending_count=0
while IFS= read -r line; do
  line="${line//│/|}"
  [[ "$line" == *'|'* ]] || continue
  [[ "$line" =~ ^[[:space:]]*-+ ]] && continue
  local_col="$(printf '%s' "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1}')"
  remote_col="$(printf '%s' "$line" | awk -F'|' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}')"
  [[ "$local_col" =~ ^[0-9]+$ && -z "$remote_col" ]] && pending_count=$((pending_count + 1))
done <<<"$list_output"

[[ "$pending_count" -gt 0 ]] || die 'No pending migrations to plan (local migrations already match the linked remote or none are unapplied).'

printf '\n[db-plan] Pending local migrations: %s\n' "$pending_count"
printf '[db-plan] Dry-run push against linked development project (no changes applied):\n'
run_supabase 'db push --linked --dry-run' db push --linked --dry-run
