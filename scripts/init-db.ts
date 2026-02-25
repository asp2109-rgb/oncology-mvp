import { getGuidelineCounts, initDb } from "../src/lib/db";

async function main() {
  initDb();
  const counts = await getGuidelineCounts();

  console.log("Database initialized");
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
