import { getDb, initDb } from "@/lib/db";
import type { SearchHit } from "@/lib/types";
import { ftsQueryFromText, safeJsonParse } from "@/lib/utils";

export type SearchContext = {
  guideline_ids?: string[];
  section_ids?: string[];
  limit?: number;
};

export interface SearchProvider {
  name: string;
  search(query: string, context?: SearchContext): SearchHit[];
}

function mapRowsToHits(rows: Array<Record<string, unknown>>): SearchHit[] {
  return rows.map((row) => ({
    chunk_id: String(row.chunk_id),
    guideline_id: String(row.guideline_id),
    guideline_name: String(row.guideline_name),
    section_id: String(row.section_id),
    section_title: String(row.section_title),
    chunk_text: String(row.chunk_text),
    tags: safeJsonParse<string[]>(String(row.tags), []),
    evidence_level: row.evidence_level ? String(row.evidence_level) : null,
    source_anchor: row.source_anchor ? String(row.source_anchor) : null,
    score: Number(row.score ?? 0),
  }));
}

export class SqlFtsProvider implements SearchProvider {
  public readonly name = "SqlFtsProvider";

  search(query: string, context: SearchContext = {}): SearchHit[] {
    initDb();
    const database = getDb();

    const ftsQuery = ftsQueryFromText(query);
    if (!ftsQuery) {
      return [];
    }

    const limit = context.limit ?? 12;
    const guidelineIds = context.guideline_ids ?? [];
    const sectionIds = context.section_ids ?? [];

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

    const limit = context.limit ?? 8;
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const guidelineIds = context.guideline_ids ?? [];

    const params: unknown[] = [`%${normalized}%`];
    let guidelineFilter = "";

    if (guidelineIds.length) {
      guidelineFilter = `AND rc.guideline_id IN (${guidelineIds.map(() => "?").join(",")})`;
      params.push(...guidelineIds);
    }

    params.push(limit);

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
        CASE
          WHEN lower(rc.chunk_text) LIKE '%рекомендуется%' THEN 0.5
          ELSE 1.0
        END AS score
      FROM recommendation_chunks rc
      JOIN guidelines g ON g.id = rc.guideline_id
      LEFT JOIN guideline_sections gs
        ON gs.guideline_id = rc.guideline_id
        AND gs.section_id = rc.section_id
      WHERE lower(rc.chunk_text) LIKE ?
      ${guidelineFilter}
      ORDER BY score ASC, rc.created_at DESC
      LIMIT ?
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
      const existing = merged.get(hit.chunk_id);
      if (!existing || hit.score < existing.score) {
        merged.set(hit.chunk_id, hit);
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => a.score - b.score)
    .slice(0, context.limit ?? 15);
}
