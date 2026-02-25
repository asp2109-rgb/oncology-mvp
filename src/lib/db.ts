import { randomUUID } from "node:crypto";
import type { BenchmarkReport, SourceId, ValidationResult } from "@/lib/types";
import { ftsQueryFromText, nowIso, safeJsonParse } from "@/lib/utils";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import * as sqlite from "@/lib/db-sqlite";

export type GuidelineRecord = sqlite.GuidelineRecord;
export type GuidelineSectionRecord = sqlite.GuidelineSectionRecord;
export type RecommendationChunkRecord = sqlite.RecommendationChunkRecord;
export type SourceDocumentRecord = sqlite.SourceDocumentRecord;
export type LandingLeadRecord = sqlite.LandingLeadRecord;
export type DoctorFeedbackRecord = sqlite.DoctorFeedbackRecord;

export type DbInstance = ReturnType<typeof sqlite.getDb> | ReturnType<typeof getSupabaseClient>;

const ONCO_DB_PROVIDER = (process.env.ONCO_DB_PROVIDER ?? "supabase").trim().toLowerCase();
const SUPABASE_CACHE_TTL_MS = 2 * 60 * 1000;
const SUPABASE_BATCH_SIZE = Math.max(
  100,
  Math.min(Number(process.env.SUPABASE_BATCH_SIZE ?? "500") || 500, 2000),
);
const STRICT_SUPABASE = (process.env.ONCO_DB_STRICT_SUPABASE ?? "false").trim().toLowerCase() === "true";

let warnedFallback = false;
let initialized = false;
let guidelineCache:
  | {
      expiresAt: number;
      rows: Array<{
        id: string;
        code: number | null;
        version: number | null;
        name: string;
        publish_date: string | null;
        status: number;
        source_url: string;
        pdf_url: string;
      }>;
    }
  | null = null;

function shouldUseSupabase(): boolean {
  const requested = ONCO_DB_PROVIDER === "supabase";
  if (!requested) {
    return false;
  }

  const configured = isSupabaseConfigured();
  if (!configured && STRICT_SUPABASE) {
    throw new Error(
      "[onco-db] ONCO_DB_PROVIDER=supabase, но SUPABASE_URL/KEY не заданы и включен строгий режим ONCO_DB_STRICT_SUPABASE=true.",
    );
  }

  if (!configured && !warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[onco-db] ONCO_DB_PROVIDER=supabase, но SUPABASE_URL/KEY не заданы. Используется SQLite fallback.",
    );
  }

  return configured;
}

export function getDbProviderInfo(): {
  requested: "supabase" | "sqlite";
  active: "supabase" | "sqlite";
  supabase_configured: boolean;
} {
  const requested = ONCO_DB_PROVIDER === "supabase" ? "supabase" : "sqlite";
  const configured = isSupabaseConfigured();
  const active = shouldUseSupabase() ? "supabase" : "sqlite";
  return {
    requested,
    active,
    supabase_configured: configured,
  };
}

function invalidateGuidelineCache(): void {
  guidelineCache = null;
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) {
    return direct[1];
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function parseMetadata(value: string): Record<string, unknown> {
  return safeJsonParse<Record<string, unknown>>(value, {});
}

function parseTags(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function ensureInitSqlite(): void {
  sqlite.initDb();
}

function chunkBy<T>(items: T[], size: number): T[][] {
  if (items.length <= size) {
    return [items];
  }

  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

export function getDb(): DbInstance {
  if (shouldUseSupabase()) {
    return getSupabaseClient();
  }

  ensureInitSqlite();
  return sqlite.getDb();
}

export function initDb(): void {
  if (initialized) {
    return;
  }

  if (!shouldUseSupabase()) {
    ensureInitSqlite();
  }

  initialized = true;
}

export async function withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
  initDb();
  // Supabase/PostgREST does not expose client-side transactions in this layer.
  // Use an explicit SQL function for true ACID batches when needed.
  // For SQLite fallback we keep API behavior consistent and execute callback directly.
  return await fn();
}

export async function upsertGuideline(record: GuidelineRecord): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.upsertGuideline(record);
    return;
  }

  const supabase = getSupabaseClient();
  const payload = {
    id: record.id,
    code: record.code,
    version: record.version,
    name: record.name,
    publish_date: normalizeDateOnly(record.publish_date),
    status: record.status,
    apply_status: record.apply_status,
    source_url: record.source_url,
    pdf_url: record.pdf_url,
    is_oncology: Boolean(record.is_oncology),
    updated_at: nowIso(),
  };

  const { error } = await supabase.from("guidelines").upsert(payload, { onConflict: "id" });
  if (error) {
    throw new Error(`Supabase upsertGuideline failed: ${error.message}`);
  }

  invalidateGuidelineCache();
}

