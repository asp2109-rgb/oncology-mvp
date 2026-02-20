import { NextResponse } from "next/server";
import { guidelineSearchRequestSchema } from "@/lib/types";
import { searchWithProviders, RuleIndexProvider, SqlFtsProvider } from "@/lib/search/providers";

export const runtime = "nodejs";

const sqlProvider = new SqlFtsProvider();
const ruleProvider = new RuleIndexProvider();

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = guidelineSearchRequestSchema.parse(payload);

    const hits = searchWithProviders([sqlProvider, ruleProvider], parsed.query, {
      guideline_ids: parsed.guideline_ids,
      limit: parsed.limit,
    });

    return NextResponse.json({
      query: parsed.query,
      total: hits.length,
      hits,
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
