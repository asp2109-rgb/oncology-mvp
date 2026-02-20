import { getGuidelineCounts, initDb } from "../src/lib/db";

initDb();
const counts = getGuidelineCounts();

console.log("Database initialized");
console.log(JSON.stringify(counts, null, 2));
