import { saveValidationRun } from "@/lib/db";
import { selectApplicableGuidelines } from "@/lib/guidelines";
import { retrieveEvidence } from "@/lib/retrieval";
import { normalizeSourceSelection } from "@/lib/sources";
import type {
  AppliedGuidelineVersion,
  CaseInput,
  RetrievalMode,
  SearchHit,
  SourceId,
  SourcePolicy,
  ValidationResult,
} from "@/lib/types";
import { extractFirstDate, normalizeDateOnly, nowIso, parseLooseDate, tokenize } from "@/lib/utils";

export type ValidationOptions = {
  source_selection?: SourceId[];
  source_policy?: Record<string, SourcePolicy>;
  retrieval_mode?: RetrievalMode;
  online_fallback?: boolean;
};

const ACTIVE_PLAN_HINT_RE =
  /(рекоменд|назнач|план|продолж|необходим|следует|проведение\s+\d+\s*курсов?|схем|протокол|линия|пхт|мхт|хт|таргет|иммуно|консилиум)/i;
const HISTORY_PLAN_HINT_RE =
  /(анамнез|выполнен|выполнена|проведен|проведено|получал|получала|ранее|истор|в\s*20\d{2}\s*г|отмечалось|динамика)/i;
const DRUG_PLAN_HINT_RE =
  /(карбоплатин|цисплатин|паклитаксел|доксорубицин|циклофосфамид|винорельбин|капецитабин|гемцитабин|иксабепилон|бевацизумаб|атезолизумаб|пембролизумаб|ниволумаб|иринотекан|eribulin|flot|folfox|xelox|auc|мг\/м|мг\/кг)/i;
const COMPLETED_HISTORY_CUE_RE = /(проведено|получал[аи]?|выполнен[ао]?|завершен[ао]?|отмена|дефектур)/i;
const NOSOLOGY_TOKEN_STOPWORDS = new Set([
  "рак",
  "злокачественное",
  "новообразование",
  "опухоль",
  "опухоли",
  "части",
  "центральной",
  "неуточненной",
  "локализации",
  "стадия",
  "ст",
  "левой",
  "правой",
  "левой",
  "правый",
  "левый",
  "подтип",
  "типа",
]);
const DIAGNOSIS_TRAIL_RE =
  /\b(?:напхт|пхт|хтт?|ит\b|прогрессирован|рецидив|линии?|курс(?:а|ов)?|консилиум|схем[аеуы]?|протокол|лечени[ея]\s+в\s+20\d{2})/i;

function extractItemDateCandidates(item: string): string[] {
  const values: string[] = [];
  for (const match of item.matchAll(/\b(\d{4}-\d{2}-\d{2})(?:\s*г\.?)?\b/g)) {
    values.push(match[1]);
  }
  for (const match of item.matchAll(/\b(\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4})(?:\s*г\.?)?\b/g)) {
    values.push(match[1]);
  }
  for (const match of item.matchAll(/\b(\d{1,2})[\.\/-](20\d{2})(?:\s*г\.?)?\b/g)) {
    const month = match[1].padStart(2, "0");
    values.push(`${match[2]}-${month}`);
  }
  return values;
}

function latestItemTimestamp(item: string): number | null {
  const timestamps = extractItemDateCandidates(item)
    .map((value) => parseLooseDate(value))
    .filter((value): value is number => value !== null);

  if (!timestamps.length) {
    return null;
  }

  return Math.max(...timestamps);
}

function inferItemTimestampFromTimeline(caseInput: CaseInput, item: string): number | null {
  const itemTokens = meaningfulTokens(item).filter((token) => token.length >= 4);
  if (!itemTokens.length) {
    return null;
  }

  let best: { timestamp: number; overlap: number } | null = null;

  for (const event of caseInput.timeline ?? []) {
    const normalizedDate = normalizeDateOnly(event.event_date) ?? event.event_date;
    const timestamp = parseLooseDate(normalizedDate);
    if (timestamp === null) {
      continue;
    }

    const payloadText = typeof event.payload === "object" ? JSON.stringify(event.payload) : String(event.payload ?? "");
    const eventTokens = meaningfulTokens(`${event.event_type} ${payloadText}`);
    const overlap = tokenOverlapFromArrays(itemTokens, eventTokens);
    if (overlap < 2) {
      continue;
    }

    if (!best || overlap > best.overlap || (overlap === best.overlap && timestamp > best.timestamp)) {
      best = {
        timestamp,
        overlap,
      };
    }
  }

  return best?.timestamp ?? null;
}

