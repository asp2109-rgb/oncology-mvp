import { setTimeout as sleep } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import {
  initDb,
  replaceGuidelineSections,
  replaceRecommendationChunks,
  upsertGuideline,
  withTransaction,
} from "../src/lib/db";
import {
  buildTags,
  extractEvidenceLevel,
  sentenceChunks,
  toPlainText,
} from "../src/lib/utils";

const API_BASE = "https://apicr.minzdrav.gov.ru";
const WEB_BASE = "https://cr.minzdrav.gov.ru";

type MkbItem = {
  Id: number;
  Code: string;
  Name: string;
};

type ListItem = {
  CodeVersion: string;
  Name: string;
  PublishDateStr: string | null;
  Status: number;
  ApplyStatusCalculated?: number;
};

type ListResponse = {
  TotalRecords: number;
  Data: ListItem[];
};

type ClinrecDetail = {
  id: string;
  code?: number;
  version?: number;
  name: string;
  publish_date: string | null;
  status: number;
  apply_status: string | null;
  obj?: {
    sections?: Array<{
      id?: string;
      title?: string;
      content?: string;
    }>;
  };
  textBlock?: string;
};

function assertOk<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}

async function fetchJson<T>(url: string, init?: RequestInit, retries = 4): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    attempt += 1;

    try {
      const method = init?.method ?? "GET";
      const args = ["-sS", "-L", "--max-time", "90", "-X", method, url];

      if (init?.body) {
        args.push("-H", "Content-Type: application/json", "--data", String(init.body));
      }

      const raw = execFileSync("curl", args, {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 100,
      });

      return JSON.parse(raw) as T;
    } catch (error) {
      lastError = error;
      await sleep(600 * attempt);
    }
  }

  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

async function fetchOncologyMkbId(): Promise<number> {
  const mkbList = await fetchJson<MkbItem[]>(`${API_BASE}/api.ashx?op=GetMkbRefList`);
  const oncology = mkbList.find((item) => item.Code === "C00-D48");
  return assertOk(oncology, "Could not find oncology MKB code C00-D48").Id;
}

