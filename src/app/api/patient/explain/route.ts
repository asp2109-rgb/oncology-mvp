import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { patientExplainRequestSchema } from "@/lib/types";
import { buildPatientExplanation } from "@/lib/llm";
import { validateCase, type ValidationOptions } from "@/lib/validation/rule-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = patientExplainRequestSchema.parse(payload);

    const patientValidationOptions: ValidationOptions = {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      retrieval_mode: "standard",
      online_fallback: false,
    };

    const validation = await validateCase(parsed.case_input, patientValidationOptions);
    const llmResult = await buildPatientExplanation(
      parsed.case_input,
      validation,
    );

    return NextResponse.json({
      validation,
      explanation: llmResult.explanation,
      llm: llmResult.llm,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Некорректный запрос пациентского объяснения",
          details: error.message,
        },
        { status: 400 },
      );
    }

    const details = error instanceof Error ? error.message : "Неизвестная ошибка";
    const status = details.includes("OPENAI_API_KEY") ? 503 : 502;

    return NextResponse.json(
      {
        error: "Не удалось получить объяснение от LLM",
        details,
      },
      { status },
    );
  }
}
