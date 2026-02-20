import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { BenchmarkReport, ValidationResult } from "@/lib/types";
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
