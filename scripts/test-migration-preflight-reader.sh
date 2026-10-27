#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
image="postgres:17-alpine"
container="receipt-migration-reader-test-$$-${RANDOM}"
test_password='disposable-only-test-password'
test_root="$(mktemp -d "${TMPDIR:-/tmp}/migration-reader-test.XXXXXX")"
container_started=0

cleanup() {
  if [[ "$container_started" -eq 1 ]]; then
    docker stop "$container" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT INT TERM

docker info >/dev/null 2>&1 || {
  echo "Docker daemon is required for the isolated migration reader test." >&2
  exit 1
}
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" >/dev/null

docker run --detach --rm --name "$container" \
  --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD=disposable-postgres-password \
  --env POSTGRES_DB=postgres \
  "$image" >/dev/null
container_started=1
bound_port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
export PGHOST=127.0.0.1 PGPORT="$bound_port" PGDATABASE=postgres
export PGUSER=postgres PGPASSWORD=disposable-postgres-password PGSSLMODE=disable

ready=0
for _ in $(seq 1 40); do
  if pg_isready -q; then
    ready=1
    break
  fi
  sleep 0.25
done
[[ "$ready" -eq 1 ]] || {
  echo "Disposable PostgreSQL did not become ready." >&2
  exit 1
}

psql -X -w -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE ai_quota_owner NOLOGIN NOINHERIT;
GRANT ai_quota_owner TO postgres WITH ADMIN TRUE, SET TRUE, INHERIT FALSE;
GRANT CREATE ON DATABASE postgres TO ai_quota_owner;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[]
);
INSERT INTO supabase_migrations.schema_migrations (version, statements)
VALUES ('20261027150000', ARRAY['fixture migration']);
CREATE TABLE public.business_rows (id integer PRIMARY KEY, secret text NOT NULL);
INSERT INTO public.business_rows VALUES (1, 'fixture-only-business-data');
SET ROLE ai_quota_owner;
CREATE SCHEMA ai_quota;
CREATE TABLE ai_quota.settings (
  id smallint PRIMARY KEY,
  emergency_stop boolean NOT NULL,
  configuration_value text NOT NULL
);
INSERT INTO ai_quota.settings VALUES (1, false, 'fixture-only-secret-setting');
CREATE TABLE ai_quota.requests (request_id integer PRIMARY KEY, payload text);
RESET ROLE;
REVOKE CREATE ON DATABASE postgres FROM ai_quota_owner;
CREATE FUNCTION public.migration_reader_secdef_probe()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.business_rows VALUES (2, 'must-not-be-written');
END
$function$;
REVOKE ALL ON FUNCTION public.migration_reader_secdef_probe() FROM PUBLIC;
SQL

psql -X -w -v ON_ERROR_STOP=1 \
  -f "$repo_root/supabase/migrations/20261027150000_migration_preflight_reader.sql"
if [[ "$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c \
  "SELECT coalesce(bool_or(m.set_option OR m.inherit_option), false) FROM pg_catalog.pg_auth_members AS m JOIN pg_catalog.pg_roles AS granted ON granted.oid = m.roleid JOIN pg_catalog.pg_roles AS member ON member.oid = m.member WHERE granted.rolname = 'ai_quota_owner' AND member.rolname = 'postgres'")" != f ]]; then
  echo "Migration executor retained SET access to ai_quota_owner." >&2
  exit 1
fi

psql -X -w -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE migration_preflight_login
  LOGIN PASSWORD '$test_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
GRANT migration_preflight_reader TO migration_preflight_login WITH INHERIT TRUE, SET FALSE;
ALTER ROLE migration_preflight_login SET default_transaction_read_only = on;
SQL

export PGUSER=migration_preflight_login PGPASSWORD="$test_password"
psql -X -w -v ON_ERROR_STOP=1 -f \
  "$repo_root/supabase/diagnostics/verify_migration_preflight_reader.sql"
[[ "$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c \
  'SELECT version FROM supabase_migrations.schema_migrations')" == '20261027150000' ]]
[[ "$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c \
  'SELECT count(*) FROM ai_quota.settings WHERE id = 1')" == '1' ]]
