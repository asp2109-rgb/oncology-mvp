import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { extractIcd10CodeFromText, resolveIcd10Info } from "@/lib/icd10";
import type { CaseInput, ExcludedPersonalDataItem, PlannedDrug, TreatmentHistoryEntry } from "@/lib/types";

type ParsedFileText = {
  text: string;
  format: string;
  warnings: string[];
};

type PreparedCaseText = {
  text: string;
  anonymized: boolean;
  redactedFioCount: number;
  excluded_personal_data: ExcludedPersonalDataItem[];
  privacy_notice: string;
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

const COMORBIDITY_KEYWORDS = ["тромбоз", "диабет", "почеч", "гипертенз", "сердеч", "хобл", "инсульт"];
const COMPLICATION_KEYWORDS = ["асцит", "тромбоз", "кровотеч", "непроходим", "перфорац", "нейтропен", "фебрильн"];
const METASTASIS_KEYWORDS = ["мтс", "метастаз", "канцероматоз"];
const THERAPY_KEYWORDS = [
  "рекоменду",
  "схема",
  "протокол",
  "хт",
  "пхт",
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
  "рамуцирумаб",
  "пембролизумаб",
  "ниволумаб",
  "bevacizumab",
  "flot",
  "folfox",
  "xelox",
];

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

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2): number {
  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function splitMeaningfulLines(text: string): string[] {
  return text
    .split(/\n+/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 3);
}

function extractDates(text: string): string[] {
  const dates = new Set<string>();

  const regexes = [/\b(\d{4}-\d{2}-\d{2})\b/g, /\b(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})\b/g];

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

function normalizeText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/\t/g, " ").replace(/[\u00A0\u2002\u2003]/g, " ");
}

function anonymizeSensitiveData(text: string): {
  text: string;
  redactedFioCount: number;
  excludedPersonalData: ExcludedPersonalDataItem[];
} {
  let redacted = text;
  let count = 0;
  const excludedPersonalData: ExcludedPersonalDataItem[] = [];

  const patterns = [
    /(ФИО|Пациент|Пациентка|Больной|Больная)\s*[:\-]\s*[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2}/g,
    /[А-ЯЁ][а-яё]{1,30}\s+[А-ЯЁ][а-яё]{1,30}\s+[А-ЯЁ][а-яё]{1,30}/g,
    /[А-ЯЁ][а-яё]{1,30}\s+[А-ЯЁ]\.[А-ЯЁ]\./g,
  ];

  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, (match) => {
      count += 1;
      excludedPersonalData.push({
        type: "fio",
        masked_value: match.replace(/\s+/g, " ").slice(0, 80),
        reason: "ФИО исключено из дальнейшей обработки.",
      });
      if (match.includes(":")) {
        return `${match.split(":")[0]}: [ФИО УДАЛЕНО]`;
      }
      return "[ФИО УДАЛЕНО]";
    });
  }

  const dobPattern =
    /((?:дата\s*рождени[яе]|д\.?\s*р\.?|год\s*рождени[яе]|родил(?:ся|ась)?)[^\n\r:]{0,14}[:\-]?\s*)(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/gi;
  redacted = redacted.replace(dobPattern, (_match, prefix: string, dateValue: string) => {
    excludedPersonalData.push({
      type: "date_of_birth",
      masked_value: dateValue,
      reason: "Дата рождения исключена из дальнейшей обработки, используется только для расчета возраста.",
    });
    return `${prefix}[ДАТА РОЖДЕНИЯ УДАЛЕНА]`;
  });

  return {
    text: redacted,
    redactedFioCount: count,
    excludedPersonalData,
  };
}

