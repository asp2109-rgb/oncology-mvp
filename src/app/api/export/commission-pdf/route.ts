import { ZodError } from "zod";
import { exportPdfRequestSchema } from "@/lib/types";
import { buildCommissionPdfFilename, generateCommissionPdf } from "@/lib/pdf/export";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = exportPdfRequestSchema.parse(payload);
    const pdf = await generateCommissionPdf(parsed.case_input, parsed.validation);
    const filename = buildCommissionPdfFilename(parsed.case_input);

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
          error: "Некорректный запрос на экспорт PDF для комиссии",
          details: error.message,
        },
        { status: 400 },
      );
    }

    return Response.json(
      {
        error: "Не удалось сформировать PDF для комиссии",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
