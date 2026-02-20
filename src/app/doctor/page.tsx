"use client";

import { useMemo, useState } from "react";
import { FileUp, Loader2, SearchCheck } from "lucide-react";
import { SectionCard } from "@/components/section-card";
import { MetricChip } from "@/components/metric-chip";
import { sampleCaseInput } from "@/lib/sample-data";
import type { CaseInput, DoctorValidationResponse, ValidationResult } from "@/lib/types";

type ParseResponse = {
  source: string;
  detected_format: string;
  text_length: number;
  preview: string;
  warnings?: string[];
  case_input: CaseInput;
};

const defaultCase = sampleCaseInput;

function parseLines(input: string): string[] {
  return input
    .split(/\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function humanizeValidationStatus(status: ValidationResult["status"]): string {
  return status === "compliant" ? "Соответствует" : "Требует проверки";
}

function humanizeLlmVerdict(verdict: "confirmed" | "needs_attention"): string {
  return verdict === "confirmed" ? "Подтверждено LLM" : "Требует внимания (LLM)";
}

export default function DoctorPage() {
  const [diagnosis, setDiagnosis] = useState(defaultCase.diagnosis);
  const [stage, setStage] = useState(defaultCase.stage);
  const [asOfDate, setAsOfDate] = useState(defaultCase.as_of_date);
  const [biomarkersText, setBiomarkersText] = useState(defaultCase.biomarkers.join("\n"));
  const [planText, setPlanText] = useState(defaultCase.current_plan.join("\n"));
  const [timelineText, setTimelineText] = useState(JSON.stringify(defaultCase.timeline, null, 2));

  const [rawInputText, setRawInputText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsePreview, setParsePreview] = useState("");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  const [result, setResult] = useState<DoctorValidationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payloadPreview = useMemo<CaseInput>(
    () => ({
      diagnosis,
      stage,
      biomarkers: parseLines(biomarkersText),
      current_plan: parseLines(planText),
      as_of_date: asOfDate,
      timeline: (() => {
        try {
          return JSON.parse(timelineText) as CaseInput["timeline"];
        } catch {
          return [];
        }
      })(),
    }),
    [asOfDate, biomarkersText, diagnosis, planText, stage, timelineText],
  );

  function applyCaseInput(caseInput: CaseInput) {
    setDiagnosis(caseInput.diagnosis);
    setStage(caseInput.stage);
    setAsOfDate(caseInput.as_of_date);
    setBiomarkersText(caseInput.biomarkers.join("\n"));
    setPlanText(caseInput.current_plan.join("\n"));
    setTimelineText(JSON.stringify(caseInput.timeline, null, 2));
  }

  async function handleParseInput() {
    setParsing(true);
    setError(null);

    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append("file", selectedFile);
      }
      if (rawInputText.trim()) {
        formData.append("text", rawInputText.trim());
      }

      const response = await fetch("/api/case/parse", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details ?? data?.error ?? "Не удалось разобрать вход");
      }

      const parsed = data as ParseResponse;
      applyCaseInput(parsed.case_input);
      setParsePreview(parsed.preview);
      setParseWarnings(parsed.warnings ?? []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ошибка разбора входа");
    } finally {
      setParsing(false);
    }
  }

  async function handleValidate() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/doctor/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadPreview),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.details ?? "Ошибка валидации кейса");
      }

      setResult(data as DoctorValidationResponse);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Неожиданная ошибка валидации");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-6">
        <SectionCard
          title="Режим врача: валидация протокола"
          subtitle="Загрузите документ/текст, автозаполните поля кейса и проверьте соответствие клиническим рекомендациям"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">
                Загрузить файл (предпочтительно PDF, DOC, DOCX, TXT, MD, CSV, JSON, RTF; другие форматы — best effort)
              </span>
              <input
                type="file"
                accept="*/*"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#cde5fb] file:mr-3 file:rounded-lg file:border file:border-[#3f678f] file:bg-[#153252] file:px-3 file:py-1.5 file:text-xs file:text-[#dff4ff]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Или вставьте сырой текст</span>
              <textarea
                value={rawInputText}
                onChange={(event) => setRawInputText(event.target.value)}
                rows={5}
                placeholder="Вставьте выписку, протокол, фрагмент клинического кейса"
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleParseInput}
              disabled={parsing || (!selectedFile && !rawInputText.trim())}
              className="inline-flex items-center gap-2 rounded-full border border-[#4f8cc1] bg-[#143456] px-5 py-2 text-sm font-semibold text-[#def6ff] transition hover:bg-[#1a436d] disabled:opacity-60"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              Разобрать вход и автозаполнить кейс
            </button>

            {parseWarnings.length ? (
              <p className="text-xs text-[#ffd89e]">Предупреждений при разборе: {parseWarnings.length}</p>
            ) : null}
          </div>

          {parsePreview ? (
            <div className="mt-4 rounded-xl border border-[#2e4f73] bg-[#0d2138]/90 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Предпросмотр извлеченного текста</p>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-[#cde5fb]">{parsePreview}</p>

              {parseWarnings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-[#ffd89e]">
                  {parseWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Структура кейса" subtitle="Можно скорректировать поля вручную перед валидацией">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Диагноз</span>
              <input
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Дата проверки (as_of_date)</span>
              <input
                type="date"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Стадия</span>
              <input
                value={stage}
                onChange={(event) => setStage(event.target.value)}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Биомаркеры (по одному на строку)</span>
              <textarea
                value={biomarkersText}
                onChange={(event) => setBiomarkersText(event.target.value)}
                rows={6}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Текущий план (по пунктам)</span>
              <textarea
                value={planText}
                onChange={(event) => setPlanText(event.target.value)}
                rows={6}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Таймлайн (JSON)</span>
              <textarea
                value={timelineText}
                onChange={(event) => setTimelineText(event.target.value)}
                rows={9}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 font-mono text-xs text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={handleValidate}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-5 py-2 text-sm font-semibold text-[#dffeff] transition hover:bg-[#1b4263] disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              Проверить кейс
            </button>

            {error ? <p className="text-sm text-[#ff9f9f]">{error}</p> : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Результат валидации"
        subtitle="Rule-based проверка + заключение LLM для врача"
      >
        {!result ? (
          <p className="text-sm text-[#afcae4]">Запустите проверку кейса, чтобы увидеть структурированный результат.</p>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricChip label="Статус" value={humanizeValidationStatus(result.status)} />
              <MetricChip label="Задержка" value={`${result.latency_ms} мс`} />
              <MetricChip label="Доказательства" value={String(result.evidence.length)} />
              <MetricChip label="Трассируемость" value={`${Math.round(result.source_traceability_rate * 100)}%`} />
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4 text-sm text-[#d8eeff]">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">LLM-проверка</p>
              <p className="mt-2">
                {humanizeLlmVerdict(result.llm_review.verdict)} | {result.llm_review.provider} / {result.llm_review.model}
              </p>
              {result.llm_review.response_id ? (
                <p className="mt-1 text-[11px] text-[#8fb6dd]">response_id: {result.llm_review.response_id}</p>
              ) : null}
              <p className="mt-2 leading-6">{result.llm_review.clinical_rationale}</p>

              {result.llm_review.critical_risks.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#9fc3e6]">Критические риски</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#ffbcbc]">
                    {result.llm_review.critical_risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.llm_review.additional_checks.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.12em] text-[#9fc3e6]">Дополнительные проверки</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[#cce7ff]">
                    {result.llm_review.additional_checks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <ResultList title="Совпадения" values={result.matches} color="text-[#80f0d6]" />
            <ResultList title="Несоответствия" values={result.mismatches} color="text-[#ffb3b3]" />
            <ResultList title="Недостающие действия" values={result.missing_actions} color="text-[#ffd89e]" />
            <ResultList title="Конфликты" values={result.conflicts} color="text-[#ff9696]" />

            <div className="space-y-2">
              <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">Примененные версии рекомендаций</h3>
              <div className="space-y-2 text-sm text-[#d9eeff]">
                {result.applied_guideline_versions.map((guideline) => (
                  <div key={guideline.id} className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/90 p-3">
                    <p className="font-medium">{guideline.name}</p>
                    <p className="mt-1 text-xs text-[#9dc1e1]">
                      {guideline.id} | дата публикации: {guideline.publish_date ?? "нет данных"} | статус: {guideline.status}
                    </p>
                    <div className="mt-2 flex gap-3 text-xs">
                      <a className="text-[#83dff8] hover:underline" href={guideline.source_url} target="_blank" rel="noreferrer">
                        источник
                      </a>
                      <a className="text-[#83dff8] hover:underline" href={guideline.pdf_url} target="_blank" rel="noreferrer">
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

function ResultList({
  title,
  values,
  color,
}: {
  title: string;
  values: string[];
  color: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">{title}</h3>
      {values.length ? (
        <ul className={`space-y-1.5 text-sm ${color}`}>
          {values.map((value) => (
            <li key={`${title}-${value}`} className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/90 px-3 py-2">
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#8eb2d6]">Нет пунктов</p>
      )}
    </div>
  );
}