async function fetchGuidelinePage(status: number, oncologyMkbId: number, currentPage: number): Promise<ListResponse> {
  const body = {
    filters: [
      {
        fieldName: "status",
        filterType: 1,
        filterValueType: 2,
        value1: status,
        value2: "",
        values: [],
      },
      {
        fieldName: "mkbid",
        filterType: 9,
        filterValueType: 1,
        value1: "",
        value2: "",
        values: [oncologyMkbId],
      },
    ],
    sortOption: {
      fieldName: "publishdate",
      sortType: 2,
    },
    pageSize: 100,
    currentPage,
    useANDoperator: true,
    columns: [],
  };

  return fetchJson<ListResponse>(`${API_BASE}/api.ashx?op=GetJsonClinrecsFilterV2`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function fetchAllGuidelineItems(status: number, oncologyMkbId: number): Promise<ListItem[]> {
  let page = 1;
  let totalRecords = Number.POSITIVE_INFINITY;
  const results: ListItem[] = [];

  while ((page - 1) * 100 < totalRecords) {
    const payload = await fetchGuidelinePage(status, oncologyMkbId, page);
    totalRecords = payload.TotalRecords;
    results.push(...payload.Data);
    page += 1;
  }

  return results;
}

function buildSections(detail: ClinrecDetail): Array<{
  section_id: string;
  section_title: string;
  section_html: string;
  section_text: string;
}> {
  const fromApi = detail.obj?.sections ?? [];

  if (!fromApi.length && detail.textBlock) {
    return [
      {
        section_id: "doc_whole",
        section_title: "Исходный документ",
        section_html: detail.textBlock,
        section_text: toPlainText(detail.textBlock),
      },
    ];
  }

  const sections = fromApi
    .map((section, index) => {
      const sectionId = section.id?.trim() || `section_${index + 1}`;
      const sectionTitle = section.title?.trim() || sectionId;
      const sectionHtml = section.content ?? "";
      const sectionText = toPlainText(sectionHtml);

      return {
        section_id: sectionId,
        section_title: sectionTitle,
        section_html: sectionHtml,
        section_text: sectionText,
      };
    })
    .filter((section) => section.section_text.length > 3 || section.section_html.length > 3);

  if (!sections.length) {
    return [
      {
        section_id: "doc_whole",
        section_title: "Исходный документ",
        section_html: detail.textBlock ?? "",
        section_text: toPlainText(detail.textBlock ?? ""),
      },
    ];
  }

  return sections;
}

function buildChunks(
  guidelineId: string,
  sections: Array<{
    section_id: string;
    section_title: string;
    section_text: string;
  }>,
) {
  const chunks: Array<{
    chunk_id: string;
    guideline_id: string;
    section_id: string;
    chunk_text: string;
    tags: string[];
    evidence_level: string | null;
    source_anchor: string | null;
  }> = [];

  for (const section of sections) {
    const split = sentenceChunks(section.section_text, 900).slice(0, 220);

    for (let index = 0; index < split.length; index += 1) {
      const text = split[index];
      chunks.push({
        chunk_id: `${guidelineId}:${section.section_id}:${index + 1}`,
        guideline_id: guidelineId,
        section_id: section.section_id,
        chunk_text: text,
        tags: buildTags(text),
        evidence_level: extractEvidenceLevel(text),
        source_anchor: section.section_title,
      });
    }
  }

  return chunks;
}

async function fetchDetail(guidelineId: string): Promise<ClinrecDetail> {
  const url = `${API_BASE}/api.ashx?op=GetClinrec2&id=${encodeURIComponent(guidelineId)}&ssid=`;
  return fetchJson<ClinrecDetail>(url);
}

async function main() {
  initDb();
  const oncologyMkbId = await fetchOncologyMkbId();

  console.log(`Oncology MKB id: ${oncologyMkbId}`);

  const statusZero = await fetchAllGuidelineItems(0, oncologyMkbId);
  const statusArchive = await fetchAllGuidelineItems(4, oncologyMkbId);

  const allItems = [...statusZero, ...statusArchive];
  const dedupedMap = new Map<string, ListItem>();
  for (const item of allItems) {
    dedupedMap.set(item.CodeVersion, item);
  }

  const deduped = Array.from(dedupedMap.values()).sort((a, b) => {
    return (Date.parse(b.PublishDateStr ?? "") || 0) - (Date.parse(a.PublishDateStr ?? "") || 0);
  });

  console.log(`Collected oncology guidelines: ${deduped.length}`);

  let processed = 0;
  let failed = 0;

  for (const item of deduped) {
    try {
      const detail = await fetchDetail(item.CodeVersion);
      const sections = buildSections(detail);
      const chunks = buildChunks(item.CodeVersion, sections);

      withTransaction(() => {
        upsertGuideline({
          id: detail.id,
          code: detail.code ?? null,
          version: detail.version ?? null,
          name: detail.name,
          publish_date: detail.publish_date ?? item.PublishDateStr ?? null,
          status: detail.status ?? item.Status,
          apply_status: detail.apply_status ?? null,
          source_url: `${WEB_BASE}/preview-cr/${detail.id}`,
          pdf_url: `${API_BASE}/api.ashx?op=GetClinrecPdf&id=${detail.id}`,
          is_oncology: 1,
        });

        replaceGuidelineSections(
          detail.id,
          sections.map((section) => ({
            guideline_id: detail.id,
            section_id: section.section_id,
            section_title: section.section_title,
            section_html: section.section_html,
            section_text: section.section_text,
          })),
        );

        replaceRecommendationChunks(detail.id, chunks);
      });

      processed += 1;

      if (processed % 10 === 0 || processed === deduped.length) {
        console.log(`Processed ${processed}/${deduped.length}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`Failed guideline ${item.CodeVersion}:`, error);
    }
  }

  console.log("Ingestion completed");
  console.log(
    JSON.stringify(
      {
        total: deduped.length,
        processed,
        failed,
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
