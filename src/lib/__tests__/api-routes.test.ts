import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

afterEach(() => {
  for (const filePath of cleanup.splice(0, cleanup.length)) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function mockValidation() {
  return {
    validation_run_id: "run-test-1",
    status: "review_required" as const,
    matches: ["Паклитаксел + карбоплатин"],
    mismatches: [],
    missing_actions: [],
    conflicts: [],
    evidence: [],
    applied_guideline_versions: [],
    source_traceability_rate: 0.5,
    source_coverage: [],
    retrieval_mode_used: "standard" as const,
    confidence: 0.8,
    ru_first_passed: true,
    warnings: [],
    rag_query_context: "План (блок 5): Паклитаксел + карбоплатин",
    latency_ms: 10,
    generated_at: new Date().toISOString(),
    llm_review: null,
  };
}

describe("api routes", () => {
  it("parse route returns excluded personal data metadata", async () => {
    const { POST } = await import("@/app/api/case/parse/route");

    const formData = new FormData();
    formData.set(
      "text",
      "ФИО: Иванов Иван Иванович\nДата рождения: 01.02.1974\nДиагноз: Рак желудка C16.0, стадия IV",
    );

    const response = await POST(
      new Request("http://localhost/api/case/parse", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      excluded_personal_data: Array<{ type: string }>;
      privacy_notice: string;
    };
    expect(payload.excluded_personal_data.some((item) => item.type === "fio")).toBe(true);
    expect(payload.excluded_personal_data.some((item) => item.type === "date_of_birth")).toBe(true);
    expect(payload.privacy_notice.length).toBeGreaterThan(10);
  });

  it("export routes return pdf content", async () => {
    const caseInput = {
      diagnosis: "Рак желудка",
      stage: "4",
      stage_numeric: 4,
      sex: "male" as const,
      age: 62,
      biomarkers: ["HER2 1+"],
      comorbidities: [],
      prior_surgeries: [],
      radiation_history: [],
      labs: {},
      contraindications: [],
      current_plan: ["Паклитаксел + карбоплатин"],
      as_of_date: "2026-02-25",
      timeline: [],
    };

    const payload = {
      case_input: caseInput,
      validation: mockValidation(),
    };

    const { POST: commissionPost } = await import("@/app/api/export/commission-pdf/route");
    const commissionResponse = await commissionPost(
      new Request("http://localhost/api/export/commission-pdf", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(commissionResponse.status).toBe(200);
    expect(commissionResponse.headers.get("content-type")).toContain("application/pdf");
    const commissionBytes = Buffer.from(await commissionResponse.arrayBuffer());
    expect(commissionBytes.length).toBeGreaterThan(500);

    const { POST: patientPost } = await import("@/app/api/export/patient-pdf/route");
    const patientResponse = await patientPost(
      new Request("http://localhost/api/export/patient-pdf", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(patientResponse.status).toBe(200);
    expect(patientResponse.headers.get("content-type")).toContain("application/pdf");
    const patientBytes = Buffer.from(await patientResponse.arrayBuffer());
    expect(patientBytes.length).toBeGreaterThan(500);
  });

  it("feedback route saves doctor feedback", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-feedback-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);
    vi.resetModules();

    const { saveValidationRun } = await import("@/lib/db");
    const validationResult = { ...mockValidation() } as { llm_review?: unknown } & Record<string, unknown>;
    delete validationResult.llm_review;
    const runId = await saveValidationRun({
      case_id: null,
      as_of_date: "2026-02-25",
      latency_ms: 1,
      result: validationResult as Parameters<typeof saveValidationRun>[0]["result"],
    });

    const { POST } = await import("@/app/api/doctor/feedback/route");
    const response = await POST(
      new Request("http://localhost/api/doctor/feedback", {
        method: "POST",
        body: JSON.stringify({
          validation_run_id: runId,
          rating: "up",
          comment: "Сработало корректно",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; feedback_id: string };
    expect(payload.ok).toBe(true);
    expect(payload.feedback_id.length).toBeGreaterThan(10);
  });
});
