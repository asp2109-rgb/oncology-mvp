import { createHash } from "node:crypto";
import {
  initDb,
  logSourceSyncAttempt,
  upsertSourceDocument,
  deleteSourceDocumentsBySource,
  listSourceStatus,
  listRecentMinzdravGuidelines,
} from "@/lib/db";
import { SOURCE_CONFIG, SOURCE_IDS } from "@/lib/sources";
import type { SourceId } from "@/lib/types";
import { nowIso, toPlainText } from "@/lib/utils";

type SyncItemResult = {
  source: SourceId;
  attempted: number;
  downloaded: number;
  online_only: number;
  failed: number;
};

function absoluteUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

function stableId(source: SourceId, url: string): string {
  const digest = createHash("sha1").update(`${source}:${url}`).digest("hex");
  return `${source}:${digest}`;
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Oncology-MVP/1.0 (+source-sync)",
      },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

async function extractPdfText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Oncology-MVP/1.0 (+source-sync)" },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, text: "" };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });

    let text = "";
    try {
      const parsed = await parser.getText();
      text = parsed.text ?? "";
    } finally {
      await parser.destroy().catch(() => undefined);
    }

    return {
      ok: true,
      status: response.status,
      text: text.replace(/\s+/g, " ").slice(0, 20_000),
    };
  } catch {
    return { ok: false, status: 0, text: "" };
  }
}

async function syncMinzdrav(): Promise<SyncItemResult> {
  const rows = await listRecentMinzdravGuidelines(600);

  await deleteSourceDocumentsBySource("minzdrav");
  let downloaded = 0;

  for (const row of rows) {
    await upsertSourceDocument(
      {
        document_id: `minzdrav:${row.id}`,
        source: "minzdrav",
        title: row.name,
        url: row.source_url,
        version: row.publish_date,
        published_at: row.publish_date,
        access_level: "open",
        ingest_status: "downloaded",
        http_status: 200,
        failure_reason: null,
        content_text: row.sample_chunk ?? row.name,
        metadata_json: JSON.stringify({ guideline_id: row.id }),
      },
      [row.name],
    );

    downloaded += 1;
    await logSourceSyncAttempt({
      source: "minzdrav",
      url: row.source_url,
      status: "downloaded",
      http_status: 200,
    });
  }

  return {
    source: "minzdrav",
    attempted: rows.length,
    downloaded,
    online_only: 0,
    failed: 0,
  };
}

async function syncRUSSCO(): Promise<SyncItemResult> {
  const root = "https://rosoncoweb.ru/standarts/RUSSCO/";
  const page = await fetchText(root);

  if (!page.ok) {
    await logSourceSyncAttempt({
      source: "russco",
      url: root,
      status: "failed",
      http_status: page.status,
      failure_reason: "Не удалось открыть страницу RUSSCO",
    });

    return { source: "russco", attempted: 1, downloaded: 0, online_only: 0, failed: 1 };
  }

  await deleteSourceDocumentsBySource("russco");

  const links = Array.from(
    new Set(
      Array.from(page.text.matchAll(/href="([^"]+\.pdf)"/gi))
        .map((match) => absoluteUrl(root, match[1]))
        .filter((url) => /rosoncoweb\.ru/i.test(url)),
    ),
  ).slice(0, 120);

  let downloaded = 0;
  let onlineOnly = 0;
  let failed = 0;

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const downloadNow = index < 8;
    const title = decodeURIComponent(link.split("/").pop() ?? `RUSSCO_${index + 1}`);

    if (downloadNow) {
      const pdf = await extractPdfText(link);
      if (pdf.ok) {
        await upsertSourceDocument(
          {
            document_id: stableId("russco", link),
            source: "russco",
            title,
            url: link,
            version: null,
            published_at: null,
            access_level: "open",
            ingest_status: "downloaded",
            http_status: pdf.status,
            failure_reason: null,
            content_text: pdf.text || title,
            metadata_json: JSON.stringify({ source_page: root }),
          },
          [title],
        );
        downloaded += 1;
        await logSourceSyncAttempt({ source: "russco", url: link, status: "downloaded", http_status: pdf.status });
      } else {
        failed += 1;
        await logSourceSyncAttempt({
          source: "russco",
          url: link,
          status: "failed",
          http_status: pdf.status,
          failure_reason: "PDF недоступен",
        });
      }
    } else {
      await upsertSourceDocument(
        {
          document_id: stableId("russco", link),
          source: "russco",
          title,
          url: link,
          version: null,
          published_at: null,
          access_level: "open",
          ingest_status: "online_only",
          http_status: 200,
          failure_reason: null,
          content_text: "",
          metadata_json: JSON.stringify({ source_page: root }),
        },
        [title],
      );
      onlineOnly += 1;
      await logSourceSyncAttempt({ source: "russco", url: link, status: "online_only", http_status: 200 });
    }
  }

  return {
    source: "russco",
    attempted: links.length,
    downloaded,
    online_only: onlineOnly,
    failed,
  };
}

