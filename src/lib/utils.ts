export const nowIso = () => new Date().toISOString();

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
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s]/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
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

export function ftsQueryFromText(input: string): string {
  const tokens = Array.from(new Set(tokenize(input))).slice(0, 12);

  if (!tokens.length) {
    return "";
  }

  return tokens.map((token) => `${token}*`).join(" OR ");
}
