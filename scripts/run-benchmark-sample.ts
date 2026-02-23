import { initDb } from "../src/lib/db";
import { runBenchmark } from "../src/lib/benchmark";

async function main() {
  initDb();
  const report = await runBenchmark("sample-v1");

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
