import type { SourceId, SourcePolicy } from "@/lib/types";

export const SOURCE_CONFIG: Record<
  SourceId,
  {
    label: string;
    tier: "mandatory_ru" | "ru_practice" | "international" | "evidence" | "reference";
    defaultPolicy: SourcePolicy;
    defaultSelected: boolean;
  }
> = {
  minzdrav: {
    label: "Минздрав РФ",
    tier: "mandatory_ru",
    defaultPolicy: "LOCAL_ONLY",
    defaultSelected: true,
  },
  russco: {
    label: "RUSSCO",
    tier: "ru_practice",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  nccn_patient: {
    label: "NCCN (Patients)",
    tier: "international",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  nccn_professional: {
    label: "NCCN (Professional)",
    tier: "international",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  esmo: {
    label: "ESMO",
    tier: "international",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  asco: {
    label: "ASCO",
    tier: "international",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  pubmed: {
    label: "PubMed",
    tier: "evidence",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
  femb: {
    label: "FEMB",
    tier: "reference",
    defaultPolicy: "LOCAL_THEN_ONLINE",
    defaultSelected: false,
  },
};

export const SOURCE_IDS = Object.keys(SOURCE_CONFIG) as SourceId[];

export const DEFAULT_SOURCE_SELECTION: SourceId[] = SOURCE_IDS.filter(
  (source) => SOURCE_CONFIG[source].defaultSelected,
);

export const DEFAULT_SOURCE_POLICY: Record<SourceId, SourcePolicy> = SOURCE_IDS.reduce(
  (acc, source) => {
    acc[source] = SOURCE_CONFIG[source].defaultPolicy;
    return acc;
  },
  {} as Record<SourceId, SourcePolicy>,
);

export function normalizeSourceSelection(input?: SourceId[]): SourceId[] {
  const selected = (input ?? DEFAULT_SOURCE_SELECTION).filter((source) => SOURCE_IDS.includes(source));
  if (selected.length > 0) {
    return Array.from(new Set(selected));
  }
  return ["minzdrav"];
}

export function resolveSourcePolicy(
  sourceSelection: SourceId[],
  customPolicy?: Record<string, SourcePolicy>,
): Record<SourceId, SourcePolicy> {
  const policy: Record<SourceId, SourcePolicy> = { ...DEFAULT_SOURCE_POLICY };

  for (const source of SOURCE_IDS) {
    const override = customPolicy?.[source];
    if (override && (override === "LOCAL_ONLY" || override === "LOCAL_THEN_ONLINE" || override === "DISABLED")) {
      policy[source] = override;
    }
  }

  for (const source of SOURCE_IDS) {
    if (!sourceSelection.includes(source)) {
      policy[source] = "DISABLED";
    }
  }

  return policy;
}

export function sourceIsEnabled(policy: SourcePolicy): boolean {
  return policy !== "DISABLED";
}
