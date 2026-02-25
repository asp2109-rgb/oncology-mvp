import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

afterEach(() => {
  for (const filePath of cleanup.splice(0, cleanup.length)) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  }
});

async function seedBaselineGuideline() {
  const {
    initDb,
    upsertGuideline,
    replaceGuidelineSections,
    replaceRecommendationChunks,
    withTransaction,
  } = await import("@/lib/db");

  initDb();

  await withTransaction(async () => {
    await upsertGuideline({
      id: "574_1",
      code: 574,
      version: 1,
      name: "Рак желудка",
      publish_date: "2020-04-09T00:00:00",
      status: 0,
      apply_status: "Применяется",
      source_url: "https://cr.minzdrav.gov.ru/preview-cr/574_1",
      pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=574_1",
      is_oncology: 1,
    });

    await replaceGuidelineSections("574_1", [
      {
        guideline_id: "574_1",
        section_id: "doc_3",
        section_title: "Лечение",
        section_html: "<p>Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение</p>",
        section_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
      },
    ]);

    await replaceRecommendationChunks("574_1", [
      {
        chunk_id: "574_1:doc_3:1",
        guideline_id: "574_1",
        section_id: "doc_3",
        chunk_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
        tags: ["recommendation", "chemotherapy", "surgery"],
        evidence_level: "A",
        source_anchor: "Лечение",
      },
    ]);
  });
}

async function seedGuidelinesWithModernVersion() {
  const {
    initDb,
    upsertGuideline,
    replaceGuidelineSections,
    replaceRecommendationChunks,
    withTransaction,
  } = await import("@/lib/db");

  initDb();

  await withTransaction(async () => {
    await upsertGuideline({
      id: "574_1",
      code: 574,
      version: 1,
      name: "Рак желудка",
      publish_date: "2020-04-09T00:00:00",
      status: 0,
      apply_status: "Применяется",
      source_url: "https://cr.minzdrav.gov.ru/preview-cr/574_1",
      pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=574_1",
      is_oncology: 1,
    });

    await upsertGuideline({
      id: "574_2",
      code: 574,
      version: 2,
      name: "Рак желудка",
      publish_date: "2024-06-01T00:00:00",
      status: 0,
      apply_status: "Применяется",
      source_url: "https://cr.minzdrav.gov.ru/preview-cr/574_2",
      pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=574_2",
      is_oncology: 1,
    });

    await replaceGuidelineSections("574_1", [
      {
        guideline_id: "574_1",
        section_id: "doc_3",
        section_title: "Лечение",
        section_html: "<p>Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение</p>",
        section_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
      },
    ]);

    await replaceGuidelineSections("574_2", [
      {
        guideline_id: "574_2",
        section_id: "doc_3",
        section_title: "Лечение",
        section_html: "<p>Рекомендуется экспериментальный режим Y для современной практики</p>",
        section_text: "Рекомендуется экспериментальный режим Y для современной практики",
      },
    ]);

    await replaceRecommendationChunks("574_1", [
      {
        chunk_id: "574_1:doc_3:1",
        guideline_id: "574_1",
        section_id: "doc_3",
        chunk_text: "Рекомендуется периоперационная химиотерапия FLOT и хирургическое лечение",
        tags: ["recommendation", "chemotherapy", "surgery"],
        evidence_level: "A",
        source_anchor: "Лечение",
      },
    ]);

    await replaceRecommendationChunks("574_2", [
      {
        chunk_id: "574_2:doc_3:1",
        guideline_id: "574_2",
        section_id: "doc_3",
        chunk_text: "Рекомендуется экспериментальный режим Y для современной практики",
        tags: ["recommendation", "experimental"],
        evidence_level: "B",
        source_anchor: "Лечение",
      },
    ]);
  });
}

