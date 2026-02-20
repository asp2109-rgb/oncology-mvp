import { NextResponse } from "next/server";
import { caseInputSchema } from "@/lib/types";
import { validateCase } from "@/lib/validation/rule-engine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const caseInput = caseInputSchema.parse(payload);

    const result = validateCase(caseInput);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Некорректный запрос валидации",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 400 },
    );
  }
}
