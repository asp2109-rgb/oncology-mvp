import { NextResponse } from "next/server";
import { caseInputSchema } from "@/lib/types";
import { extractTextFromFile, suggestCaseFromText } from "@/lib/case-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const rawText = String(formData.get("text") ?? "").trim();
    const file = formData.get("file") as File | null;

    if (!rawText && !file) {
      return NextResponse.json(
        {
          error: "Нужно передать текст или файл",
        },
        { status: 400 },
      );
    }

    let text = rawText;
    let sourceName = "вставленный_текст";
    let detectedFormat = "text";
    let warnings: string[] = [];

    if (file) {
      const parsed = await extractTextFromFile(file);
      text = `${text}\n${parsed.text}`.trim();
      sourceName = file.name;
      detectedFormat = parsed.format;
      warnings = parsed.warnings;
    }

    if (!text || text.length < 10) {
      return NextResponse.json(
        {
          error: "Не удалось извлечь содержательный текст из входа",
          warnings,
        },
        { status: 422 },
      );
    }

    const maybeJson = text.trim();
    if (maybeJson.startsWith("{") || maybeJson.startsWith("[")) {
      try {
        const parsedJson = JSON.parse(maybeJson);
        const parsedCase = caseInputSchema.safeParse(parsedJson);
        if (parsedCase.success) {
          return NextResponse.json({
            source: sourceName,
            detected_format: "json_case_input",
            text_length: text.length,
            preview: text.slice(0, 2000),
            warnings,
            case_input: parsedCase.data,
          });
        }
      } catch {
        // fallback to text parser
      }
    }

    const suggestedCase = suggestCaseFromText(text);

    return NextResponse.json({
      source: sourceName,
      detected_format: detectedFormat,
      text_length: text.length,
      preview: text.slice(0, 3000),
      warnings,
      case_input: suggestedCase,
      supported_formats: [
        "pdf",
        "doc",
        "docx",
        "txt",
        "md",
        "csv",
        "tsv",
        "json",
        "rtf",
        "xml",
        "html",
        "yaml",
        "yml",
        "log",
        "ini",
        "other (best effort)",
      ],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Ошибка разбора входных данных",
        details: error instanceof Error ? error.message : "Неизвестная ошибка",
      },
      { status: 500 },
    );
  }
}