function extractFirst(text: string, regexes: RegExp[]): string {
  for (const regex of regexes) {
    const matched = text.match(regex);
    const value = matched?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function extractAll(text: string, regexes: RegExp[], limit = 20): string[] {
  const values: string[] = [];
  for (const regex of regexes) {
    for (const match of text.matchAll(regex)) {
      const value = match[1]?.trim();
      if (value) {
        values.push(value.replace(/\s+/g, " "));
      }
    }
  }
  return unique(values).slice(0, limit);
}

function sanitizeDiagnosis(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").replace(/[|•]+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const clauses = normalized
    .split(/(?<=\.)\s+|[;\n\r]+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const selected: string[] = [];
  for (const clause of clauses) {
    if (!selected.length) {
      selected.push(clause);
      continue;
    }

    if (diagnosisClauseLooksTreatmentHistory(clause)) {
      break;
    }

    // Keep short biological refinements in diagnosis (subtype, receptor status, etc.).
    if (clause.length <= 140 && /(подтип|фенотип|her2|er|pr|pd-?l1|g\d|tnm|ст\.?|стадия)/i.test(clause)) {
      selected.push(clause);
      continue;
    }

    if (selected.length >= 2) {
      break;
    }
  }

  return selected
    .join(" ")
    .replace(
      /(?:\bTNM\b|(?:стадия|stage)\s*[:\-]?\s*(?:[0-4]|[IVX]+)[A-Ca-cА-Яа-я]?|гистолог(?:ия|ическое\s+заключение)|молекулярн\w+.*)$/i,
      "",
    )
    .replace(/[;,:\-–]+$/g, "")
    .trim();
}

function diagnosisClauseLooksTreatmentHistory(clause: string): boolean {
  return /\b(?:напхт|пхт|хтт?|ит\b|линии?|курс(?:а|ов)?|прогрессирован|рецидив|консилиум|схем[аеуы]?|протокол|с\s*\d{1,2}[\.\/-]\d{4}|в\s*20\d{2}\s*г)\b/i.test(
    clause,
  );
}

function diagnosisCandidateScore(line: string): number {
  const lower = line.toLowerCase();
  let score = 0;

  if (/рак|карцином|сарком|лимфом|опухол|carcinoma|cancer/.test(lower)) {
    score += 8;
  }
  if (/\b[cd]\d{2}(?:\.\d)?\b/.test(lower)) {
    score += 3;
  }
  if (line.length > 8 && line.length < 150) {
    score += 2;
  }
  if (/рекоменд|терап|протокол|схема|лечение|анамнез|жалоб/.test(lower)) {
    score -= 3;
  }

  return score;
}

function detectDiagnosis(text: string): string {
  const diagnosisMatch = extractFirst(text, [
    /(?:основной\s+)?диагноз(?:\s+при\s+поступлении)?\s*[:\-]\s*([^\n\r]+)/i,
    /diagnosis\s*[:\-]\s*([^\n\r]+)/i,
  ]);
  const cleaned = sanitizeDiagnosis(diagnosisMatch);
  if (cleaned.length >= 4) {
    return cleaned;
  }

  const candidates = splitMeaningfulLines(text)
    .filter((line) => /рак|опухол|carcinoma|cancer|сарком|лимфом|карцином/i.test(line))
    .map((line) => ({
      raw: line,
      cleaned: sanitizeDiagnosis(line),
      score: diagnosisCandidateScore(line),
    }))
    .filter((item) => item.cleaned.length >= 4)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.cleaned ?? "Не удалось автоматически определить диагноз";
}

function stageRomanToNumeric(value: string): number | null {
  const normalized = value.toUpperCase();
  if (normalized === "0") {
    return 0;
  }
  if (normalized === "I" || normalized === "1") {
    return 1;
  }
  if (normalized === "II" || normalized === "2") {
    return 2;
  }
  if (normalized === "III" || normalized === "3") {
    return 3;
  }
  if (normalized === "IV" || normalized === "4") {
    return 4;
  }
  return null;
}

function detectStageInfo(text: string): { stage: string; stage_numeric: number | null; stage_raw: string } {
  const stageRaw = extractFirst(text, [
    /(?:стадия|ст\.?|stage)\s*[:\-]?\s*([IVX0-4]{1,4}[A-Ca-cА-Яа-я]?)/i,
    /(?:\b((?:[IVX]{1,4}|[0-4])[A-Za-zА-Яа-я]?)\s*ст(?:адия|\.?))(?=\s|$|[,.;:])/i,
  ]);

  const compact = stageRaw
    .toUpperCase()
    .replace(/[А]/g, "A")
    .replace(/[В]/g, "B")
    .replace(/[С]/g, "C")
    .replace(/[^IVX0-4]/g, "")
    .trim();
  const stageNumeric = stageRomanToNumeric(compact);

  return {
    stage: stageNumeric === null ? "" : String(stageNumeric),
    stage_numeric: stageNumeric,
    stage_raw: stageRaw,
  };
}

function detectSex(text: string): CaseInput["sex"] {
  if (/(мужчина|мужской|пол\s*[:\-]?\s*м)/i.test(text)) {
    return "male";
  }
  if (/(женщина|женский|пол\s*[:\-]?\s*ж)/i.test(text)) {
    return "female";
  }
  return "unknown";
}

function calculateAge(dateOfBirthIso: string, asOfIso: string): number | null {
  const dob = new Date(dateOfBirthIso);
  const asOf = new Date(asOfIso);

  if (Number.isNaN(dob.getTime()) || Number.isNaN(asOf.getTime()) || asOf < dob) {
    return null;
  }

  let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = asOf.getUTCMonth() - dob.getUTCMonth();
  const dayDelta = asOf.getUTCDate() - dob.getUTCDate();

  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1;
  }

  if (age < 0 || age > 120) {
    return null;
  }

  return age;
}

function detectAge(text: string, asOfDate: string): number | null {
  const explicitAge = extractFirst(text, [
    /(?:возраст|age)\D{0,8}(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:лет|год(?:а)?)\b/i,
  ]);
  const parsedAge = parseNumber(explicitAge);
  if (parsedAge !== null && parsedAge >= 0 && parsedAge <= 120) {
    return Math.trunc(parsedAge);
  }

  const dateOfBirth = extractFirst(text, [
    /(?:дата\s*рождени[яе]|родил(?:ся|ась)?)\D{0,20}(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i,
  ]);

  const normalizedDob = normalizeDate(dateOfBirth);
  if (!normalizedDob) {
    return null;
  }

  return calculateAge(normalizedDob, asOfDate);
}

function detectBiomarkers(text: string): string[] {
  const markers = new Set<string>();
  const markerRegex =
    /(?:ER\s*[-=]?\s*\d+|PR\s*[-=]?\s*\d+|HER2\s*[-+]?\s*\d*\+?|PD-?L1\s*[^\n,;]*|BRCA1\/2|BRCA1|BRCA2|KI-?67\s*[-=]?\s*\d+%?|TMB\s*[-=]?\s*[0-9\.]+|BRAF\s*V600E|KRAS|NRAS|NTRK)/gi;

  for (const match of text.matchAll(markerRegex)) {
    markers.add(match[0].replace(/\s+/g, " ").trim());
  }

  return Array.from(markers).slice(0, 20);
}

function detectWeightKg(text: string): number | null {
  const raw = extractFirst(text, [/(?:вес|масса(?:\s+тела)?)\D{0,12}(\d{2,3}(?:[.,]\d+)?)/i]);
  const parsed = parseNumber(raw);
  if (parsed === null || parsed < 20 || parsed > 500) {
    return null;
  }
  return round(parsed, 1);
}

function detectHeightCm(text: string): number | null {
  const raw = extractFirst(text, [/(?:рост)\D{0,12}(\d{2,3}(?:[.,]\d+)?)/i]);
  const parsed = parseNumber(raw);
  if (parsed === null || parsed < 80 || parsed > 250) {
    return null;
  }
  return round(parsed, 1);
}

function calculateBsa(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null) {
    return null;
  }

  const bsa = 0.007184 * Math.pow(heightCm, 0.725) * Math.pow(weightKg, 0.425);
  if (!Number.isFinite(bsa)) {
    return null;
  }

  return round(bsa, 3);
}

function detectBsa(text: string, weightKg: number | null, heightCm: number | null): number | null {
  const explicit = extractFirst(text, [/(?:bsa|ппт|площад(?:ь|и)\s+поверхности\s+тела)\D{0,12}(\d(?:[.,]\d+)?)/i]);
  const parsed = parseNumber(explicit);
  if (parsed !== null && parsed > 0.5 && parsed < 3.5) {
    return round(parsed, 3);
  }

  return calculateBsa(weightKg, heightCm);
}

function detectEcog(text: string): number | null {
  const value = extractFirst(text, [/(?:ecog|общее\s+состояние)\D{0,12}([0-4])\b/i]);
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }

  const ecog = Math.trunc(parsed);
  return ecog >= 0 && ecog <= 4 ? ecog : null;
}

function findLinesByKeywords(text: string, keywords: string[], limit = 10): string[] {
  const lines = splitMeaningfulLines(text);
  const found = lines.filter((line) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword));
  });

  return unique(found).slice(0, limit);
}

