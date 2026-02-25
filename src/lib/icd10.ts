import fs from "node:fs";
import path from "node:path";

type Icd10Record = {
  code: string;
  name_ru: string;
  is_group: boolean;
};

type Icd10Resolution = {
  icd10_code: string;
  icd10_name_ru: string;
  nosology_label_ru: string;
};

const ICD10_PATH = path.join(process.cwd(), "data", "icd10-ru.json");

let cache: Icd10Record[] | null = null;
let indexByCode: Map<string, Icd10Record> | null = null;

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeIcd10Code(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(",", ".")
    .replace(/\s+/g, "");

  const compact = normalized.match(/^([A-Z])(\d{2})(\d)$/);
  if (compact) {
    return `${compact[1]}${compact[2]}.${compact[3]}`;
  }

  return normalized;
}

function loadIcd10Records(): Icd10Record[] {
  if (cache) {
    return cache;
  }

  try {
    const raw = fs.readFileSync(ICD10_PATH, "utf8");
    const parsed = JSON.parse(raw) as Icd10Record[];
    cache = parsed
      .map((item) => ({
        code: normalizeIcd10Code(String(item.code ?? "")),
        name_ru: normalizeSpaces(String(item.name_ru ?? "")),
        is_group: Boolean(item.is_group),
      }))
      .filter((item) => item.code.length >= 3 && item.name_ru.length > 1);
    indexByCode = new Map(cache.map((item) => [item.code, item]));
  } catch {
    cache = [];
    indexByCode = new Map();
  }

  return cache;
}

function getCodeIndex(): Map<string, Icd10Record> {
  if (!indexByCode) {
    loadIcd10Records();
  }
  return indexByCode ?? new Map();
}

function resolveNosologyLabel(record: Icd10Record): string {
  const index = getCodeIndex();
  const parentCode = record.code.split(".")[0];
  const parent = index.get(parentCode);
  return parent?.name_ru ?? record.name_ru;
}

export function lookupIcd10ByCode(value: string | null | undefined): Icd10Resolution | null {
  if (!value) {
    return null;
  }

  const code = normalizeIcd10Code(value);
  if (!code) {
    return null;
  }

  const index = getCodeIndex();
  const direct = index.get(code);
  if (direct) {
    return {
      icd10_code: direct.code,
      icd10_name_ru: direct.name_ru,
      nosology_label_ru: resolveNosologyLabel(direct),
    };
  }

  const prefix = code.split(".")[0];
  const fallback = index.get(prefix);
  if (fallback) {
    return {
      icd10_code: fallback.code,
      icd10_name_ru: fallback.name_ru,
      nosology_label_ru: resolveNosologyLabel(fallback),
    };
  }

  return null;
}

export function extractIcd10CodeFromText(text: string): string {
  const match = text.match(/\b([CD]\d{2}(?:\.\d)?)\b/i);
  if (!match?.[1]) {
    return "";
  }
  return normalizeIcd10Code(match[1]);
}

function tokenizeDiagnosis(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s-]/gi, " ")
        .split(/\s+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ),
  ).slice(0, 10);
}

function fuzzyLookupByDiagnosis(diagnosis: string): Icd10Resolution | null {
  const records = loadIcd10Records();
  if (!records.length) {
    return null;
  }

  const tokens = tokenizeDiagnosis(diagnosis);
  if (!tokens.length) {
    return null;
  }

  let best: { record: Icd10Record; score: number } | null = null;

  for (const record of records) {
    if (record.is_group) {
      continue;
    }
    if (!/^[CD]\d{2}(?:\.\d)?$/.test(record.code)) {
      continue;
    }

    const haystack = record.name_ru.toLowerCase();
    const score = tokens.reduce((acc, token) => (haystack.includes(token) ? acc + 1 : acc), 0);
    if (score === 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { record, score };
    }
  }

  if (!best || best.score < 2) {
    return null;
  }

  return {
    icd10_code: best.record.code,
    icd10_name_ru: best.record.name_ru,
    nosology_label_ru: resolveNosologyLabel(best.record),
  };
}

export function resolveIcd10Info(params: {
  diagnosis: string;
  icd10_code?: string | null;
}): Icd10Resolution | null {
  const fromCode = lookupIcd10ByCode(params.icd10_code);
  if (fromCode) {
    return fromCode;
  }

  const fromDiagnosisCode = lookupIcd10ByCode(extractIcd10CodeFromText(params.diagnosis));
  if (fromDiagnosisCode) {
    return fromDiagnosisCode;
  }

  return fuzzyLookupByDiagnosis(params.diagnosis);
}
