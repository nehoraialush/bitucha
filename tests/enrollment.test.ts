import { describe, it, expect } from "vitest";
import {
  enrollmentSteps,
  validateStep,
  latestSteps,
  paymentSchedule,
  medicalQuestions,
  bodySystems,
  compactBodySystems,
  bodySystemCategories,
  enrollmentDefinition,
} from "../packages/domain/src/enrollment";
describe("Versioned enrollment rules", () => {
  it("defines all 18 sequential steps without duplicate identifiers", () => {
    expect(enrollmentSteps.map((s) => s.number)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    for (const s of enrollmentSteps)
      expect(new Set(s.fields.map((f) => f.key)).size).toBe(s.fields.length);
  });
  it("requires all questionnaire answers and conditional medical detail", () => {
    const a = Object.fromEntries(
      medicalQuestions.map((q) => [q.key, { value: false }]),
    );
    expect(validateStep(5, a)).toEqual([]);
    a.illness = { value: true };
    expect(validateStep(5, a).join(" ")).toContain("אבחנה");
    expect(validateStep(5, {}).length).toBe(16);
  });
  it("rejects impossible dates and chip formats", () => {
    const fields = {
      name: "חיה",
      species: "DOG",
      breed: "מעורב",
      mixed: true,
      sex: "MALE",
      birthDate: "2025-02-30",
      weight: 5,
      neutered: false,
      use: "COMPANION",
      residence: "בית",
      chip: "123",
    };
    expect(validateStep(3, fields).join(" ")).toContain("תאריך");
    expect(validateStep(3, fields).join(" ")).toContain("שבב");
  });
  it("requires consent rather than a false boolean", () => {
    expect(validateStep(11, { accepted: false })).not.toEqual([]);
    expect(validateStep(11, { accepted: true })).toEqual([]);
  });
  it("validates signature coordinates and nonempty strokes", () => {
    const a = {
      signerName: "לקוח",
      signerRole: "POLICYHOLDER",
      accepted: true,
      strokes: [
        [
          [0, 0],
          [5, 5],
        ],
      ],
    };
    expect(validateStep(16, a)).toEqual([]);
    expect(
      validateStep(16, {
        ...a,
        strokes: [
          [
            [0, 0],
            [1001, 5],
          ],
        ],
      }),
    ).not.toEqual([]);
  });
  it("retains invalidation revisions instead of resurrecting earlier completions", () => {
    expect(
      latestSteps([
        { number: 1, revision: 1, completed: true },
        { number: 1, revision: 2, completed: false },
      ])[1].completed,
    ).toBe(false);
  });
  it("allocates exact cents and clips monthly due dates without drifting", () => {
    const s = paymentSchedule(10001, "MONTHLY", "2026-01-31");
    expect(s.reduce((n, x) => n + x.amountCents, 0)).toBe(10001);
    expect(s[1].dueAt).toBe("2026-02-28");
    expect(s[2].dueAt).toBe("2026-03-31");
    expect(paymentSchedule(10001, "ANNUAL", "2026-01-31")).toHaveLength(1);
  });
  it("keeps the original questionnaire definition for old drafts", () => {
    expect(bodySystemCategories).toHaveLength(20);
    expect(bodySystems).toHaveLength(60);
    const legacy = enrollmentDefinition(1)[5];
    expect(legacy.questions).toHaveLength(20);
    const a = Object.fromEntries(
      legacy.questions!.map((q) => [q.key, { value: false }]),
    );
    expect(validateStep(6, a, 1)).toEqual([]);
    expect(validateStep(6, a, 2)).toHaveLength(40);
  });
  it("uses eight focused body-system questions in v4 without changing old declarations", () => {
    expect(enrollmentDefinition(4)[5].questions).toEqual(compactBodySystems);
    expect(compactBodySystems).toHaveLength(8);
    expect(enrollmentDefinition(3)[5].questions).toHaveLength(60);
    expect(enrollmentDefinition(3)[8].fields).toHaveLength(1);
    expect(
      validateStep(9, { productId: "p", noClaims: true }, 4).join(" "),
    ).toContain("אישור היעדר תביעות");
    expect(validateStep(9, { productId: "p", noClaims: false }, 4)).toEqual([]);
  });
});
