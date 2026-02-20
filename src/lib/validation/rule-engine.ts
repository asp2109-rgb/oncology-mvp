import { randomUUID } from "node:crypto";
import { saveValidationRun } from "@/lib/db";
import { selectApplicableGuidelines } from "@/lib/guidelines";
import { RuleIndexProvider, searchWithProviders, SqlFtsProvider } from "@/lib/search/providers";
import type { CaseInput, SearchHit, ValidationResult } from "@/lib/types";
import { nowIso, tokenize } from "@/lib/utils";

const ftsProvider = new SqlFtsProvider();
const ruleProvider = new RuleIndexProvider();

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

function calculateTraceability(evidence: SearchHit[], totalSignals: number): number {
  if (totalSignals <= 0) {
    return 0;
  }

  const ratio = evidence.length / totalSignals;
  return Number(Math.max(0, Math.min(1, ratio)).toFixed(4));
}

export function validateCase(caseInput: CaseInput): ValidationResult {
  const started = Date.now();

  const applied = selectApplicableGuidelines(caseInput.diagnosis, caseInput.as_of_date, 10);
  const guidelineIds = applied.map((item) => item.id);

  const planItems = normalizePlan(caseInput);
  const matches: string[] = [];
  const mismatches: string[] = [];
  const conflicts: string[] = [];

  const evidenceCollection: SearchHit[] = [];

  for (const planItem of planItems) {
    const planTokens = new Set(tokenize(planItem));

    const hits = searchWithProviders(
      [ftsProvider, ruleProvider],
      `${caseInput.diagnosis} ${planItem}`,
      {
        guideline_ids: guidelineIds,
        section_ids: ["doc_3", "doc_diag_2", "doc_criteria"],
        limit: 6,
      },
    );

    const relevantHits = hits.filter((hit) => {
      if (!planTokens.size) {
        return false;
      }

      const hitTokens = new Set(tokenize(hit.chunk_text));
      let overlap = 0;

      for (const token of planTokens) {
        if (hitTokens.has(token)) {
          overlap += 1;
        }
      }

      return overlap > 0;
    });

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

  const recommendationHits = searchWithProviders(
    [ftsProvider, ruleProvider],
    `${caseInput.diagnosis} рекомендуется лечение`,
    {
      guideline_ids: guidelineIds,
      section_ids: ["doc_3", "doc_diag_2", "doc_criteria"],
      limit: 15,
    },
  );

  evidenceCollection.push(...recommendationHits);

  const planTokenSet = new Set(planItems.flatMap((item) => tokenize(item)));

  const missingActions = recommendationHits
    .filter((hit) => {
      const hitTokens = tokenize(hit.chunk_text).slice(0, 14);
      const overlap = hitTokens.filter((token) => planTokenSet.has(token)).length;
      return overlap === 0;
    })
    .slice(0, 5)
    .map((hit) => hit.chunk_text.slice(0, 220));

  const evidence = Array.from(new Map(evidenceCollection.map((item) => [item.chunk_id, item])).values())
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);

  const status: ValidationResult["status"] =
    mismatches.length === 0 && conflicts.length === 0 ? "compliant" : "review_required";

  const latency = Date.now() - started;

  const result: ValidationResult = {
    status,
    matches: uniq(matches),
    mismatches: uniq(mismatches),
    missing_actions: uniq(missingActions),
    conflicts: uniq(conflicts),
    evidence,
    applied_guideline_versions: applied,
    source_traceability_rate: calculateTraceability(evidence, planItems.length + missingActions.length + 1),
    latency_ms: latency,
    generated_at: nowIso(),
  };

  saveValidationRun({
    run_id: randomUUID(),
    case_id: null,
    as_of_date: caseInput.as_of_date,
    result,
    latency_ms: latency,
  });

  return result;
}
