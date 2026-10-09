import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { InsuranceService } from "./service";
import { Actor, need, actorPermissions } from "./auth";
import {
  enrollmentDefinition,
  medicalDetails,
} from "../../../packages/domain/src/enrollment";
import { chromium } from "@playwright/test";
import { db } from "./db";
import { NotFoundException } from "@nestjs/common";
export const escape = (v: unknown) =>
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
const bytesHash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export async function documentHtml(id: string) {
  const saved = await db.documentArtifact.findUnique({
    where: { documentId: id },
  });
  if (saved?.html) {
    if (bytesHash(saved.html) !== saved.htmlHash)
      throw new ConflictException("בדיקת שלמות המסמך נכשלה");
    return saved.html;
  }

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
        .filter(
          (f) =>
            ![
              "customerId",
              "petId",
              "productId",
              "attachmentId",
              "noClaimsAttachmentId",
            ].includes(f.key),
        )
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
  const coverageRows =
    terms?.coverages
      ?.map(
        (c: any) =>
          `<tr><td>${escape(c.name)}</td><td>${escape(money(c.limitCents))}</td><td>${escape((policy?.exclusions || []).includes(c.code) ? "מוחרג לפי החלטת חיתום" : "כלול לפי התנאים")}</td></tr>`,
      )
      .join("") || "";
  const coverages = coverageRows
    ? `<h2>רשימת הכיסויים וגבולות האחריות</h2><table class="coverage-table"><thead><tr><th>פרק / כיסוי</th><th>תקרת משנה</th><th>תנאי כיסוי</th></tr></thead><tbody>${coverageRows}</tbody></table><p class="document-note">תקרות המשנה כפופות לתקרה השנתית הכוללת, להשתתפות העצמית, לשיעור ההחזר, לאכשרה ולהחרגות המפורטות במסמך. הסכומים בשקלים חדשים.</p>`
    : "";
  const contents = `<section class="document-summary"><h2>פרטי התיק והתקופה</h2><table>${details}</table></section>${coverages}${treatments}${enrollment}`;
  return professionalHtml(
    d.title,
    String(d.number),
    contents,
    d.createdAt,
    s.signature?.bundleHash || s.signature?.documentHash,
    d.signedAt
      ? `חתימה מדומה נרשמה על ידי ${d.signedBy || ""} בתאריך ${d.signedAt.toISOString().slice(0, 10)}`
      : undefined,
  );
}
export async function documentPdf(id: string) {
  await enqueueDocument(id);
  void processDocumentArtifact(id).catch(() => {});
  for (let attempt = 0; attempt < 120; attempt++) {
    const artifact = await db.documentArtifact.findUnique({
      where: { documentId: id },
    });
    if (artifact?.status === "READY" && artifact.content) {
      if (bytesHash(artifact.content) !== artifact.pdfHash)
        throw new ConflictException("בדיקת שלמות PDF נכשלה");
      return Buffer.from(artifact.content);
    }
    if (artifact?.status === "FAILED")
      throw new ServiceUnavailableException(
        "הפקת PDF נכשלה. ניתן לבקש ניסיון חוזר במרכז המסמכים",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new ServiceUnavailableException(
    "המסמך עדיין בתהליך הפקה. נסו שוב בעוד מספר שניות",
  );
}
export async function htmlPdf(html: string) {
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
      margin: { top: "12mm", bottom: "20mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font:9px Arial;text-align:center;color:#68758b;direction:rtl">ביטוחה · מסמך סימולציה | עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
}

export function professionalHtml(
  title: string,
  number: string,
  contents: string,
  createdAt: Date,
  contentHash?: string,
  signed?: string,
) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>
 @page{size:A4}*{box-sizing:border-box}body{margin:0;color:#172641;background:#fff;font:12px Arial,"Noto Sans Hebrew",sans-serif;line-height:1.7;direction:rtl;padding:12px 16px}header.document-header{display:flex;justify-content:space-between;align-items:start;border-bottom:3px solid #17345c;padding:12px 0 18px}.wordmark{font-size:34px;font-weight:800;color:#17345c;letter-spacing:-1px}.wordmark small{display:block;letter-spacing:1px;font-size:9px;color:#68819b}.document-meta{text-align:left;color:#586d84;font-size:10px}.title-block{padding:20px 0 12px;border-bottom:1px solid #b9c8d9}h1{font-size:23px;margin:0;color:#17345c}h2{font-size:14px;border-right:3px solid #167f84;padding-right:9px;margin:24px 0 9px;break-after:avoid}table{width:100%;border-collapse:collapse;margin:9px 0 18px;font-size:11px}th,td{text-align:right;vertical-align:top;padding:8px 10px;border:1px solid #dce3ed;overflow-wrap:anywhere}th{background:#eff3f8;color:#36516f;width:32%;font-weight:600}.coverage-table th{width:auto}tr{break-inside:avoid}thead{display:table-header-group}.document-note{padding:10px 12px;border:1px solid #dce3ed;background:#f8fafc;font-size:10px}.document-footer{margin-top:24px;border-top:2px solid #17345c;padding-top:12px;font-size:9px;color:#65758a}.integrity{font:9px monospace;direction:ltr;overflow-wrap:anywhere}.signature-record{border:1px solid #a8c3ca;background:#f5faf9;padding:12px;margin-top:16px}svg{max-width:100%;break-inside:avoid}a{color:#17345c}@media screen{body{max-width:820px;margin:24px auto;box-shadow:0 6px 30px #17264118;padding:32px}html{background:#edf1f6}}@media print{body{padding:0}.document-summary{break-inside:avoid}}
 </style></head><body><header class="document-header"><div class="wordmark">ביטוחה<small>BITUCHA · PET INSURANCE CORE</small></div><div class="document-meta">עותק ללקוח · מסמך ${escape(number)}<br>תאריך הפקה ${escape(createdAt.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }))}<br>מערכת תפעול ביטוח חיות מחמד</div></header><section class="title-block"><h1>${escape(title)}</h1><span>רשימה ופרטי הסכם · כל הסכומים בשקלים חדשים</span></section>${contents}${signed ? `<section class="signature-record">${escape(signed)}<br>חתימה מדומה, ללא טענה לאימות זהות או תוקף משפטי.</section>` : ""}${contentHash ? `<h2>אימות שלמות התוכן</h2><p class="integrity">SHA-256: ${escape(contentHash)}</p>` : ""}<footer class="document-footer">ביטוחה · מסמך פיתוח לסימולציה מקצועית עם נתונים בדויים בלבד. אינו פוליסה מחייבת ואינו מעיד על הרשאה לפעילות ביטוח אמיתית. התנאים הם תנאי המוצר שהוגדרו במערכת.</footer></body></html>`;
}
export function signingDocumentHtml(s: any, kind: string, contentHash: string) {
  const row = (k: string, v: any) =>
    `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`;
  const c = s.customer,
    p = s.pet,
    t = s.terms;
  let contents = `<h2>פרטי המבוטח וחיית המחמד</h2><table>${row("בעל הבקשה", c.firstName + " " + c.lastName)}${row("כתובת", c.address + ", " + c.city)}${row("חיית מחמד", p.name)}${row("סוג וגזע", (p.species === "DOG" ? "כלב" : "חתול") + " · " + p.breed)}${row("תאריך לידה", p.birthDate)}${row("מספר שבב", p.chip || "נדרש להשלמה")}${row("תחילת כיסוי", s.startDate)}${row("סיום כיסוי (לא כולל)", s.endDate)}</table>`;
  const titles: Record<string, string> = {
    AGREEMENT: "הסכם הצטרפות ורשימת תנאים",
    HEALTH: "הצהרת בריאות והסכמות",
    PAYMENT: "הסכם תשלומים מדומה",
  };
  if (kind === "AGREEMENT")
    contents += `<h2>תנאי המוצר שנבחר</h2><table>${row("מסלול", t.name + " · גרסה " + t.version)}${row("פרמיה שנתית", money(t.premiumCents))}${row("תקרה שנתית", money(t.annualLimitCents))}${row("אכשרה", t.waitingDays + " ימים")}${row("השתתפות עצמית לאירוע", money(t.deductibleCents))}${row("שיעור החזר", t.reimbursementBps / 100 + "%")}</table><h2>כיסויים ותקרות משנה</h2><table><tr><th>כיסוי</th><th>תקרה</th><th>מצב</th></tr>${t.coverages.map((x: any) => `<tr><td>${escape(x.name)}</td><td>${escape(money(x.limitCents))}</td><td>${s.exclusions.includes(x.code) ? "מוחרג לפי החיתום" : "כלול לפי התנאים"}</td></tr>`).join("")}</table><p class="document-note">תקרות המשנה כפופות לתקרה הכוללת ולכל התנאים וההחרגות. הכיסוי יופעל רק לאחר השלמת בקרת ההפקה. זו אינה הבטחת כיסוי לכל טיפול.</p>`;
  if (kind === "HEALTH") {
    for (const step of s.medical) {
      const def = enrollmentDefinition(s.definitionVersion)[step.number - 1];
      let rows = "";
      for (const q of def.questions || []) {
        const a = step.answers[q.key];
        rows += row(q.label, a?.value ? "כן" : "לא");
        if (a?.value)
          for (const f of medicalDetails.filter(
            (f) => f.key !== "attachmentId",
          ))
            rows += row(
              f.label,
              typeof a[f.key] === "boolean"
                ? a[f.key]
                  ? "כן"
                  : "לא"
                : a[f.key],
            );
      }
      for (const f of def.fields)
        rows += row(
          f.label,
          typeof step.answers[f.key] === "boolean"
            ? step.answers[f.key]
              ? "כן"
              : "לא"
            : step.answers[f.key],
        );
      for (const r of step.answers.records || [])
        for (const f of def.repeat || [])
          if (f.key !== "attachmentId") rows += row(f.label, r[f.key]);
      contents += `<h2>${escape(def.title)}</h2><table>${rows}</table>`;
    }
    contents += `<h2>הצהרות בעל הבקשה</h2>${s.declarations.map((d: any) => `<p>${escape(d.label)}</p>`).join("")}`;
  }
  if (kind === "PAYMENT")
    contents += `<h2>לוח תשלומים מוסכם</h2><p>תשלומים מדומים בלבד. אין הזנת פרטי כרטיס או גבייה אמיתית.</p><table><tr><th>חיוב</th><th>מועד</th><th>סכום</th></tr>${s.schedule.map((x: any) => `<tr><td>${x.position}</td><td>${escape(x.dueAt)}</td><td>${escape(money(x.amountCents))}</td></tr>`).join("")}</table><p>סה״כ לתקופה: ${escape(money(s.schedule.reduce((a: number, x: any) => a + x.amountCents, 0)))}</p>`;
  return professionalHtml(
    titles[kind],
    String(s.applicationNumber) + "-" + kind,
    contents,
    new Date(s.createdAt),
    contentHash,
  );
}

export async function enqueueDocument(id: string) {
  if (!(await db.document.findUnique({ where: { id }, select: { id: true } })))
    throw new NotFoundException("מסמך לא נמצא");
  return db.documentArtifact.upsert({
    where: { documentId: id },
    update: {},
    create: { documentId: id },
  });
}
export async function processDocumentArtifact(documentId?: string) {
  const leaseToken = randomUUID();
  const artifact = await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.documentArtifact.updateMany({
      where: {
        status: "PROCESSING",
        leaseUntil: { lt: now },
        attempts: { gte: 3 },
      },
      data: {
        status: "FAILED",
        errorCode: "LEASE_EXHAUSTED",
        leaseUntil: null,
        leaseToken: null,
      },
    });
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "DocumentArtifact" WHERE ((${documentId || null}::text IS NULL) OR "documentId"=${documentId || null}) AND attempts<3 AND ((status='PENDING' AND "nextAttemptAt"<=CURRENT_TIMESTAMP) OR (status='PROCESSING' AND "leaseUntil"<CURRENT_TIMESTAMP)) ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return null;
    return tx.documentArtifact.update({
      where: { id: rows[0].id },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        leaseToken,
        leaseUntil: new Date(Date.now() + 90000),
      },
    });
  });
  if (!artifact) return;
  try {
    const html = artifact.html || (await documentHtml(artifact.documentId));
    const htmlHash = bytesHash(html);
    if (artifact.htmlHash && artifact.htmlHash !== htmlHash)
      throw new Error("HTML_INTEGRITY_FAILED");
    const frozen = await db.documentArtifact.updateMany({
      where: { id: artifact.id, status: "PROCESSING", leaseToken },
      data: { html, htmlHash },
    });
    if (!frozen.count) return;
    const content = await htmlPdf(html);
    await db.documentArtifact.updateMany({
      where: { id: artifact.id, status: "PROCESSING", leaseToken },
      data: {
        status: "READY",
        content: new Uint8Array(content),
        pdfHash: bytesHash(content),
        errorCode: null,
        leaseUntil: null,
        leaseToken: null,
      },
    });
  } catch {
    await db.documentArtifact.updateMany({
      where: { id: artifact.id, status: "PROCESSING", leaseToken },
      data: {
        status: artifact.attempts >= 3 ? "FAILED" : "PENDING",
        errorCode: "PDF_RENDER_FAILED",
        nextAttemptAt: new Date(Date.now() + artifact.attempts * 5000),
        leaseUntil: null,
        leaseToken: null,
      },
    });
  }
}
export function startDocumentWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processDocumentArtifact();
    } catch {
      console.error("DOCUMENT_WORKER_UNAVAILABLE");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  return () => clearInterval(timer);
}
export async function artifactStatus(actor: Actor, id: string) {
  await authorizeDocument(actor, id);
  const a = await enqueueDocument(id);
  return {
    status: a.status,
    templateVersion: a.templateVersion,
    attempts: a.attempts,
    pdfHash: a.pdfHash,
    htmlHash: a.htmlHash,
    errorCode: a.errorCode,
    updatedAt: a.updatedAt,
  };
}
export async function retryDocument(actor: Actor, id: string, key: unknown) {
  need(actor, "document.generate");
  await authorizeDocument(actor, id);
  return new InsuranceService().command(
    actor,
    "document.pdf.retry",
    key,
    { id },
    async (tx) => {
      const a = await tx.documentArtifact.findUnique({
        where: { documentId: id },
      });
      if (!a || a.status !== "FAILED")
        throw new ConflictException("ניסיון חוזר מותר רק למסמך שנכשל");
      await tx.documentArtifact.update({
        where: { id: a.id },
        data: {
          status: "PENDING",
          attempts: 0,
          errorCode: null,
          nextAttemptAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          employeeId: actor.id,
          action: "document.pdf.retry",
          entityId: id,
          processId: id,
        },
      });
      return { status: "PENDING" };
    },
  );
}

export async function listDocuments(
  actor: Actor,
  q: string = "",
  status: string = "",
) {
  need(actor, "document.read");
  const clinical = [
    "APPLICATION",
    "HEALTH_DECLARATION",
    "UNDERWRITING",
    "SIMULATED_SIGNATURE",
  ];
  const canMedical = actorPermissions(actor).some(
    (p) => p === "*" || p === "application.read",
  );
  if (
    q.length > 100 ||
    !["", "PENDING", "PROCESSING", "READY", "FAILED"].includes(status)
  )
    throw new ConflictException("מסנן מסמכים אינו תקין");
  return db.document.findMany({
    where: {
      ...(!canMedical ? { type: { notIn: clinical } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
            ],
          }
        : {}),
      ...(status ? { artifact: { status } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      number: true,
      title: true,
      type: true,
      customerId: true,
      policyId: true,
      createdAt: true,
      signedAt: true,
      artifact: {
        select: {
          status: true,
          attempts: true,
          errorCode: true,
          pdfHash: true,
          templateVersion: true,
        },
      },
    },
  });
}
