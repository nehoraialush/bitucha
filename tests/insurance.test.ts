import { describe, it, expect } from "vitest";
import {
  assessClaim,
  cancellationCredit,
  ageMonths,
  anniversary,
  Terms,
} from "../packages/domain/src/insurance";
const terms: Terms = {
  premiumCents: 120000,
  annualLimitCents: 100000,
  deductibleCents: 10000,
  reimbursementBps: 8000,
  waitingDays: 30,
  coverages: [{ code: "VISIT", name: "ביקור", limitCents: 70000 }],
};
const base = {
  terms,
  start: new Date("2026-01-01"),
  end: new Date("2027-01-01"),
  cancelledAt: null,
  event: new Date("2026-03-01"),
  availableCents: 100000,
  usedByCategory: {},
  lines: [{ category: "VISIT", costCents: 100000 }],
};
describe("מנוע כיסוי וכספים", () => {
  it("מחשב השתתפות ואחוז החזר באגורות", () =>
    expect(
      assessClaim({ ...base, lines: [{ category: "VISIT", costCents: 50000 }] })
        .approvedCents,
    ).toBe(32000));
  it("אינו מחיל השתתפות פעם נוספת לכל שורה", () =>
    expect(
      assessClaim({
        ...base,
        lines: [
          { category: "VISIT", costCents: 20000 },
          { category: "VISIT", costCents: 20000 },
        ],
      }).approvedCents,
    ).toBe(24000));
  it("מכבד תקרת משנה", () =>
    expect(assessClaim(base).approvedCents).toBe(70000));
  it("מכבד ניצול תקרת משנה קודם", () =>
    expect(
      assessClaim({ ...base, usedByCategory: { VISIT: 65000 } }).approvedCents,
    ).toBe(5000));
  it("מכבד יתרה שנתית זמינה", () =>
    expect(assessClaim({ ...base, availableCents: 500 }).approvedCents).toBe(
      500,
    ));
  it("דוחה בתקופת אכשרה", () =>
    expect(assessClaim({ ...base, event: new Date("2026-01-10") }).status).toBe(
      "REJECTED",
    ));
  it("מאשר בגבול סיום אכשרה", () =>
    expect(
      assessClaim({ ...base, event: new Date("2026-01-31") }).approvedCents,
    ).toBeGreaterThan(0));
  it("דוחה אירוע לפני תחילה", () =>
    expect(
      assessClaim({ ...base, event: new Date("2025-12-31") }).approvedCents,
    ).toBe(0));
  it("סוף תקופה לא כלול", () =>
    expect(
      assessClaim({ ...base, event: new Date("2027-01-01") }).approvedCents,
    ).toBe(0));
  it("ביטול אינו מוחק כיסוי לפני מועד הביטול", () =>
    expect(
      assessClaim({ ...base, cancelledAt: new Date("2026-04-01") })
        .approvedCents,
    ).toBe(70000));
  it("אירוע במועד ביטול נדחה", () =>
    expect(
      assessClaim({ ...base, cancelledAt: new Date("2026-03-01") })
        .approvedCents,
    ).toBe(0));
  it("קטגוריה שלא כלולה אינה מכוסה", () =>
    expect(
      assessClaim({
        ...base,
        lines: [{ category: "DENTAL", costCents: 50000 }],
      }).approvedCents,
    ).toBe(0));
  it("החרגה מחיתום חוסמת כיסוי", () =>
    expect(
      assessClaim({ ...base, excludedCategories: ["VISIT"] }).approvedCents,
    ).toBe(0));
  it("השעיה חוסמת כיסוי", () =>
    expect(assessClaim({ ...base, suspended: true }).approvedCents).toBe(0));
  it("שנה מעוברת אינה מוסיפה יום כיסוי", () =>
    expect(anniversary(new Date("2024-02-29")).toISOString().slice(0, 10)).toBe(
      "2025-02-28",
    ));
  it("גיל מחושב לפי יום בחודש", () =>
    expect(ageMonths(new Date("2025-01-20"), new Date("2026-01-19"))).toBe(11));
  it("זיכוי יחסי בתחילת תקופה מלא ובסוף אפס", () => {
    expect(cancellationCredit(120000, base.start, base.end, base.start)).toBe(
      120000,
    );
    expect(cancellationCredit(120000, base.start, base.end, base.end)).toBe(0);
  });
  it("אין ביטול מחוץ לתקופה", () =>
    expect(() =>
      cancellationCredit(120000, base.start, base.end, new Date("2025-01-01")),
    ).toThrow());
});
