import { ZodError } from "zod";
import { buildPatientExplanation } from "@/lib/llm";
import type { PatientExplanation } from "@/lib/types";
import { exportPdfRequestSchema } from "@/lib/types";
import { buildPatientPdfFilename, generatePatientPdf } from "@/lib/pdf/export";
import { validateCase, type ValidationOptions } from "@/lib/validation/rule-engine";

export const runtime = "nodejs";

function fallbackPatientExplanation(): PatientExplanation {
  return {
    plain_summary: "План лечения сформирован врачом и проверен по клиническим рекомендациям.",
    why_this_is_recommended:
      "Решение учитывает диагноз, стадию, анализы и молекулярные маркеры. Для деталей обсудите схему и риски с лечащим врачом.",
    questions_for_doctor: [
      "Какова цель текущей линии терапии?",
      "Какие анализы нужно сдавать перед следующим циклом?",
      "Какие симптомы требуют срочного обращения?",
    ],
    sources: [],
  };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = exportPdfRequestSchema.parse(payload);
    const patientValidationOptions: ValidationOptions = {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      retrieval_mode: "standard",
      online_fallback: false,
    };

    const patientValidation = await validateCase(parsed.case_input, patientValidationOptions);
    let explanation: PatientExplanation;

    try {
      const llm = await buildPatientExplanation(parsed.case_input, patientValidation);
      explanation = llm.explanation;
    } catch {
      explanation = fallbackPatientExplanation();
    }

    const pdf = await generatePatientPdf({
      caseInput: parsed.case_input,
      validation: patientValidation,
      explanation,
    });
    const filename = buildPatientPdfFilename(parsed.case_input);

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Некорректный запрос на экспорт patient PDF",
          details: error.message,
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: "Не удалось сформировать patient PDF",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