async function syncNccnPatients(): Promise<SyncItemResult> {
  const pages = [
    "https://www.nccn.org/guidelines/patients",
    "https://www.nccn.org/patientresources/patient-resources/guidelines-for-patients",
  ];

  let mergedText = "";
  let statusCode = 0;
  for (const pageUrl of pages) {
    const page = await fetchText(pageUrl);
    if (page.ok) {
      mergedText += `\n${page.text}`;
      statusCode = page.status;
    }
  }

  if (!mergedText.trim()) {
    await logSourceSyncAttempt({
      source: "nccn_patient",
      url: pages[0],
      status: "failed",
      http_status: statusCode || null,
      failure_reason: "Не удалось открыть список NCCN Patients",
    });
    return { source: "nccn_patient", attempted: 1, downloaded: 0, online_only: 0, failed: 1 };
  }

  await deleteSourceDocumentsBySource("nccn_patient");

  let links = Array.from(
    new Set(
      Array.from(mergedText.matchAll(/href="([^"]*\/patients\/guidelines\/content\/PDF\/[^"]+\.pdf)"/gi)).map(
        (match) => absoluteUrl("https://www.nccn.org", match[1]),
      ),
    ),
  );

  if (!links.length) {
    const detailLinks = Array.from(
      new Set(
        Array.from(
          mergedText.matchAll(
            /href="([^"]*guidelines-for-patients-details\?patientGuidelineId=\d+)"/gi,
          ),
        ).map((match) => absoluteUrl("https://www.nccn.org", match[1])),
      ),
    ).slice(0, 30);

    for (const detailUrl of detailLinks) {
      const detailPage = await fetchText(detailUrl);
      if (!detailPage.ok) {
        continue;
      }

      const detailPdfLinks = Array.from(
        new Set(
          Array.from(
            detailPage.text.matchAll(/href="([^"]*\/patients\/guidelines\/content\/PDF\/[^"]+\.pdf)"/gi),
          ).map((match) => absoluteUrl("https://www.nccn.org", match[1])),
        ),
      );

      links = links.concat(detailPdfLinks);
    }
  }

  links = Array.from(new Set(links)).slice(0, 120);

  let downloaded = 0;
  let onlineOnly = 0;
  let failed = 0;

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const title = decodeURIComponent(link.split("/").pop() ?? `NCCN_${index + 1}`);

    if (index < 8) {
      const pdf = await extractPdfText(link);
      if (pdf.ok) {
        await upsertSourceDocument(
          {
            document_id: stableId("nccn_patient", link),
            source: "nccn_patient",
            title,
            url: link,
            version: null,
            published_at: null,
            access_level: "open",
            ingest_status: "downloaded",
            http_status: pdf.status,
            failure_reason: null,
            content_text: pdf.text || title,
            metadata_json: JSON.stringify({ source_page: pages }),
          },
          [title],
        );
        downloaded += 1;
        await logSourceSyncAttempt({
          source: "nccn_patient",
          url: link,
          status: "downloaded",
          http_status: pdf.status,
        });
      } else {
        failed += 1;
        await logSourceSyncAttempt({
          source: "nccn_patient",
          url: link,
          status: "failed",
          http_status: pdf.status,
          failure_reason: "PDF недоступен",
        });
      }
    } else {
      await upsertSourceDocument(
        {
          document_id: stableId("nccn_patient", link),
            source: "nccn_patient",
            title,
            url: link,
          version: null,
          published_at: null,
          access_level: "open",
          ingest_status: "online_only",
          http_status: 200,
          failure_reason: null,
          content_text: "",
            metadata_json: JSON.stringify({ source_page: pages }),
          },
          [title],
        );
      onlineOnly += 1;
      await logSourceSyncAttempt({
        source: "nccn_patient",
        url: link,
        status: "online_only",
        http_status: 200,
      });
    }
  }

  return {
    source: "nccn_patient",
    attempted: links.length,
    downloaded,
    online_only: onlineOnly,
    failed,
  };
}

