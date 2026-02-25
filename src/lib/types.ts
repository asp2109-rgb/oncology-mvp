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

export const treatmentHistoryEntrySchema = z.object({
  line: z.number().int().positive().nullable().optional(),
  regimen: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  best_response: z.string().optional(),
  stop_reason: z.string().optional(),
});

export const plannedDrugSchema = z.object({
  name: z.string().min(1),
  dose_value: z.number().nullable().optional(),
  dose_unit: z.string().optional(),
  route: z.string().optional(),
  schedule_days: z.string().optional(),
  cycle_days: z.number().int().positive().nullable().optional(),
});

export const caseInputSchema = z.object({
  diagnosis: z.string().min(2),
  stage: z.string().optional().default(""),
  stage_numeric: z.number().int().min(0).max(4).nullable().optional(),
  stage_raw: z.string().optional(),
  sex: z.enum(["male", "female", "other", "unknown"]).optional().default("unknown"),
  age: z.number().int().nonnegative().nullable().optional().default(null),
  weight_kg: z.number().positive().nullable().optional(),
  height_cm: z.number().positive().nullable().optional(),
  bsa_m2: z.number().positive().nullable().optional(),
  ecog: z.number().int().min(0).max(4).nullable().optional(),
  histology: z.string().optional().default(""),
  allergies: z.array(z.string()).optional(),
  biomarkers: z.array(z.string()).optional().default([]),
  icd10_code: z.string().optional(),
  icd10_name_ru: z.string().optional(),
  nosology_label_ru: z.string().optional(),
  primary_localization: z.string().optional(),
  tnm: z.string().optional(),
  her2_status: z.string().optional(),
  pd_l1_cps: z.number().nullable().optional(),
  msi_mmr: z.string().optional(),
  comorbidities: z.array(z.string()).optional().default([]),
  prior_surgeries: z.array(z.string()).optional().default([]),
  radiation_history: z.array(z.string()).optional().default([]),
  labs: z.record(z.string(), z.string()).optional().default({}),
  neutrophils_abs: z.number().nullable().optional(),
  platelets: z.number().nullable().optional(),
  hemoglobin: z.number().nullable().optional(),
  bilirubin_total: z.number().nullable().optional(),
  alt: z.number().nullable().optional(),
  ast: z.number().nullable().optional(),
  creatinine: z.number().nullable().optional(),
  albumin: z.number().nullable().optional(),
  inr: z.number().nullable().optional(),
  disease_status: z.string().optional(),
  metastases: z.array(z.string()).optional(),
  last_imaging_date: z.string().optional(),
  complications: z.array(z.string()).optional(),
  treatment_history: z.array(treatmentHistoryEntrySchema).optional(),
  contraindications: z.array(z.string()).optional().default([]),
  timeline: z.array(caseEventSchema).optional().default([]),
  current_plan: z.array(z.string()).optional().default([]),
  treatment_goal: z.string().optional(),
  regimen_protocol: z.string().optional(),
  protocol_assignment_date: z.string().optional(),
  planned_therapy_line: z.number().int().positive().nullable().optional(),
  planned_drugs: z.array(plannedDrugSchema).optional(),
  as_of_date: z.string().min(1),
});

export type CaseEvent = z.infer<typeof caseEventSchema>;
export type TreatmentHistoryEntry = z.infer<typeof treatmentHistoryEntrySchema>;
export type PlannedDrug = z.infer<typeof plannedDrugSchema>;
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
  validation_run_id?: string;
  status: "compliant" | "review_required";
  matches: string[];
  mismatches: string[];
  missing_actions: string[];
  conflicts: string[];
  evidence: SearchHit[];
  applied_guideline_versions: AppliedGuidelineVersion[];
  nearby_guideline_versions?: AppliedGuidelineVersion[];
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
  rag_query_context?: string;
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
  validation_run_id?: string;
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

export type ExcludedPersonalDataItem = {
  type: "fio" | "date_of_birth";
  masked_value: string;
  reason: string;
};

export const guidelineSearchRequestSchema = z.object({
  query: z.string().min(2),
  limit: z.number().int().positive().max(50).optional().default(10),
  guideline_ids: z.array(z.string()).optional().default([]),
  sources: z.array(sourceIdSchema).optional().default(["minzdrav"]),
  as_of_date: z.string().optional(),
  event_date: z.string().optional(),
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
  retrieval_mode: retrievalModeSchema.optional().default("standard"),
  online_fallback: z.boolean().optional().default(false),
});

export type DoctorValidationRequest = z.infer<typeof doctorValidationRequestSchema>;

export const sourceSyncRequestSchema = z.object({
  sources: z.array(sourceIdSchema).optional().default([...sourceIdSchema.options]),
  force: z.boolean().optional().default(false),
});

export type SourceSyncRequest = z.infer<typeof sourceSyncRequestSchema>;

export const landingLeadRequestSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Укажите имя и фамилию")
    .max(120, "Слишком длинное имя"),
  work_email: z
    .string()
    .trim()
    .email("Введите корректный email")
    .max(180, "Слишком длинный email"),
  clinic_name: z
    .string()
    .trim()
    .min(2, "Укажите название клиники")
    .max(160, "Слишком длинное название"),
  role: z
    .string()
    .trim()
    .min(2, "Укажите роль")
    .max(120, "Слишком длинная роль"),
  monthly_cases: z.coerce.number().int().min(0, "Введите число кейсов").max(50000, "Слишком большое значение"),
  message: z
    .string()
    .trim()
    .max(1000, "Комментарий слишком длинный")
    .optional()
    .default(""),
  consent: z
    .boolean()
    .refine((value) => value, "Нужно подтвердить согласие на обработку данных")
    .transform(() => true),
});

export type LandingLeadRequest = z.infer<typeof landingLeadRequestSchema>;

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

export const doctorFeedbackRequestSchema = z.object({
  validation_run_id: z.string().min(1),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional().default(""),
});

export type DoctorFeedbackRequest = z.infer<typeof doctorFeedbackRequestSchema>;

export const exportPdfRequestSchema = z.object({
  case_input: caseInputSchema,
  validation: z.custom<DoctorValidationResponse>(),
});

export type ExportPdfRequest = z.infer<typeof exportPdfRequestSchema>;