export async function replaceGuidelineSections(
  guidelineId: string,
  sections: GuidelineSectionRecord[],
): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.replaceGuidelineSections(guidelineId, sections);
    return;
  }

  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("guideline_sections")
    .delete()
    .eq("guideline_id", guidelineId);

  if (deleteError) {
    throw new Error(`Supabase replaceGuidelineSections(delete) failed: ${deleteError.message}`);
  }

  if (!sections.length) {
    return;
  }

  const payload = sections.map((section) => ({ ...section }));
  for (const batch of chunkBy(payload, SUPABASE_BATCH_SIZE)) {
    const { error: insertError } = await supabase.from("guideline_sections").insert(batch);
    if (insertError) {
      throw new Error(`Supabase replaceGuidelineSections(insert) failed: ${insertError.message}`);
    }
  }
}

export async function replaceRecommendationChunks(
  guidelineId: string,
  chunks: RecommendationChunkRecord[],
): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.replaceRecommendationChunks(guidelineId, chunks);
    return;
  }

  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("recommendation_chunks")
    .delete()
    .eq("guideline_id", guidelineId);

  if (deleteError) {
    throw new Error(`Supabase replaceRecommendationChunks(delete) failed: ${deleteError.message}`);
  }

  if (!chunks.length) {
    return;
  }

  const payload = chunks.map((chunk) => ({
    ...chunk,
    tags: chunk.tags,
  }));

  for (const batch of chunkBy(payload, SUPABASE_BATCH_SIZE)) {
    const { error: insertError } = await supabase.from("recommendation_chunks").insert(batch);
    if (insertError) {
      throw new Error(`Supabase replaceRecommendationChunks(insert) failed: ${insertError.message}`);
    }
  }
}

export async function getGuidelineCounts(): Promise<{ guidelines: number; chunks: number }> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.getGuidelineCounts();
  }

  const supabase = getSupabaseClient();

  const { data: rpcData, error: rpcError } = await supabase.rpc("onco_get_guideline_counts");
  if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
    const row = rpcData[0] as { guidelines?: number; chunks?: number };
    return {
      guidelines: Number(row.guidelines ?? 0),
      chunks: Number(row.chunks ?? 0),
    };
  }

  const [{ count: guidelineCount, error: gErr }, { count: chunkCount, error: cErr }] = await Promise.all([
    supabase.from("guidelines").select("id", { head: true, count: "exact" }),
    supabase.from("recommendation_chunks").select("chunk_id", { head: true, count: "exact" }),
  ]);

  if (gErr || cErr) {
    throw new Error(
      `Supabase getGuidelineCounts failed: ${gErr?.message ?? cErr?.message ?? rpcError?.message ?? "unknown error"}`,
    );
  }

  return {
    guidelines: Number(guidelineCount ?? 0),
    chunks: Number(chunkCount ?? 0),
  };
}

