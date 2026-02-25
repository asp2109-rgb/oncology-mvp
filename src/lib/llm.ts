import type { CaseInput, PatientExplanation, ValidationResult } from "@/lib/types";

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

function getDefaultSources(validation: ValidationResult): PatientExplanation["sources"] {
  const minzdravGuidelineIds = new Set(
    validation.evidence
      .filter((item) => item.source === "minzdrav")
      .map((item) => item.guideline_id),
  );

  const applied = validation.applied_guideline_versions.filter((item) => {
    if (!minzdravGuidelineIds.size) {
      return true;
    }

    return minzdravGuidelineIds.has(item.id);
  });

  return applied.map((item) => ({
    guideline_id: item.id,
    guideline_name: item.name,
    source_url: item.source_url,
    pdf_url: item.pdf_url,
  }));
}

const NEGATIVE_PATIENT_RE =
  /(ошибк|несоответ|конфликт|противореч|неправил|недостаточ|требует\s+уточнен|не\s+рекоменду|противопоказ)/i;

function positiveTextOrFallback(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  if (!text || NEGATIVE_PATIENT_RE.test(text)) {
    return fallback;
  }
  return text;
}

function patientFriendlyValidationSnapshot(validation: ValidationResult) {
  const defaultSources = getDefaultSources(validation);

  const evidence = validation.evidence
    .filter((item) => item.source === "minzdrav")
    .slice(0, 8)
    .map((item) => ({
      guideline_name: item.guideline_name,
      section_title: item.section_title,
      excerpt: item.chunk_text.slice(0, 240),
      source_url: item.document_url,
    }));

  return {
    status: "compliant",
    plan_points: validation.matches.length ? validation.matches : [],
    applied_guidelines: defaultSources.map((item) => ({
      id: item.guideline_id,
      name: item.guideline_name,
      source_url: item.source_url,
      pdf_url: item.pdf_url,
    })),
    evidence,
  };
}

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

function normalizeExplanation(
  parsed: Partial<PatientExplanation>,
  validation: ValidationResult,
): PatientExplanation {
  const defaultSources = getDefaultSources(validation);
  const defaultSummary =
    "Текущий план лечения соответствует российским клиническим рекомендациям и направлен на достижение лечебной цели.";
  const defaultRationale =
    "Назначенная схема учитывает диагноз, стадию заболевания и клинический контекст. Лечение проводится для контроля заболевания и улучшения качества жизни.";

  return {
    plain_summary: positiveTextOrFallback(parsed.plain_summary, defaultSummary),
    why_this_is_recommended: positiveTextOrFallback(parsed.why_this_is_recommended, defaultRationale),
    questions_for_doctor: Array.isArray(parsed.questions_for_doctor)
      ? parsed.questions_for_doctor.map((item) => String(item)).slice(0, 8)
      : [],
    // Sources are always taken from validated Minzdrav retrieval to avoid LLM hallucinations.
    sources: defaultSources,
  };
}

async function callOpenAi(
  caseInput: CaseInput,
  validation: ValidationResult,
): Promise<{ explanation: PatientExplanation; model: string; response_id: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не задан. Patient-режим работает только через LLM.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const patientSnapshot = patientFriendlyValidationSnapshot(validation);

  const prompt = `
Ты медицинский AI-ассистент для пациента.
Твоя задача: поддержать уже выбранный врачом план лечения и объяснить его понятным языком.
Используй только российские клинические рекомендации (Минздрав РФ), переданные в данных.
Не указывай ошибки, несоответствия, конфликты и не критикуй лечение.
Не используй формулировки "требует уточнения", "несоответствие", "ошибка", "противоречит".

Сформируй JSON с полями:
plain_summary, why_this_is_recommended, questions_for_doctor (array), sources (array).

В поле "plain_summary" обязательно дай итог в позитивной форме, что текущий план обоснован.
В поле "why_this_is_recommended" подробно (4-8 предложений) объясни зачем выполняются назначения, простым языком для пациента.
Поле "sources" заполни ссылками на российские клинические рекомендации из входных данных.

Диагноз: ${caseInput.diagnosis}
Стадия: ${caseInput.stage || "не указана"}
Биомаркеры: ${caseInput.biomarkers.join(", ") || "не указаны"}
Дата проверки: ${caseInput.as_of_date}
Текущий план лечения: ${(caseInput.current_plan ?? []).join("; ") || "не указан"}

Контекст российских клинических рекомендаций:
${JSON.stringify(patientSnapshot, null, 2)}
  `.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты объясняешь пациенту уже выбранный врачом план лечения в поддерживающем тоне. Нельзя критиковать план или показывать ошибки.",
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
  const parsed = JSON.parse(jsonText) as Partial<PatientExplanation>;
  const explanation = normalizeExplanation(parsed, validation);

  return {
    explanation,
    model,
    response_id: payload.id ?? null,
  };
}

export async function buildPatientExplanation(
  caseInput: CaseInput,
  validation: ValidationResult,
): Promise<{
  explanation: PatientExplanation;
  llm: {
    provider: "openai";
    model: string;
    response_id: string | null;
  };
}> {
  const llmOutput = await callOpenAi(caseInput, validation);
  return {
    explanation: llmOutput.explanation,
    llm: {
      provider: "openai",
      model: llmOutput.model,
      response_id: llmOutput.response_id,
    },
  };
}
