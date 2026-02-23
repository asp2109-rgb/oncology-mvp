import { z } from "zod";

export const sourceIdSchema = z.enum([
  "minzdrav",
  "russco",
  "nccn_patient",
  "nccn_professional",
  "esmo",
  "asco",
  "pubmed",
  "femb",
]);

export type SourceId = z.infer<typeof sourceIdSchema>;

export const sourcePolicySchema = z.enum(["LOCAL_ONLY", "LOCAL_THEN_ONLINE", "DISABLED"]);
export type SourcePolicy = z.infer<typeof sourcePolicySchema>;

export const retrievalModeSchema = z.enum([
  "standard",
  "hyde",
  "fusion",
  "graphrag_lite",
  "kag",
  "agentic",
  "auto",
]);

export type RetrievalMode = z.infer<typeof retrievalModeSchema>;

export const caseEventSchema = z.object({
  event_date: z.string().min(1),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export const caseInputSchema = z.object({
  diagnosis: z.string().min(2),
  stage: z.string().optional().default(""),
  sex: z.enum(["male", "female", "other", "unknown"]).optional().default("unknown"),
  age: z.number().int().nonnegative().nullable().optional().default(null),
  histology: z.string().optional().default(""),
  biomarkers: z.array(z.string()).optional().default([]),
  comorbidities: z.array(z.string()).optional().default([]),
  prior_surgeries: z.array(z.string()).optional().default([]),
  radiation_history: z.array(z.string()).optional().default([]),
  labs: z.record(z.string(), z.string()).optional().default({}),
  contraindications: z.array(z.string()).optional().default([]),
  timeline: z.array(caseEventSchema).optional().default([]),
  current_plan: z.array(z.string()).optional().default([]),
  as_of_date: z.string().min(1),
});

export type CaseEvent = z.infer<typeof caseEventSchema>;
export type CaseInput = z.infer<typeof caseInputSchema>;

export type SearchHit = {
  chunk_id: string;
  guideline_id: string;
  guideline_name: string;
  section_id: string;
  section_title: string;
  chunk_text: string;
  tags: string[];
  evidence_level: string | null;
  source_anchor: string | null;
  source: SourceId;
  source_tier: "mandatory_ru" | "ru_practice" | "international" | "evidence" | "reference";
  access_mode: "local" | "online";
  document_url: string;
  document_version: string | null;
  score: number;
};

export type AppliedGuidelineVersion = {
  id: string;
  name: string;
  publish_date: string | null;
  status: number;
  source_url: string;
  pdf_url: string;
};

export type ValidationResult = {
  status: "compliant" | "review_required";
  matches: string[];
  mismatches: string[];
  missing_actions: string[];
  conflicts: string[];
  evidence: SearchHit[];
  applied_guideline_versions: AppliedGuidelineVersion[];
  source_traceability_rate: number;
  source_coverage: Array<{
    source: SourceId;
    evidence_count: number;
    access_modes: Array<"local" | "online">;
  }>;
  retrieval_mode_used: RetrievalMode;
  confidence: number;
  ru_first_passed: boolean;
  warnings: string[];
  latency_ms: number;
  generated_at: string;
};

export type DoctorLlmReview = {
  provider: "openai";
  model: string;
  response_id: string | null;
  method: "rag_kag";
  verdict: "confirmed" | "needs_attention";
  final_conclusion: string;
  clinical_rationale: string;
  critical_risks: string[];
  additional_checks: string[];
  citations: Array<{
    chunk_id: string;
    guideline_id: string;
    guideline_name: string;
    section_title: string;
    source_anchor: string | null;
    excerpt: string;
    source: SourceId;
    access_mode: "local" | "online";
    source_url: string;
    pdf_url: string;
  }>;
};

export type DoctorValidationResponse = ValidationResult & {
  llm_review: DoctorLlmReview | null;
  llm_fallback?: "rules_only";
};

export type PatientExplanation = {
  plain_summary: string;
  why_this_is_recommended: string;
  questions_for_doctor: string[];
  sources: Array<{
    guideline_id: string;
    guideline_name: string;
    source_url: string;
    pdf_url: string;
  }>;
};

export const guidelineSearchRequestSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().positive().max(50).optional().default(10),
  guideline_ids: z.array(z.string()).optional().default([]),
  sources: z.array(sourceIdSchema).optional().default(["minzdrav"]),
  allow_online: z.boolean().optional().default(false),
  retrieval_mode: retrievalModeSchema.optional().default("standard"),
});

export type GuidelineSearchRequest = z.infer<typeof guidelineSearchRequestSchema>;

export const sourcePolicyMapSchema = z
  .record(z.string(), sourcePolicySchema)
  .optional()
  .default({});

export const doctorValidationRequestSchema = z.object({
  case_input: caseInputSchema,
  source_selection: z.array(sourceIdSchema).optional().default(["minzdrav"]),
  source_policy: sourcePolicyMapSchema,
  retrieval_mode: retrievalModeSchema.optional().default("auto"),
  online_fallback: z.boolean().optional().default(true),
});

export type DoctorValidationRequest = z.infer<typeof doctorValidationRequestSchema>;

export const sourceSyncRequestSchema = z.object({
  sources: z.array(sourceIdSchema).optional().default([...sourceIdSchema.options]),
  force: z.boolean().optional().default(false),
});

export type SourceSyncRequest = z.infer<typeof sourceSyncRequestSchema>;

export type BenchmarkScenario = {
  id: string;
  title: string;
  dataset: "retrospective" | "synthetic" | "literature";
  expected_status: "compliant" | "review_required";
  expected_mismatch: boolean;
  case_input: CaseInput;
};

export type BenchmarkMetrics = {
  protocol_match_accuracy: number;
  mismatch_detection_precision: number;
  mismatch_detection_recall: number;
  median_validation_time: number;
  case_coverage: number;
  source_traceability_rate: number;
};

export type BenchmarkReport = {
  dataset_version: string;
  scenarios_total: number;
  scenarios: Array<{
    id: string;
    title: string;
    expected_status: "compliant" | "review_required";
    actual_status: "compliant" | "review_required";
    latency_ms: number;
    evidence_count: number;
  }>;
  metrics: BenchmarkMetrics;
  notes: string[];
  created_at: string;
};

export const patientExplainRequestSchema = z.object({
  case_input: caseInputSchema,
  validation: z.custom<ValidationResult>().optional(),
});
