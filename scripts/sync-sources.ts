import { initDb } from "../src/lib/db";
import { syncSources } from "../src/lib/source-sync";
import { SOURCE_IDS } from "../src/lib/sources";
import type { SourceId } from "../src/lib/types";

function parseSourcesArg(): SourceId[] | undefined {
  const sourcesArg = process.argv.find((arg) => arg.startsWith("--sources="));
  if (!sourcesArg) {
    return undefined;
  }

  const values = sourcesArg
    .replace("--sources=", "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const selected = SOURCE_IDS.filter((source) => values.includes(source));
  return selected.length ? selected : undefined;
}

async function main() {
  initDb();

  const selected = parseSourcesArg();
  const summary = await syncSources({ sources: selected });

  console.log(
    JSON.stringify(
      {
        selected_sources: selected ?? SOURCE_IDS,
        ...summary,
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