async function seedCrossNosologyGuidelines() {
  const {
    initDb,
    upsertGuideline,
    replaceGuidelineSections,
    replaceRecommendationChunks,
    withTransaction,
  } = await import("@/lib/db");

  initDb();

  await withTransaction(async () => {
    await upsertGuideline({
      id: "379_4",
      code: 379,
      version: 4,
      name: "Рак молочной железы",
      publish_date: "2021-01-28T00:00:00",
      status: 0,
      apply_status: "Применяется",
      source_url: "https://cr.minzdrav.gov.ru/preview-cr/379_4",
      pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=379_4",
      is_oncology: 1,
    });

    await upsertGuideline({
      id: "355_5",
      code: 355,
      version: 5,
      name: "Рак поджелудочной железы",
      publish_date: "2025-01-23T16:31:25.343",
      status: 0,
      apply_status: "Применяется",
      source_url: "https://cr.minzdrav.gov.ru/preview-cr/355_5",
      pdf_url: "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrecPdf&id=355_5",
      is_oncology: 1,
    });

    await replaceGuidelineSections("379_4", [
      {
        guideline_id: "379_4",
        section_id: "doc_3",
        section_title: "Лечение",
        section_html: "<p>Для рака молочной железы возможна ПХТ паклитаксел + карбоплатин.</p>",
        section_text: "Для рака молочной железы возможна ПХТ паклитаксел + карбоплатин.",
      },
    ]);
    await replaceGuidelineSections("355_5", [
      {
        guideline_id: "355_5",
        section_id: "doc_3",
        section_title: "Лечение",
        section_html: "<p>Для рака поджелудочной железы рассматривается схема с платиной.</p>",
        section_text: "Для рака поджелудочной железы рассматривается схема с платиной.",
      },
    ]);

    await replaceRecommendationChunks("379_4", [
      {
        chunk_id: "379_4:doc_3:1",
        guideline_id: "379_4",
        section_id: "doc_3",
        chunk_text: "Для рака молочной железы возможна ПХТ паклитаксел + карбоплатин.",
        tags: ["recommendation", "chemotherapy"],
        evidence_level: "A",
        source_anchor: "Лечение",
      },
    ]);
    await replaceRecommendationChunks("355_5", [
      {
        chunk_id: "355_5:doc_3:1",
        guideline_id: "355_5",
        section_id: "doc_3",
        chunk_text: "Для рака поджелудочной железы рассматривается схема с платиной.",
        tags: ["recommendation", "chemotherapy"],
        evidence_level: "A",
        source_anchor: "Лечение",
      },
    ]);
  });
}

