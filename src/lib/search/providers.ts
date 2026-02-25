import { getDb, initDb } from "@/lib/db";
import { rankHitsForReferenceDate } from "@/lib/search/retrospective";
import { SOURCE_CONFIG } from "@/lib/sources";
import type { SearchHit, SourceId } from "@/lib/types";
import { ftsQueryFromText, safeJsonParse } from "@/lib/utils";

export type SearchContext = {
  guideline_ids?: string[];
  section_ids?: string[];
  sources?: SourceId[];
  as_of_date?: string;
  limit?: number;
};

export interface SearchProvider {
  name: string;
  search(query: string, context?: SearchContext): SearchHit[];
}

function parseSource(value: unknown): SourceId {
  const raw = String(value ?? "minzdrav") as SourceId;
  if (raw in SOURCE_CONFIG) {
    return raw;
  }
  return "minzdrav";
}

function mapRowsToHits(rows: Array<Record<string, unknown>>): SearchHit[] {
  return rows.map((row) => {
    const source = parseSource(row.source);
    const chunkText = String(row.chunk_text ?? "");
    const title = String(row.guideline_name ?? row.section_title ?? source);

    return {
      chunk_id: String(row.chunk_id),
      guideline_id: String(row.guideline_id),
      guideline_name: title,
      section_id: String(row.section_id ?? "source_doc"),
      section_title: String(row.section_title ?? "Источник"),
      chunk_text: chunkText || title,
      tags: safeJsonParse<string[]>(String(row.tags ?? "[]"), []),
      evidence_level: row.evidence_level ? String(row.evidence_level) : null,
      source_anchor: row.source_anchor ? String(row.source_anchor) : null,
      source,
      source_tier: SOURCE_CONFIG[source].tier,
      access_mode: row.access_mode === "online" ? "online" : "local",
      document_url: row.document_url ? String(row.document_url) : "",
      document_version: row.document_version ? String(row.document_version) : null,
      score: Number(row.score ?? 0),
    };
  });
}

function contextSources(context: SearchContext): SourceId[] {
  const incoming = context.sources ?? ["minzdrav"];
  const valid = incoming.filter((source): source is SourceId => source in SOURCE_CONFIG);
  return valid.length ? valid : ["minzdrav"];
}

export class SqlFtsProvider implements SearchProvider {
  public readonly name = "SqlFtsProvider";

  search(query: string, context: SearchContext = {}): SearchHit[] {
    initDb();
    const database = getDb();

    const sources = contextSources(context);
    if (!sources.includes("minzdrav")) {
      return [];
    }

    const ftsQuery = ftsQueryFromText(query);
    if (!ftsQuery) {
      return [];
    }

    const limit = context.limit ?? 12;
    const guidelineIds = context.guideline_ids ?? [];
    const sectionIds = context.section_ids ?? [];
    const asOfDate = context.as_of_date?.trim();

    const filters: string[] = [];
    const params: unknown[] = [ftsQuery];

    if (guidelineIds.length) {
      filters.push(`rc.guideline_id IN (${guidelineIds.map(() => "?").join(",")})`);
      params.push(...guidelineIds);
    }

    if (sectionIds.length) {
      filters.push(`rc.section_id IN (${sectionIds.map(() => "?").join(",")})`);
      params.push(...sectionIds);
    }

    if (asOfDate) {
      filters.push("(g.publish_date IS NULL OR date(substr(g.publish_date, 1, 10)) <= date(?))");
      params.push(asOfDate);
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
      LIMIT ${Math.max(1, Math.min(50, limit))}
    `;

    const rows = database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return mapRowsToHits(rows);
  }
}

export class RuleIndexProvider implements SearchProvider {
  public readonly name = "RuleIndexProvider";

  search(query: string, context: SearchContext = {}): SearchHit[] {
    initDb();
    const database = getDb();

    const sources = contextSources(context);
    if (!sources.includes("minzdrav")) {
      return [];
    }

    const limit = context.limit ?? 8;
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const guidelineIds = context.guideline_ids ?? [];
    const asOfDate = context.as_of_date?.trim();

    const filters: string[] = ["lower(rc.chunk_text) LIKE ?"];
    const params: unknown[] = [`%${normalized}%`];

    if (guidelineIds.length) {
      filters.push(`rc.guideline_id IN (${guidelineIds.map(() => "?").join(",")})`);
      params.push(...guidelineIds);
    }

    if (asOfDate) {
      filters.push("(g.publish_date IS NULL OR date(substr(g.publish_date, 1, 10)) <= date(?))");
      params.push(asOfDate);
    }

    params.push(limit);
    const whereFilters = filters.join("\n      AND ");

    const rows = database
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
      WHERE ${whereFilters}
      ORDER BY score ASC, rc.created_at DESC
      LIMIT ?
    `,
      )
      .all(...params) as Array<Record<string, unknown>>;

    return mapRowsToHits(rows);
  }
}

export class SourceDocumentProvider implements SearchProvider {
  public readonly name = "SourceDocumentProvider";

  search(query: string, context: SearchContext = {}): SearchHit[] {
    initDb();
    const database = getDb();

    const sources = contextSources(context).filter((source) => source !== "minzdrav");
    if (!sources.length) {
      return [];
    }

    const ftsQuery = ftsQueryFromText(query);
    if (!ftsQuery) {
      return [];
    }

    const limit = Math.max(1, Math.min(30, context.limit ?? 10));
    const sourceFilter = sources.map(() => "?").join(",");
    const params: unknown[] = [ftsQuery, ...sources];

    const rows = database
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
      .all(...params) as Array<Record<string, unknown>>;

    return mapRowsToHits(rows);
  }
}

export function searchWithProviders(
  providers: SearchProvider[],
  query: string,
  context: SearchContext = {},
): SearchHit[] {
  const merged = new Map<string, SearchHit>();

  for (const provider of providers) {
    const hits = provider.search(query, context);
    for (const hit of hits) {
      const key = `${hit.source}:${hit.chunk_id}`;
      const existing = merged.get(key);
      if (!existing || hit.score < existing.score) {
        merged.set(key, hit);
      }
    }
  }

  return rankHitsForReferenceDate(Array.from(merged.values()), context.as_of_date ?? null, context.limit ?? 15);
}
