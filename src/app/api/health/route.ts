import { NextResponse } from "next/server";
import { getDbProviderInfo, getGuidelineCounts, initDb } from "@/lib/db";
import { getSourceStatus } from "@/lib/source-sync";
import { getSupabaseConfigState } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  initDb();
  const counts = await getGuidelineCounts();
  const sources = await getSourceStatus();
  const activeSources = sources.filter((source) => source.downloaded_count > 0 || source.online_only_count > 0).length;
  const db = getDbProviderInfo();
  const supabase = getSupabaseConfigState();

  return NextResponse.json({
    ok: true,
    service: "oncology-mvp",
    timestamp: new Date().toISOString(),
    db,
    supabase,
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
