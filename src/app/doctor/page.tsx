"use client";

import { useMemo, useState } from "react";
import { FileUp, Loader2, SearchCheck } from "lucide-react";
import { SectionCard } from "@/components/section-card";
import { MetricChip } from "@/components/metric-chip";
import { sampleCaseInput } from "@/lib/sample-data";
import { SOURCE_CONFIG, SOURCE_IDS } from "@/lib/sources";
import type {
  CaseInput,
  DoctorValidationResponse,
  RetrievalMode,
  SourceId,
  SourcePolicy,
  ValidationResult,
} from "@/lib/types";

type ParseResponse = {
  source: string;
  detected_format: string;
  text_length: number;
  preview: string;
  warnings?: string[];
  case_input: CaseInput;
};

const defaultCase = sampleCaseInput;
const retrievalModes: RetrievalMode[] = [
  "auto",
  "standard",
  "hyde",
  "fusion",
  "graphrag_lite",
  "kag",
  "agentic",
];

const sourcePolicyOptions: SourcePolicy[] = ["LOCAL_ONLY", "LOCAL_THEN_ONLINE", "DISABLED"];

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
  const [sex, setSex] = useState(defaultCase.sex);
  const [age, setAge] = useState(defaultCase.age ? String(defaultCase.age) : "");
  const [histology, setHistology] = useState(defaultCase.histology);
  const [asOfDate, setAsOfDate] = useState(defaultCase.as_of_date);
  const [biomarkersText, setBiomarkersText] = useState(defaultCase.biomarkers.join("\n"));
  const [comorbiditiesText, setComorbiditiesText] = useState(defaultCase.comorbidities.join("\n"));
  const [contraindicationsText, setContraindicationsText] = useState(defaultCase.contraindications.join("\n"));
  const [planText, setPlanText] = useState(defaultCase.current_plan.join("\n"));
  const [timelineText, setTimelineText] = useState(JSON.stringify(defaultCase.timeline, null, 2));

  const [sourceSelection, setSourceSelection] = useState<SourceId[]>(
    SOURCE_IDS.filter((source) => SOURCE_CONFIG[source].defaultSelected),
  );
  const [sourcePolicy, setSourcePolicy] = useState<Record<string, SourcePolicy>>(
    Object.fromEntries(SOURCE_IDS.map((source) => [source, SOURCE_CONFIG[source].defaultPolicy])),
  );
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>("auto");
  const [onlineFallback, setOnlineFallback] = useState(true);

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
      sex,
      age: age.trim() ? Number(age) : null,
      histology,
      biomarkers: parseLines(biomarkersText),
      comorbidities: parseLines(comorbiditiesText),
      prior_surgeries: defaultCase.prior_surgeries,
      radiation_history: defaultCase.radiation_history,
      labs: defaultCase.labs,
      contraindications: parseLines(contraindicationsText),
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
    [
      age,
      asOfDate,
      biomarkersText,
      comorbiditiesText,
      contraindicationsText,
      diagnosis,
      histology,
      planText,
      sex,
      stage,
      timelineText,
    ],
  );

  function applyCaseInput(caseInput: CaseInput) {
    setDiagnosis(caseInput.diagnosis);
    setStage(caseInput.stage);
    setSex(caseInput.sex);
    setAge(caseInput.age === null ? "" : String(caseInput.age));
    setHistology(caseInput.histology);
    setAsOfDate(caseInput.as_of_date);
    setBiomarkersText(caseInput.biomarkers.join("\n"));
    setComorbiditiesText(caseInput.comorbidities.join("\n"));
    setContraindicationsText(caseInput.contraindications.join("\n"));
    setPlanText(caseInput.current_plan.join("\n"));
    setTimelineText(JSON.stringify(caseInput.timeline, null, 2));
  }

  function toggleSource(source: SourceId) {
    setSourceSelection((prev) => {
      if (prev.includes(source)) {
        return prev.filter((item) => item !== source);
      }
      return [...prev, source];
    });
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
        body: JSON.stringify({
          case_input: payloadPreview,
          source_selection: sourceSelection,
          source_policy: sourcePolicy,
          retrieval_mode: retrievalMode,
          online_fallback: onlineFallback,
        }),
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
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Пол</span>
              <select
                value={sex}
                onChange={(event) => setSex(event.target.value as CaseInput["sex"])}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              >
                <option value="unknown">Не указан</option>
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
                <option value="other">Иной</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Возраст</span>
              <input
                value={age}
                onChange={(event) => setAge(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Например, 54"
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Гистология</span>
              <input
                value={histology}
                onChange={(event) => setHistology(event.target.value)}
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

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Сопутствующие заболевания</span>
              <textarea
                value={comorbiditiesText}
                onChange={(event) => setComorbiditiesText(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-[#2e4f73] bg-[#0d2138] px-3 py-2 text-sm text-[#e8f6ff] outline-none focus:border-[#73e0d6]"
              />
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.14em] text-[#94bce0]">Противопоказания</span>
              <textarea
                value={contraindicationsText}
                onChange={(event) => setContraindicationsText(event.target.value)}
                rows={4}
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

          <div className="mt-4 space-y-3 rounded-xl border border-[#2e4f73] bg-[#0d2138]/70 p-3">
            <p className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Источники проверки (галочки)</p>
            <div className="grid gap-2 md:grid-cols-2">
              {SOURCE_IDS.map((source) => (
                <div key={source} className="rounded-lg border border-[#2b4a6b] bg-[#0c2036]/90 p-2">
                  <label className="flex items-center gap-2 text-sm text-[#d7ecff]">
                    <input
                      type="checkbox"
                      checked={sourceSelection.includes(source)}
                      onChange={() => toggleSource(source)}
                    />
                    {SOURCE_CONFIG[source].label}
                  </label>
                  <select
                    value={sourcePolicy[source] ?? "LOCAL_THEN_ONLINE"}
                    onChange={(event) =>
                      setSourcePolicy((prev) => ({
                        ...prev,
                        [source]: event.target.value as SourcePolicy,
                      }))
                    }
                    className="mt-2 w-full rounded-md border border-[#2e4f73] bg-[#0d2138] px-2 py-1 text-xs text-[#cfe8ff]"
                  >
                    {sourcePolicyOptions.map((policy) => (
                      <option key={`${source}-${policy}`} value={policy}>
                        {policy}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.12em] text-[#8fb6dd]">Режим retrieval</span>
                <select
                  value={retrievalMode}
                  onChange={(event) => setRetrievalMode(event.target.value as RetrievalMode)}
                  className="w-full rounded-md border border-[#2e4f73] bg-[#0d2138] px-2 py-2 text-sm text-[#cfe8ff]"
                >
                  {retrievalModes.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pt-7 text-sm text-[#d7ecff]">
                <input
                  type="checkbox"
                  checked={onlineFallback}
                  onChange={(event) => setOnlineFallback(event.target.checked)}
                />
                Online fallback
              </label>
            </div>
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
        subtitle="Гибридная проверка и итоговое заключение RAG+KAG для врача"
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
              <MetricChip label="Режим retrieval" value={result.retrieval_mode_used} />
              <MetricChip label="Уверенность" value={`${Math.round(result.confidence * 100)}%`} />
            </div>

            <div className="rounded-2xl border border-[#2d4c6f] bg-[#0c2036] p-4 text-sm text-[#d8eeff]">
              <p className="text-xs uppercase tracking-[0.14em] text-[#89b1d8]">Заключение (RAG+KAG)</p>
              {result.llm_review ? (
                <>
                  <p className="mt-2 font-semibold text-[#dbf3ff]">{humanizeLlmVerdict(result.llm_review.verdict)}</p>
                  <p className="mt-2 leading-6 text-[#e3f5ff]">{result.llm_review.final_conclusion}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.12em] text-[#9fc3e6]">Техническое обоснование</p>
                  <p className="mt-1 leading-6">{result.llm_review.clinical_rationale}</p>
                  {result.llm_review.response_id ? (
                    <p className="mt-1 text-[11px] text-[#8fb6dd]">response_id: {result.llm_review.response_id}</p>
                  ) : null}

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

                  {result.llm_review.citations.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#9fc3e6]">RAG-цитаты</p>
                      <div className="mt-2 space-y-2">
                        {result.llm_review.citations.map((citation) => (
                          <div
                            key={citation.chunk_id}
                            className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/95 p-3"
                          >
                            <p className="text-xs text-[#9fc2e3]">
                              {citation.guideline_name} · {citation.section_title} · {citation.source} · {citation.access_mode}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[#d3ebff]">{citation.excerpt}</p>
                            <div className="mt-2 flex gap-3 text-xs">
                              {citation.source_url ? (
                                <a
                                  className="text-[#83dff8] hover:underline"
                                  href={citation.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  источник
                                </a>
                              ) : null}
                              {citation.pdf_url ? (
                                <a
                                  className="text-[#83dff8] hover:underline"
                                  href={citation.pdf_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  pdf
                                </a>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[#ffd89e]">
                  LLM недоступен. Показан результат rules-only.
                </p>
              )}
            </div>

            <ResultList title="Совпадения" values={result.matches} color="text-[#80f0d6]" />
            <ResultList title="Несоответствия" values={result.mismatches} color="text-[#ffb3b3]" />
            <ResultList title="Недостающие действия" values={result.missing_actions} color="text-[#ffd89e]" />
            <ResultList title="Конфликты" values={result.conflicts} color="text-[#ff9696]" />

            {result.warnings.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">Warnings</h3>
                <ul className="space-y-1 text-sm text-[#ffd89e]">
                  {result.warnings.map((warning) => (
                    <li key={warning} className="rounded-xl border border-[#6b542e] bg-[#3a2d17]/70 px-3 py-2">
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">Покрытие источников</h3>
              <div className="space-y-2 text-sm text-[#d9eeff]">
                {result.source_coverage.length ? (
                  result.source_coverage.map((coverage) => (
                    <div
                      key={coverage.source}
                      className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/90 p-3"
                    >
                      <p className="font-medium">{SOURCE_CONFIG[coverage.source]?.label ?? coverage.source}</p>
                      <p className="mt-1 text-xs text-[#9dc1e1]">
                        evidence: {coverage.evidence_count} | mode: {coverage.access_modes.join(", ")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#8eb2d6]">Покрытие по источникам пока пустое.</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm uppercase tracking-[0.12em] text-[#90b7dc]">Evidence</h3>
              <div className="space-y-2 text-sm text-[#d9eeff]">
                {result.evidence.map((hit) => (
                  <div key={`${hit.source}-${hit.chunk_id}`} className="rounded-xl border border-[#2c4d70] bg-[#0d2138]/90 p-3">
                    <p className="text-xs text-[#9dc1e1]">
                      {SOURCE_CONFIG[hit.source]?.label ?? hit.source} · {hit.access_mode} · {hit.section_title}
                    </p>
                    <p className="mt-1 leading-6">{hit.chunk_text}</p>
                    {hit.document_url ? (
                      <a
                        className="mt-2 inline-block text-xs text-[#83dff8] hover:underline"
                        href={hit.document_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        открыть источник
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

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
