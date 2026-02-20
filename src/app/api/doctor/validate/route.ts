import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { caseInputSchema } from "@/lib/types";
import { validateCase } from "@/lib/validation/rule-engine";
import { buildDoctorLlmReview } from "@/lib/doctor-llm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const caseInput = caseInputSchema.parse(payload);

    const result = validateCase(caseInput);
    const llmReview = await buildDoctorLlmReview(caseInput, result);

    return NextResponse.json({
      ...result,
      llm_review: llmReview,
    });
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
