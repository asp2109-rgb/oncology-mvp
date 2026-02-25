import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDbProviderInfo } from "@/lib/db";
import { caseInputSchema, doctorValidationRequestSchema } from "@/lib/types";
import { validateCase, type ValidationOptions } from "@/lib/validation/rule-engine";
import { buildDoctorLlmReview } from "@/lib/doctor-llm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = getDbProviderInfo();
    if (db.requested === "supabase" && db.active !== "supabase") {
      return NextResponse.json(
        {
          error: "Supabase не активен на сервере",
          details:
            "ONCO_DB_PROVIDER=supabase, но приложение работает в SQLite fallback. Проверьте env в Render: URL (SUPABASE_URL или NEXT_PUBLIC_SUPABASE_URL, либо SUPABASE_PROJECT_REF) и ключ (SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_KEY).",
          db,
        },
        { status: 503 },
      );
    }

    const payload = await request.json();
    const parsedRequest = doctorValidationRequestSchema.safeParse(payload);

    const caseInput = parsedRequest.success
      ? parsedRequest.data.case_input
      : caseInputSchema.parse(payload);

    const validationOptions: ValidationOptions = {
      // Single-source mode: always validate against local Minzdrav KR.
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      retrieval_mode: parsedRequest.success ? parsedRequest.data.retrieval_mode : "standard",
      online_fallback: false,
    };

    const result = await validateCase(caseInput, validationOptions);

    try {
      const llmReview = await buildDoctorLlmReview(caseInput, result);

      return NextResponse.json({
        ...result,
        llm_review: llmReview,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : "Неизвестная ошибка LLM";
      if (details.includes("OPENAI_API_KEY")) {
        return NextResponse.json({
          ...result,
          llm_review: null,
          llm_fallback: "rules_only",
          warnings: [...result.warnings, "LLM недоступен, возвращен режим rules-only."],
        });
      }

      throw error;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Некорректный запрос валидации",
          details: error.message,
        },
        { status: 400 },
      );
    }

    const details = error instanceof Error ? error.message : "Неизвестная ошибка";
    const status = details.includes("OPENAI_API_KEY") ? 503 : 502;

    return NextResponse.json(
      {
        error: "Не удалось выполнить LLM-проверку врача",
        details,
      },
      { status },
    );
  }
}
