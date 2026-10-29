#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' '[db:push] Hosted Dev database migrations are applied only by shared-supabase-db.' >&2
printf '%s\n' '[db:push] No database connection or migration was attempted. Use npm run db:plan for the shared Reader-only workflow link.' >&2
exit 2