export async function saveValidationRun(params: {
  run_id?: string;
  case_id: string | null;
  as_of_date: string;
  result: ValidationResult;
  latency_ms: number;
}): Promise<string> {
  initDb();

  const runId = params.run_id ?? randomUUID();

  if (!shouldUseSupabase()) {
    return sqlite.saveValidationRun({
      ...params,
      run_id: runId,
    });
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("validation_runs").insert({
    run_id: runId,
    case_id: params.case_id,
    as_of_date: normalizeDateOnly(params.as_of_date),
    result_json: params.result,
    latency_ms: params.latency_ms,
  });

  if (error) {
    throw new Error(`Supabase saveValidationRun failed: ${error.message}`);
  }

  return runId;
}

export async function saveDoctorFeedback(
  record: DoctorFeedbackRecord,
): Promise<{ feedback_id: string; created_at: string }> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.saveDoctorFeedback(record);
  }

  const feedback_id = randomUUID();
  const created_at = nowIso();

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("doctor_feedback").insert({
    feedback_id,
    validation_run_id: record.validation_run_id,
    rating: record.rating,
    comment: record.comment,
    created_at,
  });

  if (error) {
    throw new Error(`Supabase saveDoctorFeedback failed: ${error.message}`);
  }

  return { feedback_id, created_at };
}

export async function saveBenchmarkRun(params: {
  bench_id: string;
  dataset_version: string;
  report: BenchmarkReport;
}): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.saveBenchmarkRun(params);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("benchmark_runs").insert({
    bench_id: params.bench_id,
    dataset_version: params.dataset_version,
    metrics_json: params.report,
  });

  if (error) {
    throw new Error(`Supabase saveBenchmarkRun failed: ${error.message}`);
  }
}

export async function saveLandingLead(
  record: LandingLeadRecord,
): Promise<{ lead_id: string; created_at: string }> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.saveLandingLead(record);
  }

  const lead_id = randomUUID();
  const created_at = nowIso();

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("landing_leads").insert({
    lead_id,
    full_name: record.full_name,
    work_email: record.work_email,
    clinic_name: record.clinic_name,
    role: record.role,
    monthly_cases: record.monthly_cases,
    message: record.message,
    consent: Boolean(record.consent),
    source: record.source,
    created_at,
  });

  if (error) {
    throw new Error(`Supabase saveLandingLead failed: ${error.message}`);
  }

  return { lead_id, created_at };
}

export async function getLatestBenchmarkRun(): Promise<BenchmarkReport | null> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.getLatestBenchmarkRun();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("benchmark_runs")
    .select("metrics_json")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase getLatestBenchmarkRun failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return safeJsonParse<BenchmarkReport | null>(JSON.stringify(data.metrics_json), null);
}

export async function upsertTrialsCache(queryKey: string, payload: unknown): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.upsertTrialsCache(queryKey, payload);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("trials_cache").upsert(
    {
      query_key: queryKey,
      fetched_at: nowIso(),
      payload_json: payload,
    },
    { onConflict: "query_key" },
  );

  if (error) {
    throw new Error(`Supabase upsertTrialsCache failed: ${error.message}`);
  }
}

export async function readTrialsCache(
  queryKey: string,
): Promise<{ fetched_at: string; payload_json: string } | null> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.readTrialsCache(queryKey);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("trials_cache")
    .select("fetched_at,payload_json")
    .eq("query_key", queryKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase readTrialsCache failed: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    fetched_at: String(data.fetched_at),
    payload_json: JSON.stringify(data.payload_json),
  };
}

export async function deleteSourceDocumentsBySource(source: SourceId): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.deleteSourceDocumentsBySource(source);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("source_documents").delete().eq("source", source);

  if (error) {
    throw new Error(`Supabase deleteSourceDocumentsBySource failed: ${error.message}`);
  }
}

export async function upsertSourceDocument(
  record: SourceDocumentRecord,
  keywords: string[] = [],
): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.upsertSourceDocument(record, keywords);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("source_documents").upsert(
    {
      document_id: record.document_id,
      source: record.source,
      title: record.title,
      url: record.url,
      version: record.version,
      published_at: normalizeDateOnly(record.published_at),
      access_level: record.access_level,
      ingest_status: record.ingest_status,
      http_status: record.http_status,
      failure_reason: record.failure_reason,
      content_text: record.content_text,
      metadata_json: parseMetadata(record.metadata_json),
      keywords: parseTags(keywords).join(" "),
      updated_at: nowIso(),
    },
    { onConflict: "document_id" },
  );

  if (error) {
    throw new Error(`Supabase upsertSourceDocument failed: ${error.message}`);
  }
}

