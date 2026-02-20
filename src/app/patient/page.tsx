"use client";

import { useMemo, useState } from "react";
import { Loader2, MessageSquareHeart } from "lucide-react";
import { SectionCard } from "@/components/section-card";
import { sampleCaseInput } from "@/lib/sample-data";
import type { CaseInput, PatientExplanation, ValidationResult } from "@/lib/types";

function linesToArray(text: string): string[] {
  return text
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

type PatientApiResponse = {
  validation: ValidationResult;
  explanation: PatientExplanation;
  llm: {
    provider: string;
    model: string;
    response_id: string | null;
  };
};

export default function PatientPage() {
  const [diagnosis, setDiagnosis] = useState(sampleCaseInput.diagnosis);
  const [asOfDate, setAsOfDate] = useState(sampleCaseInput.as_of_date);
  const [planText, setPlanText] = useState(sampleCaseInput.current_plan.join("\n"));

  const [response, setResponse] = useState<PatientApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payload = useMemo<CaseInput>(
    () => ({
      diagnosis,
      stage: sampleCaseInput.stage,
      biomarkers: sampleCaseInput.biomarkers,
      as_of_date: asOfDate,
      current_plan: linesToArray(planText),
      timeline: sampleCaseInput.timeline,
    }),
    [asOfDate, diagnosis, planText],
  );

  async function handleExplain() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/patient/explain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ case_input: payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details ?? "Не удалось сформировать объяснение");
      }

      setResponse(data as PatientApiResponse);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Неожиданная ошибка пациентского режима");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <SectionCard
        title="Режим пациента"
        subtitle="Понятное объяснение, почему текущий план соответствует рекомендациям или требует уточнения"
      >
        <div className="space-y-4">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Диагноз</span>
            <input
              value={diagnosis}
              onChange={(event) => setDiagnosis(event.target.value)}
              className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Дата проверки</span>
            <input
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
              className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
            />
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Текущий план лечения</span>
            <textarea
              value={planText}
              onChange={(event) => setPlanText(event.target.value)}
              rows={7}
              className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
            />
          </label>

          <button
            onClick={handleExplain}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-5 py-2 text-sm font-semibold text-[#dffeff] transition hover:bg-[#1b4263] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareHeart className="h-4 w-4" />}
            Пояснить пациенту
          </button>

          {error ? <p className="text-sm text-[#ff9f9f]">{error}</p> : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Результат объяснения"
        subtitle="Ответ формируется через OpenAI LLM на основании текущего кейса и найденных источников"
      >
        {!response ? (
          <p className="text-sm text-[#afcae4]">Запустите ассистента, чтобы получить ответ LLM в пациентском формате.</p>
        ) : (
          <div className="space-y-5 text-sm text-[#d8eeff]">
            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">LLM сессия</p>
              <p className="mt-2 text-xs text-[#b8d5ef]">
                Провайдер: {response.llm.provider} | Модель: {response.llm.model}
              </p>
              {response.llm.response_id ? (
                <p className="mt-1 text-[11px] text-[#8fb6dd]">response_id: {response.llm.response_id}</p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">Кратко</p>
              <p className="mt-2 leading-6">{response.explanation.plain_summary}</p>
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">Почему это рекомендуют</p>
              <p className="mt-2 leading-6">{response.explanation.why_this_is_recommended}</p>
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">Вопросы к врачу</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {response.explanation.questions_for_doctor.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">Источники</p>
              <div className="mt-2 space-y-3">
                {response.explanation.sources.map((source) => (
                  <div key={`${source.guideline_id}-${source.guideline_name}`}>
                    <p className="font-medium">{source.guideline_name}</p>
                    <div className="flex gap-3 text-xs">
                      <a className="text-[#82dcf4] hover:underline" href={source.source_url} target="_blank" rel="noreferrer">
                        источник
                      </a>
                      <a className="text-[#82dcf4] hover:underline" href={source.pdf_url} target="_blank" rel="noreferrer">
                        pdf
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
