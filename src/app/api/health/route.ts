import { NextResponse } from "next/server";
import { getGuidelineCounts, initDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  initDb();
  const counts = getGuidelineCounts();

  return NextResponse.json({
    ok: true,
    service: "oncology-mvp",
    timestamp: new Date().toISOString(),
    counts,
    llm_enabled: Boolean(process.env.OPENAI_API_KEY),
  });
}
