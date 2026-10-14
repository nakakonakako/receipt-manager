-- Read-only verification for the S1-06 AI quota migration.
-- Inspects migration metadata and PostgreSQL catalogs only.
\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $verify$
DECLARE
  v_migration_count bigint;
  v_claim_oid oid;
  v_renew_oid oid;
  v_finish_oid oid;
  v_proc pg_catalog.pg_proc%ROWTYPE;
  v_schema_owner name;
  v_function_owner name;
  v_table text;
  v_privilege text;
  v_role text;
BEGIN
  SELECT pg_catalog.count(*)
    INTO v_migration_count
  FROM supabase_migrations.schema_migrations
  WHERE version = '20261014120000';

  IF v_migration_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'S1-06 AI quota migration history check failed (expected exactly one row)';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_namespace
      WHERE nspname = 'ai_quota') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ai_quota schema is missing';
  END IF;

  SELECT r.rolname
    INTO v_schema_owner
  FROM pg_catalog.pg_namespace AS n
  JOIN pg_catalog.pg_roles AS r ON r.oid = n.nspowner
  WHERE n.nspname = 'ai_quota';

  IF v_schema_owner IS DISTINCT FROM 'ai_quota_owner' THEN
    RAISE EXCEPTION 'ai_quota schema owner must be ai_quota_owner';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'ai_quota_owner'
        AND rolcanlogin = false AND rolsuper = false AND rolinherit = false
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = 'ai_quota_backend'
        AND rolcanlogin = true AND rolsuper = false AND rolbypassrls = false
        AND rolinherit = false
    ) THEN
    RAISE EXCEPTION 'ai_quota role attributes do not match the least-privilege design';
  END IF;
  IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS m
      JOIN pg_catalog.pg_roles AS r ON r.oid = m.member
      WHERE r.rolname = 'ai_quota_backend'
    ) THEN
    RAISE EXCEPTION 'ai_quota_backend must not inherit or assume other database roles';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ai_quota'
        AND c.relname = 'settings'
        AND c.relkind = 'r') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ai_quota.settings is missing';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ai_quota'
        AND c.relname = 'requests'
        AND c.relkind = 'r') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ai_quota.requests is missing';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'ai_quota' AND c.relkind = 'r') IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'ai_quota must contain exactly the settings and requests tables';
  END IF;

  IF pg_catalog.has_schema_privilege('ai_quota_backend', 'ai_quota', 'USAGE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ai_quota_backend must have USAGE on schema ai_quota';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_schema_privilege(v_role, 'ai_quota', 'USAGE') THEN
      RAISE EXCEPTION 'Data API/PUBLIC role must not have USAGE on ai_quota';
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY['settings', 'requests'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(
        'ai_quota_backend', pg_catalog.format('ai_quota.%I', v_table), v_privilege
      ) THEN
        RAISE EXCEPTION 'ai_quota_backend must not have direct table privileges';
      END IF;
    END LOOP;
    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(
          v_role, pg_catalog.format('ai_quota.%I', v_table), v_privilege
        ) THEN
          RAISE EXCEPTION 'Data API/PUBLIC role must not have direct ai_quota table privileges';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  v_claim_oid := pg_catalog.to_regprocedure('ai_quota.claim_ai_request(uuid,uuid,text)');
  v_renew_oid := pg_catalog.to_regprocedure('ai_quota.renew_ai_lease(uuid)');
  v_finish_oid := pg_catalog.to_regprocedure(
    'ai_quota.finish_ai_request(uuid,boolean,boolean,bigint,bigint,bigint)'
  );

  IF v_claim_oid IS NULL OR v_renew_oid IS NULL OR v_finish_oid IS NULL THEN
    RAISE EXCEPTION 'one or more ai_quota RPCs are missing';
  END IF;

  SELECT * INTO STRICT v_proc FROM pg_catalog.pg_proc WHERE oid = v_claim_oid;
  SELECT rolname INTO v_function_owner FROM pg_catalog.pg_roles WHERE oid = v_proc.proowner;
  IF v_proc.prosecdef IS DISTINCT FROM true
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_function_owner IS DISTINCT FROM 'ai_quota_owner' THEN
    RAISE EXCEPTION 'claim_ai_request must be SECURITY DEFINER with an empty search_path';
  END IF;
  IF pg_catalog.has_function_privilege('public', v_claim_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('anon', v_claim_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('authenticated', v_claim_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('service_role', v_claim_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('ai_quota_backend', v_claim_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'claim_ai_request EXECUTE permissions do not match';
  END IF;

  SELECT * INTO STRICT v_proc FROM pg_catalog.pg_proc WHERE oid = v_renew_oid;
  SELECT rolname INTO v_function_owner FROM pg_catalog.pg_roles WHERE oid = v_proc.proowner;
  IF v_proc.prosecdef IS DISTINCT FROM true
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_function_owner IS DISTINCT FROM 'ai_quota_owner' THEN
    RAISE EXCEPTION 'renew_ai_lease must be SECURITY DEFINER with an empty search_path';
  END IF;
  IF pg_catalog.has_function_privilege('public', v_renew_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('anon', v_renew_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('authenticated', v_renew_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('service_role', v_renew_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('ai_quota_backend', v_renew_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'renew_ai_lease EXECUTE permissions do not match';
  END IF;

  SELECT * INTO STRICT v_proc FROM pg_catalog.pg_proc WHERE oid = v_finish_oid;
  SELECT rolname INTO v_function_owner FROM pg_catalog.pg_roles WHERE oid = v_proc.proowner;
  IF v_proc.prosecdef IS DISTINCT FROM true
     OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_function_owner IS DISTINCT FROM 'ai_quota_owner' THEN
    RAISE EXCEPTION 'finish_ai_request must be SECURITY DEFINER with an empty search_path';
  END IF;
  IF pg_catalog.has_function_privilege('public', v_finish_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('anon', v_finish_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('authenticated', v_finish_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('service_role', v_finish_oid, 'EXECUTE') IS DISTINCT FROM false
     OR pg_catalog.has_function_privilege('ai_quota_backend', v_finish_oid, 'EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'finish_ai_request EXECUTE permissions do not match';
  END IF;

  IF (SELECT pg_catalog.count(*)
      FROM ai_quota.settings
      WHERE id = 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'ai_quota.settings singleton row is missing';
  END IF;

  RAISE NOTICE 'PASS: S1-06 AI quota migration, schema, roles, RPC security, and grants';
END
$verify$;

COMMIT;
