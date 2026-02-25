import {
  searchRecommendationChunksFts,
  searchRecommendationChunksLike,
  searchSourceDocumentsFts,
} from "@/lib/db";
import { rankHitsForReferenceDate } from "@/lib/search/retrospective";
import { SOURCE_CONFIG } from "@/lib/sources";
import type { SearchHit, SourceId } from "@/lib/types";
import { safeJsonParse } from "@/lib/utils";

export type SearchContext = {
  guideline_ids?: string[];
  section_ids?: string[];
  sources?: SourceId[];
  as_of_date?: string;
  limit?: number;
};

export interface SearchProvider {
  name: string;
  search(query: string, context?: SearchContext): Promise<SearchHit[]>;
}

function parseSource(value: unknown): SourceId {
  const raw = String(value ?? "minzdrav") as SourceId;
  if (raw in SOURCE_CONFIG) {
    return raw;
  }
  return "minzdrav";
}

function parseTagsValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      return safeJsonParse<string[]>(trimmed, []);
    }
    return trimmed.split(/\s+/g).filter(Boolean);
  }
  return [];
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
      tags: parseTagsValue(row.tags),
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

  async search(query: string, context: SearchContext = {}): Promise<SearchHit[]> {
    const sources = contextSources(context);
    if (!sources.includes("minzdrav")) {
      return [];
    }

    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const rows = await searchRecommendationChunksFts({
      query: normalized,
      guideline_ids: context.guideline_ids,
      section_ids: context.section_ids,
      as_of_date: context.as_of_date,
      limit: context.limit ?? 12,
    });

    return mapRowsToHits(rows);
  }
}

export class RuleIndexProvider implements SearchProvider {
  public readonly name = "RuleIndexProvider";

  async search(query: string, context: SearchContext = {}): Promise<SearchHit[]> {
    const sources = contextSources(context);
    if (!sources.includes("minzdrav")) {
      return [];
    }

    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const rows = await searchRecommendationChunksLike({
      query: normalized,
      guideline_ids: context.guideline_ids,
      as_of_date: context.as_of_date,
      limit: context.limit ?? 8,
    });

    return mapRowsToHits(rows);
  }
}

export class SourceDocumentProvider implements SearchProvider {
  public readonly name = "SourceDocumentProvider";

  async search(query: string, context: SearchContext = {}): Promise<SearchHit[]> {
    const sources = contextSources(context).filter((source) => source !== "minzdrav");
    if (!sources.length) {
      return [];
    }

    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const rows = await searchSourceDocumentsFts({
      query: normalized,
      sources,
      limit: context.limit ?? 10,
    });

    return mapRowsToHits(rows);
  }
}

export async function searchWithProviders(
  providers: SearchProvider[],
  query: string,
  context: SearchContext = {},
): Promise<SearchHit[]> {
  const merged = new Map<string, SearchHit>();

  for (const provider of providers) {
    const hits = await provider.search(query, context);
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