async function syncNccnProfessional(): Promise<SyncItemResult> {
  const url = "https://www.nccn.org/professionals/physician_gls/pdf/nscl.pdf";
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { "User-Agent": "Oncology-MVP/1.0 (+source-sync)" },
    cache: "no-store",
  }).catch(() => null);

  const status = response?.status ?? 0;
  const location = response?.headers.get("location") ?? "";
  const loginRequired = status === 302 || /\/login/i.test(location);

  await deleteSourceDocumentsBySource("nccn_professional");

  await upsertSourceDocument(
    {
      document_id: stableId("nccn_professional", url),
      source: "nccn_professional",
      title: "NCCN Professional Guidelines",
      url,
      version: null,
      published_at: null,
      access_level: loginRequired ? "login_required" : "open",
      ingest_status: "online_only",
      http_status: status || null,
      failure_reason: loginRequired ? "Требуется логин NCCN" : null,
      content_text: "",
      metadata_json: JSON.stringify({ location }),
    },
    ["nccn", "professional", "guidelines"],
  );

  await logSourceSyncAttempt({
    source: "nccn_professional",
    url,
    status: "online_only",
    http_status: status || null,
    failure_reason: loginRequired ? "login_required" : null,
  });

  return {
    source: "nccn_professional",
    attempted: 1,
    downloaded: 0,
    online_only: 1,
    failed: 0,
  };
}

async function syncSimpleHtmlSource(
  source: SourceId,
  url: string,
  title: string,
): Promise<SyncItemResult> {
  await deleteSourceDocumentsBySource(source);
  const page = await fetchText(url);

  if (!page.ok) {
    const accessRestricted = page.status === 401 || page.status === 403;
    const status = accessRestricted ? "online_only" : "failed";
    await upsertSourceDocument(
      {
        document_id: stableId(source, url),
        source,
        title,
        url,
        version: null,
        published_at: null,
        access_level: accessRestricted ? "restricted" : "open",
        ingest_status: status,
        http_status: page.status || null,
        failure_reason: accessRestricted ? "access_restricted" : `HTTP ${page.status || "error"}`,
        content_text: "",
        metadata_json: JSON.stringify({}),
      },
      [title],
    );
    await logSourceSyncAttempt({
      source,
      url,
      status,
      http_status: page.status || null,
      failure_reason: accessRestricted ? "access_restricted" : `HTTP ${page.status || "error"}`,
    });
    return {
      source,
      attempted: 1,
      downloaded: 0,
      online_only: accessRestricted ? 1 : 0,
      failed: accessRestricted ? 0 : 1,
    };
  }

  const plain = toPlainText(page.text).slice(0, 20_000);
  const downloadable = plain.length > 1000;
  const status = downloadable ? "downloaded" : "online_only";

  await upsertSourceDocument(
    {
      document_id: stableId(source, url),
      source,
      title,
      url,
      version: null,
      published_at: null,
      access_level: "open",
      ingest_status: status,
      http_status: page.status,
      failure_reason: null,
      content_text: downloadable ? plain : "",
      metadata_json: JSON.stringify({}),
    },
    [title],
  );

  await logSourceSyncAttempt({
    source,
    url,
    status,
    http_status: page.status,
  });

  return {
    source,
    attempted: 1,
    downloaded: downloadable ? 1 : 0,
    online_only: downloadable ? 0 : 1,
    failed: 0,
  };
}