export async function logSourceSyncAttempt(params: {
  source: SourceId;
  url: string;
  status: "downloaded" | "online_only" | "failed";
  http_status?: number | null;
  failure_reason?: string | null;
  attempted_at?: string;
}): Promise<void> {
  initDb();

  if (!shouldUseSupabase()) {
    sqlite.logSourceSyncAttempt(params);
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("source_sync_logs").insert({
    log_id: randomUUID(),
    source: params.source,
    url: params.url,
    attempted_at: params.attempted_at ?? nowIso(),
    status: params.status,
    http_status: params.http_status ?? null,
    failure_reason: params.failure_reason ?? null,
  });

  if (error) {
    throw new Error(`Supabase logSourceSyncAttempt failed: ${error.message}`);
  }
}

export async function listSourceStatus(): Promise<
  Array<{
    source: SourceId;
    downloaded_count: number;
    online_only_count: number;
    failed_count: number;
    last_indexed_at: string | null;
    last_attempt_at: string | null;
    last_attempt_status: string | null;
    last_attempt_url: string | null;
    last_attempt_http_status: number | null;
    last_attempt_failure_reason: string | null;
  }>
> {
  initDb();

  if (!shouldUseSupabase()) {
    return sqlite.listSourceStatus();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("onco_list_source_status");

  if (error) {
    throw new Error(`Supabase listSourceStatus failed: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    source: String(row.source) as SourceId,
    downloaded_count: Number(row.downloaded_count ?? 0),
    online_only_count: Number(row.online_only_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    last_indexed_at: row.last_indexed_at ? String(row.last_indexed_at) : null,
    last_attempt_at: row.last_attempt_at ? String(row.last_attempt_at) : null,
    last_attempt_status: row.last_attempt_status ? String(row.last_attempt_status) : null,
    last_attempt_url: row.last_attempt_url ? String(row.last_attempt_url) : null,
    last_attempt_http_status:
      row.last_attempt_http_status === null || row.last_attempt_http_status === undefined
        ? null
        : Number(row.last_attempt_http_status),
    last_attempt_failure_reason: row.last_attempt_failure_reason ? String(row.last_attempt_failure_reason) : null,
  }));
}

export async function listRecentMinzdravGuidelines(
  limit = 600,
): Promise<Array<{ id: string; name: string; publish_date: string | null; source_url: string; sample_chunk: string | null }>> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const rows = db
      .prepare(
        `
        SELECT
          g.id,
          g.name,
          g.publish_date,
          g.source_url,
          (
            SELECT rc.chunk_text
            FROM recommendation_chunks rc
            WHERE rc.guideline_id = g.id
            ORDER BY rc.chunk_id ASC
            LIMIT 1
          ) AS sample_chunk
        FROM guidelines g
        ORDER BY g.publish_date DESC
        LIMIT ?
      `,
      )
      .all(limit) as Array<{
      id: string;
      name: string;
      publish_date: string | null;
      source_url: string;
      sample_chunk: string | null;
    }>;

    return rows;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("onco_list_recent_minzdrav", { limit_rows: limit });

  if (error) {
    throw new Error(`Supabase listRecentMinzdravGuidelines failed: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name),
    publish_date: row.publish_date ? String(row.publish_date) : null,
    source_url: String(row.source_url ?? ""),
    sample_chunk: row.sample_chunk ? String(row.sample_chunk) : null,
  }));
}

export async function listGuidelinesRaw(
  limit = 5000,
): Promise<
  Array<{
    id: string;
    code: number | null;
    version: number | null;
    name: string;
    publish_date: string | null;
    status: number;
    source_url: string;
    pdf_url: string;
  }>
> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const rows = db
      .prepare(
        `
      SELECT id, code, version, name, publish_date, status, source_url, pdf_url
      FROM guidelines
      ORDER BY publish_date DESC
      LIMIT ?
    `,
      )
      .all(limit) as Array<{
      id: string;
      code: number | null;
      version: number | null;
      name: string;
      publish_date: string | null;
      status: number;
      source_url: string;
      pdf_url: string;
    }>;

    return rows;
  }

  if (guidelineCache && guidelineCache.expiresAt > Date.now() && guidelineCache.rows.length <= limit) {
    return guidelineCache.rows.slice(0, limit);
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("guidelines")
    .select("id, code, version, name, publish_date, status, source_url, pdf_url")
    .order("publish_date", { ascending: false, nullsFirst: false })
    .limit(Math.max(limit, 1000));

  if (error) {
    throw new Error(`Supabase listGuidelinesRaw failed: ${error.message}`);
  }

  const rows = (data ?? []).map((row) => ({
    id: String(row.id),
    code: row.code === null || row.code === undefined ? null : Number(row.code),
    version: row.version === null || row.version === undefined ? null : Number(row.version),
    name: String(row.name),
    publish_date: row.publish_date ? String(row.publish_date) : null,
    status: Number(row.status ?? 0),
    source_url: String(row.source_url ?? ""),
    pdf_url: String(row.pdf_url ?? ""),
  }));

  guidelineCache = {
    rows,
    expiresAt: Date.now() + SUPABASE_CACHE_TTL_MS,
  };

  return rows.slice(0, limit);
}

export async function listGuidelineSourcesWithSectionCounts(
  limit = 500,
): Promise<
  Array<{
    id: string;
    name: string;
    publish_date: string | null;
    status: number;
    source_url: string;
    pdf_url: string;
    section_count: number;
  }>
> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const rows = db
      .prepare(
        `
      SELECT
        g.id,
        g.name,
        g.publish_date,
        g.status,
        g.source_url,
        g.pdf_url,
        COUNT(gs.section_id) AS section_count
      FROM guidelines g
      LEFT JOIN guideline_sections gs ON gs.guideline_id = g.id
      GROUP BY g.id
      ORDER BY g.publish_date DESC
      LIMIT ?
    `,
      )
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      publish_date: row.publish_date ? String(row.publish_date) : null,
      status: Number(row.status),
      source_url: String(row.source_url),
      pdf_url: String(row.pdf_url),
      section_count: Number(row.section_count ?? 0),
    }));
  }

  const supabase = getSupabaseClient();
  const { data: guidelines, error: guidelineError } = await supabase
    .from("guidelines")
    .select("id, name, publish_date, status, source_url, pdf_url")
    .order("publish_date", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (guidelineError) {
    throw new Error(`Supabase listGuidelineSourcesWithSectionCounts(guidelines) failed: ${guidelineError.message}`);
  }

  const ids = (guidelines ?? []).map((row) => String(row.id));
  const sectionCounts = new Map<string, number>();

  if (ids.length) {
    const { data: sections, error: sectionError } = await supabase
      .from("guideline_sections")
      .select("guideline_id")
      .in("guideline_id", ids);

    if (sectionError) {
      throw new Error(`Supabase listGuidelineSourcesWithSectionCounts(sections) failed: ${sectionError.message}`);
    }

    for (const row of sections ?? []) {
      const id = String(row.guideline_id);
      sectionCounts.set(id, (sectionCounts.get(id) ?? 0) + 1);
    }
  }

  return (guidelines ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    publish_date: row.publish_date ? String(row.publish_date) : null,
    status: Number(row.status ?? 0),
    source_url: String(row.source_url ?? ""),
    pdf_url: String(row.pdf_url ?? ""),
    section_count: sectionCounts.get(String(row.id)) ?? 0,
  }));
}