function daysBetweenTimestamps(from: number, to: number): number {
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function isLikelyHistoricalPlanText(
  item: string,
  asOfTimestamp: number | null,
  itemTimestamp: number | null = latestItemTimestamp(item),
): boolean {
  const text = item.trim();
  if (!text) {
    return false;
  }

  if (
    /\b(?:с)\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}(?:\s*г\.?)?\b.*\b(?:по)\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}(?:\s*г\.?)?\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (HISTORY_PLAN_HINT_RE.test(text) && !ACTIVE_PLAN_HINT_RE.test(text)) {
    return true;
  }
  if (COMPLETED_HISTORY_CUE_RE.test(text)) {
    return true;
  }

  if (itemTimestamp !== null && asOfTimestamp !== null && asOfTimestamp > itemTimestamp) {
    const ageDays = daysBetweenTimestamps(itemTimestamp, asOfTimestamp);
    if (ageDays > 540) {
      const hasExplicitDate = extractItemDateCandidates(text).length > 0;
      if (hasExplicitDate) {
        return true;
      }
      // Keep concise regimen labels available for retrospective checks even if
      // the closest timeline event is old; long narrative lines remain historical.
      if (text.length > 140) {
        return true;
      }
    }
  }

  return false;
}

function isActivePlanItem(item: string, asOfTimestamp: number | null, itemTimestamp: number | null): boolean {
  const text = item.trim();
  if (!text || text.length < 6) {
    return false;
  }

  const hasActiveHint = ACTIVE_PLAN_HINT_RE.test(text);
  const hasHistoryHint = HISTORY_PLAN_HINT_RE.test(text);
  const hasDrugHint = DRUG_PLAN_HINT_RE.test(text);
  const hasLikelyHistoryLine = /\b(?:хт|пхт|мхт|терап)\s*\d+\s*линии?\b/i.test(text);
  const hasHistoricalInterval =
    /\bс\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}(?:\s*г\.?)?\b.*\bпо\s*\d{1,2}[\.\/-]\d{1,2}[\.\/-]\d{2,4}(?:\s*г\.?)?\b/i.test(
      text,
    );
  const hasCompletedHistoryCue = COMPLETED_HISTORY_CUE_RE.test(text);
  const historicalByDate = isLikelyHistoricalPlanText(text, asOfTimestamp, itemTimestamp);

  if (hasActiveHint) {
    if (historicalByDate) {
      return false;
    }
    return true;
  }
  if (hasLikelyHistoryLine || hasHistoricalInterval || historicalByDate || hasCompletedHistoryCue) {
    return false;
  }
  if (hasHistoryHint && !hasDrugHint) {
    return false;
  }
  if (!hasHistoryHint) {
    const wordCount = text.split(/\s+/g).filter(Boolean).length;
    if (wordCount <= 8 && text.length <= 120) {
      return true;
    }
  }
  return hasDrugHint;
}

function extractActiveCurrentPlan(caseInput: CaseInput): string[] {
  const asOfTimestamp = parseLooseDate(normalizeDateOnly(caseInput.as_of_date) ?? caseInput.as_of_date);

  const scored = (caseInput.current_plan ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      const timestamp = latestItemTimestamp(item) ?? inferItemTimestampFromTimeline(caseInput, item);
      const activeHint = ACTIVE_PLAN_HINT_RE.test(item) ? 2 : 0;
      const drugHint = DRUG_PLAN_HINT_RE.test(item) ? 1 : 0;
      const recencyScore = timestamp !== null ? 1 : 0;
      return {
        item,
        index,
        timestamp,
        score: activeHint + drugHint + recencyScore,
        isActive: isActivePlanItem(item, asOfTimestamp, timestamp),
      };
    })
    .filter((item) => item.isActive)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.timestamp === null && right.timestamp !== null) {
        return 1;
      }
      if (left.timestamp !== null && right.timestamp === null) {
        return -1;
      }
      if (left.timestamp !== null && right.timestamp !== null && right.timestamp !== left.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return left.index - right.index;
    });

  if (!scored.length) {
    return [];
  }

  const latestTimestamp = scored
    .map((item) => item.timestamp)
    .filter((value): value is number => value !== null)
    .reduce((acc, value) => Math.max(acc, value), 0);

  const focused = latestTimestamp
    ? scored.filter((item) => {
        if (item.timestamp === null) {
          return item.score >= 5;
        }
        return daysBetweenTimestamps(item.timestamp, latestTimestamp) <= 420;
      })
    : scored;

  return uniq(focused.map((item) => item.item)).slice(0, 8);
}

