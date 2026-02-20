import { getDb, initDb } from "@/lib/db";
import type { AppliedGuidelineVersion } from "@/lib/types";
import { tokenize } from "@/lib/utils";

function parseDate(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function selectApplicableGuidelines(
  diagnosis: string,
  asOfDate: string,
  limit = 8,
): AppliedGuidelineVersion[] {
  initDb();
  const database = getDb();

  const tokens = tokenize(diagnosis).slice(0, 6);
  const filters = tokens.length
    ? tokens.map(() => "lower(name) LIKE ?").join(" OR ")
    : "lower(name) LIKE ?";

  const params = tokens.length ? tokens.map((token) => `%${token}%`) : [`%${diagnosis.toLowerCase()}%`];

  const candidates = database
    .prepare(
      `
      SELECT
        id,
        code,
        version,
        name,
        publish_date,
        status,
        source_url,
        pdf_url
      FROM guidelines
      WHERE (${filters})
      ORDER BY publish_date DESC
    `,
    )
    .all(...params) as Array<{
    id: string;
    code: number | null;
    version: number | null;
    name: string;
    publish_date: string | null;
    status: number;
    source_url: string;
    pdf_url: string;
  }>;

  if (!candidates.length) {
    return database
      .prepare(
        `
        SELECT id, name, publish_date, status, source_url, pdf_url
        FROM guidelines
        WHERE is_oncology = 1
        ORDER BY publish_date DESC
        LIMIT ?
      `,
      )
      .all(limit)
      .map((row) => ({
        id: String((row as Record<string, unknown>).id),
        name: String((row as Record<string, unknown>).name),
        publish_date: (row as Record<string, unknown>).publish_date
          ? String((row as Record<string, unknown>).publish_date)
          : null,
        status: Number((row as Record<string, unknown>).status),
        source_url: String((row as Record<string, unknown>).source_url),
        pdf_url: String((row as Record<string, unknown>).pdf_url),
      }));
  }

  const asOfTimestamp = parseDate(asOfDate);
  const grouped = new Map<number | null, typeof candidates>();

  for (const candidate of candidates) {
    const key = candidate.code;
    const bucket = grouped.get(key) ?? [];
    bucket.push(candidate);
    grouped.set(key, bucket);
  }

  const selected: AppliedGuidelineVersion[] = [];

  for (const versions of grouped.values()) {
    const sorted = versions.sort((a, b) => parseDate(b.publish_date) - parseDate(a.publish_date));

    const applicable = sorted.find((item) => parseDate(item.publish_date) <= asOfTimestamp) ?? sorted[0];

    selected.push({
      id: applicable.id,
      name: applicable.name,
      publish_date: applicable.publish_date,
      status: applicable.status,
      source_url: applicable.source_url,
      pdf_url: applicable.pdf_url,
    });
  }

  return selected
    .sort((a, b) => parseDate(b.publish_date) - parseDate(a.publish_date))
    .slice(0, limit);
}

export function listGuidelineSources(limit = 500): Array<{
  id: string;
  name: string;
  publish_date: string | null;
  status: number;
  source_url: string;
  pdf_url: string;
  section_count: number;
}> {
  initDb();
  const database = getDb();

  const rows = database
    .prepare(
      `
      SELECT
        g.id,
        g.name,
        g.publish_date,
        g.status,
        g.source_url,
        g.pdf_url,
        COUNT(gs.section_id) AS section_count
      FROM guidelines g
      LEFT JOIN guideline_sections gs ON gs.guideline_id = g.id
      GROUP BY g.id
      ORDER BY g.publish_date DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    publish_date: row.publish_date ? String(row.publish_date) : null,
    status: Number(row.status),
    source_url: String(row.source_url),
    pdf_url: String(row.pdf_url),
    section_count: Number(row.section_count ?? 0),
  }));
}
