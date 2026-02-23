import { randomUUID } from "node:crypto";
import { saveValidationRun } from "@/lib/db";
import { selectApplicableGuidelines } from "@/lib/guidelines";
import { retrieveEvidence } from "@/lib/retrieval";
import { normalizeSourceSelection } from "@/lib/sources";
import type {
  CaseInput,
  RetrievalMode,
  SearchHit,
  SourceId,
  SourcePolicy,
  ValidationResult,
} from "@/lib/types";
import { nowIso, tokenize } from "@/lib/utils";

export type ValidationOptions = {
  source_selection?: SourceId[];
  source_policy?: Record<string, SourcePolicy>;
  retrieval_mode?: RetrievalMode;
  online_fallback?: boolean;
};

function normalizePlan(caseInput: CaseInput): string[] {
  if (caseInput.current_plan.length) {
    return caseInput.current_plan.map((item) => item.trim()).filter(Boolean);
  }

  const fromTimeline = caseInput.timeline
    .map((event) => {
      const payloadText = JSON.stringify(event.payload);
      return `${event.event_type}: ${payloadText}`;
    })
    .slice(-4);

  return fromTimeline;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function calculateTraceability(planItems: string[], evidence: SearchHit[]): number {
  if (!planItems.length) {
    return 0;
  }

  const hitCoverage = Math.min(1, evidence.length / Math.max(1, planItems.length * 2));
  const sourceDiversity = new Set(evidence.map((hit) => hit.source)).size / Math.min(4, Math.max(1, planItems.length));
  return Number(Math.max(0, Math.min(1, (hitCoverage * 0.7 + sourceDiversity * 0.3))).toFixed(4));
}

function tokenOverlap(planItem: string, chunkText: string): number {
  const planTokens = tokenize(planItem);
  const hitTokens = tokenize(chunkText);
  if (!planTokens.length || !hitTokens.length) {
    return 0;
  }

  let overlap = 0;
  for (const planToken of planTokens) {
    if (
      hitTokens.some(
        (hitToken) =>
          hitToken === planToken ||
          hitToken.startsWith(planToken) ||
          planToken.startsWith(hitToken),
      )
    ) {
      overlap += 1;
    }
  }

  return overlap;
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
  const normalizedCase: CaseInput = {
    diagnosis: caseInput.diagnosis,
    stage: caseInput.stage ?? "",
    sex: caseInput.sex ?? "unknown",
    age: caseInput.age ?? null,
    histology: caseInput.histology ?? "",
    biomarkers: caseInput.biomarkers ?? [],
    comorbidities: caseInput.comorbidities ?? [],
    prior_surgeries: caseInput.prior_surgeries ?? [],
    radiation_history: caseInput.radiation_history ?? [],
    labs: caseInput.labs ?? {},
    contraindications: caseInput.contraindications ?? [],
    timeline: caseInput.timeline ?? [],
    current_plan: caseInput.current_plan ?? [],
    as_of_date: caseInput.as_of_date,
  };

  const sourceSelection = normalizeSourceSelection(options.source_selection);
  const retrievalMode = options.retrieval_mode ?? "auto";
  const onlineFallback = options.online_fallback ?? true;
  const minzdravSelected = sourceSelection.includes("minzdrav");

  const applied = minzdravSelected
    ? selectApplicableGuidelines(normalizedCase.diagnosis, normalizedCase.as_of_date, 10)
    : [];
  const guidelineIds = applied.map((item) => item.id);

  const planItems = normalizePlan(normalizedCase);
  const matches: string[] = [];
  const mismatches: string[] = [];
  const conflicts: string[] = [];

  const evidenceCollection: SearchHit[] = [];
  const warnings = new Set<string>();
  const confidenceSamples: number[] = [];
  const modeSamples: RetrievalMode[] = [];

  for (const planItem of planItems) {
    const retrieval = await retrieveEvidence({
      query: `${normalizedCase.diagnosis} ${planItem}`,
      caseInput: normalizedCase,
      mode: retrievalMode,
      sourceSelection,
      sourcePolicy: options.source_policy,
      onlineFallback,
      guidelineIds,
      limit: 8,
    });

    modeSamples.push(retrieval.retrieval_mode_used);
    confidenceSamples.push(retrieval.confidence);
    for (const warning of retrieval.warnings) {
      warnings.add(warning);
    }

    const relevantHits = retrieval.hits.filter((hit) => tokenOverlap(planItem, hit.chunk_text) > 0);
    evidenceCollection.push(...relevantHits);

    if (relevantHits.length > 0) {
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

  const recommendationRetrieval = await retrieveEvidence({
    query: `${normalizedCase.diagnosis} рекомендуется лечение`,
    caseInput: normalizedCase,
    mode: retrievalMode,
    sourceSelection,
    sourcePolicy: options.source_policy,
    onlineFallback,
    guidelineIds,
    limit: 15,
  });

  modeSamples.push(recommendationRetrieval.retrieval_mode_used);
  confidenceSamples.push(recommendationRetrieval.confidence);
  for (const warning of recommendationRetrieval.warnings) {
    warnings.add(warning);
  }

  evidenceCollection.push(...recommendationRetrieval.hits);

  const planTokenSet = new Set(planItems.flatMap((item) => tokenize(item)));

  const missingActions = recommendationRetrieval.hits
    .filter((hit) => {
      const hitTokens = tokenize(hit.chunk_text).slice(0, 18);
      const overlap = hitTokens.filter((token) => planTokenSet.has(token)).length;
      return overlap === 0;
    })
    .slice(0, 5)
    .map((hit) => hit.chunk_text.slice(0, 220));

  const evidence = Array.from(
    new Map(evidenceCollection.map((item) => [`${item.source}:${item.chunk_id}`, item])).values(),
  )
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);

  if (minzdravSelected && applied.length === 0) {
    warnings.add("По диагнозу не найдены релевантные локальные клинические рекомендации Минздрава РФ.");
  }

  const status: ValidationResult["status"] =
    mismatches.length === 0 &&
    conflicts.length === 0 &&
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
    source_traceability_rate: calculateTraceability(planItems, evidence),
    source_coverage: buildSourceCoverage(evidence),
    retrieval_mode_used,
    confidence: avgConfidence,
    ru_first_passed: recommendationRetrieval.ru_first_passed,
    warnings: Array.from(warnings),
    latency_ms: latency,
    generated_at: nowIso(),
  };

  saveValidationRun({
    run_id: randomUUID(),
    case_id: null,
    as_of_date: normalizedCase.as_of_date,
    result,
    latency_ms: latency,
  });

  return result;
}