function normalizePlan(caseInput: CaseInput): string[] {
  const asOfTimestamp = parseLooseDate(normalizeDateOnly(caseInput.as_of_date) ?? caseInput.as_of_date);
  const directPlan = extractActiveCurrentPlan(caseInput);
  const regimenProtocol = caseInput.regimen_protocol?.trim();
  const regimenLooksHistorical = regimenProtocol ? isLikelyHistoricalPlanText(regimenProtocol, asOfTimestamp) : false;

  if (regimenProtocol && !regimenLooksHistorical) {
    directPlan.push(regimenProtocol);
  }
  const canUsePlannedDrugs =
    (directPlan.length > 0 || Boolean(regimenProtocol && !regimenLooksHistorical)) &&
    Boolean(caseInput.planned_drugs?.length) &&
    (caseInput.planned_drugs?.length ?? 0) <= 8;

  if (canUsePlannedDrugs) {
    const latestDirectTimestamp = directPlan
      .map((item) => latestItemTimestamp(item))
      .filter((value): value is number => value !== null)
      .reduce((acc, value) => Math.max(acc, value), 0);
    const directPlanTokenSet = new Set(directPlan.flatMap((item) => meaningfulTokens(item)));

    const filteredDrugItems = (caseInput.planned_drugs ?? [])
      .map((drug) => {
        const dose = drug.dose_value ? ` ${drug.dose_value}` : "";
        const unit = drug.dose_unit ? ` ${drug.dose_unit}` : "";
        return `${drug.name}${dose}${unit}`.trim();
      })
      .filter((item) => !isLikelyHistoricalPlanText(item, asOfTimestamp))
      .filter((item) => {
        if (!directPlanTokenSet.size) {
          return true;
        }
        const overlap = meaningfulTokens(item).filter((token) => directPlanTokenSet.has(token)).length;
        return overlap > 0;
      })
      .filter((item) => {
        if (!latestDirectTimestamp) {
          return true;
        }
        const itemTimestamp = latestItemTimestamp(item);
        if (itemTimestamp === null) {
          return true;
        }
        return daysBetweenTimestamps(itemTimestamp, latestDirectTimestamp) <= 420;
      });

    const nonDuplicateDrugItems = filteredDrugItems.filter((item) => {
      const itemTokens = meaningfulTokens(item);
      if (!itemTokens.length) {
        return false;
      }
      return !directPlan.some((planItem) => tokenOverlapFromArrays(itemTokens, meaningfulTokens(planItem)) > 0);
    });

    directPlan.push(...nonDuplicateDrugItems);
  }

  if (directPlan.length) {
    return uniq(directPlan);
  }

  return [];
}

function buildBlock5RagContext(caseInput: CaseInput, options: { includePlan?: boolean } = {}): string {
  const includePlan = options.includePlan ?? true;
  const plan = normalizePlan(caseInput).slice(0, 12).join("; ");
  const drugs = (caseInput.planned_drugs ?? [])
    .map((drug) => {
      const dose = drug.dose_value !== null && drug.dose_value !== undefined ? ` ${drug.dose_value}` : "";
      const unit = drug.dose_unit ? ` ${drug.dose_unit}` : "";
      return `${drug.name}${dose}${unit}`.trim();
    })
    .join("; ");

  const sections = [
    caseInput.nosology_label_ru ? `Нозология: ${caseInput.nosology_label_ru}` : "",
    caseInput.icd10_code ? `МКБ-10: ${caseInput.icd10_code}` : "",
    caseInput.stage_numeric !== null && caseInput.stage_numeric !== undefined
      ? `Стадия: ${caseInput.stage_numeric}`
      : caseInput.stage
        ? `Стадия: ${caseInput.stage}`
        : "",
    caseInput.treatment_goal ? `Цель лечения: ${caseInput.treatment_goal}` : "",
    caseInput.regimen_protocol ? `Режим/протокол: ${caseInput.regimen_protocol}` : "",
    caseInput.protocol_assignment_date ? `Дата назначения протокола: ${caseInput.protocol_assignment_date}` : "",
    caseInput.planned_therapy_line ? `Линия терапии: ${caseInput.planned_therapy_line}` : "",
    drugs ? `Препараты: ${drugs}` : "",
    includePlan && plan ? `План (блок 5): ${plan}` : "",
    caseInput.biomarkers?.length ? `Биомаркеры: ${caseInput.biomarkers.join(", ")}` : "",
  ].filter(Boolean);

  return sections.join(". ");
}

