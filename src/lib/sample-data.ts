import type { CaseInput } from "@/lib/types";

export const sampleCaseInput: CaseInput = {
  diagnosis: "Рак молочной железы, трижды негативный подтип",
  stage: "IV",
  sex: "female",
  age: 54,
  histology: "Инвазивная карцинома молочной железы",
  biomarkers: ["ER 0", "PR 0", "HER2 negative", "PD-L1 CPS 10"],
  comorbidities: ["Артериальная гипертензия"],
  prior_surgeries: ["Секторальная резекция молочной железы"],
  radiation_history: [],
  labs: {
    "Hb": "121 г/л",
    "ALT": "26 Ед/л",
  },
  contraindications: [],
  as_of_date: "2025-03-10",
  current_plan: [
    "ПХТ паклитаксел + карбоплатин",
    "Контроль по ПЭТ-КТ",
    "Рассмотреть смену линии терапии при прогрессировании",
  ],
  timeline: [
    {
      event_date: "2021-09-01",
      event_type: "line_1_start",
      payload: {
        therapy: "Паклитаксел + Карбоплатин",
        intent: "systemic",
      },
    },
    {
      event_date: "2022-03-16",
      event_type: "progression",
      payload: {
        source: "ПЭТ-КТ",
        note: "Отрицательная динамика",
      },
    },
    {
      event_date: "2023-05-29",
      event_type: "tumor_board",
      payload: {
        recommendation: "Иксабепилон + капецитабин",
      },
    },
  ],
};