describe("rule engine", () => {
  it("finds matches and mismatches for case plan", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-rules-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();

    const { validateCase } = await import("@/lib/validation/rule-engine");
    await seedBaselineGuideline();

    const result = await validateCase({
      diagnosis: "Рак желудка",
      stage: "III",
      sex: "unknown",
      age: null,
      histology: "",
      biomarkers: [],
      comorbidities: [],
      prior_surgeries: [],
      radiation_history: [],
      labs: {},
      contraindications: [],
      as_of_date: "2021-03-01",
      current_plan: ["Периоперационная химиотерапия FLOT", "Гомеопатия"],
      timeline: [],
    }, {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      online_fallback: false,
      retrieval_mode: "standard",
    });

    expect(result.matches).toContain("Периоперационная химиотерапия FLOT");
    expect(result.mismatches).toContain("Гомеопатия");
    expect(result.status).toBe("review_required");
    expect(result.applied_guideline_versions.length).toBeGreaterThan(0);
    expect(result.retrieval_mode_used).toBeDefined();
    expect(result.source_coverage.length).toBeGreaterThan(0);
    expect(result.validation_run_id).toBeTruthy();
    expect(result.rag_query_context).toContain("План (блок 5)");
    expect(result.warnings.some((item) => item.includes("Блок 5 заполнен неполно"))).toBe(true);
  });

  it("adds conflicts and missing actions from clinical constraints", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-rules-clinical-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();

    const { validateCase } = await import("@/lib/validation/rule-engine");
    await seedBaselineGuideline();

    const result = await validateCase({
      diagnosis: "Рак желудка",
      stage: "IV",
      sex: "male",
      age: 61,
      ecog: 2,
      histology: "аденокарцинома",
      biomarkers: ["HER2 1+"],
      allergies: ["аллергия на таксаны"],
      comorbidities: ["тромбоз воротной вены"],
      complications: ["асцит"],
      prior_surgeries: [],
      radiation_history: [],
      labs: {},
      neutrophils_abs: 1.2,
      platelets: 92,
      bilirubin_total: 28,
      contraindications: [],
      treatment_history: [
        {
          line: 1,
          regimen: "XELOX",
          start_date: "2023-03-24",
          end_date: "2023-06-13",
          best_response: "прогрессирование",
          stop_reason: "прогрессирование",
        },
      ],
      current_plan: ["рамуцирумаб + паклитаксел"],
      treatment_goal: "паллиативное лечение",
      regimen_protocol: "рамуцирумаб + паклитаксел",
      planned_therapy_line: 1,
      planned_drugs: [
        {
          name: "рамуцирумаб",
          dose_value: 8,
          dose_unit: "мг/кг",
        },
        {
          name: "паклитаксел",
          dose_value: 80,
          dose_unit: "мг/м²",
        },
      ],
      as_of_date: "2025-03-10",
      timeline: [],
    }, {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      online_fallback: false,
      retrieval_mode: "standard",
    });

    expect(result.status).toBe("review_required");
    expect(result.conflicts.some((item) => item.toLowerCase().includes("аллерг"))).toBe(true);
    expect(result.conflicts.some((item) => item.toLowerCase().includes("тромбоз"))).toBe(true);
    expect(result.conflicts.some((item) => item.toLowerCase().includes("нейтрофил"))).toBe(true);
    expect(result.conflicts.some((item) => item.toLowerCase().includes("тромбоц"))).toBe(true);
    expect(result.missing_actions.some((item) => item.toLowerCase().includes("вес"))).toBe(true);
    expect(result.missing_actions.some((item) => item.toLowerCase().includes("рост"))).toBe(true);
    expect(result.rag_query_context).toContain("Биомаркеры");
    expect(result.warnings.some((item) => item.includes("Блок 5 заполнен неполно"))).toBe(false);
  });

  it("uses retrospective event date to select historical guideline version", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-rules-retro-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();

    const { validateCase } = await import("@/lib/validation/rule-engine");
    await seedGuidelinesWithModernVersion();

    const result = await validateCase({
      diagnosis: "Рак желудка",
      stage: "III",
      sex: "unknown",
      age: null,
      histology: "",
      biomarkers: [],
      comorbidities: [],
      prior_surgeries: [],
      radiation_history: [],
      labs: {},
      contraindications: [],
      as_of_date: "2025-03-01",
      current_plan: ["Периоперационная химиотерапия FLOT"],
      timeline: [
        {
          event_date: "2021-04-15",
          event_type: "therapy",
          payload: {
            note: "Назначена периоперационная химиотерапия FLOT",
          },
        },
      ],
    }, {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      online_fallback: false,
      retrieval_mode: "standard",
    });

    expect(result.status).toBe("compliant");
    expect(result.matches).toContain("Периоперационная химиотерапия FLOT");
    expect(result.applied_guideline_versions.map((item) => item.id)).toContain("574_1");
    expect(result.applied_guideline_versions.map((item) => item.id)).not.toContain("574_2");
    expect(result.evidence.some((hit) => hit.guideline_id === "574_2")).toBe(false);
  });

  it("filters applied guidelines by nosology and avoids cross-site evidence", async () => {
    const dbPath = path.join(os.tmpdir(), `onco-rules-nosology-${Date.now()}.db`);
    process.env.ONCO_DB_PATH = dbPath;
    cleanup.push(dbPath, `${dbPath}-shm`, `${dbPath}-wal`);

    vi.resetModules();

    const { validateCase } = await import("@/lib/validation/rule-engine");
    await seedCrossNosologyGuidelines();

    const result = await validateCase({
      diagnosis:
        "Рак левой молочной железы сT2N0M0, IIА ст. Трижды негативный подтип. НАПХТ 4АС + 12P в 2017.",
      stage: "2",
      stage_numeric: 2,
      stage_raw: "IIА",
      sex: "female",
      age: 52,
      histology: "",
      biomarkers: [],
      icd10_code: "C50.1",
      icd10_name_ru: "Центральной части молочной железы",
      nosology_label_ru: "Злокачественное новообразование молочной железы",
      comorbidities: [],
      prior_surgeries: [],
      radiation_history: [],
      labs: {},
      contraindications: [],
      as_of_date: "2026-01-01",
      regimen_protocol: "ПХТ паклитаксел + карбоплатин",
      current_plan: ["ПХТ паклитаксел + карбоплатин"],
      timeline: [],
    }, {
      source_selection: ["minzdrav"],
      source_policy: {
        minzdrav: "LOCAL_ONLY",
      },
      online_fallback: false,
      retrieval_mode: "standard",
    });

    const appliedNames = result.applied_guideline_versions.map((item) => item.name.toLowerCase());
    expect(appliedNames.some((name) => name.includes("молоч"))).toBe(true);
    expect(appliedNames.some((name) => name.includes("поджелуд"))).toBe(false);
    expect(result.evidence.some((hit) => hit.guideline_name.toLowerCase().includes("поджелуд"))).toBe(false);
  });
});