function isBlock5Insufficient(caseInput: CaseInput): boolean {
  const hasGoal = Boolean(caseInput.treatment_goal?.trim());
  const hasRegimen = Boolean(caseInput.regimen_protocol?.trim());
  const hasDrugs = Boolean(caseInput.planned_drugs?.length);
  const hasPlan = Boolean(extractActiveCurrentPlan(caseInput).length);
  return !(hasGoal && (hasRegimen || hasDrugs || hasPlan));
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function calculateBsaFromAnthropometry(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null) {
    return null;
  }

  const computed = 0.007184 * Math.pow(heightCm, 0.725) * Math.pow(weightKg, 0.425);
  if (!Number.isFinite(computed)) {
    return null;
  }

  return Number(computed.toFixed(3));
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function evaluateClinicalContext(caseInput: CaseInput): {
  conflicts: string[];
  missingActions: string[];
  warnings: string[];
} {
  const conflicts: string[] = [];
  const missingActions: string[] = [];
  const warnings: string[] = [];

  const planText = normalizePlan(caseInput).join(" ").toLowerCase();
  const hasChemoSignal =
    /(химио|пхт|карбоплатин|цисплатин|оксалиплатин|иринотекан|паклитаксел|капецитабин|доцетаксел|flot|folfox|xelox)/.test(
      planText,
    );

  for (const allergy of caseInput.allergies ?? []) {
    const lowerAllergy = allergy.toLowerCase();
    const mentionsTaxanes = lowerAllergy.includes("таксан");
    const mentionsPlatinum = lowerAllergy.includes("платин");

    if (mentionsTaxanes && /(паклитаксел|доцетаксел|таксан)/.test(planText)) {
      conflicts.push(`Аллергический риск: ${allergy}. В плане есть таксаны.`);
      continue;
    }

    if (mentionsPlatinum && /(карбоплатин|цисплатин|оксалиплатин)/.test(planText)) {
      conflicts.push(`Аллергический риск: ${allergy}. В плане есть препараты платины.`);
      continue;
    }

    const allergyTokens = tokenize(lowerAllergy).filter((token) => token.length > 4);
    if (allergyTokens.some((token) => planText.includes(token))) {
      conflicts.push(`Аллергический риск: ${allergy}. Обнаружено совпадение с текущим назначением.`);
    }
  }

  for (const drug of caseInput.planned_drugs ?? []) {
    const unit = (drug.dose_unit ?? "").toLowerCase();
    if (unit.includes("мг/кг") && !caseInput.weight_kg) {
      missingActions.push(`Для дозы ${drug.name} в мг/кг требуется указать вес пациента.`);
    }

    if ((unit.includes("мг/м²") || unit.includes("мг/м2")) && !caseInput.bsa_m2) {
      if (!caseInput.weight_kg || !caseInput.height_cm) {
        missingActions.push(`Для дозы ${drug.name} в мг/м² укажите рост и вес (или BSA).`);
      } else {
        warnings.push(`Для ${drug.name} требуется проверить рассчитанный BSA перед назначением.`);
      }
    }
  }

  const thrombosisContext = [...(caseInput.comorbidities ?? []), ...(caseInput.complications ?? [])]
    .join(" ")
    .toLowerCase();
  if (
    thrombosisContext.includes("тромб") &&
    /(рамуцирумаб|бевацизумаб|афлиберцепт)/.test(planText)
  ) {
    conflicts.push("В анамнезе/осложнениях есть тромбоз: требуется пересмотр антиангиогенной терапии.");
  }

  if (caseInput.ecog !== null && caseInput.ecog !== undefined) {
    if (caseInput.ecog >= 2 && /(интенсив|flot|triplet|трехкомпонент)/.test(planText)) {
      conflicts.push(`ECOG ${caseInput.ecog}: интенсивная терапия требует повторной оценки переносимости.`);
    } else if (caseInput.ecog >= 2 && hasChemoSignal) {
      warnings.push(`ECOG ${caseInput.ecog}: проверьте переносимость текущего режима.`);
    }
  }

  if (hasChemoSignal && caseInput.neutrophils_abs !== null && caseInput.neutrophils_abs !== undefined) {
    if (caseInput.neutrophils_abs < 1.5) {
      conflicts.push(
        `Нейтрофилы ${caseInput.neutrophils_abs}: ниже 1.5x10^9/л, проведение цитотоксической ХТ потенциально небезопасно.`,
      );
    }
  }

  if (hasChemoSignal && caseInput.platelets !== null && caseInput.platelets !== undefined) {
    if (caseInput.platelets < 100) {
      conflicts.push(`Тромбоциты ${caseInput.platelets}: ниже 100x10^9/л, требуется коррекция/отсрочка терапии.`);
    }
  }

  if (caseInput.hemoglobin !== null && caseInput.hemoglobin !== undefined && caseInput.hemoglobin < 90) {
    warnings.push(`Гемоглобин ${caseInput.hemoglobin} г/л: возможна клинически значимая анемия, нужна дополнительная оценка.`);
  }

  if (caseInput.bilirubin_total !== null && caseInput.bilirubin_total !== undefined && /иринотекан/.test(planText)) {
    if (caseInput.bilirubin_total > 34) {
      conflicts.push(`Билирубин ${caseInput.bilirubin_total} мкмоль/л: высокий риск токсичности иринотекана.`);
    } else if (caseInput.bilirubin_total > 21) {
      warnings.push(`Билирубин ${caseInput.bilirubin_total} мкмоль/л: рассмотрите коррекцию дозы иринотекана.`);
    }
  }

  const historyLines = (caseInput.treatment_history ?? [])
    .map((item) => item.line)
    .filter((line): line is number => typeof line === "number" && Number.isFinite(line));
  const maxHistoryLine = historyLines.length ? Math.max(...historyLines) : 0;
  if (caseInput.planned_therapy_line !== null && caseInput.planned_therapy_line !== undefined && maxHistoryLine > 0) {
    if (caseInput.planned_therapy_line <= maxHistoryLine) {
      conflicts.push(
        `Указана линия ${caseInput.planned_therapy_line}, но в анамнезе уже есть линия ${maxHistoryLine}. Проверьте хронологию.`,
      );
    }
  } else if ((caseInput.treatment_history ?? []).length > 0 && !caseInput.planned_therapy_line) {
    missingActions.push("Укажите линию текущего назначения на основе анамнеза лечения.");
  }

  const imagingDate = parseIsoDate(caseInput.last_imaging_date);
  const asOfDate = parseIsoDate(caseInput.as_of_date);
  if (imagingDate && asOfDate) {
    const daysOld = daysBetween(imagingDate, asOfDate);
    if (daysOld > 120) {
      warnings.push(
        `Последняя визуализация от ${caseInput.last_imaging_date} (${daysOld} дней до даты проверки): проверьте актуальность статуса заболевания.`,
      );
    }
  }

  return {
    conflicts: uniq(conflicts),
    missingActions: uniq(missingActions),
    warnings: uniq(warnings),
  };
}

function calculateTraceability(planItems: string[], evidence: SearchHit[]): number {
  if (!planItems.length) {
    return 0;
  }

  const hitCoverage = Math.min(1, evidence.length / Math.max(1, planItems.length * 2));
  const sourceDiversity = new Set(evidence.map((hit) => hit.source)).size / Math.min(4, Math.max(1, planItems.length));
  return Number(Math.max(0, Math.min(1, (hitCoverage * 0.7 + sourceDiversity * 0.3))).toFixed(4));
}

const CLINICAL_MATCH_STOPWORDS = new Set([
  "пациент",
  "пациента",
  "текущий",
  "текущая",
  "текущие",
  "линия",
  "лечения",
  "режим",
  "протокол",
  "схема",
  "терапия",
  "назначение",
  "рекомендуется",
  "рекомендовано",
  "рекомендация",
  "следует",
  "можно",
  "возможно",
  "при",
  "после",
  "перед",
  "данные",
  "уточнить",
  "проверить",
  "наличие",
  "контекст",
  "пхт",
  "мхт",
  "хт",
  "хтт",
  "консилиум",
  "курс",
  "курсов",
  "день",
  "дни",
  "схеме",
  "схема",
  "химиотерапия",
]);

function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((token) => !CLINICAL_MATCH_STOPWORDS.has(token));
}

