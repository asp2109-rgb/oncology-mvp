import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { BenchmarkReport, SourceId, ValidationResult } from "@/lib/types";
import { nowIso, safeJsonParse } from "@/lib/utils";

type DbInstance = Database.Database;

let db: DbInstance | null = null;
let initialized = false;

export type GuidelineRecord = {
  id: string;
  code: number | null;
  version: number | null;
  name: string;
  publish_date: string | null;
  status: number;
  apply_status: string | null;
  source_url: string;
  pdf_url: string;
  is_oncology: number;
};

export type GuidelineSectionRecord = {
  guideline_id: string;
  section_id: string;
  section_title: string;
  section_html: string;
  section_text: string;
};

export type RecommendationChunkRecord = {
  chunk_id: string;
  guideline_id: string;
  section_id: string;
  chunk_text: string;
  tags: string[];
  evidence_level: string | null;
  source_anchor: string | null;
};

export type SourceDocumentRecord = {
  document_id: string;
  source: SourceId;
  title: string;
  url: string;
  version: string | null;
  published_at: string | null;
  access_level: "open" | "login_required" | "restricted";
  ingest_status: "downloaded" | "online_only" | "failed";
  http_status: number | null;
  failure_reason: string | null;
  content_text: string;
  metadata_json: string;
};

