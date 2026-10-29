#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
workflow_url='https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml'
migrations_dir="$repo_root/supabase/migrations"

printf '%s\n' '[db:list] Local receipt-manager migration files only; this is NOT the Dev DB history or shared inventory.'
if ! find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -print -quit | grep -q .; then
  printf '%s\n' '[db:list] No local SQL migration files found.'
else
  find "$migrations_dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort
fi
printf '\n%s\n' '[db:list] Check the official shared inventory and Dev DB history with the Reader-only workflow:'
printf '%s\n' "$workflow_url"
printf '%s\n' '[db:list] No database was queried and no Supabase CLI was run.'
