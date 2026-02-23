import { NextResponse } from "next/server";
import { sourceSyncRequestSchema } from "@/lib/types";
import { syncSources } from "@/lib/source-sync";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let payload: unknown = {};
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const parsed = sourceSyncRequestSchema.parse(payload);
    const summary = await syncSources({ sources: parsed.sources });

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Не удалось выполнить синхронизацию источников",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
