import { listGuidelineSourcesWithSectionCounts, listGuidelinesRaw } from "@/lib/db";
import type { AppliedGuidelineVersion } from "@/lib/types";
import { tokenize } from "@/lib/utils";

type GuidelineSelectionContext = {
  icd10_code?: string | null;
  icd10_name_ru?: string | null;
  nosology_label_ru?: string | null;
};

function parseDate(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

const GUIDELINE_QUERY_STOPWORDS = new Set([
  "рак",
  "злокачественное",
  "новообразование",
  "опухоль",
  "опухоли",
  "онкологический",
  "онкология",
  "части",
  "центральной",
  "неуточненной",
  "локализации",
  "левый",
  "левая",
  "правый",
  "правая",
  "стадия",
  "ст",
  "t",
  "n",
  "m",
]);

const GUIDELINE_FOCUS_STOPWORDS = new Set([
  ...GUIDELINE_QUERY_STOPWORDS,
  "железы",
  "тип",
  "подтип",
  "подтипа",
]);

const TREATMENT_TRAIL_CUE_RE =
  /\b(?:напхт|пхт|хтт?|ит\b|прогрессирован|рецидив|линии?|курс(?:а|ов)?|консилиум|схем[аеуы]?|протокол|лечени[ея]\s+в\s+20\d{2}|с\s*\d{1,2}[\.\/-]\d{4})/i;

const ICD10_SITE_HINTS: Record<string, string[]> = {
  C15: ["пищевод"],
  C16: ["желуд"],
  C18: ["ободоч", "кишк"],
  C19: ["ректосигмоид"],
  C20: ["прямой", "кишк"],
  C21: ["анальн"],
  C22: ["печен"],
  C23: ["желч"],
  C24: ["желч"],
  C25: ["поджелуд"],
  C33: ["трахе"],
  C34: ["легк", "бронх"],
  C50: ["молоч", "груд"],
  C53: ["шейк", "матк"],
  C54: ["тело", "матк"],
  C56: ["яичник"],
  C57: ["маточн", "труб"],
  C61: ["предстат", "простаты"],
  C64: ["почек", "почка"],
  C67: ["мочев", "пузыр"],
  C71: ["головн", "мозг"],
};

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]/g, "")
    .trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function textToTokens(value: string, stopwords: Set<string>): string[] {
  return unique(
    tokenize(value)
      .map(normalizeToken)
      .filter((token) => token.length >= 4 && !stopwords.has(token)),
  );
}

function diagnosisFocusText(diagnosis: string): string {
  const chunks = diagnosis
    .split(/[\n\r.;]+/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const focused: string[] = [];
  for (const chunk of chunks) {
    if (!focused.length) {
      focused.push(chunk);
      continue;
    }

    if (TREATMENT_TRAIL_CUE_RE.test(chunk)) {
      break;
    }

    // Keep only short nosology refinements before treatment narrative starts.
    if (chunk.length <= 120) {
      focused.push(chunk);
    } else {
      break;
    }

    if (focused.length >= 2) {
      break;
    }
  }

  if (!focused.length) {
    return diagnosis;
  }

  return focused.join(". ");
}

function normalizeIcd10Prefix(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const upper = value.toUpperCase().replace(/\s+/g, "");
  const match = upper.match(/^([A-Z]\d{2})/);
  return match?.[1] ?? "";
}

function resolveSiteHints(context: GuidelineSelectionContext): string[] {
  const icdPrefix = normalizeIcd10Prefix(context.icd10_code);
  const fromIcd = icdPrefix ? ICD10_SITE_HINTS[icdPrefix] ?? [] : [];
  const fromNosology = textToTokens(
    [context.icd10_name_ru ?? "", context.nosology_label_ru ?? ""].join(" "),
    GUIDELINE_FOCUS_STOPWORDS,
  )
    .filter((token) => token.length >= 5)
    .slice(0, 6);

  return unique([...fromIcd, ...fromNosology]).slice(0, 8);
}

function hasTokenPrefixOverlap(leftTokens: string[], rightTokens: string[]): boolean {
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }

  return leftTokens.some((leftToken) =>
    rightTokens.some(
      (rightToken) =>
        rightToken === leftToken ||
        rightToken.startsWith(leftToken) ||
        leftToken.startsWith(rightToken),
    ),
  );
}

