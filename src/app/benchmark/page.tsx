"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { MetricChip } from "@/components/metric-chip";
import { SectionCard } from "@/components/section-card";
import type { BenchmarkReport } from "@/lib/types";

function humanizeStatus(value: "compliant" | "review_required"): string {
  return value === "compliant" ? "Соответствует" : "Требует проверки";
}

export default function BenchmarkPage() {
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchLatest() {
    setLoadingLatest(true);
    try {
      const response = await fetch("/api/benchmark/latest");
      if (response.ok) {
        const data = (await response.json()) as BenchmarkReport;
        setReport(data);
      }
    } finally {
      setLoadingLatest(false);
    }
  }

  useEffect(() => {
    fetchLatest();
  }, []);

  async function runBenchmark() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/benchmark/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dataset_version: "v1" }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details ?? "Ошибка запуска бенчмарка");
      }

      setReport(data as BenchmarkReport);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Неожиданная ошибка бенчмарка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <SectionCard
        title="Запуск бенчмарка"
        subtitle="Ретроспектива + синтетика + литературные сценарии с сохранением отчета"
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runBenchmark}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-[#49cabd] bg-[#163754] px-5 py-2 text-sm font-semibold text-[#dffeff] transition hover:bg-[#1b4263] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            Запустить бенчмарк
          </button>

          <button
            onClick={fetchLatest}
            disabled={loadingLatest}
            className="inline-flex items-center gap-2 rounded-full border border-[#3a5f86] bg-[#122845] px-5 py-2 text-sm font-semibold text-[#dff1ff] transition hover:bg-[#183152] disabled:opacity-60"
          >
            {loadingLatest ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить последний
          </button>

          {error ? <p className="text-sm text-[#ff9f9f]">{error}</p> : null}
        </div>
      </SectionCard>

      {!report ? (
        <SectionCard title="Отчета пока нет">
          <p className="text-sm text-[#afcae4]">Запустите бенчмарк, чтобы заполнить панель метрик.</p>
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Ключевые метрики" subtitle={`Версия датасета: ${report.dataset_version}`}>
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
              <MetricChip label="Точность" value={`${Math.round(report.metrics.protocol_match_accuracy * 100)}%`} />
              <MetricChip
                label="Точность (Precision)"
                value={`${Math.round(report.metrics.mismatch_detection_precision * 100)}%`}
              />
              <MetricChip
                label="Полнота (Recall)"
                value={`${Math.round(report.metrics.mismatch_detection_recall * 100)}%`}
              />
              <MetricChip label="Медиана времени" value={`${report.metrics.median_validation_time} мс`} />
              <MetricChip label="Покрытие" value={`${Math.round(report.metrics.case_coverage * 100)}%`} />
              <MetricChip
                label="Трассируемость"
                value={`${Math.round(report.metrics.source_traceability_rate * 100)}%`}
              />
            </div>
          </SectionCard>

          <SectionCard title="Результаты сценариев" subtitle={`Всего сценариев: ${report.scenarios_total}`}>
            <div className="space-y-2">
              {report.scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className="rounded-xl border border-[#2d4c6f] bg-[#0c2036]/90 p-3 text-sm text-[#dcf1ff]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{scenario.title}</p>
                    <p className="text-xs text-[#9ac2e8]">{scenario.id}</p>
                  </div>
                  <p className="mt-1 text-xs text-[#a5c5e5]">
                    ожидалось: {humanizeStatus(scenario.expected_status)} | факт: {humanizeStatus(scenario.actual_status)} |
                    время: {scenario.latency_ms} мс | доказательства: {scenario.evidence_count}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Примечания">
            <ul className="list-disc space-y-1 pl-5 text-sm text-[#d8eeff]">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </SectionCard>
        </>
      )}
    </div>
  );
}
