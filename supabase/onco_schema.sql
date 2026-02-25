-- Oncology MVP schema for Supabase/Postgres
-- Apply in Supabase SQL Editor before switching ONCO_DB_PROVIDER=supabase

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table if not exists public.guidelines (
  id text primary key,
  code integer,
  version integer,
  name text not null,
  publish_date date,
  status integer not null,
  apply_status text,
  source_url text not null,
  pdf_url text not null,
  is_oncology boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_guidelines_publish_date on public.guidelines (publish_date desc nulls last);
create index if not exists idx_guidelines_status on public.guidelines (status);
create index if not exists idx_guidelines_code on public.guidelines (code);
create index if not exists idx_guidelines_name_trgm on public.guidelines using gin (name gin_trgm_ops);

create table if not exists public.guideline_sections (
  guideline_id text not null references public.guidelines(id) on delete cascade,
  section_id text not null,
  section_title text not null,
  section_html text not null,
  section_text text not null,
  created_at timestamptz not null default now(),
  primary key (guideline_id, section_id)
);

create index if not exists idx_sections_guideline on public.guideline_sections (guideline_id);
create index if not exists idx_sections_section_id on public.guideline_sections (section_id);

create table if not exists public.recommendation_chunks (
  chunk_id text primary key,
  guideline_id text not null references public.guidelines(id) on delete cascade,
  section_id text not null,
  chunk_text text not null,
  tags jsonb not null default '[]'::jsonb,
  evidence_level text,
  source_anchor text,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(chunk_text, '') || ' ' || coalesce(tags::text, ''))
  ) stored
);

create index if not exists idx_chunks_guideline on public.recommendation_chunks (guideline_id);
create index if not exists idx_chunks_section on public.recommendation_chunks (section_id);
create index if not exists idx_chunks_created on public.recommendation_chunks (created_at desc);
create index if not exists idx_chunks_search_vector on public.recommendation_chunks using gin (search_vector);

