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

function normalizeReview(
  parsed: Partial<DoctorLlmReview>,
  model: string,
  responseId: string | null,
): DoctorLlmReview {
  if (!parsed.clinical_rationale) {
    throw new Error("LLM не вернула clinical_rationale");
  }

  const verdictRaw = parsed.verdict === "confirmed" ? "confirmed" : "needs_attention";

  return {
    provider: "openai",
    model,
    response_id: responseId,
    verdict: verdictRaw,
    clinical_rationale: parsed.clinical_rationale,
    critical_risks: Array.isArray(parsed.critical_risks)
      ? parsed.critical_risks.map((item) => String(item)).slice(0, 8)
      : [],
    additional_checks: Array.isArray(parsed.additional_checks)
      ? parsed.additional_checks.map((item) => String(item)).slice(0, 8)
      : [],
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

  const prompt = `
Ты медицинский ассистент для врача. Оцени результат rule-based проверки и верни JSON:
{
  "verdict": "confirmed" | "needs_attention",
  "clinical_rationale": "короткое техническое обоснование",
  "critical_risks": ["..."],
  "additional_checks": ["..."]
}

Ограничения:
- не назначай лечение,
- анализируй только соответствие рекомендациям и риски несоответствий,
- не используй markdown.

Кейс:
${JSON.stringify(caseInput, null, 2)}

Результат rule-based:
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
  const parsed = JSON.parse(jsonText) as Partial<DoctorLlmReview>;
  return normalizeReview(parsed, model, payload.id ?? null);
}
