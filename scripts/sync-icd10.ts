import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

type MkbItem = {
  Code: string;
  Name: string;
  IsGroup: boolean;
};

type PersistedIcd10 = {
  code: string;
  name_ru: string;
  is_group: boolean;
};

const SOURCE_URL = "https://apicr.minzdrav.gov.ru/api.ashx?op=GetMkbRefList";
const OUTPUT_PATH = path.join(process.cwd(), "data", "icd10-ru.json");

function fetchMkbList(): MkbItem[] {
  const raw = execFileSync("curl", ["-sS", "-L", "--compressed", "--retry", "3", "--max-time", "420", SOURCE_URL], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 80,
  });

  return JSON.parse(raw) as MkbItem[];
}

function isOncologyCode(code: string): boolean {
  const upper = code.toUpperCase();
  return upper.startsWith("C") || upper.startsWith("D");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(",", ".");
}

async function main() {
  const list = fetchMkbList();

  const prepared: PersistedIcd10[] = list
    .filter((item) => Boolean(item?.Code) && Boolean(item?.Name))
    .filter((item) => isOncologyCode(item.Code))
    .map((item) => ({
      code: normalizeCode(item.Code),
      name_ru: item.Name.trim(),
      is_group: Boolean(item.IsGroup),
    }))
    .sort((left, right) => left.code.localeCompare(right.code, "ru"));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");

  console.log(`ICD-10 saved: ${OUTPUT_PATH}`);
  console.log(`Records: ${prepared.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
