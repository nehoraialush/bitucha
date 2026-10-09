import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { db } from "../../apps/api/src/db";
import {
  medicalQuestions,
  compactBodySystems,
  declarations,
} from "../../packages/domain/src/enrollment";
let workflowId = "";
const extraWorkflows: string[] = [];
const extraEmployees: string[] = [];
test("resumes enrollment draft, completes 18 steps and creates policy and signed snapshot documents", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByLabel("דוא״ל").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("סיסמה").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "כניסה למערכת", exact: true }).click();
  await page
    .getByRole("button", { name: "הצטרפות וחיתום", exact: true })
    .click();
  const createdResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/applications") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page
    .getByRole("button", { name: "הצטרפות חדשה לביטוח", exact: true })
    .click();
  workflowId = (await (await createdResponse).json()).id;
  await expect(
    page.getByRole("heading", { name: "1. פתיחת בקשת הצטרפות", exact: true }),
  ).toBeVisible();
  await page.getByLabel("ערוץ *", { exact: true }).selectOption("PHONE");
  await page.getByLabel("מקור הפנייה *", { exact: true }).fill("בדיקת דפדפן");
  await page.getByLabel("סוג בקשה *", { exact: true }).selectOption("NEW");
  await page.getByLabel("דחיפות *", { exact: true }).selectOption("NORMAL");
  const draftResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/steps/1") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page.getByRole("button", { name: "שמירת טיוטה", exact: true }).click();
  const draft = await (await draftResponse).json();
  workflowId = draft.id;
  await page.reload();
  await page
    .getByRole("button", { name: "הצטרפות וחיתום", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: String(draft.application.number),
        exact: true,
      }),
    })
    .getByRole("button", { name: "פתיחת בקשה", exact: true })
    .click();
  await expect(page.getByLabel("מקור הפנייה *", { exact: true })).toHaveValue(
    "בדיקת דפדפן",
  );
  const sourceInput = page.getByLabel("מקור הפנייה *", { exact: true });
  await sourceInput.focus();
  const backgroundSave = page.waitForResponse(
    (r) =>
      r.url().endsWith("/steps/1") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await sourceInput.fill("בדיקת שמירה ללא ריענון");
  await backgroundSave;
  await expect(sourceInput).toBeFocused();
  await expect(sourceInput).toHaveValue("בדיקת שמירה ללא ריענון");
  const next = async (n: number) => {
    await page
      .getByRole("button", { name: "בדיקה, שמירה והמשך", exact: true })
      .click();
    await expect(page.locator(".workflow-body h2").first()).toContainText(
      `${n + 1}.`,
    );
  };
  await next(1);
  const fields2: Record<string, string> = {
    "שם פרטי *": "לקוח",
    "שם משפחה *": "בדיקת אשף",
    "מזהה בדוי *": "E2E-" + Date.now(),
    "תאריך לידה *": "1990-01-01",
    "טלפון נייד *": "0501234567",
    "דואר אלקטרוני *": "e2e@example.invalid",
    "רחוב ומספר *": "רחוב בדוי 1",
    "עיר *": "עיר בדויה",
  };
  for (const [label, value] of Object.entries(fields2))
    await page.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries({
    "סוג מזהה *": "SIMULATED_ID",
    "אמצעי התקשרות *": "EMAIL",
    "שפה *": "HE",
    "אומתו הפרטים *": "true",
    "הסכמה לשימוש במידע בדוי *": "true",
  }))
    await page.getByLabel(label, { exact: true }).selectOption(value);
  await next(2);
  for (const [label, value] of Object.entries({
    "שם *": "חיית בדיקת אשף",
    "גזע *": "מעורב",
    "תאריך לידה *": "2023-01-01",
    "משקל בק״ג *": "5",
    "מקום מגורים עיקרי *": "בית",
    "מספר שבב — 15 ספרות": String(
      800000000000000 + Math.floor(Math.random() * 1000000000),
    ),
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries({
    "סוג *": "DOG",
    "גזע מעורב *": "true",
    "מין *": "MALE",
    "מסורס / מעוקרת *": "true",
    "שימוש *": "COMPANION",
  }))
    await page.getByLabel(label, { exact: true }).selectOption(value);
  await next(3);
  await page
    .getByLabel("מוצר מבוקש *", { exact: true })
    .selectOption("demo-product-DOG-BASIC");
  await page
    .getByLabel("נתוני החיה נבדקו *", { exact: true })
    .selectOption("true");
  await next(4);
  for (const q of medicalQuestions) {
    const details = page.locator("details").filter({
      has: page.locator("summary").getByText(q.label, { exact: true }),
    });
    await details.locator("summary").click();
    await details
      .getByLabel("האם קיים מצב רפואי בתחום זה? *", { exact: true })
      .selectOption("false");
  }
  await next(5);
  for (const q of compactBodySystems) {
    const details = page.locator("details").filter({
      has: page.locator("summary").getByText(q.label, { exact: true }),
    });
    await details.locator("summary").click();
    await details
      .getByLabel("האם קיים מצב רפואי בתחום זה? *", { exact: true })
      .selectOption("false");
  }
  await next(6);
  await page
    .getByLabel("אין היסטוריה נוספת *", { exact: true })
    .selectOption("true");
  await next(7);
  await page
    .getByLabel("מחוסן לפי ההצהרה *", { exact: true })
    .selectOption("true");
  await next(8);
  await page
    .getByLabel("מסלול נבחר *", { exact: true })
    .selectOption("demo-product-DOG-BASIC");
  await page
    .getByLabel("האם קיים אישור היעדר תביעות? *", { exact: true })
    .selectOption("false");
  await next(9);
  await page
    .getByLabel("בחירת ההרחבות נבדקה *", { exact: true })
    .selectOption("true");
  await next(10);
  await page
    .getByLabel("אישור פירוט חישוב המחיר המדומה *", { exact: true })
    .selectOption("true");
  await next(11);
  await page
    .getByLabel("העברה לבדיקת חיתום *", { exact: true })
    .selectOption("true");
  await next(12);
  for (const d of declarations)
    await page.getByLabel(d.label + " *", { exact: true }).selectOption("true");
  await next(13);
  await page
    .getByLabel("רשימת המסמכים נבדקה *", { exact: true })
    .selectOption("true");
  await next(14);
  await page
    .getByLabel("תדירות חיוב *", { exact: true })
    .selectOption("MONTHLY");
  await page
    .getByLabel("אמצעי תשלום מדומה *", { exact: true })
    .selectOption("SIMULATED_TRANSFER");
  await page
    .getByLabel("אישור תנאי הגבייה המדומה *", { exact: true })
    .selectOption("true");
  await next(15);
  await page
    .getByRole("button", { name: "יצירת קישור חתימה ללקוח", exact: true })
    .click();
  const linkInput = page.getByLabel(
    "קישור אישי לשליחה ללקוח — לשמור במקום פרטי",
  );
  await expect(linkInput).not.toHaveValue("");
  const signingUrl = await linkInput.inputValue();
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  try {
    await customerPage.goto(signingUrl);
    await customerPage
      .getByRole("checkbox", { name: /אני מסכים\/ה שהנציג/ })
      .check();
    for (const title of ["הסכם ותנאי פוליסה", "הצהרת בריאות", "לוח תשלומים"]) {
      await customerPage
        .getByRole("button", { name: title, exact: true })
        .click();
      await expect(customerPage.locator("iframe")).toBeVisible();
    }
    await customerPage
      .getByLabel("הודעה לנציג")
      .fill("אפשר לעזור לי לקרוא את התנאים?");
    await customerPage
      .getByRole("button", { name: "שליחת בקשת עזרה", exact: true })
      .click();
    await expect(page.locator(".signing-events")).toContainText(
      "אפשר לעזור לי לקרוא את התנאים?",
    );
    await page
      .getByLabel("הודעת עזרה ללקוח")
      .fill("כן, שלושת המסמכים זמינים לקריאה והורדה.");
    await page
      .getByRole("button", { name: "שליחת הודעה ללקוח", exact: true })
      .click();
    await expect(customerPage.locator(".signing-chat")).toContainText(
      "שלושת המסמכים זמינים",
    );
    const pdfDownload = customerPage.waitForEvent("download");
    await customerPage
      .getByRole("button", { name: "הורדת PDF למסמך פתוח", exact: true })
      .click();
    const downloaded = await pdfDownload;
    expect(await downloaded.failure()).toBeNull();
    const downloadedBytes = await readFile((await downloaded.path())!);
    expect(downloadedBytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(downloadedBytes.length).toBeGreaterThan(1000);
    await customerPage.getByRole("checkbox", { name: /פתחתי וקראתי/ }).check();
    await customerPage
      .getByLabel("שם החותם כפי שמופיע בבקשה")
      .fill("לקוח בדיקת אשף");
    const canvas = customerPage.getByLabel("משטח ציור חתימה מדומה");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await customerPage.mouse.move(box!.x + 20, box!.y + 40);
    await customerPage.mouse.down();
    await customerPage.mouse.move(box!.x + 140, box!.y + 90, { steps: 15 });
    await customerPage.mouse.up();
    await customerPage
      .getByRole("checkbox", { name: /אני מאשר\/ת את ההצהרות/ })
      .check();
    await customerPage
      .getByRole("button", { name: "חתימה ואישור מסמכים", exact: true })
      .click();
    await expect(
      customerPage.getByRole("heading", { name: "המסמכים נחתמו בהצלחה" }),
    ).toBeVisible();
    await expect(page.locator(".workflow-body h2").first()).toContainText(
      "17.",
    );
  } finally {
    await customerContext.close();
  }
  await page
    .getByLabel("כל פרטי הסיכום נבדקו *", { exact: true })
    .selectOption("true");
  await next(17);
  await page
    .getByRole("button", { name: "הפקת פוליסה ומסמכים", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "הפוליסה הופקה", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "PDF", exact: true }),
  ).toHaveCount(5);
  const pdf = await page.request.get(
    (await page
      .getByRole("link", { name: "PDF", exact: true })
      .first()
      .getAttribute("href")) as string,
  );
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const application = await db.application.findUniqueOrThrow({
    where: { workflowId },
  });
  expect(
    await db.charge.count({ where: { policyId: application.policyId! } }),
  ).toBe(12);
  await page.screenshot({
    path: "test-results/enrollment-completed.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "פתיחת תיק הלקוח", exact: true })
    .click();
  await page.getByRole("button", { name: "פוליסות", exact: true }).click();
  const renewalResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/applications") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await page.getByRole("button", { name: "חידוש פוליסה", exact: true }).click();
  const renewal = await (await renewalResponse).json();
  extraWorkflows.push(renewal.id);
  await expect(
    page.getByRole("heading", { name: "1. פתיחת בקשת הצטרפות", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("סוג בקשה *", { exact: true })).toHaveValue(
    "RENEWAL",
  );
  expect(renewal.application.renewalOfId).toBe(application.policyId);
  await page.getByRole("button", { name: "ניהול ואיפוס", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "החזרת נתוני דוגמה", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "בדיקת היקף המחיקה לפני איפוס", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "רשומות שיימחקו", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "איפוס המערכת ומחיקת כל הנתונים העסקיים",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "ביטול", exact: true }).click();
  await page
    .getByRole("button", { name: "החזרת נתוני דוגמה", exact: true })
    .click();
  const restoreDialog = page.getByRole("dialog", {
    name: "אישור החזרת נתוני דוגמה",
    exact: true,
  });
  await expect(
    restoreDialog.getByRole("button", {
      name: "אישור החזרת נתוני דוגמה",
      exact: true,
    }),
  ).toBeVisible();
  await restoreDialog
    .getByRole("button", { name: "ביטול", exact: true })
    .click();
  await page
    .getByRole("button", { name: "עובדים והרשאות", exact: true })
    .click();
  await page.getByRole("button", { name: "יצירת עובד", exact: true }).click();
  let employeeDialog = page.getByRole("dialog", {
    name: "יצירת עובד",
    exact: true,
  });
  const employeeName = "חתם בדיקת דפדפן " + Date.now();
  await employeeDialog
    .getByLabel("שם עובד", { exact: true })
    .fill(employeeName);
  await employeeDialog
    .getByLabel("דוא״ל עובד", { exact: true })
    .fill(randomUUID() + "@example.invalid");
  await employeeDialog
    .getByLabel("סיסמה ראשונית — 16 תווים לפחות", { exact: true })
    .fill(randomUUID() + randomUUID());
  const employeeCreated = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/employees") &&
      r.request().method() === "POST" &&
      r.status() === 201,
  );
  await employeeDialog
    .getByRole("button", { name: "שמירת עובד", exact: true })
    .click();
  const employee = await (await employeeCreated).json();
  extraEmployees.push(employee.id);
  await page
    .getByRole("button", { name: "עריכת " + employeeName, exact: true })
    .click();
  employeeDialog = page.getByRole("dialog", {
    name: "עריכת עובד",
    exact: true,
  });
  await employeeDialog
    .getByLabel("תקרת אישור תביעה (₪) — ריק לפי סמכות תפקיד", { exact: true })
    .fill("250");
  await employeeDialog
    .getByLabel("מקור הרשאות עובד", { exact: true })
    .selectOption("CUSTOM");
  await employeeDialog
    .getByLabel("קריאת בקשות ומסמכי הצטרפות רפואיים", { exact: true })
    .check();
  await employeeDialog
    .getByLabel("החלטת חיתום ובדיקת מסמכים", { exact: true })
    .check();
  await employeeDialog
    .getByRole("button", { name: "שמירת עובד", exact: true })
    .click();
  await expect(employeeDialog).not.toBeVisible();
  const configured = await db.employee.findUniqueOrThrow({
    where: { id: employee.id },
    include: { permissionGrants: true },
  });
  expect(configured.approvalLimitCents).toBe(25000);
  expect(configured.permissionGrants).toHaveLength(2);
  const policyDocument = await db.document.findFirstOrThrow({
    where: { policyId: application.policyId!, type: "POLICY" },
  });
  await page.getByRole("button", { name: "מרכז מסמכים", exact: true }).click();
  await page
    .getByLabel("חיפוש שם או מספר מסמך")
    .fill(String(policyDocument.number));
  const documentRow = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", {
        name: String(policyDocument.number),
        exact: true,
      }),
    });
  await expect(documentRow).toBeVisible();
  await documentRow
    .getByRole("button", { name: "תצוגת מסמך", exact: true })
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", {
        name: "רשימת הכיסויים וגבולות האחריות",
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "תצוגת מסמך" })
    .getByRole("button", { name: "סגירה", exact: true })
    .click();
});
test.afterAll(async () => {
  for (const id of extraEmployees) {
    await db.employeePermission.deleteMany({ where: { employeeId: id } });
    await db.session.deleteMany({ where: { employeeId: id } });
    await db.auditEvent.deleteMany({ where: { entityId: id } });
    await db.employee.deleteMany({ where: { id } });
  }
  if (!workflowId) return;
  const app = await db.application.findUnique({ where: { workflowId } });
  for (const id of extraWorkflows) {
    await db.signingEvent.deleteMany({
      where: { request: { workflowId: id } },
    });
    await db.signingRequest.deleteMany({ where: { workflowId: id } });
    await db.approvalRequest.deleteMany({ where: { workflowId: id } });
    await db.workflowAttachment.deleteMany({ where: { workflowId: id } });
    await db.workflowStep.deleteMany({ where: { workflowId: id } });
    await db.application.deleteMany({ where: { workflowId: id } });
    await db.workflowInstance.deleteMany({ where: { id } });
    await db.auditEvent.deleteMany({ where: { entityId: id } });
  }

  await db.signingEvent.deleteMany({ where: { request: { workflowId } } });
  await db.signingRequest.deleteMany({ where: { workflowId } });
  await db.approvalRequest.deleteMany({ where: { workflowId } });
  await db.workflowAttachment.deleteMany({ where: { workflowId } });
  await db.workflowStep.deleteMany({ where: { workflowId } });
  await db.application.deleteMany({ where: { workflowId } });
  await db.workflowInstance.deleteMany({ where: { id: workflowId } });
  await db.auditEvent.deleteMany({ where: { entityId: workflowId } });
  if (app?.customerId) {
    await db.document.deleteMany({ where: { customerId: app.customerId } });
    await db.ledgerEntry.deleteMany({ where: { customerId: app.customerId } });
    await db.charge.deleteMany({ where: { policyId: app.policyId! } });
    await db.task.deleteMany({ where: { customerId: app.customerId } });
    await db.policy.deleteMany({ where: { customerId: app.customerId } });
    await db.pet.deleteMany({ where: { customerId: app.customerId } });
    await db.customer.delete({ where: { id: app.customerId } });
  }
  await db.$disconnect();
});
