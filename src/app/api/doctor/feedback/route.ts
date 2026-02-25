import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { doctorFeedbackRequestSchema } from "@/lib/types";
import { saveDoctorFeedback } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = doctorFeedbackRequestSchema.parse(payload);
    const saved = await saveDoctorFeedback({
      validation_run_id: parsed.validation_run_id,
      rating: parsed.rating,
      comment: parsed.comment.trim(),
    });

    return NextResponse.json({
      ok: true,
      ...saved,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Некорректный запрос feedback",
          details: error.message,
        },
        { status: 400 },
      );
    }

    const details = error instanceof Error ? error.message : "Неизвестная ошибка";
    const status = details.toLowerCase().includes("foreign key") ? 404 : 500;

    return NextResponse.json(
      {
        error: "Не удалось сохранить feedback",
        details,
      },
      { status },
    );
  }
}
