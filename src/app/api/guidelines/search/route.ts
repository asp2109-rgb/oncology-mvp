import { NextResponse } from "next/server";
import { guidelineSearchRequestSchema } from "@/lib/types";
import {
  searchWithProviders,
  RuleIndexProvider,
  SourceDocumentProvider,
  SqlFtsProvider,
} from "@/lib/search/providers";
import { searchOnlineSources } from "@/lib/search/online";
import { rankHitsForReferenceDate, resolveReferenceDate } from "@/lib/search/retrospective";

export const runtime = "nodejs";

const sqlProvider = new SqlFtsProvider();
const ruleProvider = new RuleIndexProvider();
const sourceDocumentProvider = new SourceDocumentProvider();

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = guidelineSearchRequestSchema.parse(payload);
    const referenceDate = resolveReferenceDate({
      eventDate: parsed.event_date,
      asOfDate: parsed.as_of_date,
      query: parsed.query,
    });

    const localHits = await searchWithProviders([sqlProvider, ruleProvider, sourceDocumentProvider], parsed.query, {
      guideline_ids: parsed.guideline_ids,
      sources: parsed.sources,
      as_of_date: referenceDate ?? undefined,
      limit: parsed.limit,
    });

    const onlineHits = parsed.allow_online
      ? await searchOnlineSources(parsed.query, parsed.sources, Math.max(3, Math.floor(parsed.limit / 2)), {
          as_of_date: referenceDate ?? undefined,
        })
      : [];

    const merged = rankHitsForReferenceDate(
      Array.from(
      new Map(
        [...localHits, ...onlineHits].map((hit) => [`${hit.source}:${hit.chunk_id}`, hit]),
      ).values(),
      ),
      referenceDate,
      parsed.limit,
    );

    return NextResponse.json({
      query: parsed.query,
      reference_date: referenceDate,
      total: merged.length,
      retrieval_mode: parsed.retrieval_mode,
      allow_online: parsed.allow_online,
      hits: merged,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Некорректный payload запроса",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 400 },
    );
  }
}
