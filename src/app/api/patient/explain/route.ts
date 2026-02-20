import { NextResponse } from "next/server";
import { patientExplainRequestSchema } from "@/lib/types";
import { buildPatientExplanation } from "@/lib/llm";
import { validateCase } from "@/lib/validation/rule-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = patientExplainRequestSchema.parse(payload);

    const validation = parsed.validation ?? validateCase(parsed.case_input);
    const explanation = await buildPatientExplanation(
      parsed.case_input,
      validation,
      parsed.force_fallback,
    );

    return NextResponse.json({
      validation,
      explanation,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Некорректный запрос пациентского объяснения",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 400 },
    );
  }
}
