import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { saveBenchmarkRun } from "@/lib/db";
import type { BenchmarkReport, BenchmarkScenario } from "@/lib/types";
import { validateCase } from "@/lib/validation/rule-engine";
import { median } from "@/lib/utils";

function readScenarios(filePath: string): BenchmarkScenario[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as BenchmarkScenario[];
}

function loadAllScenarios(): BenchmarkScenario[] {
  const root = process.cwd();

  const files = [
    path.join(root, "data", "benchmark", "retrospective.json"),
    path.join(root, "data", "benchmark", "synthetic.json"),
    path.join(root, "data", "benchmark", "literature.json"),
  ];

  const scenarios: BenchmarkScenario[] = [];

  for (const file of files) {
    if (fs.existsSync(file)) {
      scenarios.push(...readScenarios(file));
    }
  }

  return scenarios;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

export function runBenchmark(datasetVersion = "v1"): BenchmarkReport {
  const scenarios = loadAllScenarios();

  let statusCorrect = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;

  const latencies: number[] = [];
  let coveredCases = 0;
  let sourceTraceabilitySum = 0;

  const scenarioResults: BenchmarkReport["scenarios"] = [];

  for (const scenario of scenarios) {
    const started = Date.now();
    const validation = validateCase(scenario.case_input);
    const elapsed = Date.now() - started;

    if (validation.status === scenario.expected_status) {
      statusCorrect += 1;
    }

    const predictedMismatch = validation.mismatches.length > 0 || validation.conflicts.length > 0;

    if (predictedMismatch && scenario.expected_mismatch) {
      tp += 1;
    } else if (predictedMismatch && !scenario.expected_mismatch) {
      fp += 1;
    } else if (!predictedMismatch && scenario.expected_mismatch) {
      fn += 1;
    }

    if (validation.evidence.length > 0) {
      coveredCases += 1;
    }

    sourceTraceabilitySum += validation.source_traceability_rate;
    latencies.push(Math.max(validation.latency_ms, elapsed));

    scenarioResults.push({
      id: scenario.id,
      title: scenario.title,
      expected_status: scenario.expected_status,
      actual_status: validation.status,
      latency_ms: Math.max(validation.latency_ms, elapsed),
      evidence_count: validation.evidence.length,
    });
  }

  const total = scenarios.length || 1;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

  const report: BenchmarkReport = {
    dataset_version: datasetVersion,
    scenarios_total: scenarios.length,
    scenarios: scenarioResults,
    metrics: {
      protocol_match_accuracy: round(statusCorrect / total),
      mismatch_detection_precision: round(precision),
      mismatch_detection_recall: round(recall),
      median_validation_time: round(median(latencies)),
      case_coverage: round(coveredCases / total),
      source_traceability_rate: round(sourceTraceabilitySum / total),
    },
    notes: [
      "Ретроспективные, синтетические и литературные сценарии выполнены текущим rule engine.",
      "Patient-mode использует LLM-объяснение поверх результатов проверки.",
      "Метрики предназначены для итераций MVP и не являются клиническими claims.",
    ],
    created_at: new Date().toISOString(),
  };

  saveBenchmarkRun({
    bench_id: randomUUID(),
    dataset_version: datasetVersion,
    report,
  });

  return report;
}
