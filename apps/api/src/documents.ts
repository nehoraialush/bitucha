import { Actor, need } from "./auth";
import {
  enrollmentDefinition,
  medicalDetails,
} from "../../../packages/domain/src/enrollment";
import { chromium } from "@playwright/test";
import { db } from "./db";
import { NotFoundException } from "@nestjs/common";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (v: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(
    v / 100,
  );
const statuses: Record<string, string> = {
  ACTIVE: "פעילה",
  QUOTED: "הצעה",
  CANCELLED: "מבוטלת",
  PAID: "שולמה",
  APPROVED: "אושרה",
  PARTIALLY_APPROVED: "אושרה חלקית",
  REJECTED: "נדחתה",
  NEEDS_INFORMATION: "נדרשת השלמה",
  UNDERWRITING_PENDING: "ממתינה לחיתום",
};
export async function authorizeDocument(actor: Actor, id: string) {
  const d = await db.document.findUnique({
    where: { id },
    select: { type: true },
  });
  if (!d) throw new NotFoundException("מסמך לא נמצא");
  if (
    [
      "APPLICATION",
      "HEALTH_DECLARATION",
      "UNDERWRITING",
      "SIMULATED_SIGNATURE",
    ].includes(d.type)
  )
    need(actor, "application.read");
}
export async function documentHtml(id: string) {
  const d = await db.document.findUnique({ where: { id } });
  if (!d) throw new NotFoundException("מסמך לא נמצא");
  const s = d.snapshot as any;
  const customer =
    s.customer ??
    (await db.customer.findUnique({ where: { id: d.customerId } }));
  const policy = s.policy ?? (d.type === "QUOTE" ? s : null);
  const claim = s.claim;
  const row = (label: string, v: unknown) =>
    `<tr><th>${escape(label)}</th><td>${escape(v)}</td></tr>`;
  let details =
    row("לקוח", customer?.name) +
    row("מספר לקוח", customer?.number) +
    row(
      "מועד הפקה",
      d.createdAt.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }),
    );
  if (policy) {
    details +=
      row("מספר פוליסה", policy.number) +
      row("מצב", statuses[policy.status] || policy.status) +
      row("תחילת תקופה", String(policy.startDate).slice(0, 10)) +
      row("סיום תקופה", String(policy.endDate).slice(0, 10)) +
      row("פרמיה שנתית", money(policy.premiumCents)) +
      row("תקרה שנתית", money(policy.annualLimitCents));
  }
  if (policy?.exclusions?.length)
    details += row(
      "כיסויים מוחרגים",
      policy.exclusions
        .map(
          (code: string) =>
            policy.snapshot.coverages.find((c: any) => c.code === code)?.name ||
            "כיסוי מוחרג",
        )
        .join(", "),
    );
  if (s.pet) details += row("בעל חיים", s.pet.name) + row("גזע", s.pet.breed);
  if (claim)
    details +=
      row("מספר תביעה", claim.number) +
      row("החלטה", statuses[claim.status] || claim.status) +
      row("אבחנה", claim.diagnosis) +
      row("סכום מאושר", money(claim.approvedCents));
  if (s.reason) details += row("נימוק", s.reason);
  if (s.amountCents != null) details += row("סכום", money(s.amountCents));
  if (s.creditCents != null)
    details += row("זיכוי ביטול", money(s.creditCents));
  if (s.refundDueCents != null)
    details += row("החזר שטרם בוצע", money(s.refundDueCents));
  if (s.renewedFromNumber)
    details += row("חידוש של פוליסה מספר", s.renewedFromNumber);
  const terms = s.terms ?? policy?.snapshot;
  if (terms)
    details +=
      row("תקופת אכשרה", `${terms.waitingDays} ימים`) +
      row("השתתפות עצמית לאירוע", money(terms.deductibleCents)) +
      row("שיעור החזר", `${terms.reimbursementBps / 100}%`);
  const lines = s.calculation?.lines || [];
  const treatments = lines.length
    ? `<h2>פירוט טיפול וחישוב</h2><table><tr><th>כיסוי</th><th>נתבע</th><th>מאושר</th><th>נימוק</th></tr>${lines.map((l: any) => `<tr><td>${escape(terms?.coverages?.find((c: any) => c.code === l.category)?.name || "טיפול שאינו כלול בכיסוי")}</td><td>${escape(money(l.costCents))}</td><td>${escape(money(l.approvedCents))}</td><td>${escape(l.reason)}</td></tr>`).join("")}</table>`
    : "";
  let enrollment = "";
  if (s.steps) {
    const selected: Record<string, number[]> = {
      APPLICATION: [1, 2, 3, 4, 9, 10, 11, 13, 14, 15, 16, 17],
      HEALTH_DECLARATION: [3, 5, 6, 7, 8, 13],
      UNDERWRITING: [4, 11, 12],
      POLICY: [9, 10, 12, 15],
      SIMULATED_SIGNATURE: [13, 16],
      RENEWAL_CONFIRMATION: [9, 12, 15, 17],
    };
    for (const step of s.steps) {
      if (!(selected[d.type] || []).includes(step.number)) continue;
      const def = enrollmentDefinition(step.definitionVersion)[step.number - 1];
      const answers = step.answers;
      const display = (v: unknown) =>
        typeof v === "boolean" ? (v ? "כן" : "לא") : v;
      let rows = def.fields
        .map((f) => row(f.label, display(answers[f.key])))
        .join("");
      for (const q of def.questions || []) {
        const a = answers[q.key];
        rows += row(q.label, display(a?.value));
        if (a?.value)
          for (const f of medicalDetails)
            rows += row(f.label, display(a[f.key]));
      }
      for (const [i, r] of (answers.records || []).entries()) {
        rows += row("רשומה", i + 1);
        for (const f of def.repeat || [])
          rows += row(f.label, display(r[f.key]));
      }
      if (answers.evaluation)
        rows += row("תוצאת בדיקה", answers.evaluation.reason);
      if (answers.reason) rows += row("נימוק החלטה", answers.reason);
      if (answers.excludedCategories)
        rows += row("כיסויים מוחרגים", answers.excludedCategories.join(", "));
      if (answers.declarationTexts)
        for (const text of answers.declarationTexts)
          rows += row("הצהרה v" + answers.declarationVersion, text.label);
      if (answers.signedAt)
        rows +=
          row("מועד חתימה מדומה", answers.signedAt) +
          row("טביעת מסמך חתום", answers.documentHash);
      enrollment += `<h2>${escape(def.title)} · גרסת תשובות ${escape(step.revision)}</h2><table>${rows}</table>`;
    }
    if (s.schedule)
      enrollment += `<h2>לוח חיובים</h2><table><tr><th>מספר</th><th>תאריך</th><th>סכום</th></tr>${s.schedule.map((i: any) => `<tr><td>${escape(i.position)}</td><td>${escape(i.dueAt)}</td><td>${escape(money(i.amountCents))}</td></tr>`).join("")}</table>`;
    if (s.signature?.strokes)
      enrollment += `<h2>חתימה מצוירת מדומה</h2><svg viewBox="0 0 800 220" width="500" height="138" aria-label="חתימה מדומה">${s.signature.strokes.map((stroke: number[][]) => `<polyline fill="none" stroke="#17283e" stroke-width="2" points="${stroke.map((p) => p.map((n) => (Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : 0)).join(",")).join(" ")}"/>`).join("")}</svg>`;
  }
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>${escape(d.title)}</title><style>body{font:15px Arial,sans-serif;color:#17283e;padding:32px;direction:rtl}h1{font-size:26px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:right;padding:12px;border-bottom:1px solid #ddd}th{width:30%;background:#f2f5f8}footer{margin-top:40px;font-size:12px;color:#555}tr{break-inside:avoid}</style><body><header>ביטוחה · מערכת סימולציה</header><h1>${escape(d.title)}</h1><p>מסמך מספר ${d.number}</p><table>${details}</table>${treatments}${enrollment}<footer>מסמך פיתוח עם נתונים בדויים בלבד. אינו מסמך ביטוח מחייב.${d.signedAt ? " חתימה מדומה נרשמה בתאריך " + escape(d.signedAt.toISOString().slice(0, 10)) + ". אין אימות משפטי לחתימה." : ""}</footer></body></html>`;
}
export async function documentPdf(id: string) {
  const html = await documentHtml(id);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm" },
    });
  } finally {
    await browser.close();
  }
}
