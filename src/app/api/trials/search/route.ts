import { NextResponse } from "next/server";
import { searchTrials } from "@/lib/trials";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim() ?? "";

    if (!query) {
      return NextResponse.json({ error: "Параметр query обязателен" }, { status: 400 });
    }

    const recruiting = searchParams.get("recruiting") === "true";
    const result = await searchTrials(query, recruiting, 20);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Не удалось получить данные clinicaltrials.gov",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
