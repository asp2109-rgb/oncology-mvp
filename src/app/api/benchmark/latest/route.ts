import { NextResponse } from "next/server";
import { getLatestBenchmarkRun } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const report = getLatestBenchmarkRun();

  if (!report) {
    return NextResponse.json({ error: "Отчётов бенчмарка пока нет" }, { status: 404 });
  }

  return NextResponse.json(report);
}