function countTokenPrefixOverlap(leftTokens: string[], rightTokens: string[]): number {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  let overlap = 0;
  for (const leftToken of leftTokens) {
    if (
      rightTokens.some(
        (rightToken) =>
          rightToken === leftToken ||
          rightToken.startsWith(leftToken) ||
          leftToken.startsWith(rightToken),
      )
    ) {
      overlap += 1;
    }
  }
  return overlap;
}

function buildQueryTokens(diagnosis: string, context: GuidelineSelectionContext): string[] {
  const focus = diagnosisFocusText(diagnosis);
  const diagnosisTokens = textToTokens(focus, GUIDELINE_QUERY_STOPWORDS).slice(0, 8);
  const nosologyTokens = textToTokens(
    [context.icd10_name_ru ?? "", context.nosology_label_ru ?? ""].join(" "),
    GUIDELINE_FOCUS_STOPWORDS,
  ).slice(0, 8);
  const siteHints = resolveSiteHints(context);
  return unique([...siteHints, ...nosologyTokens, ...diagnosisTokens]).slice(0, 10);
}

export async function selectApplicableGuidelines(
  diagnosis: string,
  asOfDate: string,
  limit = 8,
  context: GuidelineSelectionContext = {},
): Promise<AppliedGuidelineVersion[]> {
  const queryTokens = buildQueryTokens(diagnosis, context);
  const fallbackDiagnosis = diagnosisFocusText(diagnosis).toLowerCase();
  const candidatesPool = await listGuidelinesRaw(5000);
  const rawCandidates = candidatesPool
    .filter((candidate) => {
      const lowerName = candidate.name.toLowerCase();
      if (!queryTokens.length) {
        return lowerName.includes(fallbackDiagnosis);
      }
      return queryTokens.some((token) => lowerName.includes(token));
    })
    .sort((left, right) => parseDate(right.publish_date) - parseDate(left.publish_date));

  if (!rawCandidates.length) {
    return [];
  }

  const siteHints = resolveSiteHints(context);
  let candidates = rawCandidates;

  if (siteHints.length) {
    const narrowedBySite = rawCandidates.filter((candidate) =>
      siteHints.some((hint) => candidate.name.toLowerCase().includes(hint)),
    );

    if (narrowedBySite.length) {
      candidates = narrowedBySite;
    }
  }

  const relevanceScored = candidates
    .map((candidate) => {
      const nameTokens = textToTokens(candidate.name, GUIDELINE_QUERY_STOPWORDS);
      const queryOverlap = countTokenPrefixOverlap(queryTokens, nameTokens);
      const siteOverlap = countTokenPrefixOverlap(siteHints, nameTokens);
      const score = queryOverlap * 3 + siteOverlap * 2;

      return {
        candidate,
        score,
        hasOverlap: queryOverlap > 0 || hasTokenPrefixOverlap(siteHints, nameTokens),
      };
    })
    .filter((item) => item.hasOverlap)
    .sort((left, right) => right.score - left.score);

  if (relevanceScored.length) {
    candidates = relevanceScored.map((item) => item.candidate);
  } else if (siteHints.length) {
    // If site is known but no name-level overlap, returning an empty set is safer than
    // attaching unrelated recommendations from a different organ site.
    return [];
  }

  const asOfTimestamp = parseDate(asOfDate);
  const grouped = new Map<number | null, typeof candidates>();

  for (const candidate of candidates) {
    const key = candidate.code;
    const bucket = grouped.get(key) ?? [];
    bucket.push(candidate);
    grouped.set(key, bucket);
  }

  const selected: AppliedGuidelineVersion[] = [];

  for (const versions of grouped.values()) {
    const sorted = versions.sort((a, b) => parseDate(b.publish_date) - parseDate(a.publish_date));

    const applicable = sorted.find((item) => parseDate(item.publish_date) <= asOfTimestamp) ?? sorted[0];

    selected.push({
      id: applicable.id,
      name: applicable.name,
      publish_date: applicable.publish_date,
      status: applicable.status,
      source_url: applicable.source_url,
      pdf_url: applicable.pdf_url,
    });
  }

  return selected
    .sort((a, b) => parseDate(b.publish_date) - parseDate(a.publish_date))
    .slice(0, limit);
}

export async function listGuidelineSources(limit = 500): Promise<Array<{
  id: string;
  name: string;
  publish_date: string | null;
  status: number;
  source_url: string;
  pdf_url: string;
  section_count: number;
}>> {
  const rows = await listGuidelineSourcesWithSectionCounts(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    publish_date: row.publish_date,
    status: row.status,
    source_url: row.source_url,
    pdf_url: row.pdf_url,
    section_count: Number(row.section_count ?? 0),
  }));
}
