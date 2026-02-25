export const nowIso = () => new Date().toISOString();

const SHORT_CLINICAL_TOKENS = new Set([
  "кт",
  "мрт",
  "пэт",
  "er",
  "pr",
  "egfr",
  "alk",
  "ros1",
  "her2",
  "braf",
  "msi",
  "tmb",
  "pdl1",
  "pd1",
  "ki67",
  "kras",
  "nras",
  "figo",
  "tnm",
]);

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/pd[\s-]?l1/gi, "pdl1")
    .replace(/ki[\s-]?67/gi, "ki67")
    .replace(/[^a-z0-9а-яё]/gi, "")
    .trim();
}

function toUtcTimestamp(year: number, month: number, day: number): number | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const value = Date.UTC(year, month - 1, day);
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

export function parseLooseDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoDay = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoDay) {
    return toUtcTimestamp(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]));
  }

  const dayMonthYear = trimmed.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})$/);
  if (dayMonthYear) {
    const rawYear = Number(dayMonthYear[3]);
    const year =
      dayMonthYear[3].length === 2 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;
    return toUtcTimestamp(year, Number(dayMonthYear[2]), Number(dayMonthYear[1]));
  }

  const yearMonth = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    return toUtcTimestamp(Number(yearMonth[1]), Number(yearMonth[2]), 1);
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return toUtcTimestamp(Number(yearOnly[1]), 1, 1);
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const embeddedYear = trimmed.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  if (embeddedYear) {
    return toUtcTimestamp(Number(embeddedYear[1]), 1, 1);
  }

  return null;
}

export function normalizeDateOnly(value: string | null | undefined): string | null {
  const timestamp = parseLooseDate(value);
  if (timestamp === null) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

export function extractFirstDate(input: string): string | null {
  const candidates: Array<{ index: number; raw: string }> = [];
  const patterns = [/\b\d{4}-\d{2}-\d{2}\b/g, /\b\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}\b/g];

  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const raw = match[0];
      const index = match.index ?? Number.POSITIVE_INFINITY;
      candidates.push({ index, raw });
    }
  }

  candidates.sort((a, b) => a.index - b.index);
  for (const candidate of candidates) {
    const normalized = normalizeDateOnly(candidate.raw);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

export function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  return input
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter((token) => {
      if (!token) {
        return false;
      }
      if (token.length >= 3) {
        return true;
      }
      return SHORT_CLINICAL_TOKENS.has(token);
    });
}

export function sentenceChunks(text: string, maxLength = 850): string[] {
  if (!text.trim()) {
    return [];
  }

  const fragments = text
    .split(/(?<=[\.\!\?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let bucket = "";

  for (const fragment of fragments) {
    if ((bucket + " " + fragment).trim().length > maxLength) {
      if (bucket.trim()) {
        chunks.push(bucket.trim());
      }
      bucket = fragment;
    } else {
      bucket = `${bucket} ${fragment}`;
    }
  }

  if (bucket.trim()) {
    chunks.push(bucket.trim());
  }

  return chunks;
}

export function extractEvidenceLevel(text: string): string | null {
  const match = text.match(
    /уровень\s+убедительности\s+рекомендаций\s*[\-–:]\s*([A-Za-zА-Яа-я0-9]+)/i,
  );

  return match?.[1] ?? null;
}

export function buildTags(text: string): string[] {
  const keywordMap: Record<string, string[]> = {
    surgery: ["хирург", "операц", "резекц", "лимфодиссекц"],
    chemotherapy: ["химио", "flox", "f lot", "капецитаб", "паклитаксел", "карбоплатин", "цисплатин"],
    radiation: ["лучев", "радиотерап"],
    diagnostics: ["диагност", "кт", "мрт", "пэт", "биопс"],
    immunotherapy: ["иммуно", "атезолизумаб", "пембролизумаб", "nivolumab", "чекпоинт"],
    contraindication: ["противопоказ", "не рекоменду", "запрещ"],
    recommendation: ["рекомендуется", "показано", "следует"],
  };

  const normalized = text.toLowerCase();
  const tags: string[] = [];

  for (const [tag, stems] of Object.entries(keywordMap)) {
    if (stems.some((stem) => normalized.includes(stem))) {
      tags.push(tag);
    }
  }

  return tags;
}

const FTS_GENERIC_TOKENS = new Set([
  "лечение",
  "лечения",
  "терапия",
  "терапии",
  "режим",
  "протокол",
  "схема",
  "схеме",
  "курс",
  "курсы",
  "курсов",
  "линия",
  "линии",
  "день",
  "дни",
  "назначено",
  "назначена",
  "назначен",
  "рекомендовано",
  "рекомендована",
  "проведение",
  "проведено",
  "химиотерапия",
]);

function isFtsMeaningfulToken(token: string): boolean {
  if (!token) {
    return false;
  }
  if (!/[a-zа-яё]/i.test(token)) {
    return false;
  }
  if (/^\d+$/.test(token)) {
    return false;
  }
  if (/^\d{6,}(?:г|год)?$/.test(token)) {
    return false;
  }
  if (/^(?:19|20)\d{2}$/.test(token)) {
    return false;
  }
  return true;
}

export function ftsQueryFromText(input: string): string {
  const tokens = Array.from(new Set(tokenize(input).filter(isFtsMeaningfulToken))).slice(0, 12);

  if (!tokens.length) {
    return "";
  }

  const preferredTokens = tokens.filter((token) => !FTS_GENERIC_TOKENS.has(token));
  const mandatoryPool = preferredTokens.length >= 2 ? preferredTokens : tokens;
  const mandatoryTokens = mandatoryPool.slice(0, Math.min(2, mandatoryPool.length));
  const optionalTokens = tokens.filter((token) => !mandatoryTokens.includes(token));

  if (mandatoryTokens.length === 1) {
    return `${mandatoryTokens[0]}*`;
  }

  if (mandatoryTokens.length === 2 && optionalTokens.length === 0) {
    return `${mandatoryTokens[0]}* AND ${mandatoryTokens[1]}*`;
  }

  const mandatory = mandatoryTokens.map((token) => `${token}*`).join(" AND ");
  const optional = optionalTokens
    .map((token) => `${token}*`)
    .join(" OR ");

  return `${mandatory} AND (${optional})`;
}