function nosologyTokens(text: string): string[] {
  return meaningfulTokens(text).filter((token) => !NOSOLOGY_TOKEN_STOPWORDS.has(token) && token.length >= 4);
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

    if (DIAGNOSIS_TRAIL_RE.test(chunk)) {
      break;
    }

    if (chunk.length <= 120) {
      focused.push(chunk);
    } else {
      break;
    }

    if (focused.length >= 2) {
      break;
    }
  }

  return focused.join(". ");
}

function hasMeaningfulPlanMatch(planItem: string, hitText: string): boolean {
  const planTokens = meaningfulTokens(planItem);
  const hitTokens = meaningfulTokens(hitText);
  if (!planTokens.length || !hitTokens.length) {
    return false;
  }

  const overlap = tokenOverlapFromArrays(planTokens, hitTokens);
  if (overlap <= 0) {
    return false;
  }

  // For long plan entries require at least two meaningful overlaps, otherwise a single random token is too noisy.
  if (planTokens.length >= 3 && overlap < 2) {
    return false;
  }

  return true;
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

function resolveCaseReferenceDate(caseInput: CaseInput): string {
  const normalizedAsOf = normalizeDateOnly(caseInput.as_of_date) ?? caseInput.as_of_date;
  const asOfTimestamp = parseLooseDate(normalizedAsOf);

  let latestTimestamp: number | null = null;
  let latestDate: string | null = null;

  for (const event of caseInput.timeline) {
    const normalizedDate = normalizeDateOnly(event.event_date);
    if (!normalizedDate) {
      continue;
    }

    const eventTimestamp = parseLooseDate(normalizedDate);
    if (eventTimestamp === null) {
      continue;
    }

    if (asOfTimestamp !== null && eventTimestamp > asOfTimestamp) {
      continue;
    }

    if (latestTimestamp === null || eventTimestamp > latestTimestamp) {
      latestTimestamp = eventTimestamp;
      latestDate = normalizedDate;
    }
  }

  return latestDate ?? normalizedAsOf;
}

function resolvePlanReferenceDate(caseInput: CaseInput, planItem: string): string {
  const normalizedAsOf = normalizeDateOnly(caseInput.as_of_date) ?? caseInput.as_of_date;
  const asOfTimestamp = parseLooseDate(normalizedAsOf);

  const explicitDate = extractFirstDate(planItem);
  if (explicitDate) {
    const explicitTimestamp = parseLooseDate(explicitDate);
    if (explicitTimestamp !== null && (asOfTimestamp === null || explicitTimestamp <= asOfTimestamp)) {
      return explicitDate;
    }
  }

  const planTokens = tokenize(planItem);
  let latestEvent: { date: string; timestamp: number } | null = null;
  let bestOverlapEvent: { date: string; timestamp: number; overlap: number } | null = null;

  for (const event of caseInput.timeline) {
    const normalizedDate = normalizeDateOnly(event.event_date);
    if (!normalizedDate) {
      continue;
    }

    const eventTimestamp = parseLooseDate(normalizedDate);
    if (eventTimestamp === null) {
      continue;
    }

    if (asOfTimestamp !== null && eventTimestamp > asOfTimestamp) {
      continue;
    }

    if (!latestEvent || eventTimestamp > latestEvent.timestamp) {
      latestEvent = { date: normalizedDate, timestamp: eventTimestamp };
    }

    const eventPayload = typeof event.payload === "object" ? JSON.stringify(event.payload) : "";
    const eventTokens = tokenize(`${event.event_type} ${eventPayload}`);
    const overlap = tokenOverlapFromArrays(planTokens, eventTokens);

    if (overlap <= 0) {
      continue;
    }

    if (
      !bestOverlapEvent ||
      overlap > bestOverlapEvent.overlap ||
      (overlap === bestOverlapEvent.overlap && eventTimestamp > bestOverlapEvent.timestamp)
    ) {
      bestOverlapEvent = {
        date: normalizedDate,
        timestamp: eventTimestamp,
        overlap,
      };
    }
  }

  if (bestOverlapEvent) {
    return bestOverlapEvent.date;
  }

  if (latestEvent) {
    return latestEvent.date;
  }

  return normalizedAsOf;
}

function sortAppliedGuidelines(versions: AppliedGuidelineVersion[]): AppliedGuidelineVersion[] {
  return [...versions].sort((left, right) => {
    const leftTimestamp = parseLooseDate(left.publish_date);
    const rightTimestamp = parseLooseDate(right.publish_date);

    if (leftTimestamp === null && rightTimestamp === null) {
      return left.name.localeCompare(right.name, "ru");
    }

    if (leftTimestamp === null) {
      return 1;
    }

    if (rightTimestamp === null) {
      return -1;
    }

    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }

    return left.name.localeCompare(right.name, "ru");
  });
}

