import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
if (existsSync(".env")) process.loadEnvFile(".env");
const base =
  process.env.TEST_BASE_URL ||
  process.env.DOCKER_WEB_ORIGIN ||
  "http://localhost:8080";
const login = await fetch(base + "/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  }),
});
assert.equal(login.status, 201);
const cookie = login.headers.get("set-cookie")!.split(";")[0];
const headers = { Cookie: cookie };
const actionsResponse = await fetch(base + "/api/v1/business-actions", {
  headers,
});
assert.equal(actionsResponse.status, 200);
const actions = await actionsResponse.json();
assert.equal(actions.length, 16);
const employeesResponse = await fetch(base + "/api/v1/employees", { headers });
assert.equal(employeesResponse.status, 200);
const staff = await employeesResponse.json();
assert(staff.employees.length > 0);
assert(
  staff.employees.every((e: any) => e.version >= 1 && !("passwordHash" in e)),
);
const resetPreview = await fetch(base + "/api/v1/system/reset-preview", {
  headers,
});
assert.equal(resetPreview.status, 200);
const preview = await resetPreview.json();
assert(preview.preserved.includes("EmployeePermission"));
assert(preview.counts.Customer >= 100);
const reports = await fetch(base + "/api/v1/reports", { headers });
assert.equal(reports.status, 200);
const summary = await reports.json();
assert(summary.customers >= 100);
assert(summary.pets >= 140);
assert(summary.policies.reduce((s: number, p: any) => s + p._count, 0) >= 120);
assert(summary.claims.reduce((s: number, c: any) => s + c._count, 0) >= 200);
const customers = await (
  await fetch(base + "/api/v1/customers", { headers })
).json();
const customer = await (
  await fetch(base + `/api/v1/customers/${customers[0].id}/workspace`, {
    headers,
  })
).json();
assert(customer.documents.length > 0);
const pdf = await fetch(
  base + `/api/v1/documents/${customer.documents[0].id}/pdf`,
  { headers },
);
assert.equal(pdf.status, 200);
assert.equal(
  Buffer.from(await pdf.arrayBuffer())
    .subarray(0, 5)
    .toString(),
  "%PDF-",
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [],
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByLabel("דוא״ל").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("סיסמה").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "כניסה למערכת", exact: true }).click();
  await page.getByRole("heading", { name: "סביבת העבודה שלך" }).waitFor();
  await page.getByText(String(summary.customers), { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/bitucha-docker-dashboard.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
console.log(
  "Deployment passed: authentication, PostgreSQL/Prisma data, demo counts, PDF inside API container, React browser login",
);
