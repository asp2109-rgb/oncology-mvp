import { readTrialsCache, upsertTrialsCache } from "@/lib/db";
import { rankHitsForReferenceDate } from "@/lib/search/retrospective";
import { SOURCE_CONFIG } from "@/lib/sources";
import type { SearchHit, SourceId } from "@/lib/types";

const SOURCE_PORTALS: Record<SourceId, string> = {
  minzdrav: "https://cr.minzdrav.gov.ru/",
  russco: "https://rosoncoweb.ru/standarts/RUSSCO/",
  nccn_patient: "https://www.nccn.org/guidelines/patients",
  nccn_professional: "https://www.nccn.org/guidelines/category_1",
  esmo: "https://www.esmo.org/",
  asco: "https://www.asco.org/quality-care/clinical-guidelines",
  pubmed: "https://pubmed.ncbi.nlm.nih.gov/",
  femb: "https://femb.ru/femb/",
};

function shouldUseCache(fetchedAt: string, ttlHours = 6): boolean {
  const ageMs = Date.now() - Date.parse(fetchedAt);
  return ageMs <= ttlHours * 60 * 60 * 1000;
}

function portalHit(source: SourceId, query: string, score: number): SearchHit {
  const label = SOURCE_CONFIG[source].label;
  return {
    chunk_id: `${source}:portal:${query}`.slice(0, 220),
    guideline_id: `${source}:portal`,
    guideline_name: `${label} (online lookup)`,
    section_id: "online_portal",
    section_title: "Online lookup",
    chunk_text: `Локальных материалов не найдено. Использован online lookup по источнику ${label}.`,
    tags: ["online_lookup"],
    evidence_level: null,
    source_anchor: label,
    source,
    source_tier: SOURCE_CONFIG[source].tier,
    access_mode: "online",
    document_url: SOURCE_PORTALS[source],
    document_version: null,
    score,
  };
}

async function searchPubMed(query: string, limit: number, asOfDate?: string): Promise<SearchHit[]> {
  const key = `online:pubmed:${query}:${limit}:${asOfDate ?? "none"}`;
  const cached = await readTrialsCache(key);

  if (cached && shouldUseCache(cached.fetched_at)) {
    try {
      return JSON.parse(cached.payload_json) as SearchHit[];
    } catch {
      // ignore broken cache
    }
  }

  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", query);
  searchUrl.searchParams.set("retmax", String(Math.max(1, Math.min(limit, 20))));
  searchUrl.searchParams.set("retmode", "json");

  const searchResponse = await fetch(searchUrl.toString(), { cache: "no-store" });
  if (!searchResponse.ok) {
    return [portalHit("pubmed", query, 200)];
  }

  const searchPayload = (await searchResponse.json()) as {
    esearchresult?: { idlist?: string[] };
  };

  const ids = searchPayload.esearchresult?.idlist?.filter(Boolean) ?? [];
  if (!ids.length) {
    return [portalHit("pubmed", query, 210)];
  }

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("id", ids.join(","));
  summaryUrl.searchParams.set("retmode", "json");

  const summaryResponse = await fetch(summaryUrl.toString(), { cache: "no-store" });
  if (!summaryResponse.ok) {
    return ids.slice(0, limit).map((pmid, index) => ({
      ...portalHit("pubmed", query, 220 + index),
      chunk_id: `pubmed:${pmid}`,
      guideline_id: `pubmed:${pmid}`,
      guideline_name: `PubMed PMID:${pmid}`,
      chunk_text: `Найден PMID ${pmid} по запросу "${query}".`,
      document_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    }));
  }

  const summaryPayload = (await summaryResponse.json()) as {
    result?: Record<string, { uid?: string; title?: string; pubdate?: string }>;
  };

  const result = summaryPayload.result ?? {};
  const hits: SearchHit[] = [];

  for (let index = 0; index < ids.length; index += 1) {
    const pmid = ids[index];
    const item = result[pmid];
    const title = item?.title?.trim() || `PubMed PMID:${pmid}`;
    const pubdate = item?.pubdate?.trim() || null;

    hits.push({
      chunk_id: `pubmed:${pmid}`,
      guideline_id: `pubmed:${pmid}`,
      guideline_name: title,
      section_id: "online_pubmed",
      section_title: "PubMed",
      chunk_text: `${title}${pubdate ? ` (${pubdate})` : ""}`,
      tags: ["pubmed", "online_lookup"],
      evidence_level: null,
      source_anchor: "PubMed",
      source: "pubmed",
      source_tier: "evidence",
      access_mode: "online",
      document_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      document_version: pubdate,
      score: 100 + index,
    });
  }

  const ranked = rankHitsForReferenceDate(hits, asOfDate ?? null, limit);
  if (!ranked.length) {
    return [portalHit("pubmed", query, 210)];
  }

  await upsertTrialsCache(key, ranked);
  return ranked;
}

type OnlineSearchOptions = {
  as_of_date?: string;
};

export async function searchOnlineSources(
  query: string,
  sources: SourceId[],
  limit = 6,
  options: OnlineSearchOptions = {},
): Promise<SearchHit[]> {
  const enabledSources = Array.from(new Set(sources));
  const hits: SearchHit[] = [];

  if (enabledSources.includes("pubmed")) {
    const pubmedHits = await searchPubMed(query, Math.max(1, Math.min(limit, 10)), options.as_of_date);
    hits.push(...pubmedHits);
  }

  for (const source of enabledSources) {
    if (source === "pubmed") {
      continue;
    }
    hits.push(portalHit(source, query, 300 + hits.length));
  }

  return rankHitsForReferenceDate(hits, options.as_of_date ?? null, limit);
}
