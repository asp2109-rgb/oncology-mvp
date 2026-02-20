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

describe("database schema", () => {
  it("creates core tables", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-schema-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();
    const { getDb, initDb } = await import("@/lib/db");

    initDb();
    const db = getDb();

    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const names = rows.map((row) => row.name);

    expect(names).toContain("guidelines");
    expect(names).toContain("guideline_sections");
    expect(names).toContain("recommendation_chunks");
    expect(names).toContain("cases");
    expect(names).toContain("validation_runs");
    expect(names).toContain("benchmark_runs");
    expect(names).toContain("trials_cache");
  });
});
