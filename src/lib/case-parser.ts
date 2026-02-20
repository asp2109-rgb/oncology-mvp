import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import type { CaseInput } from "@/lib/types";

type ParsedFileText = {
  text: string;
  format: string;
  warnings: string[];
};

const TEXT_LIKE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".log",
  ".ini",
  ".cfg",
  ".conf",
  ".yaml",
  ".yml",
  ".json",
  ".rtf",
  ".xml",
  ".html",
  ".htm",
  ".tex",
  ".sql",
  ".ndjson",
]);

function toIsoDate(day: string, month: string, year: string): string {
  const dd = day.padStart(2, "0");
  const mm = month.padStart(2, "0");
  const yyyy = year.length === 2 ? `20${year}` : year;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeDate(value: string): string | null {
  const trimmed = value.trim();

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const ru = trimmed.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})$/);
  if (ru) {
    return toIsoDate(ru[1], ru[2], ru[3]);
  }

  return null;
}

function extractDates(text: string): string[] {
  const dates = new Set<string>();

  const regexes = [
    /\b(\d{4}-\d{2}-\d{2})\b/g,
    /\b(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\b/g,
  ];

  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      const normalized = normalizeDate(match[1]);
      if (normalized) {
        dates.add(normalized);
      }
    }
  }

  return Array.from(dates).sort();
}

function detectDiagnosis(text: string): string {
  const diagnosisMatch = text.match(/(?:диагноз|diagnosis)\s*[:\-]\s*([^\n\r]+)/i);
  if (diagnosisMatch?.[1]) {
    return diagnosisMatch[1].trim();
  }

  const candidate = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /рак|опухол|carcinoma|cancer|сарком|лимфом/i.test(line) && line.length > 7);

  if (candidate) {
    return candidate;
  }

  return "Не удалось автоматически определить диагноз";
}

function detectStage(text: string): string {
  const stageMatch = text.match(/(?:стадия|ст\.?|stage)\s*[:\-]?\s*([^\n\r]+)/i);
  if (stageMatch?.[1]) {
    return stageMatch[1].trim();
  }

  return "";
}

function detectBiomarkers(text: string): string[] {
  const markers = new Set<string>();

  const markerRegex = /(?:ER\s*[-=]?\s*\d+|PR\s*[-=]?\s*\d+|HER2\s*[-+]?\s*\d*\+?|PD-?L1\s*[^\n,;]*|BRCA1\/2|BRCA1|BRCA2|KI-?67\s*[-=]?\s*\d+%?|TMB\s*[-=]?\s*[0-9\.]+)/gi;

  for (const match of text.matchAll(markerRegex)) {
    markers.add(match[0].replace(/\s+/g, " ").trim());
  }

  return Array.from(markers).slice(0, 20);
}

function detectCurrentPlan(text: string): string[] {
  const keywords = [
    "рекоменду",
    "схема",
    "хт",
    "пхт",
    "мхт",
    "терап",
    "операц",
    "химио",
    "доксорубицин",
    "паклитаксел",
    "карбоплатин",
    "цисплатин",
    "иринотекан",
    "винорельбин",
    "капецитабин",
    "атезолизумаб",
    "лучев",
    "flot",
    "folfox",
  ];

  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•\d\.\)\s]+/, "").trim())
    .filter((line) => line.length > 8);

  const selected = lines.filter((line) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  if (selected.length > 0) {
    return selected.slice(0, 12);
  }

  return lines.slice(0, 6);
}

function detectTimeline(text: string): CaseInput["timeline"] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const timeline: CaseInput["timeline"] = [];

  for (const line of lines) {
    const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/);
    if (!dateMatch) {
      continue;
    }

    const date = normalizeDate(dateMatch[1]);
    if (!date) {
      continue;
    }

    let eventType = "clinical_event";
    const lower = line.toLowerCase();

    if (lower.includes("прогресс")) {
      eventType = "progression";
    } else if (lower.includes("консилиум")) {
      eventType = "tumor_board";
    } else if (lower.includes("биопс")) {
      eventType = "biopsy";
    } else if (lower.includes("пэт") || lower.includes("кт") || lower.includes("мрт")) {
      eventType = "imaging";
    } else if (lower.includes("курс") || lower.includes("терап")) {
      eventType = "therapy";
    }

    timeline.push({
      event_date: date,
      event_type: eventType,
      payload: {
        note: line.slice(0, 700),
      },
    });
  }

  return timeline.slice(0, 60);
}

