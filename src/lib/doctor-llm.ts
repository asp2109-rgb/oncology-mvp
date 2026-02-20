import type { CaseInput, DoctorLlmReview, ValidationResult } from "@/lib/types";

type ChatCompletionResponse = {
  id?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type DoctorReviewPayload = {
  verdict?: string;
  final_conclusion?: string;
  clinical_rationale?: string;
  critical_risks?: unknown;
  additional_checks?: unknown;
  used_chunk_ids?: unknown;
};

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error("LLM вернула ответ не в JSON-формате");
}

function normalizeStringArray(input: unknown, limit: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function buildCitations(
  validation: ValidationResult,
  usedChunkIds: string[],
): DoctorLlmReview["citations"] {
  if (validation.evidence.length === 0) {
    return [];
  }

  const evidenceById = new Map(validation.evidence.map((hit) => [hit.chunk_id, hit]));
  const guidelineById = new Map(validation.applied_guideline_versions.map((item) => [item.id, item]));

  const fallbackIds = validation.evidence.slice(0, 3).map((hit) => hit.chunk_id);
  const selectedIds = Array.from(new Set([...usedChunkIds, ...fallbackIds]))
    .filter((chunkId) => evidenceById.has(chunkId))
    .slice(0, 5);

  return selectedIds.map((chunkId) => {
    const hit = evidenceById.get(chunkId);
    if (!hit) {
      return {
        chunk_id: chunkId,
        guideline_id: "",
        guideline_name: "",
        section_title: "",
        source_anchor: null,
        excerpt: "",
        source_url: "",
        pdf_url: "",
      };
    }

    const guideline = guidelineById.get(hit.guideline_id);

    return {
      chunk_id: hit.chunk_id,
      guideline_id: hit.guideline_id,
      guideline_name: hit.guideline_name,
      section_title: hit.section_title,
      source_anchor: hit.source_anchor,
      excerpt: hit.chunk_text.slice(0, 280),
      source_url: guideline?.source_url ?? "",
      pdf_url: guideline?.pdf_url ?? "",
    };
  });
}

function buildDoctorPrompt(caseInput: CaseInput, validation: ValidationResult): string {
  const structuredSignals = {
    diagnosis: caseInput.diagnosis,
    stage: caseInput.stage,
    biomarkers: caseInput.biomarkers,
    as_of_date: caseInput.as_of_date,
    current_plan: caseInput.current_plan.slice(0, 15),
    rule_status: validation.status,
    matches: validation.matches.slice(0, 12),
    mismatches: validation.mismatches.slice(0, 12),
    missing_actions: validation.missing_actions.slice(0, 12),
    conflicts: validation.conflicts.slice(0, 12),
    source_traceability_rate: validation.source_traceability_rate,
    applied_guideline_versions: validation.applied_guideline_versions.map((item) => ({
      id: item.id,
      name: item.name,
      publish_date: item.publish_date,
      status: item.status,
    })),
  };

  const ragEvidence = validation.evidence.slice(0, 12).map((hit) => ({
    chunk_id: hit.chunk_id,
    guideline_id: hit.guideline_id,
    guideline_name: hit.guideline_name,
    section_title: hit.section_title,
    source_anchor: hit.source_anchor,
    score: Number(hit.score.toFixed(4)),
    excerpt: hit.chunk_text.slice(0, 520),
  }));

  return `
Ты медицинский ассистент для врача.
Сформируй итоговое заключение в формате RAG+KAG:
- RAG: ссылайся только на фрагменты из блока rag_evidence;
- KAG: учти структурированные сигналы из блока structured_signals.

Верни строго JSON:
{
  "verdict": "confirmed" | "needs_attention",
  "final_conclusion": "краткое итоговое заключение (2-4 предложения)",
  "clinical_rationale": "техническое обоснование для врача",
  "critical_risks": ["..."],
  "additional_checks": ["..."],
  "used_chunk_ids": ["chunk_id_1", "chunk_id_2"]
}

Ограничения:
- не назначай лечение;
- не выдумывай источники и chunk_id;
- используй только chunk_id из rag_evidence;
- не используй markdown.

structured_signals:
${JSON.stringify(structuredSignals, null, 2)}

rag_evidence:
${JSON.stringify(ragEvidence, null, 2)}
  `.trim();
}

function normalizeReview(
  parsed: DoctorReviewPayload,
  model: string,
  responseId: string | null,
  validation: ValidationResult,
): DoctorLlmReview {
  const finalConclusion = String(parsed.final_conclusion ?? "").trim();
  const clinicalRationale = String(parsed.clinical_rationale ?? "").trim();

  if (!finalConclusion && !clinicalRationale) {
    throw new Error("LLM не вернула final_conclusion или clinical_rationale");
  }

  const verdictRaw = parsed.verdict === "confirmed" ? "confirmed" : "needs_attention";
  const usedChunkIds = normalizeStringArray(parsed.used_chunk_ids, 12);

  return {
    provider: "openai",
    model,
    response_id: responseId,
    method: "rag_kag",
    verdict: verdictRaw,
    final_conclusion: finalConclusion || clinicalRationale,
    clinical_rationale: clinicalRationale || finalConclusion,
    critical_risks: normalizeStringArray(parsed.critical_risks, 8),
    additional_checks: normalizeStringArray(parsed.additional_checks, 8),
    citations: buildCitations(validation, usedChunkIds),
  };
}

export async function buildDoctorLlmReview(
  caseInput: CaseInput,
  validation: ValidationResult,
): Promise<DoctorLlmReview> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не задан. Проверка врача требует LLM.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const prompt = buildDoctorPrompt(caseInput, validation);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты эксперт по клиническому аудиту. Возвращай только валидный JSON без пояснений вне JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API вернул ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(payload.error?.message ?? "OpenAI не вернул content в ответе");
  }

  const jsonText = extractJsonObject(content);
  const parsed = JSON.parse(jsonText) as DoctorReviewPayload;
  return normalizeReview(parsed, model, payload.id ?? null, validation);
}