export async function searchRecommendationChunksFts(params: {
  query: string;
  guideline_ids?: string[];
  section_ids?: string[];
  as_of_date?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const guidelineIds = params.guideline_ids ?? [];
    const sectionIds = params.section_ids ?? [];
    const filters: string[] = [];
    const ftsQuery = ftsQueryFromText(params.query);
    if (!ftsQuery) {
      return [];
    }

    const values: unknown[] = [ftsQuery];

    if (guidelineIds.length) {
      filters.push(`rc.guideline_id IN (${guidelineIds.map(() => "?").join(",")})`);
      values.push(...guidelineIds);
    }

    if (sectionIds.length) {
      filters.push(`rc.section_id IN (${sectionIds.map(() => "?").join(",")})`);
      values.push(...sectionIds);
    }

    const asOfDate = normalizeDateOnly(params.as_of_date);
    if (asOfDate) {
      filters.push("(g.publish_date IS NULL OR date(substr(g.publish_date, 1, 10)) <= date(?))");
      values.push(asOfDate);
    }

    const whereFilters = filters.length ? `AND ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT
        rc.chunk_id,
        rc.guideline_id,
        g.name AS guideline_name,
        rc.section_id,
        gs.section_title,
        rc.chunk_text,
        rc.tags,
        rc.evidence_level,
        rc.source_anchor,
        g.source_url AS document_url,
        g.publish_date AS document_version,
        'minzdrav' AS source,
        'local' AS access_mode,
        bm25(recommendation_chunks_fts) AS score
      FROM recommendation_chunks_fts
      JOIN recommendation_chunks rc ON rc.chunk_id = recommendation_chunks_fts.chunk_id
      JOIN guidelines g ON g.id = rc.guideline_id
      LEFT JOIN guideline_sections gs
        ON gs.guideline_id = rc.guideline_id
        AND gs.section_id = rc.section_id
      WHERE recommendation_chunks_fts MATCH ?
      ${whereFilters}
      ORDER BY score ASC
      LIMIT ${Math.max(1, Math.min(50, params.limit ?? 12))}
    `;

    return db.prepare(sql).all(...values) as Array<Record<string, unknown>>;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("onco_search_recommendation_chunks", {
    query_text: params.query,
    guideline_ids: params.guideline_ids?.length ? params.guideline_ids : null,
    section_ids: params.section_ids?.length ? params.section_ids : null,
    as_of_date: normalizeDateOnly(params.as_of_date),
    result_limit: Math.max(1, Math.min(50, params.limit ?? 12)),
  });

  if (error) {
    throw new Error(`Supabase searchRecommendationChunksFts failed: ${error.message}`);
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function searchRecommendationChunksLike(params: {
  query: string;
  guideline_ids?: string[];
  as_of_date?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const normalized = params.query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const guidelineIds = params.guideline_ids ?? [];
    const filters: string[] = ["lower(rc.chunk_text) LIKE ?"];
    const values: unknown[] = [`%${normalized}%`];

    if (guidelineIds.length) {
      filters.push(`rc.guideline_id IN (${guidelineIds.map(() => "?").join(",")})`);
      values.push(...guidelineIds);
    }

    const asOfDate = normalizeDateOnly(params.as_of_date);
    if (asOfDate) {
      filters.push("(g.publish_date IS NULL OR date(substr(g.publish_date, 1, 10)) <= date(?))");
      values.push(asOfDate);
    }

    values.push(Math.max(1, Math.min(50, params.limit ?? 8)));

    const rows = db
      .prepare(
        `
      SELECT
        rc.chunk_id,
        rc.guideline_id,
        g.name AS guideline_name,
        rc.section_id,
        gs.section_title,
        rc.chunk_text,
        rc.tags,
        rc.evidence_level,
        rc.source_anchor,
        g.source_url AS document_url,
        g.publish_date AS document_version,
        'minzdrav' AS source,
        'local' AS access_mode,
        CASE
          WHEN lower(rc.chunk_text) LIKE '%рекомендуется%' THEN 0.5
          ELSE 1.0
        END AS score
      FROM recommendation_chunks rc
      JOIN guidelines g ON g.id = rc.guideline_id
      LEFT JOIN guideline_sections gs
        ON gs.guideline_id = rc.guideline_id
        AND gs.section_id = rc.section_id
      WHERE ${filters.join(" AND ")}
      ORDER BY score ASC, rc.created_at DESC
      LIMIT ?
    `,
      )
      .all(...values) as Array<Record<string, unknown>>;

    return rows;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("onco_search_recommendation_chunks_like", {
    query_text: params.query,
    guideline_ids: params.guideline_ids?.length ? params.guideline_ids : null,
    as_of_date: normalizeDateOnly(params.as_of_date),
    result_limit: Math.max(1, Math.min(50, params.limit ?? 8)),
  });

  if (error) {
    throw new Error(`Supabase searchRecommendationChunksLike failed: ${error.message}`);
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function searchSourceDocumentsFts(params: {
  query: string;
  sources: SourceId[];
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  initDb();

  if (!shouldUseSupabase()) {
    const db = sqlite.getDb();
    const sources = params.sources.filter((source) => source !== "minzdrav");
    if (!sources.length) {
      return [];
    }

    const ftsQuery = ftsQueryFromText(params.query);
    if (!ftsQuery) {
      return [];
    }

    const limit = Math.max(1, Math.min(30, params.limit ?? 10));
    const sourceFilter = sources.map(() => "?").join(",");
    const values: unknown[] = [ftsQuery, ...sources];
    const likeNeedle = params.query.trim().toLowerCase();

    try {
      const rows = db
        .prepare(
          `
        SELECT
          sd.document_id AS chunk_id,
          sd.document_id AS guideline_id,
          sd.title AS guideline_name,
          'source_doc' AS section_id,
          sd.source AS section_title,
          sd.content_text AS chunk_text,
          '[]' AS tags,
          NULL AS evidence_level,
          sd.title AS source_anchor,
          sd.url AS document_url,
          COALESCE(sd.published_at, sd.version) AS document_version,
          sd.source AS source,
          'local' AS access_mode,
          bm25(source_documents_fts) AS score
        FROM source_documents_fts
        JOIN source_documents sd ON sd.document_id = source_documents_fts.document_id
        WHERE source_documents_fts MATCH ?
          AND sd.source IN (${sourceFilter})
          AND sd.ingest_status = 'downloaded'
        ORDER BY score ASC
        LIMIT ${limit}
      `,
        )
        .all(...values) as Array<Record<string, unknown>>;

      return rows;
    } catch (error) {
      const message = String(error);
      if (!message.toLowerCase().includes("fts5")) {
        throw error;
      }
      if (!likeNeedle) {
        return [];
      }

      const likeRows = db
        .prepare(
          `
        SELECT
          sd.document_id AS chunk_id,
          sd.document_id AS guideline_id,
          sd.title AS guideline_name,
          'source_doc' AS section_id,
          sd.source AS section_title,
          sd.content_text AS chunk_text,
          '[]' AS tags,
          NULL AS evidence_level,
          sd.title AS source_anchor,
          sd.url AS document_url,
          COALESCE(sd.published_at, sd.version) AS document_version,
          sd.source AS source,
          'local' AS access_mode,
          100.0 AS score
        FROM source_documents sd
        WHERE sd.source IN (${sourceFilter})
          AND sd.ingest_status = 'downloaded'
          AND lower(sd.title || ' ' || sd.content_text) LIKE ?
        ORDER BY sd.updated_at DESC
        LIMIT ${limit}
      `,
        )
        .all(...sources, `%${likeNeedle}%`) as Array<Record<string, unknown>>;

      return likeRows;
    }
  }

  const supabase = getSupabaseClient();
  const filteredSources = params.sources.filter((source) => source !== "minzdrav");

  if (!filteredSources.length) {
    return [];
  }

  const { data, error } = await supabase.rpc("onco_search_source_documents", {
    query_text: params.query,
    source_ids: filteredSources,
    result_limit: Math.max(1, Math.min(30, params.limit ?? 10)),
  });

  if (error) {
    throw new Error(`Supabase searchSourceDocumentsFts failed: ${error.message}`);
  }

  return (data ?? []) as Array<Record<string, unknown>>;
}
