export type Coverage = { code: string; name: string; limitCents: number };
export type Terms = {
  premiumCents: number;
  annualLimitCents: number;
  deductibleCents: number;
  reimbursementBps: number;
  waitingDays: number;
  coverages: Coverage[];
};
export type Line = { category: string; costCents: number };
export const day = 86_400_000;
export function ageMonths(birth: Date, at: Date): number {
  return (
    (at.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    at.getUTCMonth() -
    birth.getUTCMonth() -
    (at.getUTCDate() < birth.getUTCDate() ? 1 : 0)
  );
}
export function anniversary(start: Date): Date {
  const result = new Date(start);
  result.setUTCFullYear(start.getUTCFullYear() + 1);
  if (result.getUTCMonth() !== start.getUTCMonth()) result.setUTCDate(0);
  return result;
}
export function assessClaim(input: {
  terms: Terms;
  start: Date;
  end: Date;
  cancelledAt: Date | null;
  event: Date;
  availableCents: number;
  usedByCategory: Record<string, number>;
  excludedCategories?: string[];
  suspended?: boolean;
  lines: Line[];
}) {
  let deductible = input.terms.deductibleCents;
  let remaining = Math.max(0, input.availableCents);
  const categoryRemaining = new Map(
    input.terms.coverages.map((c) => [
      c.code,
      Math.max(0, c.limitCents - (input.usedByCategory[c.code] || 0)),
    ]),
  );
  const invalidPeriod =
    input.event < input.start ||
    input.event >= input.end ||
    (input.cancelledAt !== null && input.event >= input.cancelledAt);
  const waiting =
    input.event.getTime() <
    input.start.getTime() + input.terms.waitingDays * day;
  const lines = input.lines.map((line) => {
    if (invalidPeriod)
      return { ...line, approvedCents: 0, reason: "האירוע מחוץ לתקופת הכיסוי" };
    if (input.suspended)
      return {
        ...line,
        approvedCents: 0,
        reason: "האירוע בתקופת השעיית כיסוי",
      };
    if (input.excludedCategories?.includes(line.category))
      return { ...line, approvedCents: 0, reason: "הכיסוי הוחרג בהחלטת חיתום" };
    if (waiting)
      return { ...line, approvedCents: 0, reason: "האירוע בתקופת אכשרה" };
    if (!categoryRemaining.has(line.category))
      return { ...line, approvedCents: 0, reason: "הטיפול אינו כלול בכיסוי" };
    const share = Math.min(deductible, line.costCents);
    deductible -= share;
    const payable = Math.floor(
      ((line.costCents - share) * input.terms.reimbursementBps) / 10000,
    );
    const amount = Math.min(
      payable,
      remaining,
      categoryRemaining.get(line.category)!,
    );
    remaining -= amount;
    categoryRemaining.set(
      line.category,
      categoryRemaining.get(line.category)! - amount,
    );
    return {
      ...line,
      approvedCents: amount,
      reason:
        amount === 0
          ? "השתתפות עצמית או תקרה מיצו את הזכאות"
          : amount < line.costCents
            ? "אישור חלקי לפי השתתפות עצמית, שיעור החזר ותקרות"
            : "אושר",
    };
  });
  const approvedCents = lines.reduce((sum, l) => sum + l.approvedCents, 0);
  const requestedCents = lines.reduce((sum, l) => sum + l.costCents, 0);
  return {
    lines,
    approvedCents,
    status:
      approvedCents === 0
        ? "REJECTED"
        : approvedCents < requestedCents
          ? "PARTIALLY_APPROVED"
          : "APPROVED",
  };
}
export function cancellationCredit(
  premium: number,
  start: Date,
  end: Date,
  cancel: Date,
) {
  if (cancel < start || cancel > end) throw new Error("מועד ביטול מחוץ לתקופה");
  return Math.floor(
    (premium * Math.max(0, end.getTime() - cancel.getTime())) /
      (end.getTime() - start.getTime()),
  );
}