function resolveDbPath(): string {
  const configured = process.env.ONCO_DB_PATH;

  if (configured) {
    return configured;
  }

  return path.join(process.cwd(), "data", "oncology.db");
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function getDb(): DbInstance {
  if (db) {
    return db;
  }

  const dbPath = resolveDbPath();
  ensureDir(dbPath);

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

export function initDb(): void {
  if (initialized) {
    return;
  }

  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS guidelines (
      id TEXT PRIMARY KEY,
      code INTEGER,
      version INTEGER,
      name TEXT NOT NULL,
      publish_date TEXT,
      status INTEGER NOT NULL,
      apply_status TEXT,
      source_url TEXT NOT NULL,
      pdf_url TEXT NOT NULL,
      is_oncology INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_guidelines_name ON guidelines(name);
    CREATE INDEX IF NOT EXISTS idx_guidelines_publish_date ON guidelines(publish_date);
    CREATE INDEX IF NOT EXISTS idx_guidelines_status ON guidelines(status);
    CREATE INDEX IF NOT EXISTS idx_guidelines_code ON guidelines(code);

    CREATE TABLE IF NOT EXISTS guideline_sections (
      guideline_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      section_title TEXT NOT NULL,
      section_html TEXT NOT NULL,
      section_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guideline_id, section_id),
      FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sections_guideline ON guideline_sections(guideline_id);
    CREATE INDEX IF NOT EXISTS idx_sections_section_id ON guideline_sections(section_id);

    CREATE TABLE IF NOT EXISTS recommendation_chunks (
      chunk_id TEXT PRIMARY KEY,
      guideline_id TEXT NOT NULL,
      section_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      tags TEXT NOT NULL,
      evidence_level TEXT,
      source_anchor TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (guideline_id) REFERENCES guidelines(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_guideline ON recommendation_chunks(guideline_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_section ON recommendation_chunks(section_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS recommendation_chunks_fts
    USING fts5(chunk_id UNINDEXED, chunk_text, tags);

    CREATE TABLE IF NOT EXISTS cases (
      case_id TEXT PRIMARY KEY,
      source TEXT,
      diagnosis TEXT NOT NULL,
      stage TEXT,
      biomarkers TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS case_events (
      event_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events(case_id);
    CREATE INDEX IF NOT EXISTS idx_case_events_date ON case_events(event_date);

    CREATE TABLE IF NOT EXISTS validation_runs (
      run_id TEXT PRIMARY KEY,
      case_id TEXT,
      as_of_date TEXT NOT NULL,
      result_json TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES cases(case_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_validation_created ON validation_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS benchmark_runs (
      bench_id TEXT PRIMARY KEY,
      dataset_version TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_created ON benchmark_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS trials_cache (
      query_key TEXT PRIMARY KEY,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_documents (
      document_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      version TEXT,
      published_at TEXT,
      access_level TEXT NOT NULL DEFAULT 'open',
      ingest_status TEXT NOT NULL,
      http_status INTEGER,
      failure_reason TEXT,
      content_text TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_source_documents_source ON source_documents(source);
    CREATE INDEX IF NOT EXISTS idx_source_documents_status ON source_documents(ingest_status);
    CREATE INDEX IF NOT EXISTS idx_source_documents_updated ON source_documents(updated_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS source_documents_fts
    USING fts5(document_id UNINDEXED, source, title, content_text, keywords);

    CREATE TABLE IF NOT EXISTS source_sync_logs (
      log_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_source_sync_logs_source ON source_sync_logs(source);
    CREATE INDEX IF NOT EXISTS idx_source_sync_logs_attempted ON source_sync_logs(attempted_at DESC);
  `);

  initialized = true;
}

export function withTransaction<T>(fn: () => T): T {
  const database = getDb();
  initDb();
  const transaction = database.transaction(fn);
  return transaction();
}

export function upsertGuideline(record: GuidelineRecord): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
      INSERT INTO guidelines (
        id, code, version, name, publish_date, status, apply_status, source_url, pdf_url, is_oncology
      ) VALUES (
        @id, @code, @version, @name, @publish_date, @status, @apply_status, @source_url, @pdf_url, @is_oncology
      )
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        version = excluded.version,
        name = excluded.name,
        publish_date = excluded.publish_date,
        status = excluded.status,
        apply_status = excluded.apply_status,
        source_url = excluded.source_url,
        pdf_url = excluded.pdf_url,
        is_oncology = excluded.is_oncology;
    `,
    )
    .run(record);
}

export function replaceGuidelineSections(guidelineId: string, sections: GuidelineSectionRecord[]): void {
  initDb();
  const database = getDb();

  database.prepare("DELETE FROM guideline_sections WHERE guideline_id = ?").run(guidelineId);

  const insert = database.prepare(`
    INSERT INTO guideline_sections (
      guideline_id, section_id, section_title, section_html, section_text
    ) VALUES (
      @guideline_id, @section_id, @section_title, @section_html, @section_text
    )
    ON CONFLICT(guideline_id, section_id) DO UPDATE SET
      section_title = excluded.section_title,
      section_html = excluded.section_html,
      section_text = excluded.section_text;
  `);

  for (const section of sections) {
    insert.run(section);
  }
}

export function replaceRecommendationChunks(
  guidelineId: string,
  chunks: RecommendationChunkRecord[],
): void {
  initDb();
  const database = getDb();

  const existingChunks = database
    .prepare("SELECT chunk_id FROM recommendation_chunks WHERE guideline_id = ?")
    .all(guidelineId) as Array<{ chunk_id: string }>;

  const deleteFts = database.prepare("DELETE FROM recommendation_chunks_fts WHERE chunk_id = ?");
  for (const row of existingChunks) {
    deleteFts.run(row.chunk_id);
  }

  database.prepare("DELETE FROM recommendation_chunks WHERE guideline_id = ?").run(guidelineId);

  const insertChunk = database.prepare(`
    INSERT INTO recommendation_chunks (
      chunk_id, guideline_id, section_id, chunk_text, tags, evidence_level, source_anchor
    ) VALUES (
      @chunk_id, @guideline_id, @section_id, @chunk_text, @tags, @evidence_level, @source_anchor
    );
  `);

  const insertFts = database.prepare(
    "INSERT INTO recommendation_chunks_fts (chunk_id, chunk_text, tags) VALUES (?, ?, ?)",
  );

  for (const chunk of chunks) {
    insertChunk.run({
      ...chunk,
      tags: JSON.stringify(chunk.tags),
    });

    insertFts.run(chunk.chunk_id, chunk.chunk_text, chunk.tags.join(" "));
  }
}

export function getGuidelineCounts(): { guidelines: number; chunks: number } {
  initDb();
  const database = getDb();

  const guidelineRow = database.prepare("SELECT COUNT(*) as count FROM guidelines").get() as {
    count: number;
  };
  const chunkRow = database.prepare("SELECT COUNT(*) as count FROM recommendation_chunks").get() as {
    count: number;
  };

  return {
    guidelines: guidelineRow.count,
    chunks: chunkRow.count,
  };
}

export function saveValidationRun(params: {
  run_id: string;
  case_id: string | null;
  as_of_date: string;
  result: ValidationResult;
  latency_ms: number;
}): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
    INSERT INTO validation_runs (
      run_id, case_id, as_of_date, result_json, latency_ms
    ) VALUES (
      @run_id, @case_id, @as_of_date, @result_json, @latency_ms
    )
  `,
    )
    .run({
      ...params,
      result_json: JSON.stringify(params.result),
    });
}

export function saveBenchmarkRun(params: {
  bench_id: string;
  dataset_version: string;
  report: BenchmarkReport;
}): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
    INSERT INTO benchmark_runs (
      bench_id, dataset_version, metrics_json
    ) VALUES (
      @bench_id, @dataset_version, @metrics_json
    )
  `,
    )
    .run({
      ...params,
      metrics_json: JSON.stringify(params.report),
    });
}

export function getLatestBenchmarkRun(): BenchmarkReport | null {
  initDb();
  const database = getDb();

  const row = database
    .prepare("SELECT metrics_json FROM benchmark_runs ORDER BY created_at DESC LIMIT 1")
    .get() as { metrics_json: string } | undefined;

  if (!row) {
    return null;
  }

  return safeJsonParse<BenchmarkReport | null>(row.metrics_json, null);
}

export function upsertTrialsCache(queryKey: string, payload: unknown): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
      INSERT INTO trials_cache (query_key, fetched_at, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        payload_json = excluded.payload_json
    `,
    )
    .run(queryKey, nowIso(), JSON.stringify(payload));
}

export function readTrialsCache(queryKey: string): { fetched_at: string; payload_json: string } | null {
  initDb();
  const database = getDb();

  const row = database
    .prepare("SELECT fetched_at, payload_json FROM trials_cache WHERE query_key = ?")
    .get(queryKey) as { fetched_at: string; payload_json: string } | undefined;

  return row ?? null;
}

export function deleteSourceDocumentsBySource(source: SourceId): void {
  initDb();
  const database = getDb();

  const existing = database
    .prepare("SELECT document_id FROM source_documents WHERE source = ?")
    .all(source) as Array<{ document_id: string }>;

  const deleteFts = database.prepare("DELETE FROM source_documents_fts WHERE document_id = ?");
  for (const row of existing) {
    deleteFts.run(row.document_id);
  }

  database.prepare("DELETE FROM source_documents WHERE source = ?").run(source);
}

export function upsertSourceDocument(
  record: SourceDocumentRecord,
  keywords: string[] = [],
): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
      INSERT INTO source_documents (
        document_id,
        source,
        title,
        url,
        version,
        published_at,
        access_level,
        ingest_status,
        http_status,
        failure_reason,
        content_text,
        metadata_json,
        updated_at
      ) VALUES (
        @document_id,
        @source,
        @title,
        @url,
        @version,
        @published_at,
        @access_level,
        @ingest_status,
        @http_status,
        @failure_reason,
        @content_text,
        @metadata_json,
        @updated_at
      )
      ON CONFLICT(document_id) DO UPDATE SET
        source = excluded.source,
        title = excluded.title,
        url = excluded.url,
        version = excluded.version,
        published_at = excluded.published_at,
        access_level = excluded.access_level,
        ingest_status = excluded.ingest_status,
        http_status = excluded.http_status,
        failure_reason = excluded.failure_reason,
        content_text = excluded.content_text,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `,
    )
    .run({
      ...record,
      updated_at: nowIso(),
    });

  database.prepare("DELETE FROM source_documents_fts WHERE document_id = ?").run(record.document_id);
  database
    .prepare(
      `
      INSERT INTO source_documents_fts (document_id, source, title, content_text, keywords)
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      record.document_id,
      record.source,
      record.title,
      record.content_text,
      Array.from(new Set(keywords)).join(" "),
    );
}

export function logSourceSyncAttempt(params: {
  source: SourceId;
  url: string;
  status: "downloaded" | "online_only" | "failed";
  http_status?: number | null;
  failure_reason?: string | null;
  attempted_at?: string;
}): void {
  initDb();
  const database = getDb();

  database
    .prepare(
      `
      INSERT INTO source_sync_logs (
        log_id,
        source,
        url,
        attempted_at,
        status,
        http_status,
        failure_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      randomUUID(),
      params.source,
      params.url,
      params.attempted_at ?? nowIso(),
      params.status,
      params.http_status ?? null,
      params.failure_reason ?? null,
    );
}

export function listSourceStatus(): Array<{
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
}> {
  initDb();
  const database = getDb();

  const countsRows = database
    .prepare(
      `
      SELECT
        source,
        SUM(CASE WHEN ingest_status = 'downloaded' THEN 1 ELSE 0 END) AS downloaded_count,
        SUM(CASE WHEN ingest_status = 'online_only' THEN 1 ELSE 0 END) AS online_only_count,
        SUM(CASE WHEN ingest_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        MAX(updated_at) AS last_indexed_at
      FROM source_documents
      GROUP BY source
    `,
    )
    .all() as Array<Record<string, unknown>>;

  const lastAttemptRows = database
    .prepare(
      `
      SELECT l.source, l.attempted_at, l.status, l.url, l.http_status, l.failure_reason
      FROM source_sync_logs l
      INNER JOIN (
        SELECT source, MAX(attempted_at) AS attempted_at
        FROM source_sync_logs
        GROUP BY source
      ) latest
        ON latest.source = l.source
       AND latest.attempted_at = l.attempted_at
    `,
    )
    .all() as Array<Record<string, unknown>>;

  const countsBySource = new Map(
    countsRows.map((row) => [
      String(row.source),
      {
        downloaded_count: Number(row.downloaded_count ?? 0),
        online_only_count: Number(row.online_only_count ?? 0),
        failed_count: Number(row.failed_count ?? 0),
        last_indexed_at: row.last_indexed_at ? String(row.last_indexed_at) : null,
      },
    ]),
  );

  const attemptsBySource = new Map(
    lastAttemptRows.map((row) => [
      String(row.source),
      {
        last_attempt_at: row.attempted_at ? String(row.attempted_at) : null,
        last_attempt_status: row.status ? String(row.status) : null,
        last_attempt_url: row.url ? String(row.url) : null,
        last_attempt_http_status:
          row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
        last_attempt_failure_reason: row.failure_reason ? String(row.failure_reason) : null,
      },
    ]),
  );

  const sources = new Set<string>([...countsBySource.keys(), ...attemptsBySource.keys()]);
  return Array.from(sources).map((source) => ({
    source: source as SourceId,
    downloaded_count: countsBySource.get(source)?.downloaded_count ?? 0,
    online_only_count: countsBySource.get(source)?.online_only_count ?? 0,
    failed_count: countsBySource.get(source)?.failed_count ?? 0,
    last_indexed_at: countsBySource.get(source)?.last_indexed_at ?? null,
    last_attempt_at: attemptsBySource.get(source)?.last_attempt_at ?? null,
    last_attempt_status: attemptsBySource.get(source)?.last_attempt_status ?? null,
    last_attempt_url: attemptsBySource.get(source)?.last_attempt_url ?? null,
    last_attempt_http_status: attemptsBySource.get(source)?.last_attempt_http_status ?? null,
    last_attempt_failure_reason: attemptsBySource.get(source)?.last_attempt_failure_reason ?? null,
  }));
}
