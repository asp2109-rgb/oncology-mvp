import { initDb } from "../src/lib/db";
import { runBenchmark } from "../src/lib/benchmark";

initDb();
const report = runBenchmark("sample-v1");

console.log(JSON.stringify(report, null, 2));
