#!/usr/bin/env bash
set -euo pipefail

workflow_url='https://github.com/nakakonakako/shared-supabase-db/actions/workflows/dev-migration-plan.yml'

printf '%s\n' '[db:plan] Dev DB migration history was NOT checked locally.'
printf '%s\n' '[db:plan] Use the shared-supabase-db Reader-only workflow to check the official inventory and Dev history:'
printf '%s\n' "$workflow_url"
printf '%s\n' '[db:plan] This command does not read credentials, contact a database, or run Supabase CLI.'
