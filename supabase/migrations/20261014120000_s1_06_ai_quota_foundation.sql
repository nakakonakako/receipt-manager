-- S1-06 PR 2A: private ai_quota schema, settings/requests tables, and claim/renew/finish RPCs.
-- Backend connects as role ai_quota_backend (password configured out of band; not stored here).

begin;

-- Roles (idempotent for re-apply in dev)
do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'ai_quota_owner') then
    create role ai_quota_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'ai_quota_backend') then
    create role ai_quota_backend login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$roles$;

alter role ai_quota_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
alter role ai_quota_backend login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

create schema if not exists ai_quota authorization ai_quota_owner;

revoke all on schema ai_quota from public;
revoke all on schema ai_quota from anon, authenticated, service_role;

create table ai_quota.settings (
  id smallint primary key,
  emergency_stop boolean not null default false,
  unknown_usage_breaker_threshold integer not null default 1
    constraint unknown_usage_breaker_threshold_positive check (unknown_usage_breaker_threshold > 0),
  lease_duration_seconds integer not null default 240
    constraint lease_duration_seconds_positive check (lease_duration_seconds > 0),
  monthly_cost_cap_micro_jpy bigint not null default 800000000
    constraint monthly_cost_cap_non_negative check (monthly_cost_cap_micro_jpy >= 0),
  model_id text not null default 'gemini-3-flash-preview',
  input_price_usd_per_million bigint not null default 500000,
  output_price_usd_per_million bigint not null default 3000000,
  thought_price_usd_per_million bigint not null default 3000000,
  fx_jpy_per_usd integer not null default 200
    constraint fx_jpy_per_usd_positive check (fx_jpy_per_usd > 0),
  ocr_daily_limit_per_user integer not null default 20,
  ocr_daily_limit_global integer not null default 50,
  chat_daily_limit_per_user integer not null default 20,
  chat_daily_limit_global integer not null default 50,
  csv_estimate_daily_limit_per_user integer not null default 5,
  csv_estimate_daily_limit_global integer not null default 20,
  concurrent_limit_per_user integer not null default 1,
  concurrent_limit_global integer not null default 3,
  constraint settings_singleton check (id = 1),
  constraint daily_limits_positive check (
    ocr_daily_limit_per_user > 0
    and ocr_daily_limit_global > 0
    and chat_daily_limit_per_user > 0
    and chat_daily_limit_global > 0
    and csv_estimate_daily_limit_per_user > 0
    and csv_estimate_daily_limit_global > 0
    and concurrent_limit_per_user > 0
    and concurrent_limit_global > 0
  ),
  constraint prices_non_negative check (
    input_price_usd_per_million >= 0
    and output_price_usd_per_million >= 0
    and thought_price_usd_per_million >= 0
  )
);

insert into ai_quota.settings (id) values (1)
on conflict (id) do nothing;

create table ai_quota.requests (
  request_id uuid primary key,
  user_id uuid not null,
  kind text not null,
  started_at timestamptz not null,
  jst_day date not null,
  jst_month date not null,
  status text not null default 'active',
  lease_expires_at timestamptz not null,
  input_tokens bigint,
  output_tokens bigint,
  thought_tokens bigint,
  total_tokens bigint,
  estimated_cost_micro_jpy bigint,
  usage_available boolean,
  snapshot_model_id text not null,
  snapshot_input_price_usd_per_million bigint not null,
  snapshot_output_price_usd_per_million bigint not null,
  snapshot_thought_price_usd_per_million bigint not null,
  snapshot_fx_jpy_per_usd integer not null,
  finished_at timestamptz,
  constraint requests_kind_valid check (
    kind in ('ocr', 'chat', 'csv_estimate')
  ),
  constraint requests_status_valid check (
    status in ('active', 'succeeded', 'failed', 'unknown_usage')
  ),
  constraint requests_terminal_usage_shape check (
    (status = 'active')
    or (
      status in ('succeeded', 'failed')
      and usage_available is true
      and input_tokens is not null
      and output_tokens is not null
      and thought_tokens is not null
      and total_tokens is not null
      and estimated_cost_micro_jpy is not null
      and finished_at is not null
    )
    or (
      status = 'unknown_usage'
      and usage_available is false
      and input_tokens is null
      and output_tokens is null
      and thought_tokens is null
      and total_tokens is null
      and estimated_cost_micro_jpy is null
      and finished_at is not null
    )
  )
);

