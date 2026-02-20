import type { CaseInput, PatientExplanation, ValidationResult } from "@/lib/types";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function fallbackPatientExplanation(
  caseInput: CaseInput,
  validation: ValidationResult,
): PatientExplanation {
  const statusText =
    validation.status === "compliant"
      ? "Текущий план в целом совпадает с рекомендациями, но финальное решение принимает лечащий врач."
      : "Есть пункты, которые требуют дополнительной проверки врачом по клиническим рекомендациям.";

  const mismatchText = validation.mismatches.length
    ? `Пункты для уточнения: ${validation.mismatches.join(", ")}.`
    : "Критичных несовпадений в переданном плане не найдено.";

  const missingText = validation.missing_actions.length
    ? `В рекомендациях дополнительно встречаются шаги: ${validation.missing_actions.slice(0, 3).join("; ")}.`
    : "Дополнительные обязательные шаги не выделены автоматически.";

  return {
    plain_summary: `Диагноз: ${caseInput.diagnosis}. ${statusText} ${mismatchText}`,
    why_this_is_recommended: `${missingText} Проверка выполнена по версиям клинических рекомендаций, действовавшим на дату ${caseInput.as_of_date}.`,
    questions_for_doctor: [
      "Какие пункты моего текущего плана являются приоритетными прямо сейчас?",
      "Есть ли обследования или анализы, которые нужно добавить на этом этапе?",
      "Какие риски и побочные эффекты наиболее важны именно в моей ситуации?",
    ],
    sources: validation.applied_guideline_versions.map((item) => ({
      guideline_id: item.id,
      guideline_name: item.name,
      source_url: item.source_url,
      pdf_url: item.pdf_url,
    })),
  };
}

async function callOpenAi(
  caseInput: CaseInput,
  validation: ValidationResult,
): Promise<PatientExplanation | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-5.2-mini";

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
    return null;
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as PatientExplanation;

    if (!parsed.plain_summary || !parsed.why_this_is_recommended) {
      return null;
    }

    if (!Array.isArray(parsed.questions_for_doctor)) {
      parsed.questions_for_doctor = [];
    }

    if (!Array.isArray(parsed.sources)) {
      parsed.sources = validation.applied_guideline_versions.map((item) => ({
        guideline_id: item.id,
        guideline_name: item.name,
        source_url: item.source_url,
        pdf_url: item.pdf_url,
      }));
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function buildPatientExplanation(
  caseInput: CaseInput,
  validation: ValidationResult,
  forceFallback = false,
): Promise<PatientExplanation> {
  if (!forceFallback) {
    const llmOutput = await callOpenAi(caseInput, validation);
    if (llmOutput) {
      return llmOutput;
    }
  }

  return fallbackPatientExplanation(caseInput, validation);
}
