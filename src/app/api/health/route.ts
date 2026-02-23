import { NextResponse } from "next/server";
import { getGuidelineCounts, initDb } from "@/lib/db";
import { getSourceStatus } from "@/lib/source-sync";

export const runtime = "nodejs";

export async function GET() {
  initDb();
  const counts = getGuidelineCounts();
  const sources = getSourceStatus();
  const activeSources = sources.filter((source) => source.downloaded_count > 0 || source.online_only_count > 0).length;

  return NextResponse.json({
    ok: true,
    service: "oncology-mvp",
    timestamp: new Date().toISOString(),
    counts,
    llm_enabled: Boolean(process.env.OPENAI_API_KEY),
    llm_model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    doctor_validation_mode: "rules_plus_rag_kag_llm",
    patient_explanation_mode: "llm_only",
    sources_total: sources.length,
    sources_active: activeSources,
    sources,
  });
}