function buildSourceCoverage(evidence: SearchHit[]): ValidationResult["source_coverage"] {
  const coverage = new Map<
    SourceId,
    {
      evidence_count: number;
      access_modes: Set<"local" | "online">;
    }
  >();

  for (const hit of evidence) {
    const current = coverage.get(hit.source) ?? {
      evidence_count: 0,
      access_modes: new Set<"local" | "online">(),
    };
    current.evidence_count += 1;
    current.access_modes.add(hit.access_mode);
    coverage.set(hit.source, current);
  }

  return Array.from(coverage.entries()).map(([source, item]) => ({
    source,
    evidence_count: item.evidence_count,
    access_modes: Array.from(item.access_modes),
  }));
}

export async function validateCase(
  caseInput: CaseInput,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const started = Date.now();
  const normalizedBsa =
    caseInput.bsa_m2 ??
    calculateBsaFromAnthropometry(
      caseInput.weight_kg ?? null,
      caseInput.height_cm ?? null,
    );

  const normalizedCase: CaseInput = {
    diagnosis: caseInput.diagnosis,
    stage: caseInput.stage ?? "",
    stage_numeric: caseInput.stage_numeric ?? null,
    stage_raw: caseInput.stage_raw ?? "",
    sex: caseInput.sex ?? "unknown",
    age: caseInput.age ?? null,
    weight_kg: caseInput.weight_kg ?? null,
    height_cm: caseInput.height_cm ?? null,
    bsa_m2: normalizedBsa,
    ecog: caseInput.ecog ?? null,
    histology: caseInput.histology ?? "",
    allergies: caseInput.allergies ?? [],
    biomarkers: caseInput.biomarkers ?? [],
    icd10_code: caseInput.icd10_code ?? "",
    icd10_name_ru: caseInput.icd10_name_ru ?? "",
    nosology_label_ru: caseInput.nosology_label_ru ?? "",
    primary_localization: caseInput.primary_localization ?? "",
    tnm: caseInput.tnm ?? "",
    her2_status: caseInput.her2_status ?? "",
    pd_l1_cps: caseInput.pd_l1_cps ?? null,
    msi_mmr: caseInput.msi_mmr ?? "",
    comorbidities: caseInput.comorbidities ?? [],
    prior_surgeries: caseInput.prior_surgeries ?? [],
    radiation_history: caseInput.radiation_history ?? [],
    labs: caseInput.labs ?? {},
    neutrophils_abs: caseInput.neutrophils_abs ?? null,
    platelets: caseInput.platelets ?? null,
    hemoglobin: caseInput.hemoglobin ?? null,
    bilirubin_total: caseInput.bilirubin_total ?? null,
    alt: caseInput.alt ?? null,
    ast: caseInput.ast ?? null,
    creatinine: caseInput.creatinine ?? null,
    albumin: caseInput.albumin ?? null,
    inr: caseInput.inr ?? null,
    disease_status: caseInput.disease_status ?? "",
    metastases: caseInput.metastases ?? [],
    last_imaging_date: caseInput.last_imaging_date ?? "",
    complications: caseInput.complications ?? [],
    treatment_history: caseInput.treatment_history ?? [],
    contraindications: caseInput.contraindications ?? [],
    timeline: caseInput.timeline ?? [],
    current_plan: caseInput.current_plan ?? [],
    treatment_goal: caseInput.treatment_goal ?? "",
    regimen_protocol: caseInput.regimen_protocol ?? "",
    protocol_assignment_date: caseInput.protocol_assignment_date ?? "",
    planned_therapy_line: caseInput.planned_therapy_line ?? null,
    planned_drugs: caseInput.planned_drugs ?? [],
    as_of_date: caseInput.as_of_date,
  };

  const sourceSelection = normalizeSourceSelection(options.source_selection);
  const retrievalMode = options.retrieval_mode ?? "auto";
  const onlineFallback = options.online_fallback ?? true;
  const minzdravSelected = sourceSelection.includes("minzdrav");
  const appliedByDateCache = new Map<string, AppliedGuidelineVersion[]>();
  const appliedVersionMap = new Map<string, AppliedGuidelineVersion>();
  const retrospectiveDates = new Set<string>();

  const planItems = normalizePlan(normalizedCase);
  const diagnosisFocus = diagnosisFocusText(normalizedCase.diagnosis);
  const diagnosisReferenceTokens = nosologyTokens(
    [normalizedCase.nosology_label_ru, normalizedCase.icd10_name_ru, diagnosisFocus]
      .filter(Boolean)
      .join(" "),
  );
  const matches: string[] = [];
  const mismatches: string[] = [];
  const conflicts: string[] = [];

  const evidenceCollection: SearchHit[] = [];
  const warnings = new Set<string>();
  const ragQueryContext = buildBlock5RagContext(normalizedCase, { includePlan: true });
  const ragPlanContext = buildBlock5RagContext(normalizedCase, { includePlan: false });
  const confidenceSamples: number[] = [];
  const modeSamples: RetrievalMode[] = [];
  const clinicalContext = evaluateClinicalContext(normalizedCase);

  for (const warning of clinicalContext.warnings) {
    warnings.add(warning);
  }

  if (isBlock5Insufficient(normalizedCase)) {
    warnings.add(
      "Блок 5 заполнен неполно: укажите цель лечения и режим/препараты, иначе RAG-поиск может быть менее точным.",
    );
  }
  if (!planItems.length) {
    warnings.add(
      "Не выделен активный план лечения: проверка по источникам ограничена, укажите актуальный режим/назначение в блоке 5.",
    );
  }

  conflicts.push(...clinicalContext.conflicts);

  const getGuidelinesForReferenceDate = async (referenceDate: string): Promise<AppliedGuidelineVersion[]> => {
    if (!minzdravSelected) {
      return [];
    }

    const normalizedDate = normalizeDateOnly(referenceDate) ?? normalizedCase.as_of_date;
    const cached = appliedByDateCache.get(normalizedDate);
    if (cached) {
      return cached;
    }

    const selected = await selectApplicableGuidelines(normalizedCase.diagnosis, normalizedDate, 10, {
      icd10_code: normalizedCase.icd10_code,
      icd10_name_ru: normalizedCase.icd10_name_ru,
      nosology_label_ru: normalizedCase.nosology_label_ru,
    });
    appliedByDateCache.set(normalizedDate, selected);
    return selected;
  };

  for (const planItem of planItems) {
    const referenceDate = resolvePlanReferenceDate(normalizedCase, planItem);
    retrospectiveDates.add(referenceDate);
    const planGuidelines = await getGuidelinesForReferenceDate(referenceDate);
    for (const guideline of planGuidelines) {
      appliedVersionMap.set(guideline.id, guideline);
    }

    const retrieval = await retrieveEvidence({
      query: `${planItem}. ${ragPlanContext}`,
      caseInput: normalizedCase,
      mode: retrievalMode,
      sourceSelection,
      sourcePolicy: options.source_policy,
      onlineFallback,
      guidelineIds: planGuidelines.map((item) => item.id),
      referenceDate,
      limit: 8,
    });

    modeSamples.push(retrieval.retrieval_mode_used);
    confidenceSamples.push(retrieval.confidence);
    for (const warning of retrieval.warnings) {
      warnings.add(warning);
    }

    const relevantHits = retrieval.hits.filter((hit) => {
      if (!hasMeaningfulPlanMatch(planItem, hit.chunk_text)) {
        return false;
      }
      if (minzdravSelected) {
        return hit.source === "minzdrav";
      }
      return hit.access_mode === "local";
    });
    evidenceCollection.push(...relevantHits);

    const hasNegativeSignal = relevantHits.some((hit) =>
      /(не\s+рекоменду|противопоказ|не\s+показан|не\s+следует|избегать)/i.test(hit.chunk_text),
    );

    if (hasNegativeSignal) {
      mismatches.push(planItem);
    } else if (relevantHits.length > 0) {
      matches.push(planItem);
    } else {
      mismatches.push(planItem);
    }

    const lower = planItem.toLowerCase();
    if (
      lower.includes("самолеч") ||
      lower.includes("без врача") ||
      lower.includes("отменить всё") ||
      lower.includes("игнор")
    ) {
      conflicts.push(`План содержит потенциально опасный пункт: ${planItem}`);
    }
  }

  const recommendationReferenceDate = resolveCaseReferenceDate(normalizedCase);
  retrospectiveDates.add(recommendationReferenceDate);
  const recommendationGuidelines = await getGuidelinesForReferenceDate(recommendationReferenceDate);
  for (const guideline of recommendationGuidelines) {
    appliedVersionMap.set(guideline.id, guideline);
  }

  const recommendationRetrieval = await retrieveEvidence({
    query: `${ragQueryContext}. Рекомендованные режимы лечения с учетом молекулярного профиля и линии терапии.`,
    caseInput: normalizedCase,
    mode: retrievalMode,
    sourceSelection,
    sourcePolicy: options.source_policy,
    onlineFallback,
    guidelineIds: recommendationGuidelines.map((item) => item.id),
    referenceDate: recommendationReferenceDate,
    limit: 15,
  });

  modeSamples.push(recommendationRetrieval.retrieval_mode_used);
  confidenceSamples.push(recommendationRetrieval.confidence);
  for (const warning of recommendationRetrieval.warnings) {
    warnings.add(warning);
  }

  const diagnosisRelevantRecommendationHits = recommendationRetrieval.hits.filter((hit) => {
    if (!diagnosisReferenceTokens.length) {
      return true;
    }
    const hitScopeTokens = nosologyTokens(`${hit.guideline_name} ${hit.section_title}`);
    return tokenOverlapFromArrays(diagnosisReferenceTokens, hitScopeTokens) > 0;
  });

  evidenceCollection.push(...diagnosisRelevantRecommendationHits);

  const missingActions = [
    ...clinicalContext.missingActions,
    ...(planItems.length === 0
      ? ["Укажите активный пункт лечения (режим/протокол) для предметной проверки по клиническим рекомендациям."]
      : []),
  ];

  const evidence = Array.from(
    new Map(evidenceCollection.map((item) => [`${item.source}:${item.chunk_id}`, item])).values(),
  )
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);

  const applied = sortAppliedGuidelines(Array.from(appliedVersionMap.values()));
  const nearbyCandidates = minzdravSelected
    ? await selectApplicableGuidelines(diagnosisFocus, recommendationReferenceDate, 12)
    : [];
  const nearby = minzdravSelected
    ? sortAppliedGuidelines(
        nearbyCandidates.filter(
          (item) => !applied.some((appliedItem) => appliedItem.id === item.id),
        ),
      ).slice(0, 6)
    : [];

  if (minzdravSelected && applied.length === 0) {
    warnings.add("По диагнозу не найдены релевантные локальные клинические рекомендации Минздрава РФ.");
    missingActions.push("По текущей нозологии не найдены применимые клинические рекомендации Минздрава РФ.");
  }
  if (retrospectiveDates.size) {
    warnings.add(
      `Ретроспективный режим: источники отобраны по датам событий (${Array.from(retrospectiveDates).sort().join(", ")}).`,
    );
  }

  const status: ValidationResult["status"] =
    mismatches.length === 0 &&
    conflicts.length === 0 &&
    planItems.length > 0 &&
    !(minzdravSelected && applied.length === 0)
      ? "compliant"
      : "review_required";

  const latency = Date.now() - started;
  const avgConfidence =
    confidenceSamples.length === 0
      ? 0
      : Number((confidenceSamples.reduce((sum, value) => sum + value, 0) / confidenceSamples.length).toFixed(4));

  const modeFrequency = modeSamples.reduce(
    (acc, mode) => {
      acc[mode] = (acc[mode] ?? 0) + 1;
      return acc;
    },
    {} as Record<RetrievalMode, number>,
  );

  const retrieval_mode_used =
    (Object.entries(modeFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] as RetrievalMode | undefined) ??
    (retrievalMode === "auto" ? "standard" : retrievalMode);

  const result: ValidationResult = {
    status,
    matches: uniq(matches),
    mismatches: uniq(mismatches),
    missing_actions: uniq(missingActions),
    conflicts: uniq(conflicts),
    evidence,
    applied_guideline_versions: applied,
    nearby_guideline_versions: nearby,
    source_traceability_rate: calculateTraceability(planItems, evidence),
    source_coverage: buildSourceCoverage(evidence),
    retrieval_mode_used,
    confidence: avgConfidence,
    ru_first_passed: recommendationRetrieval.ru_first_passed,
    warnings: Array.from(warnings),
    rag_query_context: ragQueryContext,
    latency_ms: latency,
    generated_at: nowIso(),
  };

  const validationRunId = await saveValidationRun({
    case_id: null,
    as_of_date: normalizedCase.as_of_date,
    result,
    latency_ms: latency,
  });

  return {
    ...result,
    validation_run_id: validationRunId,
  };
}