create table if not exists public.cases (
  case_id text primary key,
  source text,
  diagnosis text not null,
  stage text,
  biomarkers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.case_events (
  event_id text primary key,
  case_id text not null references public.cases(case_id) on delete cascade,
  event_date date not null,
  event_type text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_events_case on public.case_events(case_id);
create index if not exists idx_case_events_date on public.case_events(event_date);

create table if not exists public.validation_runs (
  run_id text primary key,
  case_id text references public.cases(case_id) on delete set null,
  as_of_date date not null,
  result_json jsonb not null,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_validation_created on public.validation_runs(created_at desc);

create table if not exists public.doctor_feedback (
  feedback_id text primary key,
  validation_run_id text not null references public.validation_runs(run_id) on delete cascade,
  rating text not null check (rating in ('up', 'down')),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_validation_run on public.doctor_feedback(validation_run_id);
create index if not exists idx_feedback_created on public.doctor_feedback(created_at desc);

create table if not exists public.benchmark_runs (
  bench_id text primary key,
  dataset_version text not null,
  metrics_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_benchmark_created on public.benchmark_runs(created_at desc);

create table if not exists public.landing_leads (
  lead_id text primary key,
  full_name text not null,
  work_email text not null,
  clinic_name text not null,
  role text not null,
  monthly_cases integer not null,
  message text not null default '',
  consent boolean not null default true,
  source text not null default 'landing',
  created_at timestamptz not null default now()
);

create index if not exists idx_landing_leads_created on public.landing_leads(created_at desc);
create index if not exists idx_landing_leads_email on public.landing_leads(work_email);

create table if not exists public.trials_cache (
  query_key text primary key,
  fetched_at timestamptz not null,
  payload_json jsonb not null
);

create table if not exists public.source_documents (
  document_id text primary key,
  source text not null,
  title text not null,
  url text not null,
  version text,
  published_at date,
  access_level text not null default 'open',
  ingest_status text not null,
  http_status integer,
  failure_reason text,
  content_text text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  keywords text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(keywords, '')), 'C')
  ) stored
);

create index if not exists idx_source_documents_source on public.source_documents(source);
create index if not exists idx_source_documents_status on public.source_documents(ingest_status);
create index if not exists idx_source_documents_updated on public.source_documents(updated_at desc);
create index if not exists idx_source_documents_search_vector on public.source_documents using gin (search_vector);

create table if not exists public.source_sync_logs (
  log_id text primary key,
  source text not null,
  url text not null,
  attempted_at timestamptz not null,
  status text not null,
  http_status integer,
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_source_sync_logs_source on public.source_sync_logs(source);
create index if not exists idx_source_sync_logs_attempted on public.source_sync_logs(attempted_at desc);

create or replace function public.onco_get_guideline_counts()
returns table(guidelines bigint, chunks bigint)
language sql
stable
as $$
  select
    (select count(*) from public.guidelines) as guidelines,
    (select count(*) from public.recommendation_chunks) as chunks;
$$;

create or replace function public.onco_search_recommendation_chunks(
  query_text text,
  guideline_ids text[] default null,
  section_ids text[] default null,
  as_of_date date default null,
  result_limit integer default 12
)
returns table (
  chunk_id text,
  guideline_id text,
  guideline_name text,
  section_id text,
  section_title text,
  chunk_text text,
  tags jsonb,
  evidence_level text,
  source_anchor text,
  document_url text,
  document_version text,
  source text,
  access_mode text,
  score double precision
)
language sql
stable
as $$
  with ts as (
    select plainto_tsquery('simple', coalesce(query_text, '')) as q
  )
  select
    rc.chunk_id,
    rc.guideline_id,
    g.name as guideline_name,
    rc.section_id,
    coalesce(gs.section_title, 'Источник') as section_title,
    rc.chunk_text,
    rc.tags,
    rc.evidence_level,
    rc.source_anchor,
    g.source_url as document_url,
    g.publish_date::text as document_version,
    'minzdrav'::text as source,
    'local'::text as access_mode,
    (1 - ts_rank_cd(rc.search_vector, ts.q))::double precision as score
  from public.recommendation_chunks rc
  join public.guidelines g on g.id = rc.guideline_id
  left join public.guideline_sections gs
    on gs.guideline_id = rc.guideline_id and gs.section_id = rc.section_id,
  ts
  where
    rc.search_vector @@ ts.q
    and (guideline_ids is null or cardinality(guideline_ids) = 0 or rc.guideline_id = any(guideline_ids))
    and (section_ids is null or cardinality(section_ids) = 0 or rc.section_id = any(section_ids))
    and (as_of_date is null or g.publish_date is null or g.publish_date <= as_of_date)
  order by ts_rank_cd(rc.search_vector, ts.q) desc, rc.created_at desc
  limit greatest(1, least(coalesce(result_limit, 12), 50));
$$;

create or replace function public.onco_search_recommendation_chunks_like(
  query_text text,
  guideline_ids text[] default null,
  as_of_date date default null,
  result_limit integer default 8
)
returns table (
  chunk_id text,
  guideline_id text,
  guideline_name text,
  section_id text,
  section_title text,
  chunk_text text,
  tags jsonb,
  evidence_level text,
  source_anchor text,
  document_url text,
  document_version text,
  source text,
  access_mode text,
  score double precision
)
language sql
stable
as $$
  select
    rc.chunk_id,
    rc.guideline_id,
    g.name as guideline_name,
    rc.section_id,
    coalesce(gs.section_title, 'Источник') as section_title,
    rc.chunk_text,
    rc.tags,
    rc.evidence_level,
    rc.source_anchor,
    g.source_url as document_url,
    g.publish_date::text as document_version,
    'minzdrav'::text as source,
    'local'::text as access_mode,
    (case when lower(rc.chunk_text) like '%рекомендуется%' then 0.5 else 1.0 end)::double precision as score
  from public.recommendation_chunks rc
  join public.guidelines g on g.id = rc.guideline_id
  left join public.guideline_sections gs
    on gs.guideline_id = rc.guideline_id and gs.section_id = rc.section_id
  where
    lower(rc.chunk_text) like ('%' || lower(coalesce(query_text, '')) || '%')
    and (guideline_ids is null or cardinality(guideline_ids) = 0 or rc.guideline_id = any(guideline_ids))
    and (as_of_date is null or g.publish_date is null or g.publish_date <= as_of_date)
  order by rc.created_at desc
  limit greatest(1, least(coalesce(result_limit, 8), 50));
$$;

create or replace function public.onco_search_source_documents(
  query_text text,
  source_ids text[] default null,
  result_limit integer default 10
)
returns table (
  chunk_id text,
  guideline_id text,
  guideline_name text,
  section_id text,
  section_title text,
  chunk_text text,
  tags jsonb,
  evidence_level text,
  source_anchor text,
  document_url text,
  document_version text,
  source text,
  access_mode text,
  score double precision
)
language sql
stable
as $$
  with ts as (
    select plainto_tsquery('simple', coalesce(query_text, '')) as q
  )
  select
    sd.document_id as chunk_id,
    sd.document_id as guideline_id,
    sd.title as guideline_name,
    'source_doc'::text as section_id,
    sd.source as section_title,
    sd.content_text as chunk_text,
    '[]'::jsonb as tags,
    null::text as evidence_level,
    sd.title as source_anchor,
    sd.url as document_url,
    coalesce(sd.published_at::text, sd.version) as document_version,
    sd.source,
    'local'::text as access_mode,
    (1 - ts_rank_cd(sd.search_vector, ts.q))::double precision as score
  from public.source_documents sd, ts
  where
    sd.ingest_status = 'downloaded'
    and sd.search_vector @@ ts.q
    and (source_ids is null or cardinality(source_ids) = 0 or sd.source = any(source_ids))
  order by ts_rank_cd(sd.search_vector, ts.q) desc, sd.updated_at desc
  limit greatest(1, least(coalesce(result_limit, 10), 50));
$$;

create or replace function public.onco_list_recent_minzdrav(limit_rows integer default 600)
returns table(
  id text,
  name text,
  publish_date text,
  source_url text,
  sample_chunk text
)
language sql
stable
as $$
  select
    g.id,
    g.name,
    g.publish_date::text,
    g.source_url,
    (
      select rc.chunk_text
      from public.recommendation_chunks rc
      where rc.guideline_id = g.id
      order by rc.chunk_id asc
      limit 1
    ) as sample_chunk
  from public.guidelines g
  order by g.publish_date desc nulls last
  limit greatest(1, least(coalesce(limit_rows, 600), 5000));
$$;

create or replace function public.onco_list_source_status()
returns table(
  source text,
  downloaded_count bigint,
  online_only_count bigint,
  failed_count bigint,
  last_indexed_at timestamptz,
  last_attempt_at timestamptz,
  last_attempt_status text,
  last_attempt_url text,
  last_attempt_http_status integer,
  last_attempt_failure_reason text
)
language sql
stable
as $$
  with counts as (
    select
      sd.source,
      sum(case when sd.ingest_status = 'downloaded' then 1 else 0 end) as downloaded_count,
      sum(case when sd.ingest_status = 'online_only' then 1 else 0 end) as online_only_count,
      sum(case when sd.ingest_status = 'failed' then 1 else 0 end) as failed_count,
      max(sd.updated_at) as last_indexed_at
    from public.source_documents sd
    group by sd.source
  ),
  last_attempt as (
    select distinct on (l.source)
      l.source,
      l.attempted_at,
      l.status,
      l.url,
      l.http_status,
      l.failure_reason
    from public.source_sync_logs l
    order by l.source, l.attempted_at desc
  )
  select
    coalesce(c.source, a.source) as source,
    coalesce(c.downloaded_count, 0) as downloaded_count,
    coalesce(c.online_only_count, 0) as online_only_count,
    coalesce(c.failed_count, 0) as failed_count,
    c.last_indexed_at,
    a.attempted_at as last_attempt_at,
    a.status as last_attempt_status,
    a.url as last_attempt_url,
    a.http_status as last_attempt_http_status,
    a.failure_reason as last_attempt_failure_reason
  from counts c
  full outer join last_attempt a on a.source = c.source;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges in schema public
grant execute on functions to anon, authenticated, service_role;