async function syncPubMed(): Promise<SyncItemResult> {
  const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
  const searchUrl = new URL(url);
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", "oncology clinical guideline");
  searchUrl.searchParams.set("retmax", "50");
  searchUrl.searchParams.set("retmode", "json");

  const searchRes = await fetch(searchUrl.toString(), { cache: "no-store" }).catch(() => null);
  if (!searchRes || !searchRes.ok) {
    await logSourceSyncAttempt({
      source: "pubmed",
      url: searchUrl.toString(),
      status: "failed",
      http_status: searchRes?.status ?? null,
      failure_reason: "PubMed search недоступен",
    });
    return { source: "pubmed", attempted: 1, downloaded: 0, online_only: 0, failed: 1 };
  }

  const searchPayload = (await searchRes.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  const ids = searchPayload.esearchresult?.idlist?.filter(Boolean).slice(0, 50) ?? [];

  if (!ids.length) {
    return { source: "pubmed", attempted: 1, downloaded: 0, online_only: 1, failed: 0 };
  }

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("id", ids.join(","));
  summaryUrl.searchParams.set("retmode", "json");

  const summaryRes = await fetch(summaryUrl.toString(), { cache: "no-store" }).catch(() => null);
  if (!summaryRes || !summaryRes.ok) {
    await logSourceSyncAttempt({
      source: "pubmed",
      url: summaryUrl.toString(),
      status: "failed",
      http_status: summaryRes?.status ?? null,
      failure_reason: "PubMed summary недоступен",
    });
    return { source: "pubmed", attempted: ids.length, downloaded: 0, online_only: ids.length, failed: 0 };
  }

  const summaryPayload = (await summaryRes.json()) as {
    result?: Record<string, { uid?: string; title?: string; pubdate?: string }>;
  };

  await deleteSourceDocumentsBySource("pubmed");

  let downloaded = 0;
  for (const id of ids) {
    const item = summaryPayload.result?.[id];
    if (!item) {
      continue;
    }
    const title = item.title?.trim() || `PMID ${id}`;
    const pubdate = item.pubdate?.trim() || null;
    const articleUrl = `https://pubmed.ncbi.nlm.nih.gov/${id}/`;

    await upsertSourceDocument(
      {
        document_id: stableId("pubmed", articleUrl),
        source: "pubmed",
        title,
        url: articleUrl,
        version: pubdate,
        published_at: pubdate,
        access_level: "open",
        ingest_status: "downloaded",
        http_status: 200,
        failure_reason: null,
        content_text: `${title}${pubdate ? ` (${pubdate})` : ""}`,
        metadata_json: JSON.stringify({ pmid: id }),
      },
      [title, "pubmed", id],
    );
    downloaded += 1;
    await logSourceSyncAttempt({ source: "pubmed", url: articleUrl, status: "downloaded", http_status: 200 });
  }

  return {
    source: "pubmed",
    attempted: ids.length,
    downloaded,
    online_only: 0,
    failed: 0,
  };
}

async function runConnector(source: SourceId): Promise<SyncItemResult> {
  switch (source) {
    case "minzdrav":
      return syncMinzdrav();
    case "russco":
      return syncRUSSCO();
    case "nccn_patient":
      return syncNccnPatients();
    case "nccn_professional":
      return syncNccnProfessional();
    case "esmo":
      return syncSimpleHtmlSource("esmo", "https://www.esmo.org/", "ESMO Clinical Guidelines Portal");
    case "asco":
      return syncSimpleHtmlSource("asco", "https://www.asco.org/quality-care/clinical-guidelines", "ASCO Clinical Guidelines");
    case "femb":
      return syncSimpleHtmlSource("femb", "https://femb.ru/femb/", "Федеральная электронная медицинская библиотека");
    case "pubmed":
      return syncPubMed();
    default:
      return { source, attempted: 0, downloaded: 0, online_only: 0, failed: 0 };
  }
}

export async function syncSources(params: { sources?: SourceId[] } = {}): Promise<{
  started_at: string;
  finished_at: string;
  results: SyncItemResult[];
}> {
  initDb();
  const started_at = nowIso();
  const selected = params.sources?.length
    ? SOURCE_IDS.filter((source) => params.sources?.includes(source))
    : SOURCE_IDS;

  const results: SyncItemResult[] = [];
  for (const source of selected) {
    const result = await runConnector(source);
    results.push(result);
  }

  return {
    started_at,
    finished_at: nowIso(),
    results,
  };
}

export async function getSourceStatus() {
  initDb();
  const raw = await listSourceStatus();
  const bySource = new Map(raw.map((item) => [item.source, item]));

  return SOURCE_IDS.map((source) => {
    const row = bySource.get(source);
    return {
      source,
      label: SOURCE_CONFIG[source].label,
      tier: SOURCE_CONFIG[source].tier,
      default_policy: SOURCE_CONFIG[source].defaultPolicy,
      downloaded_count: row?.downloaded_count ?? 0,
      online_only_count: row?.online_only_count ?? 0,
      failed_count: row?.failed_count ?? 0,
      last_indexed_at: row?.last_indexed_at ?? null,
      last_attempt_at: row?.last_attempt_at ?? null,
      last_attempt_status: row?.last_attempt_status ?? null,
      last_attempt_url: row?.last_attempt_url ?? null,
      last_attempt_http_status: row?.last_attempt_http_status ?? null,
      last_attempt_failure_reason: row?.last_attempt_failure_reason ?? null,
    };
  });
}
