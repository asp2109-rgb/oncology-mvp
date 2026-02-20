import { z } from "zod";

export const caseEventSchema = z.object({
  event_date: z.string().min(1),
  event_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export const caseInputSchema = z.object({
  diagnosis: z.string().min(2),
  stage: z.string().optional().default(""),
  biomarkers: z.array(z.string()).optional().default([]),
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
  latency_ms: number;
  generated_at: string;
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
});

export type GuidelineSearchRequest = z.infer<typeof guidelineSearchRequestSchema>;

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
