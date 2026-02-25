import { describe, expect, it } from "vitest";
import { prepareCaseText, suggestCaseFromText } from "@/lib/case-parser";

describe("case parser", () => {
  it("anonymizes FIO and date of birth before extraction", () => {
    const prepared = prepareCaseText("ФИО: Иванов Иван Иванович\nДата рождения: 01.02.1974\nДиагноз: рак желудка");
    expect(prepared.anonymized).toBe(true);
    expect(prepared.redactedFioCount).toBeGreaterThan(0);
    expect(prepared.text).toContain("[ФИО УДАЛЕНО]");
    expect(prepared.text).toContain("[ДАТА РОЖДЕНИЯ УДАЛЕНА]");
    expect(prepared.excluded_personal_data.some((item) => item.type === "fio")).toBe(true);
    expect(prepared.excluded_personal_data.some((item) => item.type === "date_of_birth")).toBe(true);
    expect(prepared.privacy_notice.length).toBeGreaterThan(10);
  });

  it("extracts key fields from russian case text", () => {
    const input = `
ФИО: Иванов Иван Иванович
Дата рождения: 01.02.1974
Пол: мужской
Диагноз: Рак пищеводно-желудочного перехода C16.0, стадия IV с поражением лимфоузлов
TNM: pT3N2M0
Гистологическое заключение: аденокарцинома
HER2-статус 1+
PD-L1 CPS=8
MSI: MSS
вес 75 кг
рост 176 см
ECOG 1
сопутствующие заболевания: тромбоз воротной вены
аллергия на таксаны
нейтрофилы 3.5
тромбоциты 200
гемоглобин 120
общий билирубин 15
АЛТ 40
АСТ 30
креатинин 80
альбумин 40
МНО 1.2
КТ от 01.02.2025
Прогрессирование заболевания
мтс в печень
Решение: рекомендовано проведение химиотаргетной терапии
Решение консилиума от 03.02.2025
по схеме: рамуцирумаб + иринотекан
рамуцирумаб 8 мг/кг в/в в 1,15 дни, каждые 28 дней
иринотекан 150 мг/м² в/в в 1,15 дни, каждые 28 дней
1 линия: XELOX с 24.03.2023 по 13.06.2023, прогрессирование
    `.trim();

    const parsed = suggestCaseFromText(input);
    expect(parsed.sex).toBe("male");
    expect(parsed.age).toBe(51);
    expect(parsed.weight_kg).toBe(75);
    expect(parsed.height_cm).toBe(176);
    expect(parsed.bsa_m2).toBeCloseTo(1.9, 1);
    expect(parsed.ecog).toBe(1);
    expect(parsed.icd10_code).toBe("C16.0");
    expect(parsed.icd10_name_ru?.length).toBeGreaterThan(5);
    expect(parsed.nosology_label_ru?.length).toBeGreaterThan(5);
    expect(parsed.stage_numeric).toBe(4);
    expect(parsed.stage_raw).toBe("IV");
    expect(parsed.stage).toBe("4");
    expect(parsed.tnm).toBe("PT3N2M0");
    expect(parsed.pd_l1_cps).toBe(8);
    expect(parsed.last_imaging_date).toBe("2025-02-01");
    expect(parsed.protocol_assignment_date).toBe("2025-02-03");
    expect(parsed.treatment_goal?.toLowerCase()).toContain("химиотаргет");
    expect(parsed.planned_drugs?.length).toBeGreaterThan(0);
    expect(parsed.treatment_history?.length).toBeGreaterThan(0);
    expect(parsed.allergies?.join(" ").toLowerCase()).toContain("аллерг");
  });

  it("cuts historical tail from diagnosis and normalizes stage from 'IIА ст.'", () => {
    const input = `
Диагноз: Рак левой молочной железы сT2N0М0, IIА ст. Трижды негативный подтип. НАПХТ 4АС + 12P и хирургическое лечение в 2017. Прогрессирование от 08.2021.
МКБ-10: C50.1
Рекомендовано: наблюдение у онколога.
    `.trim();

    const parsed = suggestCaseFromText(input);
    expect(parsed.diagnosis).toContain("Рак левой молочной железы");
    expect(parsed.diagnosis).toContain("Трижды негативный подтип");
    expect(parsed.diagnosis).not.toContain("НАПХТ");
    expect(parsed.diagnosis).not.toContain("Прогрессирование");
    expect(parsed.stage_numeric).toBe(2);
    expect(parsed.stage).toBe("2");
    expect(parsed.stage_raw.toUpperCase()).toContain("II");
    expect(parsed.icd10_code).toBe("C50.1");
  });
});
