import fs from "node:fs";
import PDFDocument from "pdfkit";
import type { CaseInput, DoctorValidationResponse, PatientExplanation, ValidationResult } from "@/lib/types";

type PdfFontSource = Buffer | string;

let bundledFontBuffer: Buffer | null | undefined;

function resolveBundledFontBuffer(): Buffer | null {
  if (bundledFontBuffer !== undefined) {
    return bundledFontBuffer;
  }

  try {
    bundledFontBuffer = fs.readFileSync(new URL("./fonts/LiberationSans-Regular.ttf", import.meta.url));
  } catch {
    bundledFontBuffer = null;
  }

  return bundledFontBuffer;
}

function resolveReadableFontPath(): string | null {
  const candidates = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolvePdfFontSource(): PdfFontSource {
  const bundled = resolveBundledFontBuffer();
  if (bundled) {
    return bundled;
  }

  const readablePath = resolveReadableFontPath();
  if (readablePath) {
    return readablePath;
  }

  throw new Error("Не найден ни встроенный, ни системный шрифт для генерации PDF.");
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function writeList(
  doc: PDFKit.PDFDocument,
  title: string,
  values: string[],
  options: {
    emptyText?: string;
    titleColor?: string;
    itemColor?: string;
    bullet?: string;
  } = {},
) {
  const emptyText = options.emptyText ?? "Нет данных";
  const titleColor = options.titleColor ?? "#0f172a";
  const itemColor = options.itemColor ?? "#0f172a";
  const bullet = options.bullet ?? "•";

  doc.fontSize(12).fillColor(titleColor).text(title, { underline: true });
  doc.moveDown(0.25);
  if (!values.length) {
    doc.fontSize(10).fillColor("#334155").text(emptyText);
    doc.moveDown(0.5);
    return;
  }

  for (const value of values) {
    doc.fontSize(10).fillColor(itemColor).text(`${bullet} ${value}`);
  }
  doc.fillColor("#0f172a");
  doc.moveDown(0.5);
}

function statusColor(status: DoctorValidationResponse["status"]): string {
  return status === "compliant" ? "#15803d" : "#b91c1c";
}

function statusText(status: DoctorValidationResponse["status"]): string {
  return status === "compliant" ? "соответствует" : "требует уточнений/коррекции";
}

function safeFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export function buildCommissionPdfFilename(caseInput: CaseInput): string {
  const base = safeFilename(caseInput.nosology_label_ru || caseInput.diagnosis || "case");
  return `commission-report-${base || "case"}.pdf`;
}

export function buildPatientPdfFilename(caseInput: CaseInput): string {
  const base = safeFilename(caseInput.nosology_label_ru || caseInput.diagnosis || "case");
  return `patient-report-${base || "case"}.pdf`;
}

function createPdfDocument(info: { Title: string; Author: string; Subject: string }): PDFKit.PDFDocument {
  const fontSource = resolvePdfFontSource();
  const doc = new PDFDocument({
    size: "A4",
    margin: 44,
    // Explicitly disable default Helvetica so pdfkit does not read AFM files from node_modules at runtime.
    font: null as unknown as string,
    info,
  });

  doc.font(fontSource);
  return doc;
}

export async function generateCommissionPdf(caseInput: CaseInput, validation: DoctorValidationResponse): Promise<Buffer> {
  const doc = createPdfDocument({
    Title: "Обоснование назначения для ВКК",
    Author: "Onco Protocol Check",
    Subject: "Валидация назначения",
  });

  doc.fontSize(16).fillColor("#0f172a").text("Обоснование назначения лекарственной терапии (ВКК)");
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor("#0f172a").text(`Диагноз: ${caseInput.diagnosis}`);
  doc.text(`МКБ-10: ${caseInput.icd10_code || "не определен"} ${caseInput.icd10_name_ru ? `(${caseInput.icd10_name_ru})` : ""}`);
  doc.text(`Стадия: ${(caseInput.stage_numeric ?? caseInput.stage) || "не указана"}`);
  doc.text(`Линия терапии: ${caseInput.planned_therapy_line ?? "не указана"}`);
  doc.text(`Режим/протокол: ${caseInput.regimen_protocol || "не указан"}`);
  if (caseInput.protocol_assignment_date) {
    doc.text(`Дата назначения протокола: ${caseInput.protocol_assignment_date}`);
  }
  doc.moveDown(0.8);

  doc.fontSize(12).fillColor("#0f172a").text("Общий вывод", { underline: true });
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor(statusColor(validation.status)).text(
    `Назначение ${statusText(validation.status)} клиническим рекомендациям.`,
  );
  doc.fillColor("#0f172a");
  doc.moveDown(0.6);

  const redDataGaps = Array.from(new Set(validation.missing_actions));
  const uncertainWarnings = Array.from(new Set(validation.warnings));
  writeList(doc, "Совпадения (зеленый)", validation.matches, {
    titleColor: "#14532d",
    itemColor: "#166534",
  });
  writeList(doc, "Несоответствия (красный)", validation.mismatches, {
    titleColor: "#7f1d1d",
    itemColor: "#b91c1c",
  });
  writeList(doc, "Факторы риска / конфликты (красный)", validation.conflicts, {
    titleColor: "#7f1d1d",
    itemColor: "#b91c1c",
  });
  writeList(doc, "Недостаточно данных / отклонение (красный)", redDataGaps, {
    titleColor: "#7f1d1d",
    itemColor: "#b91c1c",
  });
  writeList(doc, "Технические предупреждения (желтый)", uncertainWarnings, {
    titleColor: "#78350f",
    itemColor: "#a16207",
  });

  doc.fontSize(12).fillColor("#0f172a").text("Ключевые источники и цитаты", { underline: true });
  doc.moveDown(0.25);
  const topEvidence = validation.evidence.slice(0, 8);
  if (!topEvidence.length) {
    doc.fontSize(10).fillColor("#334155").text("Нет данных по источникам.");
  } else {
    for (const hit of topEvidence) {
      doc
        .fontSize(10)
        .fillColor("#0f172a")
        .text(`${hit.guideline_name} / ${hit.section_title} (${hit.source}, ${hit.access_mode})`);
      doc.fontSize(9).fillColor("#334155").text(hit.chunk_text.slice(0, 260));
      if (hit.document_url) {
        doc.fontSize(9).fillColor("#0369a1").text(hit.document_url);
      }
      doc.moveDown(0.25);
    }
  }

  doc.moveDown(0.6);
  doc.fontSize(9).fillColor("#334155").text(`Сформировано: ${new Date().toLocaleString("ru-RU")}`);
  doc.text(`Validation run ID: ${validation.validation_run_id ?? "n/a"}`);

  return pdfToBuffer(doc);
}

export async function generatePatientPdf(params: {
  caseInput: CaseInput;
  validation: ValidationResult;
  explanation: PatientExplanation;
}): Promise<Buffer> {
  const { caseInput, explanation } = params;
  const doc = createPdfDocument({
    Title: "Информация для пациента",
    Author: "Onco Protocol Check",
    Subject: "Объяснение назначения",
  });

  doc.fontSize(16).fillColor("#0f172a").text("Пояснение по плану лечения для пациента");
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor("#0f172a").text(`Диагноз: ${caseInput.diagnosis}`);
  doc.text(`Стадия: ${(caseInput.stage_numeric ?? caseInput.stage) || "не указана"}`);
  doc.text("Статус проверки: план лечения обоснован клиническими рекомендациями.");
  doc.moveDown(0.6);

  doc.fontSize(12).fillColor("#0f172a").text("Что это значит", { underline: true });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#0f172a").text(explanation.plain_summary || "Пояснение недоступно.");
  doc.moveDown(0.5);

  doc.fontSize(12).fillColor("#0f172a").text("Почему предложено такое лечение", { underline: true });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#0f172a").text(explanation.why_this_is_recommended || "Нет данных.");
  doc.moveDown(0.5);

  writeList(doc, "Вопросы к врачу", explanation.questions_for_doctor);

  doc.fontSize(12).fillColor("#0f172a").text("Источники", { underline: true });
  doc.moveDown(0.2);
  if (!explanation.sources.length) {
    doc.fontSize(10).fillColor("#334155").text("Источники не указаны.");
  } else {
    for (const source of explanation.sources.slice(0, 10)) {
      doc.fontSize(10).fillColor("#0f172a").text(`${source.guideline_name} (${source.guideline_id})`);
      if (source.source_url) {
        doc.fontSize(9).fillColor("#0369a1").text(source.source_url);
      }
      doc.moveDown(0.15);
    }
  }

  doc.moveDown(0.6);
  doc.fontSize(9).fillColor("#334155").text("Примечание: файл содержит объяснения и не включает служебные разделы разногласий.");
  doc.text(`Сформировано: ${new Date().toLocaleString("ru-RU")}`);

  return pdfToBuffer(doc);
}