function detectComorbidities(text: string): string[] {
  const explicit = extractFirst(text, [/(?:сопутствующие\s+заболевания|коморбидность)\s*[:\-]\s*([^\n\r]+)/i]);
  const collected = explicit ? [explicit] : [];
  return unique([...collected, ...findLinesByKeywords(text, COMORBIDITY_KEYWORDS, 12)]).slice(0, 12);
}

function detectAllergies(text: string): string[] {
  return unique(
    findLinesByKeywords(text, ["аллерг", "непереносим", "гиперчувств"], 8).map((line) => line.replace(/^[-•\d.)\s]+/, "")),
  );
}

function detectIcd10Code(text: string): string {
  return extractIcd10CodeFromText(text);
}

function detectTnm(text: string): string {
  const tnm = extractFirst(text, [/\b([cpyr]?\s*t\s*\d[a-cx]?\s*n\s*\d[a-cx]?\s*m\s*[01x])\b/i]);
  return tnm ? tnm.replace(/\s+/g, "").toUpperCase() : "";
}

function detectHistology(text: string): string {
  const explicit = extractFirst(text, [
    /(?:гистолог(?:ическое\s+заключение|ия)|histology)\s*[:\-]\s*([^\n\r]+)/i,
  ]);

  if (explicit) {
    return explicit;
  }

  const fallback = splitMeaningfulLines(text).find((line) =>
    /аденокарцином|плоскоклеточ|карцином|сарком|лимфом/i.test(line),
  );

  return fallback ?? "";
}

function detectHer2Status(text: string): string {
  return extractFirst(text, [/(HER2(?:\/neu)?[^\n\r]{0,40})/i]);
}

function detectPdL1Cps(text: string): number | null {
  const raw = extractFirst(text, [/PD-?L1[^\n\r]{0,24}(?:CPS)?\s*=?\s*(\d+(?:[.,]\d+)?)/i]);
  const parsed = parseNumber(raw);
  if (parsed === null || parsed < 0 || parsed > 100) {
    return null;
  }
  return round(parsed, 1);
}

