import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../apps/api/src/db";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api/v1";
let cookie = "",
  csrf = "",
  customerId = "",
  documentId = "";
const keys: string[] = [];
const hash = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
async function post(path: string, body: any = {}) {
  const key = randomUUID();
  keys.push(key);
  return fetch(base + path, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      "Idempotency-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  expect(r.status).toBe(201);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = (await r.json()).csrf;
  const c = await db.customer.create({
    data: { name: "לקוח מסמך בדיקה", phone: "0500000000" },
  });
  customerId = c.id;
  const doc = await db.document.create({
    data: {
      customerId: c.id,
      type: "RECEIPT",
      title: "קבלה בדויה לבדיקת הפקה",
      snapshot: { customer: c, amountCents: 15001, reason: "בדיקה בלבד" },
    },
  });
  documentId = doc.id;
});
afterAll(async () => {
  if (documentId) {
    await db.auditEvent.deleteMany({ where: { entityId: documentId } });
    await db.document.deleteMany({ where: { id: documentId } });
  }
  if (customerId) await db.customer.deleteMany({ where: { id: customerId } });
  await db.command.deleteMany({ where: { key: { in: keys } } });
  await db.$disconnect();
});
describe.sequential("Persisted PDF artifacts", () => {
  it("generates a frozen A4 PDF once, records hashes and audits downloads", async () => {
    const status = await fetch(
      base + `/documents/${documentId}/production-status`,
      { headers: { Cookie: cookie } },
    );
    expect(status.status).toBe(200);
    const first = await fetch(base + `/documents/${documentId}/pdf`, {
      headers: { Cookie: cookie },
    });
    expect(first.status).toBe(200);
    const bytes = Buffer.from(await first.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const artifact = await db.documentArtifact.findUniqueOrThrow({
      where: { documentId },
    });
    expect(artifact.status).toBe("READY");
    expect(artifact.pdfHash).toBe(hash(bytes));
    expect(artifact.htmlHash).toBe(hash(artifact.html!));
    expect(artifact.attempts).toBe(1);
    await db.customer.update({
      where: { id: customerId },
      data: { name: "שם ששונה אחרי ההפקה" },
    });
    const second = await fetch(base + `/documents/${documentId}/pdf`, {
      headers: { Cookie: cookie },
    });
    expect(Buffer.from(await second.arrayBuffer())).toEqual(bytes);
    expect(
      await db.auditEvent.count({
        where: { entityId: documentId, action: "document.download" },
      }),
    ).toBe(2);
  });
  it("retries a failed generation with the same frozen HTML and rejects retry of a final PDF", async () => {
    expect((await post(`/documents/${documentId}/retry-pdf`)).status).toBe(409);
    const original = await db.documentArtifact.findUniqueOrThrow({
      where: { documentId },
    });
    await db.documentArtifact.update({
      where: { documentId },
      data: { status: "FAILED", attempts: 3, errorCode: "PDF_RENDER_FAILED" },
    });
    const retry = await post(`/business-actions/document.pdf.retry/execute`, {
      entityId: documentId,
      input: {},
    });
    expect(retry.status).toBe(201);
    const result = await fetch(base + `/documents/${documentId}/pdf`, {
      headers: { Cookie: cookie },
    });
    expect(result.status).toBe(200);
    const final = await db.documentArtifact.findUniqueOrThrow({
      where: { documentId },
    });
    expect(final.htmlHash).toBe(original.htmlHash);
    expect(final.status).toBe("READY");
  });
  it("blocks corrupted PDF bytes and HTML instead of returning them to the user", async () => {
    await db.documentArtifact.update({
      where: { documentId },
      data: { content: new Uint8Array(Buffer.from("%PDF-forged")) },
    });
    expect(
      (
        await fetch(base + `/documents/${documentId}/pdf`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(409);
    await db.documentArtifact.update({
      where: { documentId },
      data: { html: "<html>forged</html>" },
    });
    expect(
      (
        await fetch(base + `/documents/${documentId}/preview`, {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(409);
  });
});
