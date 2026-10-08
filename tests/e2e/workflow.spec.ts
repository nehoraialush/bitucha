import { test, expect } from "@playwright/test";
import { db } from "../../apps/api/src/db";
const name = "לקוח בדיקת דפדפן " + Date.now();
async function login(page: any) {
  await page.goto("/");
  await page.getByLabel("דוא״ל").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("סיסמה").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "כניסה למערכת", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "סביבת העבודה שלך" }),
  ).toBeVisible();
}
test("מסלול לקוח, חיה, פוליסה, תביעה ומסמך בעברית", async ({ page }) => {
  await login(page);
  await expect(page.getByText("100", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page
    .getByRole("button", { name: "לקוחות ומבוטחים", exact: true })
    .click();
  await page.getByRole("button", { name: "פתיחת לקוח", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("שם לקוח").fill(name);
  await dialog.getByLabel("טלפון").fill("TEST-BROWSER");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "בעלי חיים", exact: true }).click();
  await page
    .getByRole("button", { name: "הוספת בעל חיים", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("שם בעל חיים").fill("חיית בדיקת דפדפן");
  await dialog.getByLabel("גזע", { exact: true }).fill("מעורב");
  await dialog.getByLabel("תאריך לידה").fill("2023-01-01");
  await dialog
    .getByLabel("מספר שבב (15 ספרות)")
    .fill(String(700000000000000 + Math.floor(Math.random() * 10000000000)));
  await dialog.getByLabel("חיסונים מעודכנים").check();
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "חיית בדיקת דפדפן", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "פוליסות", exact: true }).click();
  await page
    .getByRole("button", { name: "הצעת ביטוח חדשה", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("מוצר וגרסה").selectOption("demo-product-DOG-BASIC");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "הפעלה", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "הפעלה", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "אישור וביצוע", exact: true })
    .click();
  await expect(page.getByText("פעילה", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "תביעות", exact: true }).click();
  await page.getByRole("button", { name: "פתיחת תביעה", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("מרפאה", { exact: true }).fill("מרפאת בדיקה בדויה");
  await dialog.getByLabel("אבחנה רפואית").fill("בדיקת אכשרה");
  await dialog.getByLabel("תיאור", { exact: true }).fill("ביקור");
  await dialog.getByLabel("עלות בש״ח").fill("1000");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByText("הוגשה", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "בדיקת זכאות", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("האירוע בתקופת אכשרה", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "סגירה", exact: true })
    .click();
  await page.getByRole("button", { name: "החלטה", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("נימוק / פרטי ההשלמה").fill("האירוע בתקופת אכשרה");
  await dialog.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByText("נדחתה", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "מסמכים", exact: true }).click();
  await page
    .getByRole("button", { name: "תצוגה", exact: true })
    .first()
    .click();
  await expect(
    page
      .frameLocator("iframe")
      .getByText("מסמך פיתוח עם נתונים בדויים בלבד.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "סגירה", exact: true })
    .click();
  const href = await page
    .getByRole("link", { name: "PDF", exact: true })
    .first()
    .getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.getByRole("button", { name: "היסטוריה", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "החלטה בתביעה", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/customer-workspace.png",
    fullPage: true,
  });
});
test.afterAll(async () => {
  const c = await db.customer.findFirst({ where: { name } });
  if (c) {
    const p = await db.policy.findMany({ where: { customerId: c.id } });
    const ids = p.map((x) => x.id);
    const claims = await db.claim.findMany({
      where: { policyId: { in: ids } },
    });
    const claimIds = claims.map((x) => x.id);
    await db.paymentOrder.deleteMany({ where: { claimId: { in: claimIds } } });
    await db.claimLine.deleteMany({ where: { claimId: { in: claimIds } } });
    await db.claim.deleteMany({ where: { policyId: { in: ids } } });
    await db.charge.deleteMany({ where: { policyId: { in: ids } } });
    await db.document.deleteMany({ where: { customerId: c.id } });
    await db.ledgerEntry.deleteMany({ where: { customerId: c.id } });
    await db.auditEvent.deleteMany({ where: { customerId: c.id } });
    await db.policySuspension.deleteMany({ where: { policyId: { in: ids } } });
    await db.task.deleteMany({ where: { customerId: c.id } });
    await db.policy.deleteMany({ where: { customerId: c.id } });
    await db.pet.deleteMany({ where: { customerId: c.id } });
    await db.customer.delete({ where: { id: c.id } });
  }
  await db.$disconnect();
});
