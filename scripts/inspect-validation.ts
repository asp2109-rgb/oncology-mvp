import fs from "node:fs/promises";
import path from "node:path";
import { extractTextFromFile, suggestCaseFromText } from "../src/lib/case-parser";
import { validateCase } from "../src/lib/validation/rule-engine";
import type { RetrievalMode, SourceId } from "../src/lib/types";

type CliOptions = {
  filePath: string;
  outputPath: string | null;
  retrievalMode: RetrievalMode;
  onlineFallback: boolean;
  sourceSelection: SourceId[];
  strict: boolean;
  requireGreen: boolean;
  maxMismatches: number | null;
};

const VALID_MODES: RetrievalMode[] = [
  "auto",
  "standard",
  "hyde",
  "fusion",
  "graphrag_lite",
  "kag",
  "agentic",
];

const VALID_SOURCES: SourceId[] = [
  "minzdrav",
  "russco",
  "nccn_patient",
  "nccn_professional",
  "esmo",
  "asco",
  "pubmed",
  "femb",
];

const ICD10_SITE_HINTS: Record<string, string[]> = {
  C16: ["желуд"],
  C25: ["поджелуд"],
  C34: ["легк", "бронх"],
  C50: ["молоч", "груд"],
  C53: ["шейк", "матк"],
  C54: ["тело", "матк"],
  C56: ["яичник"],
  C61: ["простат", "предстат"],
  C67: ["мочев", "пузыр"],
};