create index requests_user_kind_day_idx
  on ai_quota.requests (user_id, kind, jst_day);

create index requests_kind_day_idx
  on ai_quota.requests (kind, jst_day);

create index requests_jst_month_status_idx
  on ai_quota.requests (jst_month, status);

create index requests_active_lease_idx
  on ai_quota.requests (lease_expires_at)
  where status = 'active';

alter table ai_quota.settings owner to ai_quota_owner;
alter table ai_quota.requests owner to ai_quota_owner;

revoke all on table ai_quota.settings from public, anon, authenticated, service_role;
revoke all on table ai_quota.requests from public, anon, authenticated, service_role;

create or replace function ai_quota._jst_bounds(p_now timestamptz)
returns table (jst_day date, jst_month date)
language sql
immutable
set search_path = ''
as $function$
  select
    (p_now at time zone 'Asia/Tokyo')::date as jst_day,
    pg_catalog.date_trunc(
      'month',
      p_now at time zone 'Asia/Tokyo'
    )::date as jst_month;
$function$;

alter function ai_quota._jst_bounds(timestamptz) owner to ai_quota_owner;
revoke all on function ai_quota._jst_bounds(timestamptz) from public;

create or replace function ai_quota._daily_limits(
  p_settings ai_quota.settings,
  p_kind text,
  out per_user integer,
  out global_limit integer
)
returns record
language plpgsql
immutable
set search_path = ''
as $function$
begin
  case p_kind
    when 'ocr' then
      per_user := p_settings.ocr_daily_limit_per_user;
      global_limit := p_settings.ocr_daily_limit_global;
    when 'chat' then
      per_user := p_settings.chat_daily_limit_per_user;
      global_limit := p_settings.chat_daily_limit_global;
    when 'csv_estimate' then
      per_user := p_settings.csv_estimate_daily_limit_per_user;
      global_limit := p_settings.csv_estimate_daily_limit_global;
    else
      raise exception using errcode = '22023', message = 'invalid ai request kind';
  end case;
end;
$function$;

alter function ai_quota._daily_limits(ai_quota.settings, text) owner to ai_quota_owner;
revoke all on function ai_quota._daily_limits(ai_quota.settings, text) from public;

create or replace function ai_quota._compute_cost_micro_jpy(
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_thought_tokens bigint,
  p_input_price_usd_per_million bigint,
  p_output_price_usd_per_million bigint,
  p_thought_price_usd_per_million bigint,
  p_fx_jpy_per_usd integer
)
returns bigint
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.ceil(
    (
      coalesce(p_input_tokens, 0)::numeric * p_input_price_usd_per_million
      + coalesce(p_output_tokens, 0)::numeric * p_output_price_usd_per_million
      + coalesce(p_thought_tokens, 0)::numeric * p_thought_price_usd_per_million
    ) * p_fx_jpy_per_usd::numeric / 1000000
  )::bigint;
$function$;

alter function ai_quota._compute_cost_micro_jpy(
  bigint, bigint, bigint, bigint, bigint, bigint, integer
) owner to ai_quota_owner;
revoke all on function ai_quota._compute_cost_micro_jpy(
  bigint, bigint, bigint, bigint, bigint, bigint, integer
) from public;