function decodeText(buffer: Buffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (utf8.includes("\u0000")) {
    return utf8.replace(/\u0000/g, " ");
  }
  return utf8;
}

async function extractFromDoc(filePath: string): Promise<string> {
  const wordExtractorModule = await import("word-extractor");
  const WordExtractorCtor = (wordExtractorModule.default ?? wordExtractorModule) as unknown as new () => {
    extract: (input: string) => Promise<{ getBody: () => string }>;
  };

  const extractor = new WordExtractorCtor();
  const document = await extractor.extract(filePath);
  return document.getBody();
}

function decodeBinaryAsText(buffer: Buffer): string {
  return decodeText(buffer)
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u0400-\u04FF]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function extractTextFromFile(file: File): Promise<ParsedFileText> {
  const warnings: string[] = [];
  const ext = path.extname(file.name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (ext === ".pdf") {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      let parsedText = "";

      try {
        const parsed = await parser.getText();
        parsedText = parsed.text;
      } finally {
        await parser.destroy().catch(() => undefined);
      }

      return {
        text: parsedText,
        format: "pdf",
        warnings,
      };
    } catch (error) {
      warnings.push(
        `PDF не удалось разобрать стандартным парсером: ${error instanceof Error ? error.message : "ошибка"}. Использован fallback-декодер; для сканов нужен OCR.`,
      );
    }

    return {
      text: decodeBinaryAsText(buffer),
      format: "pdf",
      warnings,
    };
  }

  if (ext === ".docx") {
    try {
      const parsed = await mammoth.extractRawText({ buffer });
      if (parsed.messages.length > 0) {
        warnings.push(...parsed.messages.map((message) => message.message));
      }

      return {
        text: parsed.value,
        format: "docx",
        warnings,
      };
    } catch (error) {
      warnings.push(
        `DOCX не удалось разобрать стандартным парсером: ${error instanceof Error ? error.message : "ошибка"}. Использован fallback-декодер.`,
      );
    }

    return {
      text: decodeBinaryAsText(buffer),
      format: "docx",
      warnings,
    };
  }

  if (ext === ".doc") {
    const tempFile = path.join(os.tmpdir(), `onco-doc-${randomUUID()}.doc`);
    try {
      await fs.writeFile(tempFile, buffer);
      const text = await extractFromDoc(tempFile);
      return {
        text,
        format: "doc",
        warnings,
      };
    } catch (error) {
      warnings.push(
        `DOC не удалось разобрать стандартным парсером: ${error instanceof Error ? error.message : "ошибка"}. Использован fallback-декодер.`,
      );
      return {
        text: decodeBinaryAsText(buffer),
        format: "doc",
        warnings,
      };
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  }

  if (TEXT_LIKE_EXTENSIONS.has(ext) || file.type.startsWith("text/")) {
    return {
      text: decodeText(buffer),
      format: ext.replace(".", "") || "text",
      warnings,
    };
  }

  warnings.push(`Формат ${ext || file.type || "unknown"} распознан частично, выполнено текстовое декодирование.`);
  return {
    text: decodeBinaryAsText(buffer),
    format: ext.replace(".", "") || file.type || "binary",
    warnings,
  };
}

export function suggestCaseFromText(text: string): CaseInput {
  const diagnosis = detectDiagnosis(text);
  const stage = detectStage(text);
  const biomarkers = detectBiomarkers(text);
  const currentPlan = detectCurrentPlan(text);
  const timeline = detectTimeline(text);

  const allDates = extractDates(text);
  const asOfDate = allDates.at(-1) ?? new Date().toISOString().slice(0, 10);

  return {
    diagnosis,
    stage,
    biomarkers,
    timeline,
    current_plan: currentPlan,
    as_of_date: asOfDate,
  };
}