function usage(): string {
  return [
    "Usage:",
    "  npm run inspect:validation -- --file <path-to-case.{txt|doc|docx|pdf}> [options]",
    "",
    "Options:",
    "  --output <path>          Save full debug JSON",
    "  --mode <auto|...>        Retrieval mode (default: auto)",
    "  --sources <a,b,c>        Source selection (default: minzdrav)",
    "  --online                 Enable online fallback",
    "  --strict                 Fail if foreign sources are detected or no active plan",
    "  --require-green          Fail if no green matches",
    "  --max-mismatches <n>     Fail if mismatches exceed n",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  let filePath = "";
  let outputPath: string | null = null;
  let retrievalMode: RetrievalMode = "auto";
  let onlineFallback = false;
  let sourceSelection: SourceId[] = ["minzdrav"];
  let strict = false;
  let requireGreen = false;
  let maxMismatches: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--file" && next) {
      filePath = next;
      index += 1;
      continue;
    }
    if (token === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (token === "--mode" && next) {
      if (!VALID_MODES.includes(next as RetrievalMode)) {
        throw new Error(`Unsupported retrieval mode: ${next}`);
      }
      retrievalMode = next as RetrievalMode;
      index += 1;
      continue;
    }
    if (token === "--sources" && next) {
      const parsed = next
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean) as SourceId[];
      const valid = parsed.filter((item) => VALID_SOURCES.includes(item));
      if (!valid.length) {
        throw new Error(`No valid sources in: ${next}`);
      }
      sourceSelection = Array.from(new Set(valid));
      index += 1;
      continue;
    }
    if (token === "--max-mismatches" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --max-mismatches value: ${next}`);
      }
      maxMismatches = parsed;
      index += 1;
      continue;
    }
    if (token === "--online") {
      onlineFallback = true;
      continue;
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--require-green") {
      requireGreen = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      throw new Error(usage());
    }
  }

  if (!filePath.trim()) {
    throw new Error(`Missing --file argument.\n\n${usage()}`);
  }

  return {
    filePath,
    outputPath,
    retrievalMode,
    onlineFallback,
    sourceSelection,
    strict,
    requireGreen,
    maxMismatches,
  };
}

function extToMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    return "application/pdf";
  }
  if (ext === ".doc") {
    return "application/msword";
  }
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".txt") {
    return "text/plain";
  }
  return "application/octet-stream";
}

function normalizeIcdPrefix(value: string): string {
  const upper = value.toUpperCase().replace(/\s+/g, "");
  const match = upper.match(/^([A-Z]\d{2})/);
  return match?.[1] ?? "";
}

function tokenizeText(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9а-яё\s]/gi, " ")
        .split(/\s+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4),
    ),
  );
}

function siteHintsFromCase(params: {
  icd10_code: string;
  icd10_name_ru: string;
  nosology_label_ru: string;
}): string[] {
  const fromIcd = ICD10_SITE_HINTS[normalizeIcdPrefix(params.icd10_code)] ?? [];
  const fromNosology = tokenizeText(`${params.icd10_name_ru} ${params.nosology_label_ru}`).slice(0, 8);
  return Array.from(new Set([...fromIcd, ...fromNosology]));
}

function isRelevantToNosology(name: string, hints: string[]): boolean {
  if (!hints.length) {
    return true;
  }
  const lower = name.toLowerCase();
  return hints.some((hint) => lower.includes(hint));
}

function extractUnsupportedPlanItems(missingActions: string[]): string[] {
  const prefix =
    "Для пункта лечения не найдено надежного подтверждения в выбранных клинических рекомендациях по текущей нозологии:";
  return missingActions
    .map((item) => item.trim())
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length).trim())
    .filter(Boolean);
}

async function loadCaseText(filePath: string): Promise<{ text: string; format: string; warnings: string[] }> {
  const buffer = await fs.readFile(filePath);
  const file = new File([buffer], path.basename(filePath), { type: extToMime(filePath) });
  const parsed = await extractTextFromFile(file);
  return {
    text: parsed.text,
    format: parsed.format,
    warnings: parsed.warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadCaseText(options.filePath);
  const caseInput = suggestCaseFromText(loaded.text);
  const validation = await validateCase(caseInput, {
    source_selection: options.sourceSelection,
    retrieval_mode: options.retrievalMode,
    online_fallback: options.onlineFallback,
  });

  const unsupportedPlan = extractUnsupportedPlanItems(validation.missing_actions);
  const activePlan = Array.from(new Set([...validation.matches, ...validation.mismatches, ...unsupportedPlan]));
  const matchRate = activePlan.length ? validation.matches.length / activePlan.length : 0;
  const hints = siteHintsFromCase({
    icd10_code: caseInput.icd10_code ?? "",
    icd10_name_ru: caseInput.icd10_name_ru ?? "",
    nosology_label_ru: caseInput.nosology_label_ru ?? "",
  });

  const irrelevantApplied = validation.applied_guideline_versions.filter(
    (item) => !isRelevantToNosology(item.name, hints),
  );
  const irrelevantEvidence = validation.evidence.filter(
    (item) => !isRelevantToNosology(item.guideline_name, hints),
  );

  console.log("=== Parse ===");
  console.log(`File: ${options.filePath}`);
  console.log(`Format: ${loaded.format}`);
  console.log(`Diagnosis: ${caseInput.diagnosis}`);
  console.log(`МКБ: ${caseInput.icd10_code || "n/a"} ${caseInput.icd10_name_ru || ""}`.trim());
  console.log(`Нозология: ${caseInput.nosology_label_ru || "n/a"}`);
  console.log(`Stage numeric: ${caseInput.stage_numeric ?? "n/a"} (raw: ${caseInput.stage_raw || "n/a"})`);
  console.log(`Protocol assignment date: ${caseInput.protocol_assignment_date || "n/a"}`);
  if (loaded.warnings.length) {
    console.log("Parse warnings:");
    for (const warning of loaded.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log("\n=== Validation Summary ===");
  console.log(`Status: ${validation.status}`);
  console.log(`Validation run: ${validation.validation_run_id ?? "n/a"}`);
  console.log(`Matches: ${validation.matches.length}`);
  console.log(`Mismatches: ${validation.mismatches.length}`);
  console.log(`Conflicts: ${validation.conflicts.length}`);
  console.log(`Missing actions: ${validation.missing_actions.length}`);
  console.log(`Traceability: ${validation.source_traceability_rate}`);
  console.log(`Match rate: ${(matchRate * 100).toFixed(1)}%`);
  console.log(`Applied guidelines: ${validation.applied_guideline_versions.map((item) => item.name).join(" | ") || "none"}`);

  console.log("\n=== Active Plan Items ===");
  if (!activePlan.length) {
    console.log("  (none)");
  } else {
    for (const item of activePlan) {
      const marker = validation.matches.includes(item)
        ? "✅"
        : validation.mismatches.includes(item)
          ? "❌"
          : "⚠️";
      console.log(`  ${marker} ${item}`);
    }
  }

  console.log("\n=== Relevance Audit ===");
  console.log(`Nosology hints: ${hints.join(", ") || "none"}`);
  console.log(`Irrelevant applied guidelines: ${irrelevantApplied.length}`);
  for (const item of irrelevantApplied) {
    console.log(`  - ${item.name}`);
  }
  console.log(`Irrelevant evidence chunks: ${irrelevantEvidence.length}`);
  for (const item of irrelevantEvidence.slice(0, 10)) {
    console.log(`  - ${item.guideline_name} / ${item.section_title}`);
  }

  if (validation.warnings.length) {
    console.log("\n=== Warnings ===");
    for (const warning of validation.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (options.outputPath) {
    const payload = {
      options,
      case_input: caseInput,
      validation,
      diagnostics: {
        active_plan: activePlan,
        unsupported_plan: unsupportedPlan,
        match_rate: matchRate,
        nosology_hints: hints,
        irrelevant_applied: irrelevantApplied,
        irrelevant_evidence: irrelevantEvidence.map((item) => ({
          guideline_name: item.guideline_name,
          section_title: item.section_title,
          source: item.source,
          access_mode: item.access_mode,
          chunk_text: item.chunk_text.slice(0, 320),
        })),
      },
    };
    await fs.writeFile(options.outputPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nSaved debug JSON: ${options.outputPath}`);
  }

  const failures: string[] = [];
  if (options.strict) {
    if (irrelevantApplied.length > 0) {
      failures.push(`Found ${irrelevantApplied.length} irrelevant applied guideline(s).`);
    }
    if (irrelevantEvidence.length > 0) {
      failures.push(`Found ${irrelevantEvidence.length} irrelevant evidence chunk(s).`);
    }
    if (!activePlan.length) {
      failures.push("No active plan items were extracted for validation.");
    }
  }
  if (options.requireGreen && validation.matches.length === 0) {
    failures.push("No green matches were produced.");
  }
  if (options.maxMismatches !== null && validation.mismatches.length > options.maxMismatches) {
    failures.push(`Mismatches ${validation.mismatches.length} exceed limit ${options.maxMismatches}.`);
  }

  if (failures.length) {
    console.error("\nValidation quality gate failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