function detectMsiMmr(text: string): string {
  return extractFirst(text, [/(?:MSI|MMR|микросателлит[^\n\r]*)\s*[:\-]?\s*([^\n\r]+)/i]);
}

function detectOtherMarkers(text: string): string[] {
  const markers = extractAll(text, [
    /\b(BRAF\s*V600E|NTRK\s*\w+|KRAS\s*\w+|NRAS\s*\w+|ALK\s*\w+|ROS1\s*\w+|EGFR\s*\w+)\b/gi,
  ]);

  return markers.slice(0, 12);
}

function detectDiseaseStatus(text: string): string {
  const lines = findLinesByKeywords(text, ["прогресс", "стабилизац", "ремисс", "частичн", "полный ответ"], 10);
  return lines.at(-1) ?? "";
}

function detectMetastases(text: string): string[] {
  return findLinesByKeywords(text, METASTASIS_KEYWORDS, 12);
}

function detectLastImagingDate(text: string): string {
  const lines = splitMeaningfulLines(text).filter((line) => /(кт|мрт|пэт|pet|узи)/i.test(line));
  const foundDates = lines
    .flatMap((line) => Array.from(line.matchAll(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/g), (match) => match[1]))
    .map((value) => normalizeDate(value))
    .filter((value): value is string => Boolean(value))
    .sort();

  return foundDates.at(-1) ?? "";
}

function detectComplications(text: string): string[] {
  return findLinesByKeywords(text, COMPLICATION_KEYWORDS, 10);
}

function detectLatestYear(line: string): number | null {
  const years = Array.from(line.matchAll(/\b(20\d{2})\b/g), (match) => Number(match[1])).filter(
    (year) => Number.isFinite(year) && year >= 2000 && year <= 2100,
  );
  if (!years.length) {
    return null;
  }
  return Math.max(...years);
}

