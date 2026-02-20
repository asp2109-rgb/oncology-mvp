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
      // ignore cleanup failures in tests
    }
  }
});

describe("rule engine", () => {
  it("finds matches and mismatches for case plan", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-rules-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();

    const {
      initDb,
      upsertGuideline,
      replaceGuidelineSections,
      replaceRecommendationChunks,
      withTransaction,
    } = await import("@/lib/db");
    const { validateCase } = await import("@/lib/validation/rule-engine");

    initDb();

    withTransaction(() => {
      upsertGuideline({
        id: "574_1",
        code: 574,
        version: 1,
        name: "Рак желудка",
        publish_date: "2020-04-09T00:00:00",
        status: 0,
        apply_status: "Применяется",
        source_url: "https://cr.minzdrav.gov.ru/preview-cr/574_1",
        pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=574_1",
        is_oncology: 1,
      });

      replaceGuidelineSections("574_1", [
        {
          guideline_id: "574_1",
          section_id: "doc_3",
          section_title: "Лечение",
          section_html: "<p>Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение</p>",
          section_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
        },
      ]);

      replaceRecommendationChunks("574_1", [
        {
          chunk_id: "574_1:doc_3:1",
          guideline_id: "574_1",
          section_id: "doc_3",
          chunk_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
          tags: ["recommendation", "chemotherapy", "surgery"],
          evidence_level: "A",
          source_anchor: "Лечение",
        },
      ]);
    });

    const result = validateCase({
      diagnosis: "Рак желудка",
      stage: "III",
      biomarkers: [],
      as_of_date: "2021-03-01",
      current_plan: ["Периоперационная химиотерапия FLOT", "Гомеопатия"],
      timeline: [],
    });

    expect(result.matches).toContain("Периоперационная химиотерапия FLOT");
    expect(result.mismatches).toContain("Гомеопатия");
    expect(result.status).toBe("review_required");
    expect(result.applied_guideline_versions.length).toBeGreaterThan(0);
  });
});
