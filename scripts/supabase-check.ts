import { performance } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getDbProviderInfo,
  getGuidelineCounts,
  initDb,
  listRecentMinzdravGuidelines,
} from "../src/lib/db";

function loadEnvFile(fileName: string) {
  const envPath = join(process.cwd(), fileName);
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const requireSupabase = process.argv.includes("--require-supabase");
  const startedAt = performance.now();

  initDb();
  const provider = getDbProviderInfo();

  if (requireSupabase && provider.active !== "supabase") {
    throw new Error(
      `Supabase не активен (requested=${provider.requested}, active=${provider.active}, configured=${provider.supabase_configured}).`,
    );
  }

  const beforeQueries = performance.now();
  const [counts, recent] = await Promise.all([
    getGuidelineCounts(),
    listRecentMinzdravGuidelines(5),
  ]);
  const finishedAt = performance.now();

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider,
        counts,
        timing_ms: {
          init: Math.round(beforeQueries - startedAt),
          queries: Math.round(finishedAt - beforeQueries),
          total: Math.round(finishedAt - startedAt),
        },
        recent_minzdrav_preview: recent.map((row) => ({
          id: row.id,
          name: row.name,
          publish_date: row.publish_date,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