function detectCurrentPlan(text: string): string[] {
  const rawLines = splitMeaningfulLines(text)
    .map((line) => line.replace(/^[-•\d\.\)\s]+/, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, 500);

  const activeCueRegex =
    /(рекоменд|назнач|план|продолжить|следует|консилиум|решени[ея]|проведение\s+\d+\s*курсов?|по\s+схеме|по\s+протоколу|текущ[ийе]\s+план)/i;
  const decisionCueRegex = /(консилиум|протокол|рекоменд|назнач)/i;
  const historicalCueRegex =
    /(анамнез|ранее|истор|выполнен|выполнена|проведен|проведено|получал|получала|с\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}\s*по\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/i;
  const completedPastCueRegex = /(проведено\s+\d+\s*курс|получал[аи]?|выполнен[ао]?|завершен[ао]?|на\s+фоне\s+проводимого)/i;
  const drugOrDoseRegex =
    /(карбоплатин|цисплатин|паклитаксел|доксорубицин|циклофосфамид|винорельбин|капецитабин|гемцитабин|иксабепилон|бевацизумаб|атезолизумаб|пембролизумаб|ниволумаб|иринотекан|flot|folfox|xelox|auc|\d+\s*мг\/(кг|м²|м2))/i;
  const diagnosticOnlyRegex = /(пэт|кт|мрт|биопс|гистолог|иммуногист|узи)/i;
  const regimenLineRegex = /\b(?:пхт|хт|мхт|хтт|ит|таргет|иммуно|схем|протокол)\b/i;

  const therapyCandidates = rawLines.filter((line) => THERAPY_KEYWORDS.some((keyword) => line.toLowerCase().includes(keyword)));
  const maxYear = therapyCandidates
    .map((line) => detectLatestYear(line))
    .filter((year): year is number => typeof year === "number")
    .reduce((acc, year) => Math.max(acc, year), 0);

  const scored = rawLines
    .map((line, index) => {
      const lower = line.toLowerCase();
      const hasTherapyKeyword = THERAPY_KEYWORDS.some((keyword) => lower.includes(keyword));
      if (!hasTherapyKeyword) {
        return null;
      }

      let score = 0;
      if (activeCueRegex.test(line)) {
        score += 4;
      }
      if (decisionCueRegex.test(line)) {
        score += 2;
      }
      if (drugOrDoseRegex.test(line)) {
        score += 2;
      }
      if (regimenLineRegex.test(line) && line.length <= 180) {
        score += 2;
      }
      if (index >= Math.floor(rawLines.length * 0.6)) {
        score += 1;
      }
      const year = detectLatestYear(line);
      if (maxYear > 0 && year === maxYear) {
        score += 2;
      }
      if (completedPastCueRegex.test(line)) {
        score -= 4;
      }
      if (historicalCueRegex.test(line) && !activeCueRegex.test(line)) {
        score -= 3;
      }
      if (diagnosticOnlyRegex.test(line) && !drugOrDoseRegex.test(line) && !activeCueRegex.test(line)) {
        score -= 2;
      }

      return {
        line,
        score,
      };
    })
    .filter((item): item is { line: string; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score);

  const selected = scored
    .filter((item) => item.score >= 4)
    .map((item) => item.line);

  if (selected.length > 0) {
    const maxSelectedYear = selected
      .map((line) => detectLatestYear(line))
      .filter((year): year is number => typeof year === "number")
      .reduce((acc, year) => Math.max(acc, year), 0);

    const focused = maxSelectedYear
      ? selected.filter((line) => {
          const year = detectLatestYear(line);
          if (year === null) {
            return /(рекоменд|назнач|план|текущ)/i.test(line);
          }
          return year >= maxSelectedYear - 1;
        })
      : selected;

    return unique((focused.length ? focused : selected)).slice(0, 6);
  }

  return [];
}

function detectTimeline(text: string): CaseInput["timeline"] {
  const lines = splitMeaningfulLines(text);
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

function extractLabValue(text: string, regexes: RegExp[]): number | null {
  for (const regex of regexes) {
    const raw = extractFirst(text, [regex]);
    const parsed = parseNumber(raw);
    if (parsed !== null) {
      return round(parsed, 2);
    }
  }

  return null;
}

function detectLabSignals(text: string): Pick<
  CaseInput,
  | "neutrophils_abs"
  | "platelets"
  | "hemoglobin"
  | "bilirubin_total"
  | "alt"
  | "ast"
  | "creatinine"
  | "albumin"
  | "inr"
  | "labs"
> {
  const neutrophilsAbs = extractLabValue(text, [/(?:нейтрофил(?:ы|ов)?(?:\s*\(абс\.?\))?)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const platelets = extractLabValue(text, [/(?:тромбоцит(?:ы|ов)?)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const hemoglobin = extractLabValue(text, [/(?:гемоглобин|hb)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const bilirubinTotal = extractLabValue(text, [/(?:общий\s+билирубин|билирубин)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const alt = extractLabValue(text, [/(?:алт|alt)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const ast = extractLabValue(text, [/(?:аст|ast)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const creatinine = extractLabValue(text, [/(?:креатинин)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const albumin = extractLabValue(text, [/(?:альбумин)\D{0,12}(\d+(?:[.,]\d+)?)/i]);
  const inr = extractLabValue(text, [/(?:мно|inr)\D{0,12}(\d+(?:[.,]\d+)?)/i]);

  const labs: CaseInput["labs"] = {};
  if (hemoglobin !== null) {
    labs.Hb = `${hemoglobin} г/л`;
  }
  if (neutrophilsAbs !== null) {
    labs["Нейтрофилы"] = `${neutrophilsAbs} x10^9/л`;
  }
  if (platelets !== null) {
    labs["Тромбоциты"] = `${platelets} x10^9/л`;
  }
  if (bilirubinTotal !== null) {
    labs["Общий билирубин"] = `${bilirubinTotal} мкмоль/л`;
  }
  if (alt !== null) {
    labs.ALT = `${alt} Ед/л`;
  }
  if (ast !== null) {
    labs.AST = `${ast} Ед/л`;
  }
  if (creatinine !== null) {
    labs["Креатинин"] = `${creatinine} мкмоль/л`;
  }
  if (albumin !== null) {
    labs["Альбумин"] = `${albumin} г/л`;
  }
  if (inr !== null) {
    labs.INR = String(inr);
  }

  return {
    neutrophils_abs: neutrophilsAbs,
    platelets,
    hemoglobin,
    bilirubin_total: bilirubinTotal,
    alt,
    ast,
    creatinine,
    albumin,
    inr,
    labs,
  };
}

function normalizeDoseUnit(unit: string): string {
  const normalized = unit.toLowerCase().replace(/\s+/g, "");
  if (normalized.includes("мг/кг")) {
    return "мг/кг";
  }
  if (normalized.includes("мг/м²") || normalized.includes("мг/м2")) {
    return "мг/м²";
  }
  return unit.trim();
}

function parsePlannedDrugs(text: string, currentPlan: string[], regimenProtocol: string): PlannedDrug[] {
  const candidates = [...currentPlan];
  if (regimenProtocol.trim()) {
    candidates.push(regimenProtocol.trim());
  }

  if (!candidates.length) {
    candidates.push(
      ...splitMeaningfulLines(text).filter(
        (line) => /(рекоменд|назнач|консилиум|протокол|схема)/i.test(line) && /(мг\/кг|мг\/м²|мг\/м2|AUC|дни|каждые)/i.test(line),
      ),
    );
  }

  const drugs: PlannedDrug[] = [];
  const seen = new Set<string>();

  const appendDrugFromEntry = (rawEntry: string) => {
    const entry = rawEntry.replace(/^[-•\d.)\s]+/, "").trim();
    if (!entry) {
      return;
    }

    const doseMatch = entry.match(/(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(мг\/кг|мг\/м²|мг\/м2|мг|AUC|ЕД)/i);
    if (!doseMatch) {
      return;
    }

    const beforeDose = entry.slice(0, doseMatch.index ?? 0).trim();
    const medName = beforeDose
      .replace(/(?:по\s+схеме|по\s+протоколу|схема|протокол|рекомендовано|назначено|рекомендована|рекомендован|решение)/gi, "")
      .replace(/[:;,]+$/g, "")
      .trim();

    if (!medName) {
      return;
    }

    const doseValue = parseNumber(doseMatch[1]);
    const doseUnit = normalizeDoseUnit(doseMatch[2]);
    const dedupKey = `${medName.toLowerCase()}|${doseValue ?? ""}|${doseUnit.toLowerCase()}`;
    if (seen.has(dedupKey)) {
      return;
    }
    seen.add(dedupKey);

    const route = extractFirst(entry, [/(в\/в|в\/м|п\/к|внутривенно|перорально|per\s*os)/i]);
    const scheduleDays = extractFirst(entry, [/(?:в|на)\s*([\d,\s]+)\s*(?:дни|день|сутки)/i]);
    const cycleRaw = extractFirst(entry, [/каждые\s*(\d{1,2})\s*(?:дней|дня|д)/i]);

    drugs.push({
      name: medName,
      dose_value: doseValue,
      dose_unit: doseUnit,
      route,
      schedule_days: scheduleDays,
      cycle_days: parseNumber(cycleRaw),
    });
  };

  for (const rawEntry of unique(candidates).slice(0, 20)) {
    appendDrugFromEntry(rawEntry);
  }

  if (!drugs.length) {
    const therapyDrugLineRegex =
      /(карбоплатин|цисплатин|паклитаксел|доксорубицин|циклофосфамид|винорельбин|капецитабин|гемцитабин|иксабепилон|бевацизумаб|атезолизумаб|пембролизумаб|ниволумаб|иринотекан|рамуцирумаб|эрибулин|eribulin|flot|folfox|xelox)/i;
    const fallbackLines = splitMeaningfulLines(text).filter(
      (line) =>
        /(мг\/кг|мг\/м²|мг\/м2|AUC|дни|каждые)/i.test(line) &&
        (/(рекоменд|назнач|консилиум|протокол|схема)/i.test(line) || therapyDrugLineRegex.test(line)),
    );
    for (const line of unique(fallbackLines).slice(0, 20)) {
      appendDrugFromEntry(line);
    }
  }

  return drugs.slice(0, 12);
}

function normalizeTherapyLine(rawLine: string): number | null {
  const direct = parseNumber(rawLine);
  if (direct !== null) {
    const line = Math.trunc(direct);
    if (line > 0 && line < 15) {
      return line;
    }
  }

  const lower = rawLine.toLowerCase();
  if (lower.includes("первая")) {
    return 1;
  }
  if (lower.includes("вторая")) {
    return 2;
  }
  if (lower.includes("третья")) {
    return 3;
  }
  if (lower.includes("четверт")) {
    return 4;
  }

  return null;
}

function detectTreatmentHistory(text: string): TreatmentHistoryEntry[] {
  const entries: TreatmentHistoryEntry[] = [];
  const lines = splitMeaningfulLines(text);

  for (const line of lines) {
    const hasLineKeyword = /(?:\d+\s*линия|первая\s+линия|вторая\s+линия|третья\s+линия|четвертая\s+линия)/i.test(
      line,
    );

    if (!hasLineKeyword) {
      continue;
    }

    const rawLineNumber = extractFirst(line, [/(\d+)\s*линия/i, /(первая|вторая|третья|четвертая)\s+линия/i]);
    const intervalStart = extractFirst(line, [/с\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i]);
    const intervalEnd = extractFirst(line, [/по\s*(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i]);

    const bestResponse = extractFirst(line, [/(прогрессирование|частичн(?:ый|ая)\s+ответ|полный\s+ответ|стабилизац(?:ия)?)/i]);
    const stopReason = extractFirst(line, [/(прогрессирование|токсичн(?:ость)?|непереносим(?:ость)?)/i]);

    entries.push({
      line: normalizeTherapyLine(rawLineNumber),
      regimen: line.replace(/^[\-•\d.\s]*/, "").slice(0, 240),
      start_date: normalizeDate(intervalStart) ?? undefined,
      end_date: normalizeDate(intervalEnd) ?? undefined,
      best_response: bestResponse || undefined,
      stop_reason: stopReason || undefined,
    });
  }

  return entries.slice(0, 12);
}

function detectPriorSurgeries(text: string): string[] {
  return findLinesByKeywords(text, ["операц", "хирург"], 8);
}

function detectRadiationHistory(text: string): string[] {
  return findLinesByKeywords(text, ["лучев", "длт", "radiation"], 8);
}

function detectTreatmentGoal(text: string): string {
  const explicit = extractFirst(text, [/(?:цель\s+лечения|решение|рекомендовано)\s*[:\-]\s*([^\n\r]+)/i]);
  if (explicit) {
    return explicit;
  }

  const lower = text.toLowerCase();
  if (lower.includes("адъювант")) {
    return "адъювантное лечение";
  }
  if (lower.includes("неоадъювант")) {
    return "неоадъювантное лечение";
  }
  if (lower.includes("паллиатив")) {
    return "паллиативное лечение";
  }

  return "";
}

function detectRegimenProtocol(text: string, currentPlan: string[]): string {
  const lines = splitMeaningfulLines(text)
    .map((line) => line.replace(/^[-•\d\.\)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 500);

  const protocolCueRegex = /(режим|протокол|схема|по\s+схеме|по\s+протоколу|рекомендовано|назначено|решение)/i;
  const therapyCueRegex =
    /(карбоплатин|цисплатин|паклитаксел|доксорубицин|циклофосфамид|винорельбин|капецитабин|гемцитабин|иксабепилон|бевацизумаб|атезолизумаб|пембролизумаб|ниволумаб|иринотекан|auc|\d+\s*мг\/(кг|м²|м2))/i;
  const historicalRegex =
    /(выполнен|выполнена|проведен|проведено|получал|получала|отмена|дефектур|с\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}\s*по\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|с\s*\d{1,2}[\.\/-]\d{4}\s*по\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|в\s*20\d{2}\s*по\s*поводу)/i;

  const maxYear = lines
    .map((line) => detectLatestYear(line))
    .filter((year): year is number => typeof year === "number")
    .reduce((acc, year) => Math.max(acc, year), 0);

  const scored = lines
    .filter((line) => protocolCueRegex.test(line) || therapyCueRegex.test(line))
    .map((line) => {
      let score = 0;
      if (protocolCueRegex.test(line)) {
        score += 3;
      }
      if (therapyCueRegex.test(line)) {
        score += 2;
      }
      const year = detectLatestYear(line);
      if (maxYear > 0 && year === maxYear) {
        score += 2;
      }
      if (historicalRegex.test(line) && !/(рекомендовано|назначено|решение)/i.test(line)) {
        score -= 3;
      }
      if (line.length > 260) {
        score -= 1;
      }
      return {
        line,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored.find((item) => item.score >= 4);
  if (best) {
    return best.line;
  }

  const fromCurrentPlan = currentPlan
    .map((line) => {
      let score = 0;
      if (protocolCueRegex.test(line)) {
        score += 2;
      }
      if (therapyCueRegex.test(line)) {
        score += 1;
      }
      if (historicalRegex.test(line) && !/(рекомендовано|назначено|решение)/i.test(line)) {
        score -= 2;
      }
      const year = detectLatestYear(line);
      if (maxYear > 0 && year === maxYear) {
        score += 1;
      }
      return { line, score };
    })
    .sort((left, right) => right.score - left.score)
    .find((item) => item.score > 0);

  return fromCurrentPlan?.line ?? "";
}

function detectProtocolAssignmentDate(text: string, timeline: CaseInput["timeline"]): string {
  const directLines = splitMeaningfulLines(text).filter((line) =>
    /(решени|рекоменд|консилиум|протокол|схема)/i.test(line),
  );

  const datedFromDirect = directLines
    .flatMap((line) =>
      Array.from(
        line.matchAll(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})/g),
        (match) => normalizeDate(match[1]),
      ),
    )
    .filter((item): item is string => Boolean(item))
    .sort();

  if (datedFromDirect.length) {
    return datedFromDirect.at(-1) ?? "";
  }

  const fromTimeline = timeline
    .filter((event) => /(tumor_board|therapy|clinical_event)/i.test(event.event_type))
    .map((event) => normalizeDate(event.event_date))
    .filter((item): item is string => Boolean(item))
    .sort();

  return fromTimeline.at(-1) ?? "";
}

function detectPlannedTherapyLine(
  text: string,
  treatmentHistory: TreatmentHistoryEntry[],
  currentPlan: string[],
): number | null {
  const fromCurrentPlan = currentPlan
    .map((line) => extractFirst(line, [/(\d+)\s*линии?/i, /(первая|вторая|третья|четвертая)\s+линия/i]))
    .map((raw) => normalizeTherapyLine(raw))
    .filter((line): line is number => typeof line === "number");
  if (fromCurrentPlan.length) {
    return Math.max(...fromCurrentPlan);
  }

  const recommendationLines = splitMeaningfulLines(text).filter((line) => /(рекоменд|назнач|консилиум|протокол|решение)/i.test(line));
  const fromRecommendation = recommendationLines
    .map((line) => extractFirst(line, [/(\d+)\s*линии?/i, /(первая|вторая|третья|четвертая)\s+линия/i]))
    .map((raw) => normalizeTherapyLine(raw))
    .filter((line): line is number => typeof line === "number");
  if (fromRecommendation.length) {
    return Math.max(...fromRecommendation);
  }

  const lines = treatmentHistory
    .map((item) => item.line)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (lines.length > 0) {
    return Math.max(...lines) + 1;
  }

  return null;
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

export function prepareCaseText(text: string): PreparedCaseText {
  const normalized = normalizeText(text);
  const anonymized = anonymizeSensitiveData(normalized);
  const dedupExcluded = unique(
    anonymized.excludedPersonalData.map((item) => `${item.type}|${item.masked_value}|${item.reason}`),
  ).map((item) => {
    const [type, masked_value, reason] = item.split("|");
    return {
      type: type as ExcludedPersonalDataItem["type"],
      masked_value,
      reason,
    };
  });

  return {
    text: anonymized.text,
    anonymized: dedupExcluded.length > 0,
    redactedFioCount: anonymized.redactedFioCount,
    excluded_personal_data: dedupExcluded,
    privacy_notice: "Выявленные персональные данные исключены и не используются при RAG/валидации.",
  };
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

export function suggestCaseFromText(input: string): CaseInput {
  const normalizedInput = normalizeText(input);
  const prepared = prepareCaseText(input);
  const text = prepared.text;
  const allDates = extractDates(normalizedInput);
  const asOfDate = allDates.at(-1) ?? new Date().toISOString().slice(0, 10);

  const diagnosis = detectDiagnosis(text);
  const stageInfo = detectStageInfo(text);
  const sex = detectSex(text);
  const age = detectAge(normalizedInput, asOfDate);

  const weightKg = detectWeightKg(text);
  const heightCm = detectHeightCm(text);
  const bsaM2 = detectBsa(text, weightKg, heightCm);
  const ecog = detectEcog(text);

  const histology = detectHistology(text);
  const biomarkers = detectBiomarkers(text);
  const icd10Detected = detectIcd10Code(text);
  const icd10Info = resolveIcd10Info({
    diagnosis,
    icd10_code: icd10Detected,
  });
  const icd10Code = icd10Info?.icd10_code ?? icd10Detected;
  const tnm = detectTnm(text);
  const her2Status = detectHer2Status(text);
  const pdL1Cps = detectPdL1Cps(text);
  const msiMmr = detectMsiMmr(text);
  const otherMarkers = detectOtherMarkers(text);

  const comorbidities = detectComorbidities(text);
  const allergies = detectAllergies(text);

  const diseaseStatus = detectDiseaseStatus(text);
  const metastases = detectMetastases(text);
  const lastImagingDate = detectLastImagingDate(text);
  const complications = detectComplications(text);

  const labSignals = detectLabSignals(text);
  const currentPlan = detectCurrentPlan(text);
  const treatmentHistory = detectTreatmentHistory(text);
  const priorSurgeries = detectPriorSurgeries(text);
  const radiationHistory = detectRadiationHistory(text);
  const treatmentGoal = detectTreatmentGoal(text);
  const regimenProtocol = detectRegimenProtocol(text, currentPlan);
  const plannedTherapyLine = detectPlannedTherapyLine(text, treatmentHistory, currentPlan);
  const plannedDrugs = parsePlannedDrugs(text, currentPlan, regimenProtocol);
  const timeline = detectTimeline(text);
  const protocolAssignmentDate = detectProtocolAssignmentDate(text, timeline);

  return {
    diagnosis,
    stage: stageInfo.stage,
    stage_numeric: stageInfo.stage_numeric,
    stage_raw: stageInfo.stage_raw,
    sex,
    age,
    weight_kg: weightKg,
    height_cm: heightCm,
    bsa_m2: bsaM2,
    ecog,
    histology,
    allergies,
    biomarkers: unique([...biomarkers, ...otherMarkers]),
    icd10_code: icd10Code,
    icd10_name_ru: icd10Info?.icd10_name_ru ?? "",
    nosology_label_ru: icd10Info?.nosology_label_ru ?? "",
    primary_localization: icd10Info?.nosology_label_ru ?? diagnosis,
    tnm,
    her2_status: her2Status,
    pd_l1_cps: pdL1Cps,
    msi_mmr: msiMmr,
    comorbidities,
    prior_surgeries: priorSurgeries,
    radiation_history: radiationHistory,
    labs: labSignals.labs,
    neutrophils_abs: labSignals.neutrophils_abs,
    platelets: labSignals.platelets,
    hemoglobin: labSignals.hemoglobin,
    bilirubin_total: labSignals.bilirubin_total,
    alt: labSignals.alt,
    ast: labSignals.ast,
    creatinine: labSignals.creatinine,
    albumin: labSignals.albumin,
    inr: labSignals.inr,
    disease_status: diseaseStatus,
    metastases,
    last_imaging_date: lastImagingDate,
    complications,
    treatment_history: treatmentHistory,
    contraindications: [],
    timeline,
    current_plan: currentPlan,
    treatment_goal: treatmentGoal,
    regimen_protocol: regimenProtocol,
    protocol_assignment_date: protocolAssignmentDate,
    planned_therapy_line: plannedTherapyLine,
    planned_drugs: plannedDrugs,
    as_of_date: asOfDate,
  };
}
