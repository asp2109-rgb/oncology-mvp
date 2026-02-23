import { NextResponse } from "next/server";
import { guidelineSearchRequestSchema } from "@/lib/types";
import {
  searchWithProviders,
  RuleIndexProvider,
  SourceDocumentProvider,
  SqlFtsProvider,
} from "@/lib/search/providers";
import { searchOnlineSources } from "@/lib/search/online";

export const runtime = "nodejs";

const sqlProvider = new SqlFtsProvider();
const ruleProvider = new RuleIndexProvider();
const sourceDocumentProvider = new SourceDocumentProvider();

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = guidelineSearchRequestSchema.parse(payload);

    const localHits = searchWithProviders([sqlProvider, ruleProvider, sourceDocumentProvider], parsed.query, {
      guideline_ids: parsed.guideline_ids,
      sources: parsed.sources,
      limit: parsed.limit,
    });

    const onlineHits = parsed.allow_online
      ? await searchOnlineSources(parsed.query, parsed.sources, Math.max(3, Math.floor(parsed.limit / 2)))
      : [];

    const merged = Array.from(
      new Map(
        [...localHits, ...onlineHits].map((hit) => [`${hit.source}:${hit.chunk_id}`, hit]),
      ).values(),
    )
      .sort((a, b) => a.score - b.score)
      .slice(0, parsed.limit);

    return NextResponse.json({
      query: parsed.query,
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
