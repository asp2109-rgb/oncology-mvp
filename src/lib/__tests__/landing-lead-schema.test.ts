import { describe, expect, it } from "vitest";
import { landingLeadRequestSchema } from "@/lib/types";

describe("landingLeadRequestSchema", () => {
  it("accepts a valid lead payload", () => {
    const parsed = landingLeadRequestSchema.safeParse({
      full_name: "Ирина Петрова",
      work_email: "director@clinic.ru",
      clinic_name: "ГКБ №1",
      role: "Заместитель главврача",
      monthly_cases: 240,
      message: "Нужен пилот для трёх отделений",
      consent: true,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects payload without consent", () => {
    const parsed = landingLeadRequestSchema.safeParse({
      full_name: "Ирина Петрова",
      work_email: "director@clinic.ru",
      clinic_name: "ГКБ №1",
      role: "Заместитель главврача",
      monthly_cases: 240,
      consent: false,
    });

    expect(parsed.success).toBe(false);
  });
});
