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

describe("sqlite fts fallback", () => {
  it("does not throw on dotted query in source-doc search", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-fts-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();
    const { initDb, searchSourceDocumentsFts, upsertSourceDocument } = await import("@/lib/db");

    initDb();
    await upsertSourceDocument(
      {
        document_id: "russco:demo-1",
        source: "russco",
        title: "Рак молочной железы: варианты системной терапии",
        url: "https://example.org/russco-demo",
        version: "2025",
        published_at: "2025-06-01",
        access_level: "open",
        ingest_status: "downloaded",
        http_status: 200,
        failure_reason: null,
        content_text:
          "С 25.05.2025 проводилась химиотерапия: Паклитаксел 80 мг/м2 еженедельно + Карбоплатин AUC2.",
        metadata_json: "{}",
      },
      ["рак", "молочной", "паклитаксел", "карбоплатин", "auc2"],
    );

    const dottedRows = await searchSourceDocumentsFts({
      query: "25.05.2025 Паклитаксел 80 мг/м2 + Карбоплатин AUC2.",
      sources: ["russco"],
      limit: 5,
    });
    expect(Array.isArray(dottedRows)).toBe(true);

    const simpleRows = await searchSourceDocumentsFts({
      query: "паклитаксел карбоплатин",
      sources: ["russco"],
      limit: 5,
    });

    expect(simpleRows.length).toBeGreaterThan(0);
    expect(String(simpleRows[0]?.guideline_name ?? "")).toContain("Рак молочной железы");
  });
});