create or replace function ai_quota._count_daily(
  p_user_id uuid,
  p_kind text,
  p_jst_day date
)
returns table (user_count bigint, global_count bigint)
language sql
stable
set search_path = ''
as $function$
  select
    pg_catalog.count(*) filter (where r.user_id = p_user_id) as user_count,
    pg_catalog.count(*) as global_count
  from ai_quota.requests as r
  where r.kind = p_kind
    and r.jst_day = p_jst_day
    and r.status in ('active', 'succeeded', 'failed', 'unknown_usage');
$function$;

alter function ai_quota._count_daily(uuid, text, date) owner to ai_quota_owner;
revoke all on function ai_quota._count_daily(uuid, text, date) from public;

create or replace function ai_quota._count_active_leases(
  p_user_id uuid,
  p_now timestamptz
)
returns table (user_active bigint, global_active bigint)
language sql
stable
set search_path = ''
as $function$
  select
    pg_catalog.count(*) filter (where r.user_id = p_user_id) as user_active,
    pg_catalog.count(*) as global_active
  from ai_quota.requests as r
  where r.status = 'active'
    and r.lease_expires_at > p_now;
$function$;

alter function ai_quota._count_active_leases(uuid, timestamptz) owner to ai_quota_owner;
revoke all on function ai_quota._count_active_leases(uuid, timestamptz) from public;

create or replace function ai_quota._measured_month_cost_micro_jpy(p_jst_month date)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.sum(r.estimated_cost_micro_jpy),
    0::bigint
  )
  from ai_quota.requests as r
  where r.jst_month = p_jst_month
    and r.status in ('succeeded', 'failed');
$function$;

alter function ai_quota._measured_month_cost_micro_jpy(date) owner to ai_quota_owner;
revoke all on function ai_quota._measured_month_cost_micro_jpy(date) from public;

create or replace function ai_quota._unknown_usage_count()
returns bigint
language sql
stable
set search_path = ''
as $function$
  -- Unknown usage remains a global stop until an operator reconciles it.
  select pg_catalog.count(*)
  from ai_quota.requests as r
  where r.status = 'unknown_usage';
$function$;

alter function ai_quota._unknown_usage_count() owner to ai_quota_owner;
revoke all on function ai_quota._unknown_usage_count() from public;

