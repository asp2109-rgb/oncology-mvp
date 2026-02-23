import { NextResponse } from "next/server";
import { getSourceStatus } from "@/lib/source-sync";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sources = getSourceStatus();
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      total_sources: sources.length,
      sources,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Не удалось получить статус источников",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
