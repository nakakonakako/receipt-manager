#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# This runner never starts/resets a developer Supabase project. Use a fresh,
# disposable PostgreSQL database dedicated to this test suite.
# shellcheck source=scripts/lib/ai-quota-test-db-url.sh
source "${ROOT}/scripts/lib/ai-quota-test-db-url.sh"

if ! psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT pg_catalog.to_regnamespace('ai_quota') IS NULL" | grep -qx t; then
  echo "Refusing to run: ai_quota_test must be fresh and have no ai_quota schema." >&2
  exit 1
fi

echo "Preparing Supabase API roles in the disposable database..."
psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/ai_quota/setup.sql

echo "Applying the AI quota migration to the disposable database..."
psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261014120000_s1_06_ai_quota_foundation.sql
psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261014120000') ON CONFLICT (version) DO NOTHING"

echo "Running ai_quota SQL tests..."
psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/ai_quota/test_ai_quota.sql

echo "Running read-only integrity diagnostic..."
psql "$AI_QUOTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f supabase/diagnostics/verify_s1_06_ai_quota_integrity.sql

echo "Running concurrent claim probe..."
bash supabase/tests/ai_quota/test_concurrent_claim.sh

echo "All ai_quota SQL tests passed."
