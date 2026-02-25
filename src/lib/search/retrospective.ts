import type { SearchHit } from "@/lib/types";
import { extractFirstDate, normalizeDateOnly, parseLooseDate } from "@/lib/utils";

type ReferenceDateParams = {
  asOfDate?: string | null;
  eventDate?: string | null;
  query?: string | null;
};

function hitTimestamp(hit: SearchHit): number | null {
  return parseLooseDate(hit.document_version);
}

function compareWithReference(a: SearchHit, b: SearchHit, referenceTimestamp: number | null): number {
  if (referenceTimestamp === null) {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return a.chunk_id.localeCompare(b.chunk_id);
  }

  const aTs = hitTimestamp(a);
  const bTs = hitTimestamp(b);

  const aKnown = aTs !== null;
  const bKnown = bTs !== null;
  if (aKnown !== bKnown) {
    return aKnown ? -1 : 1;
  }

  if (aTs !== null && bTs !== null) {
    const aDelta = Math.abs(referenceTimestamp - aTs);
    const bDelta = Math.abs(referenceTimestamp - bTs);
    if (aDelta !== bDelta) {
      return aDelta - bDelta;
    }
    if (aTs !== bTs) {
      return bTs - aTs;
    }
  }

  if (a.score !== b.score) {
    return a.score - b.score;
  }

  return a.chunk_id.localeCompare(b.chunk_id);
}

export function resolveReferenceDate(params: ReferenceDateParams): string | null {
  const eventDate = normalizeDateOnly(params.eventDate);
  if (eventDate) {
    return eventDate;
  }

  const queryDate = params.query ? extractFirstDate(params.query) : null;
  if (queryDate) {
    return queryDate;
  }

  return normalizeDateOnly(params.asOfDate);
}

export function filterHitsByReferenceDate(
  hits: SearchHit[],
  referenceDate: string | null | undefined,
): SearchHit[] {
  const referenceTimestamp = parseLooseDate(referenceDate ?? null);
  if (referenceTimestamp === null) {
    return hits;
  }

  return hits.filter((hit) => {
    const timestamp = hitTimestamp(hit);
    return timestamp === null || timestamp <= referenceTimestamp;
  });
}

export function sortHitsByReferenceDate(
  hits: SearchHit[],
  referenceDate: string | null | undefined,
): SearchHit[] {
  const referenceTimestamp = parseLooseDate(referenceDate ?? null);
  return [...hits].sort((a, b) => compareWithReference(a, b, referenceTimestamp));
}

export function rankHitsForReferenceDate(
  hits: SearchHit[],
  referenceDate: string | null | undefined,
  limit?: number,
): SearchHit[] {
  const filtered = filterHitsByReferenceDate(hits, referenceDate);
  const sorted = sortHitsByReferenceDate(filtered, referenceDate);
  return sorted.slice(0, limit ?? sorted.length);
}
