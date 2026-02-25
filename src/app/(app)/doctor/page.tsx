"use client";

import { useMemo, useState } from "react";
import {
  Download,
  FileUp,
  Loader2,
  Save,
  SearchCheck,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { SectionCard } from "@/components/section-card";
import { MetricChip } from "@/components/metric-chip";
import { sampleCaseInput } from "@/lib/sample-data";
import type {
  CaseInput,
  DoctorValidationResponse,
  ExcludedPersonalDataItem,
  PlannedDrug,
  RetrievalMode,
  TreatmentHistoryEntry,
  ValidationResult,
} from "@/lib/types";

type ParseResponse = {
  source: string;
  detected_format: string;
  text_length: number;
  preview: string;
  warnings?: string[];
  case_input: CaseInput;
  excluded_personal_data?: ExcludedPersonalDataItem[];
  privacy_notice?: string;
};

const defaultCase = sampleCaseInput;
const retrievalModes: RetrievalMode[] = ["standard"];

function parseLines(input: string): string[] {
  return input
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function numberFromText(input: string | null | undefined): number | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function intFromText(input: string | null | undefined): number | null {
  const parsed = numberFromText(input);
  return parsed === null ? null : Math.trunc(parsed);
}

function asText(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  return String(value);
}

function serializePlannedDrugs(items: PlannedDrug[] | undefined): string {
  if (!items?.length) {
    return "";
  }

  return items
    .map((item) => {
      const values = [
        item.name,
        item.dose_value ?? "",
        item.dose_unit ?? "",
        item.route ?? "",
        item.schedule_days ?? "",
        item.cycle_days ?? "",
      ];
      return values.join(" | ");
    })
    .join("\n");
}

function parsePlannedDrugs(input: string): PlannedDrug[] {
  return parseLines(input)
    .map((line) => {
      const [name = "", doseValue = "", doseUnit = "", route = "", scheduleDays = "", cycleDays = ""] = line
        .split("|")
        .map((item) => item.trim());
      return {
        name,
        dose_value: numberFromText(doseValue),
        dose_unit: doseUnit || undefined,
        route: route || undefined,
        schedule_days: scheduleDays || undefined,
        cycle_days: intFromText(cycleDays),
      } satisfies PlannedDrug;
    })
    .filter((item) => item.name.length > 0);
}

function severityFromResult(result: DoctorValidationResponse): "green" | "yellow" | "red" {
  if (result.conflicts.length > 0 || result.mismatches.length > 0 || result.missing_actions.length > 0) {
    return "red";
  }
  if (result.warnings.length > 0) {
    return "yellow";
  }
  return "green";
}

function statusText(status: ValidationResult["status"]): string {
  return status === "compliant" ? "Соответствует" : "Требует проверки";
}

function normalizedReasonText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function formatOverlayReason(
  level: ValidationOverlayLevel,
  reason: string | undefined,
  fragmentText: string | undefined,
): string | undefined {
  if (!reason) {
    return undefined;
  }

  const normalized = reason.trim();
  if (!normalized) {
    return undefined;
  }

  const normalizedReason = normalizedReasonText(normalized);
  const normalizedFragment = normalizedReasonText(fragmentText ?? "");

  if (level === "red") {
    if (normalizedReason.startsWith("аллергический риск")) {
      return "Есть риск безопасности: в текущем лечении присутствует препарат, на который указана аллергическая реакция в анамнезе.";
    }
    if (normalizedReason.includes("обнаружено совпадение с текущим назначением")) {
      return "Обнаружен клинический конфликт с текущим назначением.";
    }
    if (normalizedFragment && normalizedReason === normalizedFragment) {
      return "Для этого фрагмента лечения не найдено надежного подтверждения в выбранных клинических рекомендациях по текущей нозологии.";
    }
  }

  const shortReason =
    normalized.length <= 40 && !/[.:;]/.test(normalized) && normalized.split(/\s+/g).length <= 4;
  if (!shortReason) {
    return normalized;
  }

  if (level === "red") {
    return `Пункт лечения "${normalized}" не подтвержден или конфликтует с рекомендациями в текущем контексте.`;
  }
  if (level === "orange") {
    return `Для пункта "${normalized}" не хватает данных для надежной верификации назначения.`;
  }
  return normalized;
}

function buildOverlayTooltip(segment: ValidationOverlaySegment): string {
  const reason = formatOverlayReason(segment.level, segment.reason, segment.text);
  if (segment.level !== "red" && segment.level !== "orange") {
    return "";
  }

  return [
    reason
      ? segment.level === "red"
        ? `Почему не согласны: ${reason}`
        : `Не хватает данных: ${reason}`
      : "",
    segment.suggestion ? `Как корректнее: ${segment.suggestion}` : "",
    segment.source?.title ? `Источник: ${segment.source.title} / ${segment.source.section}` : "",
    segment.source?.url ? `Ссылка: ${segment.source.url}` : "",
    segment.source?.excerpt ? `Фрагмент: ${segment.source.excerpt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type ValidationOverlayLevel = "red" | "orange" | "green" | "neutral";

type ValidationOverlaySource = {
  title: string;
  section: string;
  url: string;
  excerpt: string;
};

type ValidationOverlaySegment = {
  text: string;
  level: ValidationOverlayLevel;
  reason?: string;
  source?: ValidationOverlaySource;
  suggestion?: string;
};

type ValidationOverlayLine = {
  text: string;
  segments: ValidationOverlaySegment[];
};

const OVERLAY_DIAGNOSIS_LINE_RE = /(диагноз|нозолог|мкб|локализац|стади[яи]|tnm|гистолог)/i;
const OVERLAY_TREATMENT_LINE_RE =
  /(лечени|терап|режим|протокол|схем|план|препарат|доз|курс|линия|пхт|химио|таргет|иммуно|введен|инфуз|carboplatin|cisplatin|paclitaxel|folfox|flot|xelox)/i;
const OVERLAY_DRUG_EXTRACT_RE =
  /(карбоплатин|цисплатин|оксалиплатин|паклитаксел|доцетаксел|доксорубицин|циклофосфамид|винорельбин|капецитабин|гемцитабин|иксабепилон|бевацизумаб|атезолизумаб|пембролизумаб|ниволумаб|иринотекан|эрибулин|eribulin|carboplatin|cisplatin|paclitaxel)/gi;
const OVERLAY_SEGMENT_BRIDGE_RE = /^\s*(?:[()\/,\-–—]*)\s*(?:и|или|с|со|в|во|на|по|к|ко|из|для|у|при|без)?\s*(?:[()\/,\-–—]*)\s*$/i;
const OVERLAY_HISTORY_FACT_RE =
  /(прогрессирован|рецидив|с\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}\s*по\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}|проведен[ао]?|выполнен[ао]?|на\s+фоне\s+проводимого)/i;
const OVERLAY_CLINICAL_HINT_TOKENS = new Set([
  "нейтрофилы",
  "нейтрофил",
  "тромбоциты",
  "тромбоцит",
  "гемоглобин",
  "билирубин",
  "креатинин",
  "ecog",
  "алт",
  "аст",
  "toxicity",
  "toxic",
]);
const DIAGNOSIS_MATCH_STOPWORDS = new Set([
  "рак",
  "карцинома",
  "cancer",
  "carcinoma",
  "опухоль",
  "опухоли",
  "железы",
  "железа",
  "стадия",
  "ст",
  "левый",
  "левая",
  "лев",
  "правый",
  "правая",
  "прав",
]);
const OVERLAY_STOPWORDS = new Set([
  "и",
  "или",
  "для",
  "при",
  "после",
  "в",
  "во",
  "на",
  "по",
  "из",
  "к",
  "ко",
  "с",
  "со",
  "под",
  "без",
  "не",
  "нет",
  "это",
  "как",
  "что",
  "так",
  "также",
  "был",
  "была",
  "были",
  "есть",
  "у",
  "же",
  "от",
  "до",
  "над",
  "где",
  "если",
  "нужно",
  "требуется",
  "проверить",
  "указать",
  "пациент",
  "пациента",
  "анамнезе",
  "плане",
  "текущего",
  "назначения",
  "линии",
  "лечения",
  "плана",
  "данные",
  "дата",
  "уточнить",
]);

function normalizeOverlayToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/pd[\s-]?l1/g, "pdl1")
    .replace(/ki[\s-]?67/g, "ki67")
    .replace(/[^a-z0-9а-яё]/g, "")
    .trim();
}

function isUsefulOverlayToken(token: string): boolean {
  if (!token || OVERLAY_STOPWORDS.has(token)) {
    return false;
  }
  if (/^\d+$/.test(token)) {
    return false;
  }
  if (token.length >= 3) {
    return true;
  }
  return token === "msi" || token === "mmr" || token === "tnm";
}

function overlayTokens(text: string): string[] {
  const matches = text.match(/[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9+/%.\-]*/g) ?? [];
  return Array.from(
    new Set(
      matches
        .map(normalizeOverlayToken)
        .filter(isUsefulOverlayToken),
    ),
  );
}

function buildTreatmentFocusTokens(caseInput: CaseInput): Set<string> {
  const chunks: string[] = [];

  if (caseInput.treatment_goal?.trim()) {
    chunks.push(caseInput.treatment_goal.trim());
  }
  if (caseInput.regimen_protocol?.trim()) {
    chunks.push(caseInput.regimen_protocol.trim());
  }
  if (caseInput.planned_drugs?.length) {
    for (const drug of caseInput.planned_drugs) {
      const extracted = Array.from(new Set(drug.name.match(OVERLAY_DRUG_EXTRACT_RE) ?? []));
      if (extracted.length > 0) {
        chunks.push(extracted.join(" "));
        continue;
      }
      chunks.push(drug.name);
    }
  }

  const hasStructuredPlan = chunks.length > 0;
  if (!hasStructuredPlan) {
    // Fallback to current plan only if structured plan fields are empty.
    const currentPlanCandidates = (caseInput.current_plan ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => /(назнач|рекоменд|режим|протокол|схем|линия|план|пхт|хт|таргет|иммуно)/i.test(item))
      .filter((item) => !/\bс\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}.*\bпо\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}/i.test(item))
      .slice(0, 4);
    chunks.push(...currentPlanCandidates);
  }

  const tokens = new Set<string>();
  for (const chunk of chunks) {
    for (const token of overlayTokens(chunk)) {
      tokens.add(token);
    }
  }
  return tokens;
}

function buildDiagnosisTokens(caseInput: CaseInput): Set<string> {
  const allTokens = overlayTokens([caseInput.diagnosis, caseInput.nosology_label_ru, caseInput.icd10_code].filter(Boolean).join(" "));
  const anchors = allTokens.filter((token) => {
    if (DIAGNOSIS_MATCH_STOPWORDS.has(token)) {
      return false;
    }
    if (/^[cm]\d{2}(?:\d)?$/.test(token)) {
      return true;
    }
    return token.length >= 4;
  });

  if (anchors.length > 0) {
    return new Set(anchors);
  }

  return new Set(allTokens.filter((token) => token.length >= 4));
}

function tokenSetOverlapCount(left: Set<string>, right: string[]): number {
  let overlap = 0;
  for (const token of right) {
    if (left.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function isTreatmentRelevantLine(line: string, focusTokens: Set<string>): boolean {
  const lower = line.toLowerCase();
  const tokens = overlayTokens(line);
  if (!tokens.length) {
    return false;
  }

  const hasFocusToken = tokens.some((token) => focusTokens.has(token));
  const hasTreatmentHint = OVERLAY_TREATMENT_LINE_RE.test(lower);
  const hasClinicalHint = tokens.some((token) => OVERLAY_CLINICAL_HINT_TOKENS.has(token));
  const diagnosisLike = OVERLAY_DIAGNOSIS_LINE_RE.test(lower);

  if (diagnosisLike && !hasTreatmentHint && !hasFocusToken && !hasClinicalHint) {
    return false;
  }

  return hasFocusToken || hasTreatmentHint || hasClinicalHint;
}

function overlapScore(leftTokens: string[], rightText: string): number {
  const rightTokens = overlayTokens(rightText);
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  return leftTokens.reduce((acc, token) => {
    if (
      rightTokens.some(
        (item) => item === token || item.startsWith(token) || token.startsWith(item),
      )
    ) {
      return acc + 1;
    }
    return acc;
  }, 0);
}

function reasonScore(lineTokens: string[], candidate: string): { score: number; overlap: number } {
  const candidateTokens = overlayTokens(candidate);
  if (!lineTokens.length || !candidateTokens.length) {
    return { score: 0, overlap: 0 };
  }

  const overlap = tokenOverlapFromArrays(lineTokens, candidateTokens);
  if (overlap <= 0) {
    return { score: 0, overlap: 0 };
  }

  const precision = overlap / candidateTokens.length;
  const recall = overlap / lineTokens.length;
  const harmonic = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const score = harmonic + Math.min(0.35, overlap * 0.08);
  return { score, overlap };
}

function pickBestReason(lineTokens: string[], candidates: string[]): { text: string; score: number; overlap: number } | null {
  let best: { text: string; score: number; overlap: number } | null = null;
  for (const candidate of candidates) {
    const stats = reasonScore(lineTokens, candidate);
    if (stats.score <= 0) {
      continue;
    }
    if (
      !best ||
      stats.score > best.score ||
      (Math.abs(stats.score - best.score) < 0.001 && stats.overlap > best.overlap)
    ) {
      best = {
        text: candidate,
        score: stats.score,
        overlap: stats.overlap,
      };
    }
  }
  return best;
}

function tokenOverlapFromArrays(left: string[], right: string[]): number {
  if (!left.length || !right.length) {
    return 0;
  }

  let overlap = 0;
  for (const leftToken of left) {
    if (
      right.some(
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

function pickBestSource(
  lineTokens: string[],
  reason: string,
  result: DoctorValidationResponse,
  diagnosisTokens: Set<string>,
  treatmentFocusTokens: Set<string>,
): ValidationOverlaySource | undefined {
  const reasonTokens = overlayTokens(reason);
  const appliedGuidelineIds = new Set((result.applied_guideline_versions ?? []).map((item) => item.id));
  let best:
    | {
        score: number;
        hit: DoctorValidationResponse["evidence"][number];
      }
    | null = null;

  for (const hit of result.evidence) {
    if (appliedGuidelineIds.size > 0 && !appliedGuidelineIds.has(hit.guideline_id)) {
      continue;
    }
    const sourceIdentityTokens = overlayTokens(`${hit.guideline_name} ${hit.section_title}`);
    if (diagnosisTokens.size > 0 && tokenSetOverlapCount(diagnosisTokens, sourceIdentityTokens) === 0) {
      continue;
    }

    const lineScore = overlapScore(lineTokens, hit.chunk_text);
    const reasonScore = overlapScore(reasonTokens, hit.chunk_text);
    const focusScore = tokenSetOverlapCount(treatmentFocusTokens, overlayTokens(hit.chunk_text));
    const total = Math.max(lineScore, reasonScore) + Math.min(2, focusScore);
    if (total <= 0) {
      continue;
    }
    if (!best || total > best.score) {
      best = {
        score: total,
        hit,
      };
    }
  }

  if (!best) {
    return undefined;
  }

  return {
    title: best.hit.guideline_name,
    section: best.hit.section_title,
    url: best.hit.document_url,
    excerpt: best.hit.chunk_text.slice(0, 240),
  };
}

function sameOverlayMeta(left: ValidationOverlaySegment, right: ValidationOverlaySegment): boolean {
  return (
    left.reason === right.reason &&
    left.suggestion === right.suggestion &&
    left.source?.title === right.source?.title &&
    left.source?.section === right.source?.section &&
    left.source?.url === right.source?.url &&
    left.source?.excerpt === right.source?.excerpt
  );
}

function splitLineIntoClauses(line: string): string[] {
  const parts = line.split(/([.;:!?]+)/g);
  const clauses: string[] = [];

  for (let index = 0; index < parts.length; index += 2) {
    const body = parts[index] ?? "";
    const punctuation = parts[index + 1] ?? "";
    const clause = `${body}${punctuation}`;
    if (clause.length > 0) {
      clauses.push(clause);
    }
  }

  return clauses.length ? clauses : [line];
}

function mergeOverlaySegments(segments: ValidationOverlaySegment[]): ValidationOverlaySegment[] {
  const merged: ValidationOverlaySegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const canMerge =
      previous &&
      previous.level === segment.level &&
      sameOverlayMeta(previous, segment);

    if (canMerge) {
      previous.text += segment.text;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function mergeSeparatedColoredSegments(segments: ValidationOverlaySegment[]): ValidationOverlaySegment[] {
  const merged = [...segments];
  let index = 0;

  while (index < merged.length - 2) {
    const left = merged[index];
    const bridge = merged[index + 1];
    const right = merged[index + 2];
    const canBridge =
      left.level !== "neutral" &&
      right.level === left.level &&
      bridge.level === "neutral" &&
      OVERLAY_SEGMENT_BRIDGE_RE.test(bridge.text) &&
      sameOverlayMeta(left, right);

    if (!canBridge) {
      index += 1;
      continue;
    }

    left.text += `${bridge.text}${right.text}`;
    merged.splice(index + 1, 2);
  }

  return mergeOverlaySegments(merged);
}

function annotateTextByValidation(
  text: string,
  result: DoctorValidationResponse | null,
  treatmentFocusTokens: Set<string>,
  diagnosisTokens: Set<string>,
): ValidationOverlayLine[] {
  const lines = text.split(/\n/g);
  if (!result) {
    return lines.map((line) => ({
      text: line,
      segments: [{ text: line.length > 0 ? line : " ", level: "neutral" }],
    }));
  }

  const redReasons = [...result.mismatches, ...result.missing_actions, ...result.conflicts];
  const orangeReasons = result.warnings;
  const greenReasons = result.matches;

  return lines.map((line) => {
    if (line.length === 0) {
      return {
        text: line,
        segments: [{ text: " ", level: "neutral" }],
      } satisfies ValidationOverlayLine;
    }

    if (!isTreatmentRelevantLine(line, treatmentFocusTokens)) {
      return {
        text: line,
        segments: [{ text: line, level: "neutral" }],
      } satisfies ValidationOverlayLine;
    }

    const clauses = splitLineIntoClauses(line);
    const rawSegments = clauses.map((clause) => {
      const clauseTokens = overlayTokens(clause);
      if (!clauseTokens.length || !isTreatmentRelevantLine(clause, treatmentFocusTokens)) {
        return {
          text: clause,
          level: "neutral",
        } satisfies ValidationOverlaySegment;
      }

      const hasFocusToken = clauseTokens.some((token) => treatmentFocusTokens.has(token));

      const redCandidate = pickBestReason(clauseTokens, redReasons);
      if (redCandidate && (redCandidate.overlap >= 2 || (hasFocusToken && redCandidate.score >= 0.35))) {
        const source = pickBestSource(clauseTokens, redCandidate.text, result, diagnosisTokens, treatmentFocusTokens);
        const bestMatch = pickBestReason(clauseTokens, greenReasons);
        const suggestion = (
          bestMatch && bestMatch.text.length <= 140
            ? bestMatch.text
            : source?.excerpt ??
              "Сверьте режим, линию терапии и дозы с рекомендацией источника."
        ).slice(0, 220);
        return {
          text: clause,
          level: "red",
          reason: redCandidate.text,
          source,
          suggestion,
        } satisfies ValidationOverlaySegment;
      }

      const orangeCandidate = pickBestReason(clauseTokens, orangeReasons);
      if (orangeCandidate && (orangeCandidate.overlap >= 2 || (hasFocusToken && orangeCandidate.score >= 0.35))) {
        return {
          text: clause,
          level: "orange",
          reason: orangeCandidate.text,
        } satisfies ValidationOverlaySegment;
      }

      const greenCandidate = pickBestReason(clauseTokens, greenReasons);
      if (greenCandidate && (greenCandidate.overlap >= 2 || (hasFocusToken && greenCandidate.score >= 0.25))) {
        return {
          text: clause,
          level: "green",
          reason: greenCandidate.text,
        } satisfies ValidationOverlaySegment;
      }

      if (!hasFocusToken && OVERLAY_HISTORY_FACT_RE.test(clause.toLowerCase())) {
        return {
          text: clause,
          level: "green",
          reason: "Исторический факт лечения подтвержден в данных случая.",
        } satisfies ValidationOverlaySegment;
      }

      return {
        text: clause,
        level: "neutral",
      } satisfies ValidationOverlaySegment;
    });

    return {
      text: line,
      segments: mergeSeparatedColoredSegments(mergeOverlaySegments(rawSegments)),
    } satisfies ValidationOverlayLine;
  });
}

export default function DoctorPage() {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);

  const [diagnosis, setDiagnosis] = useState(defaultCase.diagnosis);
  const [stageNumeric, setStageNumeric] = useState(asText(defaultCase.stage_numeric));
  const [stageRaw, setStageRaw] = useState(defaultCase.stage_raw ?? "");
  const [sex, setSex] = useState(defaultCase.sex);
  const [age, setAge] = useState(asText(defaultCase.age));
  const [weightKg, setWeightKg] = useState(asText(defaultCase.weight_kg));
  const [heightCm, setHeightCm] = useState(asText(defaultCase.height_cm));
  const [bsaM2, setBsaM2] = useState(asText(defaultCase.bsa_m2));
  const [ecog, setEcog] = useState(asText(defaultCase.ecog));

  const [icd10Code, setIcd10Code] = useState(defaultCase.icd10_code ?? "");
  const [icd10NameRu, setIcd10NameRu] = useState(defaultCase.icd10_name_ru ?? "");
  const [nosologyLabelRu, setNosologyLabelRu] = useState(defaultCase.nosology_label_ru ?? "");
  const [tnm, setTnm] = useState(defaultCase.tnm ?? "");
  const [histology, setHistology] = useState(defaultCase.histology ?? "");
  const [biomarkersText, setBiomarkersText] = useState(defaultCase.biomarkers.join("\n"));

  const [treatmentGoal, setTreatmentGoal] = useState(defaultCase.treatment_goal ?? "");
  const [regimenProtocol, setRegimenProtocol] = useState(defaultCase.regimen_protocol ?? "");
  const [protocolAssignmentDate, setProtocolAssignmentDate] = useState(defaultCase.protocol_assignment_date ?? "");
  const [plannedTherapyLine, setPlannedTherapyLine] = useState(asText(defaultCase.planned_therapy_line));
  const [plannedDrugsText, setPlannedDrugsText] = useState(serializePlannedDrugs(defaultCase.planned_drugs));
  const [planText, setPlanText] = useState(defaultCase.current_plan.join("\n"));

  const [comorbiditiesText, setComorbiditiesText] = useState(defaultCase.comorbidities.join("\n"));
  const [allergiesText, setAllergiesText] = useState((defaultCase.allergies ?? []).join("\n"));
  const [metastasesText, setMetastasesText] = useState((defaultCase.metastases ?? []).join("\n"));
  const [complicationsText, setComplicationsText] = useState((defaultCase.complications ?? []).join("\n"));

  const [neutrophilsAbs, setNeutrophilsAbs] = useState(asText(defaultCase.neutrophils_abs));
  const [platelets, setPlatelets] = useState(asText(defaultCase.platelets));
  const [hemoglobin, setHemoglobin] = useState(asText(defaultCase.hemoglobin));
  const [bilirubinTotal, setBilirubinTotal] = useState(asText(defaultCase.bilirubin_total));
  const [creatinine, setCreatinine] = useState(asText(defaultCase.creatinine));
  const [alt, setAlt] = useState(asText(defaultCase.alt));
  const [ast, setAst] = useState(asText(defaultCase.ast));

  const [diseaseStatus, setDiseaseStatus] = useState(defaultCase.disease_status ?? "");
  const [lastImagingDate, setLastImagingDate] = useState(defaultCase.last_imaging_date ?? "");
  const [asOfDate, setAsOfDate] = useState(defaultCase.as_of_date);
  const [timelineText, setTimelineText] = useState(JSON.stringify(defaultCase.timeline, null, 2));
  const [treatmentHistory, setTreatmentHistory] = useState<TreatmentHistoryEntry[]>(defaultCase.treatment_history ?? []);

  const [rawInputText, setRawInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsePreview, setParsePreview] = useState("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [excludedPersonalData, setExcludedPersonalData] = useState<ExcludedPersonalDataItem[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState("");

  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>("standard");

  const [result, setResult] = useState<DoctorValidationResponse | null>(null);
  const [parsing, setParsing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [exporting, setExporting] = useState<"commission" | "patient" | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  const [feedbackRating, setFeedbackRating] = useState<"up" | "down" | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");

  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const payloadPreview = useMemo<CaseInput>(() => {
    let parsedTimeline: CaseInput["timeline"] = [];
    try {
      parsedTimeline = JSON.parse(timelineText) as CaseInput["timeline"];
    } catch {
      parsedTimeline = [];
    }

    return {
      diagnosis,
      stage: stageNumeric.trim(),
      stage_numeric: intFromText(stageNumeric),
      stage_raw: stageRaw,
      sex,
      age: intFromText(age),
      weight_kg: numberFromText(weightKg),
      height_cm: numberFromText(heightCm),
      bsa_m2: numberFromText(bsaM2),
      ecog: intFromText(ecog),
      histology,
      biomarkers: parseLines(biomarkersText),
      icd10_code: icd10Code,
      icd10_name_ru: icd10NameRu,
      nosology_label_ru: nosologyLabelRu,
      primary_localization: nosologyLabelRu || diagnosis,
      tnm,
      comorbidities: parseLines(comorbiditiesText),
      allergies: parseLines(allergiesText),
      metastases: parseLines(metastasesText),
      complications: parseLines(complicationsText),
      neutrophils_abs: numberFromText(neutrophilsAbs),
      platelets: numberFromText(platelets),
      hemoglobin: numberFromText(hemoglobin),
      bilirubin_total: numberFromText(bilirubinTotal),
      creatinine: numberFromText(creatinine),
      alt: numberFromText(alt),
      ast: numberFromText(ast),
      disease_status: diseaseStatus,
      last_imaging_date: lastImagingDate,
      treatment_history: treatmentHistory,
      contraindications: [],
      timeline: parsedTimeline,
      current_plan: parseLines(planText),
      treatment_goal: treatmentGoal,
      regimen_protocol: regimenProtocol,
      protocol_assignment_date: protocolAssignmentDate,
      planned_therapy_line: intFromText(plannedTherapyLine),
      planned_drugs: parsePlannedDrugs(plannedDrugsText),
      as_of_date: asOfDate,
      prior_surgeries: defaultCase.prior_surgeries,
      radiation_history: defaultCase.radiation_history,
      labs: {
        ...(hemoglobin.trim() ? { Hb: `${hemoglobin} г/л` } : {}),
        ...(neutrophilsAbs.trim() ? { "Нейтрофилы": `${neutrophilsAbs} x10^9/л` } : {}),
        ...(platelets.trim() ? { "Тромбоциты": `${platelets} x10^9/л` } : {}),
      },
    };
  }, [
    age,
    allergiesText,
    alt,
    asOfDate,
    ast,
    biomarkersText,
    bilirubinTotal,
    bsaM2,
    comorbiditiesText,
    complicationsText,
    creatinine,
    diagnosis,
    diseaseStatus,
    ecog,
    hemoglobin,
    heightCm,
    histology,
    icd10Code,
    icd10NameRu,
    lastImagingDate,
    metastasesText,
    neutrophilsAbs,
    nosologyLabelRu,
    planText,
    plannedDrugsText,
    plannedTherapyLine,
    platelets,
    protocolAssignmentDate,
    regimenProtocol,
    sex,
    stageNumeric,
    stageRaw,
    timelineText,
    tnm,
    treatmentGoal,
    treatmentHistory,
    weightKg,
  ]);

  function applyCaseInput(caseInput: CaseInput) {
    setDiagnosis(caseInput.diagnosis);
    setStageNumeric(asText(caseInput.stage_numeric ?? intFromText(caseInput.stage ?? "")));
    setStageRaw(caseInput.stage_raw ?? caseInput.stage ?? "");
    setSex(caseInput.sex);
    setAge(asText(caseInput.age));
    setWeightKg(asText(caseInput.weight_kg));
    setHeightCm(asText(caseInput.height_cm));
    setBsaM2(asText(caseInput.bsa_m2));
    setEcog(asText(caseInput.ecog));

    setIcd10Code(caseInput.icd10_code ?? "");
    setIcd10NameRu(caseInput.icd10_name_ru ?? "");
    setNosologyLabelRu(caseInput.nosology_label_ru ?? "");
    setTnm(caseInput.tnm ?? "");
    setHistology(caseInput.histology ?? "");
    setBiomarkersText((caseInput.biomarkers ?? []).join("\n"));

    setTreatmentGoal(caseInput.treatment_goal ?? "");
    setRegimenProtocol(caseInput.regimen_protocol ?? "");
    setProtocolAssignmentDate(caseInput.protocol_assignment_date ?? "");
    setPlannedTherapyLine(asText(caseInput.planned_therapy_line));
    setPlannedDrugsText(serializePlannedDrugs(caseInput.planned_drugs));
    setPlanText((caseInput.current_plan ?? []).join("\n"));

    setComorbiditiesText((caseInput.comorbidities ?? []).join("\n"));
    setAllergiesText((caseInput.allergies ?? []).join("\n"));
    setMetastasesText((caseInput.metastases ?? []).join("\n"));
    setComplicationsText((caseInput.complications ?? []).join("\n"));

    setNeutrophilsAbs(asText(caseInput.neutrophils_abs));
    setPlatelets(asText(caseInput.platelets));
    setHemoglobin(asText(caseInput.hemoglobin));
    setBilirubinTotal(asText(caseInput.bilirubin_total));
    setCreatinine(asText(caseInput.creatinine));
    setAlt(asText(caseInput.alt));
    setAst(asText(caseInput.ast));

    setDiseaseStatus(caseInput.disease_status ?? "");
    setLastImagingDate(caseInput.last_imaging_date ?? "");
    setAsOfDate(caseInput.as_of_date);
    setTimelineText(JSON.stringify(caseInput.timeline ?? [], null, 2));
    setTreatmentHistory(caseInput.treatment_history ?? []);
  }

  async function handleParseInput() {
    setParsing(true);
    setError(null);
    setStatusMessage("");

    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append("file", selectedFile);
      }
      if (rawInputText.trim()) {
        formData.append("text", rawInputText.trim());
      }

      const response = await fetch("/api/case/parse", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details ?? data?.error ?? "Не удалось разобрать входные данные");
      }

      const parsed = data as ParseResponse;
      applyCaseInput(parsed.case_input);
      setParsePreview(parsed.preview);
      setParseWarnings(parsed.warnings ?? []);
      setExcludedPersonalData(parsed.excluded_personal_data ?? []);
      setPrivacyNotice(parsed.privacy_notice ?? "");
      setStatusMessage("Парсинг выполнен. Проверьте поля на этапе 2.");
      setActiveStep(2);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ошибка парсинга");
    } finally {
      setParsing(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setError(null);
    setStatusMessage("");

    try {
      const response = await fetch("/api/doctor/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          case_input: payloadPreview,
          retrieval_mode: retrievalMode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details ?? data?.error ?? "Ошибка валидации");
      }

      setResult(data as DoctorValidationResponse);
      setStatusMessage("Валидация завершена. Проверьте результат и экспорт.");
      setActiveStep(3);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ошибка валидации");
    } finally {
      setValidating(false);
    }
  }

  async function downloadPdf(endpoint: "/api/export/commission-pdf" | "/api/export/patient-pdf") {
    if (!result) {
      return;
    }

    setExporting(endpoint === "/api/export/commission-pdf" ? "commission" : "patient");
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          case_input: payloadPreview,
          validation: result,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.details ?? data?.error ?? "Ошибка экспорта PDF");
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = endpoint === "/api/export/commission-pdf" ? "commission-report.pdf" : "patient-report.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);

      setStatusMessage(endpoint === "/api/export/commission-pdf" ? "PDF для комиссии сформирован." : "Patient PDF сформирован.");
      setActiveStep(4);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ошибка генерации PDF");
    } finally {
      setExporting(null);
    }
  }

  async function handleFeedbackSubmit() {
    if (!result?.validation_run_id || !feedbackRating) {
      return;
    }

    setFeedbackSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/doctor/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          validation_run_id: result.validation_run_id,
          rating: feedbackRating,
          comment: feedbackComment,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details ?? data?.error ?? "Ошибка сохранения feedback");
      }

      setStatusMessage("Обратная связь сохранена.");
      setFeedbackComment("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ошибка сохранения feedback");
    } finally {
      setFeedbackSaving(false);
    }
  }

  const validationSeverity = result ? severityFromResult(result) : null;
  const treatmentFocusTokens = useMemo(() => buildTreatmentFocusTokens(payloadPreview), [payloadPreview]);
  const diagnosisTokens = useMemo(() => buildDiagnosisTokens(payloadPreview), [payloadPreview]);
  const annotatedPreviewLines = useMemo(
    () => annotateTextByValidation(parsePreview, result, treatmentFocusTokens, diagnosisTokens),
    [parsePreview, result, treatmentFocusTokens, diagnosisTokens],
  );
  const redAnnotatedFragments = useMemo(() => {
    const grouped = new Map<string, {
      text: string;
      reason?: string;
      source?: ValidationOverlaySource;
      suggestion?: string;
    }>();

    for (const line of annotatedPreviewLines) {
      for (const segment of line.segments) {
        if (segment.level !== "red") {
          continue;
        }

        const fragment = segment.text.trim();
        if (!fragment) {
          continue;
        }

        const formattedReason = formatOverlayReason(segment.level, segment.reason, fragment);
        const key = [
          formattedReason ?? "",
          segment.source?.title ?? "",
          segment.source?.section ?? "",
          segment.source?.url ?? "",
        ].join("|");
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, {
            text: fragment,
            reason: formattedReason,
            source: segment.source,
            suggestion: segment.suggestion,
          });
          continue;
        }

        if (fragment.length > existing.text.length) {
          existing.text = fragment;
        }
        if (!existing.suggestion && segment.suggestion) {
          existing.suggestion = segment.suggestion;
        }
      }
    }

    return Array.from(grouped.values()).slice(0, 12);
  }, [annotatedPreviewLines]);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-[#2f5278] bg-[#0b1f34]/85 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-[#8fb6dd]">Workflow</p>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <StepButton step={1} activeStep={activeStep} title="Этап 1" subtitle="Загрузка" onClick={setActiveStep} />
          <StepButton step={2} activeStep={activeStep} title="Этап 2" subtitle="Парсинг" onClick={setActiveStep} />
          <StepButton step={3} activeStep={activeStep} title="Этап 3" subtitle="RAG + валидация" onClick={setActiveStep} />
          <StepButton step={4} activeStep={activeStep} title="Этап 4" subtitle="Экспорт" onClick={setActiveStep} />
        </div>
      </div>

      {activeStep === 1 ? (
        <SectionCard
          title="Этап 1. Загрузка данных"
          subtitle="Загрузите файл или вставьте историю болезни, затем запустите авторазбор."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Файл (txt/doc/docx/pdf)</span>
              <input
                type="file"
                accept=".txt,.doc,.docx,.pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#cde5fb]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Или вставьте текст</span>
              <textarea
                value={rawInputText}
                onChange={(event) => setRawInputText(event.target.value)}
                rows={8}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={handleParseInput}
              disabled={parsing || (!selectedFile && !rawInputText.trim())}
              className="inline-flex items-center gap-2 rounded-full border border-[#4f8cc1] bg-[#143456] px-5 py-2 text-sm font-semibold text-[#def6ff] transition hover:bg-[#1a436d] disabled:opacity-60"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              Разобрать вход
            </button>
          </div>
        </SectionCard>
      ) : null}

      {activeStep === 2 ? (
        <SectionCard
          title="Этап 2. Проверка парсинга и сортировки"
          subtitle="Исправьте поля при необходимости. Стадия хранится как цифра, сырое значение показывается отдельно."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Диагноз</span>
              <textarea
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Стадия (цифра 0-4)</span>
              <input
                value={stageNumeric}
                onChange={(event) => setStageNumeric(event.target.value.replace(/[^0-4]/g, ""))}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Стадия (как в тексте)</span>
              <input
                value={stageRaw}
                onChange={(event) => setStageRaw(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <Field label="МКБ-10 код" value={icd10Code} onChange={setIcd10Code} />
            <Field label="МКБ-10 нозология (RU)" value={icd10NameRu} onChange={setIcd10NameRu} />
            <Field label="Нозология (для поиска)" value={nosologyLabelRu} onChange={setNosologyLabelRu} />
            <Field label="TNM" value={tnm} onChange={setTnm} />

            <Field label="Гистология" value={histology} onChange={setHistology} />
            <Field label="ECOG" value={ecog} onChange={(value) => setEcog(value.replace(/[^0-4]/g, ""))} />
            <Field label="Возраст" value={age} onChange={(value) => setAge(value.replace(/[^0-9]/g, ""))} />
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Пол</span>
              <select
                value={sex}
                onChange={(event) => setSex(event.target.value as CaseInput["sex"])}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              >
                <option value="unknown">Не указан</option>
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
                <option value="other">Иной</option>
              </select>
            </label>
            <Field label="Вес, кг" value={weightKg} onChange={(value) => setWeightKg(value.replace(/[^0-9,\.]/g, ""))} />
            <Field label="Рост, см" value={heightCm} onChange={(value) => setHeightCm(value.replace(/[^0-9,\.]/g, ""))} />
            <Field label="BSA, м²" value={bsaM2} onChange={(value) => setBsaM2(value.replace(/[^0-9,\.]/g, ""))} />
            <Field label="Дата проверки" value={asOfDate} onChange={setAsOfDate} type="date" />

            <Field label="Дата назначения протокола" value={protocolAssignmentDate} onChange={setProtocolAssignmentDate} type="date" />
            <Field label="Линия терапии" value={plannedTherapyLine} onChange={(value) => setPlannedTherapyLine(value.replace(/[^0-9]/g, ""))} />

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Биомаркеры</span>
              <textarea
                value={biomarkersText}
                onChange={(event) => setBiomarkersText(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Сопутствующие заболевания</span>
              <textarea
                value={comorbiditiesText}
                onChange={(event) => setComorbiditiesText(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Аллергии</span>
              <textarea
                value={allergiesText}
                onChange={(event) => setAllergiesText(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">План лечения (блок 5)</span>
              <textarea
                value={planText}
                onChange={(event) => setPlanText(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Режим/протокол</span>
              <input
                value={regimenProtocol}
                onChange={(event) => setRegimenProtocol(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Цель лечения</span>
              <input
                value={treatmentGoal}
                onChange={(event) => setTreatmentGoal(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Препараты (name | dose | unit | route | days | cycle)</span>
              <textarea
                value={plannedDrugsText}
                onChange={(event) => setPlannedDrugsText(event.target.value)}
                rows={5}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 font-mono text-xs text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <Field label="Нейтрофилы (абс.)" value={neutrophilsAbs} onChange={setNeutrophilsAbs} />
            <Field label="Тромбоциты" value={platelets} onChange={setPlatelets} />
            <Field label="Гемоглобин" value={hemoglobin} onChange={setHemoglobin} />
            <Field label="Билирубин" value={bilirubinTotal} onChange={setBilirubinTotal} />
            <Field label="Креатинин" value={creatinine} onChange={setCreatinine} />
            <Field label="АЛТ" value={alt} onChange={setAlt} />
            <Field label="АСТ" value={ast} onChange={setAst} />
            <Field label="Статус заболевания" value={diseaseStatus} onChange={setDiseaseStatus} />
            <Field label="Дата визуализации" value={lastImagingDate} onChange={setLastImagingDate} type="date" />

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Метастазы</span>
              <textarea
                value={metastasesText}
                onChange={(event) => setMetastasesText(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Осложнения</span>
              <textarea
                value={complicationsText}
                onChange={(event) => setComplicationsText(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Timeline (JSON)</span>
              <textarea
                value={timelineText}
                onChange={(event) => setTimelineText(event.target.value)}
                rows={5}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 font-mono text-xs text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>
          </div>

          {parsePreview ? (
            <div className="mt-4 rounded-xl border border-[#2e4f73] bg-[#0d2138]/80 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Обезличенный предпросмотр</p>
              <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs text-[#cde5fb]">{parsePreview}</p>
            </div>
          ) : null}

          {excludedPersonalData.length > 0 || privacyNotice ? (
            <div className="mt-4 rounded-xl border border-[#5c6b2f] bg-[#1f2512]/80 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[#d7e89d]">Эти данные исключены и не используются дальше</p>
              {privacyNotice ? <p className="mt-2 text-sm text-[#f4ffd2]">{privacyNotice}</p> : null}
              <ul className="mt-2 space-y-1 text-sm text-[#f4ffd2]">
                {excludedPersonalData.map((item, index) => (
                  <li key={`${item.type}-${item.masked_value}-${index}`}>
                    {item.type === "fio" ? "ФИО" : "Дата рождения"}: {item.masked_value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {parseWarnings.length > 0 ? (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-[#ffd89e]">
              {parseWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => setActiveStep(3)}
              className="inline-flex items-center gap-2 rounded-full border border-[#5aa2dd] bg-[#113452] px-5 py-2 text-sm font-semibold text-[#d7f2ff]"
            >
              <Save className="h-4 w-4" />
              Перейти к валидации
            </button>
          </div>
        </SectionCard>
      ) : null}

      {activeStep === 3 ? (
        <SectionCard
          title="Этап 3. RAG-поиск и валидация"
          subtitle="Проверка назначения с учетом блока 5 и биомаркеров, плюс экспорт и обратная связь."
        >
          <div className="space-y-4 rounded-xl border border-[#2f5278] bg-[#0d2138]/70 p-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Источники KR</p>
              <p className="mt-2 rounded-lg border border-[#2b4a6b] bg-[#0c2036]/80 px-3 py-2 text-sm text-[#d7ecff]">
                Автоматический режим: используется локальная база Минздрава РФ (без online fallback и без ручного выбора).
              </p>
            </div>

            <div className="grid gap-3">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Модель</span>
                <select
                  value={retrievalMode}
                  onChange={(event) => setRetrievalMode(event.target.value as RetrievalMode)}
                  className="w-full rounded-md border border-[#2e4f73] bg-[#0d2138] px-2 py-2 text-sm text-[#cfe8ff]"
                >
                  {retrievalModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              onClick={handleValidate}
              disabled={validating}
              className="inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-5 py-2 text-sm font-semibold text-[#dffeff] transition hover:bg-[#1b4263] disabled:opacity-60"
            >
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              Запустить валидацию
            </button>
          </div>

          {result ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricChip label="Статус" value={statusText(result.status)} />
                <MetricChip label="Задержка" value={`${result.latency_ms} мс`} />
                <MetricChip label="Traceability" value={`${Math.round(result.source_traceability_rate * 100)}%`} />
                <MetricChip label="Validation Run" value={result.validation_run_id ?? "n/a"} />
              </div>

              <div
                className={`rounded-2xl border p-4 text-sm ${
                  validationSeverity === "green"
                    ? "border-[#2d6a4f] bg-[#113126]/80 text-[#bff3d4]"
                    : validationSeverity === "yellow"
                      ? "border-[#816b2f] bg-[#362d16]/80 text-[#ffe9b0]"
                      : "border-[#7f2b2b] bg-[#3b1616]/80 text-[#ffc2c2]"
                }`}
              >
                <p className="text-xs uppercase tracking-[0.14em]">Общий вывод</p>
                <p className="mt-2 text-base font-semibold">Назначение: {statusText(result.status)}</p>
                {result.rag_query_context ? (
                  <p className="mt-2 text-xs text-[#cfe8ff]">RAG context: {result.rag_query_context}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-[#2f5278] bg-[#0d2138]/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#8fb6dd]">Клинические рекомендации в проверке</p>
                <p className="mt-1 text-xs text-[#9ec4e6]">
                  Нозология: {payloadPreview.nosology_label_ru || "не указана"}; МКБ-10: {payloadPreview.icd10_code || "не указан"}.
                </p>
                {result.applied_guideline_versions.length > 0 ? (
                  <ul className="mt-3 space-y-2 text-sm text-[#d7ecff]">
                    {result.applied_guideline_versions.map((item) => (
                      <li key={item.id} className="rounded-lg border border-[#2b4a6b] bg-[#0c2036]/80 px-3 py-2">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-[#9ec4e6]">
                          Версия: {item.id}
                          {item.publish_date ? ` • ${item.publish_date.slice(0, 10)}` : ""}
                        </p>
                        {item.source_url ? (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-xs text-[#9be7ff] underline"
                          >
                            Открыть клиническую рекомендацию
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 rounded-lg border border-[#7f2b2b] bg-[#3b1616]/80 px-3 py-2 text-sm text-[#ffc2c2]">
                    По текущей нозологии не найдены применимые клинические рекомендации Минздрава РФ.
                  </p>
                )}
                {result.nearby_guideline_versions?.length ? (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Ближайшие клинические рекомендации (косвенный поиск)</p>
                    <ul className="mt-2 space-y-2 text-sm text-[#cde5fb]">
                      {result.nearby_guideline_versions.map((item) => (
                        <li key={`nearby-${item.id}`} className="rounded-lg border border-[#2b4a6b] bg-[#0c2036]/60 px-3 py-2">
                          <p>{item.name}</p>
                          <p className="text-xs text-[#8fb6dd]">
                            Версия: {item.id}
                            {item.publish_date ? ` • ${item.publish_date.slice(0, 10)}` : ""}
                          </p>
                          {item.source_url ? (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-block text-xs text-[#9be7ff] underline"
                            >
                              Открыть
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              {parsePreview ? (
                <div className="space-y-3 rounded-2xl border border-[#2f5278] bg-[#0d2138]/70 p-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-[#8fb6dd]">Разметка исходного текста</p>
                    <p className="mt-1 text-xs text-[#9ec4e6]">
                      Зеленый: подтверждено рекомендациями. Красный: нет подтверждения/есть противоречие/не хватает данных для проверки.
                    </p>
                    <p className="mt-1 text-xs text-[#9ec4e6]">Диагноз не критикуется: разметка применяется только к фрагментам лечения и его безопасности.</p>
                  </div>
                  <div className="max-h-80 overflow-y-auto rounded-xl border border-[#2c4d70] bg-[#0a1b2d] p-3 font-mono text-xs leading-6 text-[#d8ecff]">
                    {annotatedPreviewLines.map((line, index) => {
                      const lineLevel = line.segments.some((segment) => segment.level === "red")
                        ? "red"
                        : line.segments.some((segment) => segment.level === "orange")
                          ? "orange"
                          : line.segments.some((segment) => segment.level === "green")
                            ? "green"
                            : "neutral";

                      return (
                        <div
                          key={`${index}-${line.text.slice(0, 20)}`}
                          className={`rounded px-2 whitespace-pre-wrap ${
                            lineLevel === "red"
                              ? "border-l-2 border-[#ff8f8f] bg-[#2d1414]/35"
                              : lineLevel === "orange"
                                ? "border-l-2 border-[#efc36c] bg-[#2c2313]/35"
                                : lineLevel === "green"
                                  ? "border-l-2 border-[#66d8ad] bg-[#143227]/28"
                                  : ""
                          }`}
                        >
                          {line.segments.map((segment, segmentIndex) => {
                            const tooltip = buildOverlayTooltip(segment);
                            const hasPopover = Boolean(tooltip);

                            return (
                              <span
                                key={`${index}-${segmentIndex}`}
                                className={`${
                                  hasPopover ? "group relative cursor-help" : ""
                                } ${
                                  segment.level === "red"
                                    ? "rounded-sm bg-[#4b1d1d]/70 px-0.5 text-[#ffd2d2] underline decoration-[#ff7f7f] decoration-2 underline-offset-2"
                                    : segment.level === "orange"
                                      ? "rounded-sm bg-[#4c3a18]/60 px-0.5 text-[#ffe7b3]"
                                      : segment.level === "green"
                                        ? "rounded-sm bg-[#1d4534]/55 px-0.5 text-[#c6ffe2]"
                                        : "text-[#d8ecff]"
                                }`}
                              >
                                {segment.text}
                                {hasPopover ? (
                                  <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[24rem] whitespace-pre-wrap rounded-lg border border-[#2f5278] bg-[#081524] px-3 py-2 text-[11px] leading-5 text-[#e7f4ff] shadow-xl group-hover:block">
                                    {tooltip}
                                  </span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {redAnnotatedFragments.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#ffb7b7]">Красные блоки и источники</p>
                      <div className="space-y-2">
                        {redAnnotatedFragments.slice(0, 16).map((fragment, index) => (
                          <div key={`red-${index}`} className="rounded-lg border border-[#7a3535] bg-[#391919]/70 p-3 text-sm text-[#ffd3d3]">
                            <p className="font-medium">{fragment.text}</p>
                            {fragment.reason ? <p className="mt-1 text-xs text-[#ffc2c2]">Причина: {fragment.reason}</p> : null}
                            {fragment.suggestion ? (
                              <p className="mt-1 text-xs text-[#ffdbdb]">Как корректнее: {fragment.suggestion}</p>
                            ) : null}
                            {fragment.source ? (
                              <p className="mt-1 text-xs text-[#ffdddd]">
                                Источник: {fragment.source.title} / {fragment.source.section}{" "}
                                {fragment.source.url ? (
                                  <a href={fragment.source.url} target="_blank" rel="noreferrer" className="text-[#9be7ff] underline">
                                    открыть
                                  </a>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <ResultList title="Совпадения" values={result.matches} color="text-[#80f0d6]" />
              <ResultList title="Несоответствия" values={result.mismatches} color="text-[#ffb3b3]" />
              <ResultList title="Недостаточно данных (считается несоответствием)" values={result.missing_actions} color="text-[#ffb3b3]" />
              <ResultList title="Конфликты" values={result.conflicts} color="text-[#ff9696]" />

              <div className="flex flex-wrap gap-3 rounded-xl border border-[#2f5278] bg-[#0d2138]/70 p-3">
                <button
                  onClick={() => downloadPdf("/api/export/commission-pdf")}
                  disabled={exporting !== null}
                  className="inline-flex items-center gap-2 rounded-full border border-[#5aa2dd] bg-[#113452] px-5 py-2 text-sm font-semibold text-[#d7f2ff] disabled:opacity-60"
                >
                  {exporting === "commission" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Сгенерировать PDF
                </button>

                <button
                  onClick={() => downloadPdf("/api/export/patient-pdf")}
                  disabled={exporting !== null}
                  className="inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-5 py-2 text-sm font-semibold text-[#dffeff] disabled:opacity-60"
                >
                  {exporting === "patient" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Отправить пациенту
                </button>
              </div>

              <div className="rounded-xl border border-[#2f5278] bg-[#0d2138]/70 p-3">
                <p className="text-xs uppercase tracking-[0.14em] text-[#8fb6dd]">Обратная связь врача</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setFeedbackRating("up")}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      feedbackRating === "up"
                        ? "border-[#3dd39f] bg-[#0e3a2f] text-[#bff3d4]"
                        : "border-[#3f678f] bg-[#153252] text-[#dff4ff]"
                    }`}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    Хорошо
                  </button>
                  <button
                    onClick={() => setFeedbackRating("down")}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      feedbackRating === "down"
                        ? "border-[#d16969] bg-[#4b1f1f] text-[#ffd2d2]"
                        : "border-[#3f678f] bg-[#153252] text-[#dff4ff]"
                    }`}
                  >
                    <ThumbsDown className="h-4 w-4" />
                    Не согласен
                  </button>
                </div>

                <label className="mt-3 block space-y-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Комментарий (если не согласны)</span>
                  <textarea
                    value={feedbackComment}
                    onChange={(event) => setFeedbackComment(event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
                  />
                </label>

                <button
                  onClick={handleFeedbackSubmit}
                  disabled={!feedbackRating || !result.validation_run_id || feedbackSaving}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#5aa2dd] bg-[#113452] px-4 py-2 text-sm font-semibold text-[#d7f2ff] disabled:opacity-60"
                >
                  {feedbackSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Дать обратную связь
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#afcae4]">Запустите валидацию, чтобы увидеть результат и экспорт.</p>
          )}
        </SectionCard>
      ) : null}

      {activeStep === 4 ? (
        <SectionCard title="Этап 4. Экспорт" subtitle="Формирование файлов для комиссии и пациента.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[#2f5278] bg-[#0d2138]/70 p-4">
              <p className="text-sm font-semibold text-[#d8eeff]">PDF для комиссии</p>
              <p className="mt-1 text-xs text-[#9fc3e6]">Структурированный отчет по правилам документа 04.</p>
              <button
                onClick={() => downloadPdf("/api/export/commission-pdf")}
                disabled={!result || exporting !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#5aa2dd] bg-[#113452] px-4 py-2 text-sm font-semibold text-[#d7f2ff] disabled:opacity-60"
              >
                {exporting === "commission" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Сгенерировать PDF
              </button>
            </div>

            <div className="rounded-xl border border-[#2f5278] bg-[#0d2138]/70 p-4">
              <p className="text-sm font-semibold text-[#d8eeff]">PDF для пациента</p>
              <p className="mt-1 text-xs text-[#9fc3e6]">Пояснение лечения и ссылки на источники, без раздела несогласия.</p>
              <button
                onClick={() => downloadPdf("/api/export/patient-pdf")}
                disabled={!result || exporting !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-4 py-2 text-sm font-semibold text-[#dffeff] disabled:opacity-60"
              >
                {exporting === "patient" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Отправить пациенту
              </button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {statusMessage ? <p className="text-sm text-[#9ed8b7]">{statusMessage}</p> : null}
      {error ? <p className="text-sm text-[#ff9f9f]">{error}</p> : null}
    </div>
  );
}

function StepButton({
  step,
  activeStep,
  title,
  subtitle,
  onClick,
}: {
  step: 1 | 2 | 3 | 4;
  activeStep: 1 | 2 | 3 | 4;
  title: string;
  subtitle: string;
  onClick: (step: 1 | 2 | 3 | 4) => void;
}) {
  const active = step === activeStep;
  return (
    <button
      onClick={() => onClick(step)}
      className={`rounded-xl border p-3 text-left transition ${
        active
          ? "border-[#73e0d6] bg-[#123853]"
          : "border-[#2f5278] bg-[#0d2138]/60 hover:border-[#5f89ad]"
      }`}
    >
      <p className="text-xs uppercase tracking-[0.13em] text-[#8fb6dd]">{title}</p>
      <p className="mt-1 text-sm font-semibold text-[#e8f6ff]">{subtitle}</p>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
      />
    </label>
  );
}

function ResultList({
  title,
  values,
  color,
}: {
  title: string;
  values: string[];
  color: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">{title}</h3>
      {values.length ? (
        <ul className={`space-y-1.5 text-sm ${color}`}>
          {values.map((value) => (
            <li key={`${title}-${value}`} className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/90 px-3 py-2">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#8eb2d6]">Нет пунктов</p>
      )}
    </div>
  );
}
