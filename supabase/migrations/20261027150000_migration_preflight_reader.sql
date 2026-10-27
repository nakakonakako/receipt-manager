-- A dedicated, non-login group role for production migration preflight reads.
-- A separate LOGIN role and password are provisioned only during the later
-- production cutover; credentials are never stored in a migration.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $preflight$
begin
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'migration_preflight_reader'
  ) then
    raise exception 'migration_preflight_reader already exists; review its privileges before applying this migration';
  end if;

  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'Supabase migration history table is unavailable';
  end if;
end
$preflight$;

create role migration_preflight_reader
  nologin
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  noinherit;

grant connect on database postgres to migration_preflight_reader;
grant usage on schema supabase_migrations to migration_preflight_reader;
grant select (version)
  on table supabase_migrations.schema_migrations
  to migration_preflight_reader;

commit;
