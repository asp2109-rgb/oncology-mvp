import { SourceDocumentProvider, RuleIndexProvider, SqlFtsProvider, searchWithProviders } from "@/lib/search/providers";
import { searchOnlineSources } from "@/lib/search/online";
import { resolveSourcePolicy } from "@/lib/sources";
import type { CaseInput, RetrievalMode, SearchHit, SourceId, SourcePolicy } from "@/lib/types";

const sqlProvider = new SqlFtsProvider();
const ruleProvider = new RuleIndexProvider();
const sourceDocumentProvider = new SourceDocumentProvider();

type RetrievalOptions = {
  query: string;
  caseInput: CaseInput;
  mode: RetrievalMode;
  sourceSelection: SourceId[];
  sourcePolicy?: Record<string, SourcePolicy>;
  onlineFallback: boolean;
  guidelineIds?: string[];
  sectionIds?: string[];
  limit?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqBySourceChunk(hits: SearchHit[]): SearchHit[] {
  const map = new Map<string, SearchHit>();
  for (const hit of hits) {
    const key = `${hit.source}:${hit.chunk_id}`;
    const existing = map.get(key);
    if (!existing || hit.score < existing.score) {
      map.set(key, hit);
    }
  }
  return Array.from(map.values());
}

function reciprocalRankFusion(lists: SearchHit[][]): SearchHit[] {
  const scores = new Map<string, { hit: SearchHit; score: number }>();

  for (const list of lists) {
    for (let index = 0; index < list.length; index += 1) {
      const hit = list[index];
      const key = `${hit.source}:${hit.chunk_id}`;
      const increment = 1 / (60 + index + 1);
      const current = scores.get(key);

      if (!current) {
        scores.set(key, { hit, score: increment });
      } else {
        current.score += increment;
        if (hit.score < current.hit.score) {
          current.hit = hit;
        }
      }
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => item.hit);
}

function resolveAutoMode(caseInput: CaseInput, query: string): RetrievalMode {
  const complexitySignals = [
    caseInput.biomarkers.length >= 2,
    caseInput.current_plan.length >= 3,
    caseInput.stage.length > 0,
    query.length > 120,
    /почему|обоснуй|альтернати|конфликт|противопоказ/i.test(query),
  ].filter(Boolean).length;

  if (complexitySignals >= 4) {
    return "agentic";
  }

  if (complexitySignals >= 3) {
    return "kag";
  }

  if (complexitySignals >= 2) {
    return "fusion";
  }

  return "standard";
}

function buildQueryVariants(mode: RetrievalMode, caseInput: CaseInput, query: string): string[] {
  const base = query.trim();
  const diagnosisPack = `${caseInput.diagnosis} ${caseInput.stage} ${caseInput.biomarkers.join(" ")}`.trim();

  switch (mode) {
    case "standard":
      return [base];
    case "hyde":
      return [base, `${diagnosisPack} клинический сценарий и целевые рекомендации ${base}`.trim()];
    case "fusion":
      return [
        base,
        `${diagnosisPack} терапия первая линия`,
        `${diagnosisPack} противопоказания обязательные анализы`,
      ].filter(Boolean);
    case "graphrag_lite":
      return [
        base,
        `${caseInput.diagnosis} стадия ${caseInput.stage} биомаркеры ${caseInput.biomarkers.join(", ")}`,
        `${caseInput.diagnosis} алгоритм принятия решения`,
      ];
    case "kag":
      return [
        base,
        `${diagnosisPack} рекомендуется лечение`,
        `${diagnosisPack} критерии качества`,
      ].filter(Boolean);
    case "agentic":
      return [
        base,
        `${diagnosisPack} обязательные шаги диагностики и лечения`,
        `${diagnosisPack} конфликты противопоказания`,
        `${diagnosisPack} проверка соответствия клиническим рекомендациям`,
      ].filter(Boolean);
    case "auto":
      return buildQueryVariants(resolveAutoMode(caseInput, base), caseInput, base);
    default:
      return [base];
  }
}

function calculateConfidence(
  hits: SearchHit[],
  sourceSelection: SourceId[],
  resolvedMode: RetrievalMode,
): number {
  if (!hits.length) {
    return 0.05;
  }

  const uniqueSources = new Set(hits.map((hit) => hit.source));
  const sourceCoverage = uniqueSources.size / Math.max(1, sourceSelection.length);
  const evidenceDensity = Math.min(1, hits.length / 12);
  const onlinePenalty = hits.some((hit) => hit.access_mode === "online") ? 0.08 : 0;

  const modeBonus =
    resolvedMode === "kag" || resolvedMode === "agentic" || resolvedMode === "graphrag_lite" ? 0.1 : 0.05;

  return Number(clamp(0.2 + sourceCoverage * 0.4 + evidenceDensity * 0.3 + modeBonus - onlinePenalty, 0, 0.98).toFixed(4));
}

export async function retrieveEvidence(options: RetrievalOptions): Promise<{
  hits: SearchHit[];
  retrieval_mode_used: RetrievalMode;
  confidence: number;
  ru_first_passed: boolean;
  warnings: string[];
  source_policy_resolved: Record<SourceId, SourcePolicy>;
}> {
  const mode = options.mode === "auto" ? resolveAutoMode(options.caseInput, options.query) : options.mode;
  const limit = options.limit ?? 20;
  const variants = buildQueryVariants(mode, options.caseInput, options.query);
  const resolvedPolicy = resolveSourcePolicy(options.sourceSelection, options.sourcePolicy);
  const enabledSources = options.sourceSelection.filter((source) => resolvedPolicy[source] !== "DISABLED");

  const localLists = variants.map((variant) =>
    searchWithProviders([sqlProvider, ruleProvider, sourceDocumentProvider], variant, {
      guideline_ids: options.guidelineIds,
      section_ids: options.sectionIds,
      sources: enabledSources,
      limit: Math.max(6, Math.min(25, limit)),
    }),
  );

  let merged = mode === "fusion" ? reciprocalRankFusion(localLists) : uniqBySourceChunk(localLists.flat());
  merged = merged.sort((a, b) => a.score - b.score);

  const warnings: string[] = [];
  const localBySource = new Map<SourceId, number>();
  for (const hit of merged) {
    localBySource.set(hit.source, (localBySource.get(hit.source) ?? 0) + 1);
  }

  if (options.onlineFallback) {
    const fallbackSources = enabledSources.filter((source) => {
      const policy = resolvedPolicy[source];
      if (policy !== "LOCAL_THEN_ONLINE") {
        return false;
      }
      return (localBySource.get(source) ?? 0) === 0;
    });

    if (fallbackSources.length) {
      const onlineHits = await searchOnlineSources(options.query, fallbackSources, Math.max(4, Math.floor(limit / 2)));
      if (onlineHits.length) {
        merged = uniqBySourceChunk([...merged, ...onlineHits]).sort((a, b) => a.score - b.score);
        warnings.push(
          `Для части источников использован online fallback: ${fallbackSources.join(", ")}`,
        );
      }
    }
  }

  const finalHits = merged.slice(0, limit);
  const ruFirstPassed =
    !enabledSources.includes("minzdrav") ||
    finalHits.some((hit) => hit.source === "minzdrav" && hit.access_mode === "local");

  if (!ruFirstPassed && enabledSources.includes("minzdrav")) {
    warnings.push("Не найдено локальных подтверждений из Минздрава РФ на первом проходе.");
  }

  return {
    hits: finalHits,
    retrieval_mode_used: mode,
    confidence: calculateConfidence(finalHits, enabledSources, mode),
    ru_first_passed: ruFirstPassed,
    warnings,
    source_policy_resolved: resolvedPolicy,
  };
}
