import { readTrialsCache, upsertTrialsCache } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";

type TrialItem = {
  nctId: string;
  briefTitle: string;
  overallStatus: string;
  lastUpdateSubmitDate: string | null;
  conditions: string[];
  interventions: string[];
};

type TrialSearchResult = {
  query: string;
  recruiting: boolean;
  source: "cache" | "live";
  fetched_at: string;
  items: TrialItem[];
};

function shouldUseCache(fetchedAt: string, ttlHours = 24): boolean {
  const ageMs = Date.now() - Date.parse(fetchedAt);
  return ageMs <= ttlHours * 60 * 60 * 1000;
}

function normalizeTrialsPayload(payload: unknown): TrialItem[] {
  const studies = (payload as { studies?: unknown[] })?.studies;
  if (!Array.isArray(studies)) {
    return [];
  }

  const items: TrialItem[] = [];

  for (const study of studies) {
    const protocol = (study as Record<string, unknown>).protocolSection as Record<string, unknown>;
    const identification = protocol?.identificationModule as Record<string, unknown>;
    const status = protocol?.statusModule as Record<string, unknown>;
    const conditionsModule = protocol?.conditionsModule as Record<string, unknown>;
    const armsModule = protocol?.armsInterventionsModule as Record<string, unknown>;

    const interventionsRaw = Array.isArray(armsModule?.interventions)
      ? (armsModule?.interventions as Array<Record<string, unknown>>)
      : [];

    const interventions = interventionsRaw
      .map((item) => String(item.interventionName ?? "").trim())
      .filter(Boolean)
      .slice(0, 5);

    items.push({
      nctId: String(identification?.nctId ?? ""),
      briefTitle: String(identification?.briefTitle ?? ""),
      overallStatus: String(status?.overallStatus ?? "UNKNOWN"),
      lastUpdateSubmitDate: status?.lastUpdateSubmitDate
        ? String(status.lastUpdateSubmitDate)
        : null,
      conditions: Array.isArray(conditionsModule?.conditions)
        ? (conditionsModule.conditions as unknown[]).map((value) => String(value)).slice(0, 4)
        : [],
      interventions,
    });
  }

  return items.filter((item) => item.nctId && item.briefTitle);
}

export async function searchTrials(
  query: string,
  recruiting: boolean,
  pageSize = 15,
): Promise<TrialSearchResult> {
  const normalizedQuery = query.trim();
  const queryKey = `${normalizedQuery}|${recruiting ? "1" : "0"}|${pageSize}`;

  const cached = readTrialsCache(queryKey);
  if (cached && shouldUseCache(cached.fetched_at)) {
    const payload = safeJsonParse<{ fetched_at: string; items: TrialItem[] } | null>(
      cached.payload_json,
      null,
    );

    if (payload) {
      return {
        query: normalizedQuery,
        recruiting,
        source: "cache",
        fetched_at: payload.fetched_at,
        items: payload.items,
      };
    }
  }

  const apiUrl = new URL("https://clinicaltrials.gov/api/v2/studies");
  apiUrl.searchParams.set("query.cond", normalizedQuery);
  apiUrl.searchParams.set("pageSize", String(Math.max(1, Math.min(pageSize, 25))));
  apiUrl.searchParams.set("format", "json");

  const response = await fetch(apiUrl.toString(), {
    headers: {
      "User-Agent": "Oncology-MVP/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`clinicaltrials.gov request failed: ${response.status}`);
  }

  const payload = (await response.json()) as unknown;
  let items = normalizeTrialsPayload(payload);

  if (recruiting) {
    const recruitingStatuses = new Set(["RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING"]);
    items = items.filter((item) => recruitingStatuses.has(item.overallStatus));
  }

  const fetchedAt = new Date().toISOString();

  upsertTrialsCache(queryKey, {
    fetched_at: fetchedAt,
    items,
  });

  return {
    query: normalizedQuery,
    recruiting,
    source: "live",
    fetched_at: fetchedAt,
    items,
  };
}
