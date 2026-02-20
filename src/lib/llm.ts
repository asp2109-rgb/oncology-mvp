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
  return validation.applied_guideline_versions.map((item) => ({
    guideline_id: item.id,
    guideline_name: item.name,
    source_url: item.source_url,
    pdf_url: item.pdf_url,
  }));
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
  if (!parsed.plain_summary || !parsed.why_this_is_recommended) {
    throw new Error("LLM вернула неполный JSON-ответ");
  }

  return {
    plain_summary: parsed.plain_summary,
    why_this_is_recommended: parsed.why_this_is_recommended,
    questions_for_doctor: Array.isArray(parsed.questions_for_doctor)
      ? parsed.questions_for_doctor.map((item) => String(item)).slice(0, 8)
      : [],
    sources: Array.isArray(parsed.sources) && parsed.sources.length > 0
      ? parsed.sources
          .map((source) => ({
            guideline_id: String(source.guideline_id ?? ""),
            guideline_name: String(source.guideline_name ?? ""),
            source_url: String(source.source_url ?? ""),
            pdf_url: String(source.pdf_url ?? ""),
          }))
          .filter((source) => source.guideline_name && source.source_url)
      : getDefaultSources(validation),
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

  const prompt = `
Ты медицинский AI-ассистент для пациента. Объясняй просто, но без назначения лечения.
Сформируй JSON с полями:
plain_summary, why_this_is_recommended, questions_for_doctor (array), sources (array).

Диагноз: ${caseInput.diagnosis}
Стадия: ${caseInput.stage || "не указана"}
Биомаркеры: ${caseInput.biomarkers.join(", ") || "не указаны"}
Дата проверки: ${caseInput.as_of_date}

Результат валидации:
${JSON.stringify(validation, null, 2)}
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
            "Ты помогаешь пациенту понять рекомендации. Не назначай лечение, а объясняй риски и вопросы врачу.",
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