[[ "$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c 'SHOW default_transaction_read_only')" == 'on' ]]

mkdir -p "$test_root/migrations"
touch "$test_root/migrations/20261027150000_reader.sql"
python3 "$repo_root/scripts/check-migration-history.py" \
  --migrations-dir "$test_root/migrations" >/dev/null
touch "$test_root/migrations/20261028150000_pending.sql"
if python3 "$repo_root/scripts/check-migration-history.py" \
  --migrations-dir "$test_root/migrations" >"$test_root/pending.out" 2>&1; then
  echo "Pending migration was not rejected." >&2
  exit 1
fi
grep -q 'PENDING: 20261028150000' "$test_root/pending.out"
export PGUSER=postgres PGPASSWORD=disposable-postgres-password
psql -X -w -v ON_ERROR_STOP=1 -c \
  "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261028150000')" >/dev/null
export PGUSER=migration_preflight_login PGPASSWORD="$test_password"
python3 "$repo_root/scripts/check-migration-history.py" \
  --migrations-dir "$test_root/migrations" >/dev/null
export PGUSER=postgres PGPASSWORD=disposable-postgres-password
psql -X -w -v ON_ERROR_STOP=1 -c \
  "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261029150000')" >/dev/null
export PGUSER=migration_preflight_login PGPASSWORD="$test_password"
if python3 "$repo_root/scripts/check-migration-history.py" \
  --migrations-dir "$test_root/migrations" >"$test_root/remote-only.out" 2>&1; then
  echo "Remote-only migration was not rejected." >&2
  exit 1
fi
grep -q 'REMOTE_ONLY: 20261029150000' "$test_root/remote-only.out"
export PGUSER=postgres PGPASSWORD=disposable-postgres-password
psql -X -w -v ON_ERROR_STOP=1 -c \
  "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('malformed')" >/dev/null
export PGUSER=migration_preflight_login PGPASSWORD="$test_password"
if python3 "$repo_root/scripts/check-migration-history.py" \
  --migrations-dir "$test_root/migrations" >"$test_root/malformed.out" 2>&1; then
  echo "Malformed migration history was not rejected." >&2
  exit 1
fi
grep -q 'malformed version' "$test_root/malformed.out"

expect_denied() {
  local label="$1"
  shift
  if psql -X -w -v ON_ERROR_STOP=1 -c "$*" >/dev/null 2>&1; then
    echo "Reader unexpectedly succeeded: $label" >&2
    exit 1
  fi
}

expect_denied "business data SELECT" 'SELECT * FROM public.business_rows'
expect_denied "business data DML" "INSERT INTO public.business_rows VALUES (3, 'blocked')"
expect_denied "persistent DDL" 'CREATE TABLE public.reader_must_not_create (id integer)'
expect_denied "AI quota setting value SELECT" 'SELECT configuration_value FROM ai_quota.settings'
expect_denied "AI quota request data SELECT" 'SELECT * FROM ai_quota.requests'
expect_denied "SECURITY DEFINER execution" 'SELECT public.migration_reader_secdef_probe()'

export PGUSER=postgres PGPASSWORD=disposable-postgres-password
psql -X -w -v ON_ERROR_STOP=1 -c 'DELETE FROM ai_quota.settings WHERE id = 1' >/dev/null
export PGUSER=migration_preflight_login PGPASSWORD="$test_password"
missing_singleton="$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c \
  'SELECT count(*) FROM ai_quota.settings WHERE id = 1')"
if [[ "$missing_singleton" != 0 ]]; then
  echo "Reader did not detect the missing AI quota singleton row." >&2
  exit 1
fi
export PGUSER=postgres PGPASSWORD=disposable-postgres-password
psql -X -w -v ON_ERROR_STOP=1 -c \
  "INSERT INTO ai_quota.settings VALUES (1, false, 'fixture-only-secret-setting')" >/dev/null

remaining_rows="$(psql -X -w -A -t -v ON_ERROR_STOP=1 -c \
  'SELECT count(*) FROM public.business_rows')"
if [[ "$remaining_rows" != 1 ]]; then
  echo "A denied reader operation changed the disposable application table." >&2
  exit 1
fi

echo "PASS: disposable migration reader privilege checks"