create or replace function ai_quota.claim_ai_request(
  p_request_id uuid,
  p_user_id uuid,
  p_kind text
)
returns table (
  outcome text,
  reject_reason text,
  request_id uuid,
  user_id uuid,
  kind text,
  status text,
  lease_expires_at timestamptz,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings ai_quota.settings%rowtype;
  v_now timestamptz;
  v_jst_day date;
  v_jst_month date;
  v_existing ai_quota.requests%rowtype;
  v_per_user integer;
  v_global_limit integer;
  v_daily_user_count bigint;
  v_daily_global_count bigint;
  v_active_user_count bigint;
  v_active_global_count bigint;
  v_month_cost bigint;
  v_unknown_count bigint;
begin
  if p_request_id is null or p_user_id is null or p_kind is null then
    raise exception using errcode = '22023', message = 'request id, user id, and kind are required';
  end if;
  if p_kind not in ('ocr', 'chat', 'csv_estimate') then
    raise exception using errcode = '22023', message = 'invalid ai request kind';
  end if;

  select s.* into v_settings
  from ai_quota.settings as s
  where s.id = 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ai quota settings missing';
  end if;

  v_now := pg_catalog.clock_timestamp();
  select b.jst_day, b.jst_month
    into v_jst_day, v_jst_month
  from ai_quota._jst_bounds(v_now) as b;

  select r.* into v_existing
  from ai_quota.requests as r
  where r.request_id = p_request_id;

  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.kind is distinct from p_kind then
      outcome := 'rejected';
      reject_reason := 'idempotency_conflict';
      request_id := v_existing.request_id;
      user_id := v_existing.user_id;
      kind := v_existing.kind;
      status := v_existing.status;
      lease_expires_at := v_existing.lease_expires_at;
      started_at := v_existing.started_at;
      return next;
      return;
    end if;

    outcome := 'idempotent';
    reject_reason := null;
    request_id := v_existing.request_id;
    user_id := v_existing.user_id;
    kind := v_existing.kind;
    status := v_existing.status;
    lease_expires_at := v_existing.lease_expires_at;
    started_at := v_existing.started_at;
    return next;
    return;
  end if;

  if v_settings.emergency_stop then
    outcome := 'rejected';
    reject_reason := 'emergency_stop';
    return next;
    return;
  end if;

  -- Expired workers may have consumed tokens before crashing. Record them as
  -- unknown and trip the breaker instead of silently freeing only concurrency.
  update ai_quota.requests as r
  set status = 'unknown_usage',
      usage_available = false,
      input_tokens = null,
      output_tokens = null,
      thought_tokens = null,
      total_tokens = null,
      estimated_cost_micro_jpy = null,
      finished_at = v_now
  where r.status = 'active'
    and r.lease_expires_at <= v_now;

  v_unknown_count := ai_quota._unknown_usage_count();
  if v_unknown_count >= v_settings.unknown_usage_breaker_threshold then
    outcome := 'rejected';
    reject_reason := 'unknown_usage_breaker';
    return next;
    return;
  end if;

  select l.per_user, l.global_limit
    into v_per_user, v_global_limit
  from ai_quota._daily_limits(v_settings, p_kind) as l;

  select c.user_count, c.global_count
    into v_daily_user_count, v_daily_global_count
  from ai_quota._count_daily(p_user_id, p_kind, v_jst_day) as c;

  if v_daily_user_count >= v_per_user then
    outcome := 'rejected';
    reject_reason := 'daily_limit_user';
    return next;
    return;
  end if;

  if v_daily_global_count >= v_global_limit then
    outcome := 'rejected';
    reject_reason := 'daily_limit_global';
    return next;
    return;
  end if;

  select a.user_active, a.global_active
    into v_active_user_count, v_active_global_count
  from ai_quota._count_active_leases(p_user_id, v_now) as a;

  if v_active_user_count >= v_settings.concurrent_limit_per_user then
    outcome := 'rejected';
    reject_reason := 'concurrency_user';
    return next;
    return;
  end if;

  if v_active_global_count >= v_settings.concurrent_limit_global then
    outcome := 'rejected';
    reject_reason := 'concurrency_global';
    return next;
    return;
  end if;

  v_month_cost := ai_quota._measured_month_cost_micro_jpy(v_jst_month);
  if v_month_cost >= v_settings.monthly_cost_cap_micro_jpy then
    outcome := 'rejected';
    reject_reason := 'monthly_cost_cap';
    return next;
    return;
  end if;

  insert into ai_quota.requests as r (
    request_id,
    user_id,
    kind,
    started_at,
    jst_day,
    jst_month,
    status,
    lease_expires_at,
    snapshot_model_id,
    snapshot_input_price_usd_per_million,
    snapshot_output_price_usd_per_million,
    snapshot_thought_price_usd_per_million,
    snapshot_fx_jpy_per_usd
  ) values (
    p_request_id,
    p_user_id,
    p_kind,
    v_now,
    v_jst_day,
    v_jst_month,
    'active',
    v_now + pg_catalog.make_interval(secs => v_settings.lease_duration_seconds),
    v_settings.model_id,
    v_settings.input_price_usd_per_million,
    v_settings.output_price_usd_per_million,
    v_settings.thought_price_usd_per_million,
    v_settings.fx_jpy_per_usd
  )
  returning r.* into v_existing;

  outcome := 'granted';
  reject_reason := null;
  request_id := v_existing.request_id;
  user_id := v_existing.user_id;
  kind := v_existing.kind;
  status := v_existing.status;
  lease_expires_at := v_existing.lease_expires_at;
  started_at := v_existing.started_at;
  return next;
end;
$function$;

create or replace function ai_quota.renew_ai_lease(p_request_id uuid)
returns table (
  outcome text,
  reject_reason text,
  request_id uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings ai_quota.settings%rowtype;
  v_now timestamptz;
  v_row ai_quota.requests%rowtype;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'request id is required';
  end if;

  select s.* into v_settings
  from ai_quota.settings as s
  where s.id = 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ai quota settings missing';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select r.* into v_row
  from ai_quota.requests as r
  where r.request_id = p_request_id
  for update;

  if not found then
    outcome := 'rejected';
    reject_reason := 'request_not_found';
    return next;
    return;
  end if;

  if v_row.status <> 'active' then
    outcome := 'rejected';
    reject_reason := 'not_active';
    request_id := v_row.request_id;
    lease_expires_at := v_row.lease_expires_at;
    return next;
    return;
  end if;

  if v_row.lease_expires_at <= v_now then
    outcome := 'rejected';
    reject_reason := 'lease_expired';
    request_id := v_row.request_id;
    lease_expires_at := v_row.lease_expires_at;
    return next;
    return;
  end if;

  update ai_quota.requests as r
  set lease_expires_at = v_now + pg_catalog.make_interval(secs => v_settings.lease_duration_seconds)
  where r.request_id = p_request_id
  returning r.lease_expires_at into lease_expires_at;

  outcome := 'renewed';
  reject_reason := null;
  request_id := p_request_id;
  return next;
end;
$function$;

create or replace function ai_quota.finish_ai_request(
  p_request_id uuid,
  p_succeeded boolean,
  p_usage_available boolean,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_thought_tokens bigint
)
returns table (
  outcome text,
  reject_reason text,
  request_id uuid,
  status text,
  estimated_cost_micro_jpy bigint,
  finished_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings ai_quota.settings%rowtype;
  v_now timestamptz;
  v_row ai_quota.requests%rowtype;
  v_total bigint;
  v_cost bigint;
begin
  if p_request_id is null or p_succeeded is null or p_usage_available is null then
    raise exception using errcode = '22023', message = 'request id, result, and usage availability are required';
  end if;

  select s.* into v_settings
  from ai_quota.settings as s
  where s.id = 1
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ai quota settings missing';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select r.* into v_row
  from ai_quota.requests as r
  where r.request_id = p_request_id
  for update;

  if not found then
    outcome := 'rejected';
    reject_reason := 'request_not_found';
    return next;
    return;
  end if;

  if v_row.status in ('succeeded', 'failed') then
    if p_usage_available then
      if (v_row.status = 'succeeded') is distinct from p_succeeded
         or v_row.usage_available is distinct from true
         or v_row.input_tokens is distinct from p_input_tokens
         or v_row.output_tokens is distinct from p_output_tokens
         or v_row.thought_tokens is distinct from p_thought_tokens then
        outcome := 'rejected';
        reject_reason := 'finish_conflict';
        request_id := v_row.request_id;
        status := v_row.status;
        estimated_cost_micro_jpy := v_row.estimated_cost_micro_jpy;
        finished_at := v_row.finished_at;
        return next;
        return;
      end if;
    else
      outcome := 'rejected';
      reject_reason := 'finish_conflict';
      request_id := v_row.request_id;
      status := v_row.status;
      estimated_cost_micro_jpy := v_row.estimated_cost_micro_jpy;
      finished_at := v_row.finished_at;
      return next;
      return;
    end if;

    outcome := 'idempotent';
    reject_reason := null;
    request_id := v_row.request_id;
    status := v_row.status;
    estimated_cost_micro_jpy := v_row.estimated_cost_micro_jpy;
    finished_at := v_row.finished_at;
    return next;
    return;
  end if;

  if v_row.status = 'unknown_usage' and not p_usage_available then
    outcome := 'idempotent';
    reject_reason := null;
    request_id := v_row.request_id;
    status := v_row.status;
    estimated_cost_micro_jpy := null;
    finished_at := v_row.finished_at;
    return next;
    return;
  end if;

  if v_row.status not in ('active', 'unknown_usage') then
    outcome := 'rejected';
    reject_reason := 'not_active';
    request_id := v_row.request_id;
    status := v_row.status;
    estimated_cost_micro_jpy := v_row.estimated_cost_micro_jpy;
    finished_at := v_row.finished_at;
    return next;
    return;
  end if;

  if not p_usage_available then
    if p_input_tokens is not null or p_output_tokens is not null or p_thought_tokens is not null then
      raise exception using errcode = '22023', message = 'token counts must be null when usage is unavailable';
    end if;
    update ai_quota.requests as r
    set status = 'unknown_usage',
        usage_available = false,
        input_tokens = null,
        output_tokens = null,
        thought_tokens = null,
        total_tokens = null,
        estimated_cost_micro_jpy = null,
        finished_at = v_now
    where r.request_id = p_request_id
    returning r.status, r.estimated_cost_micro_jpy, r.finished_at
      into status, estimated_cost_micro_jpy, finished_at;

    outcome := 'finished';
    reject_reason := null;
    request_id := p_request_id;
    return next;
    return;
  end if;

  if p_input_tokens is null or p_output_tokens is null or p_thought_tokens is null then
    raise exception using errcode = '22023', message = 'token counts are required when usage is available';
  end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or p_thought_tokens < 0
     or p_input_tokens > 1000000000000
     or p_output_tokens > 1000000000000
     or p_thought_tokens > 1000000000000 then
    raise exception using errcode = '22023', message = 'token counts are outside the supported range';
  end if;

  v_total := p_input_tokens + p_output_tokens + p_thought_tokens;
  v_cost := ai_quota._compute_cost_micro_jpy(
    p_input_tokens,
    p_output_tokens,
    p_thought_tokens,
    v_row.snapshot_input_price_usd_per_million,
    v_row.snapshot_output_price_usd_per_million,
    v_row.snapshot_thought_price_usd_per_million,
    v_row.snapshot_fx_jpy_per_usd
  );

  update ai_quota.requests as r
  set status = case when p_succeeded then 'succeeded' else 'failed' end,
      usage_available = true,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      thought_tokens = p_thought_tokens,
      total_tokens = v_total,
      estimated_cost_micro_jpy = v_cost,
      finished_at = v_now
  where r.request_id = p_request_id
  returning r.status, r.estimated_cost_micro_jpy, r.finished_at
    into status, estimated_cost_micro_jpy, finished_at;

  outcome := 'finished';
  reject_reason := null;
  request_id := p_request_id;
  return next;
end;
$function$;

alter function ai_quota.claim_ai_request(uuid, uuid, text) owner to ai_quota_owner;
alter function ai_quota.renew_ai_lease(uuid) owner to ai_quota_owner;
alter function ai_quota.finish_ai_request(uuid, boolean, boolean, bigint, bigint, bigint) owner to ai_quota_owner;

revoke all on function ai_quota.claim_ai_request(uuid, uuid, text) from public;
revoke all on function ai_quota.renew_ai_lease(uuid) from public;
revoke all on function ai_quota.finish_ai_request(uuid, boolean, boolean, bigint, bigint, bigint) from public;
revoke all on function ai_quota.claim_ai_request(uuid, uuid, text) from anon, authenticated, service_role;
revoke all on function ai_quota.renew_ai_lease(uuid) from anon, authenticated, service_role;
revoke all on function ai_quota.finish_ai_request(uuid, boolean, boolean, bigint, bigint, bigint)
  from anon, authenticated, service_role;

grant usage on schema ai_quota to ai_quota_backend;
grant execute on function ai_quota.claim_ai_request(uuid, uuid, text) to ai_quota_backend;
grant execute on function ai_quota.renew_ai_lease(uuid) to ai_quota_backend;
grant execute on function ai_quota.finish_ai_request(uuid, boolean, boolean, bigint, bigint, bigint) to ai_quota_backend;

commit;
