import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { db } from "../apps/api/src/db";
import {
  enrollmentSteps,
  medicalQuestions,
  bodySystems,
  declarations,
} from "../packages/domain/src/enrollment";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api/v1";
let cookie = "",
  csrf = "",
  reviewCookie = "",
  reviewCsrf = "",
  employee: any,
  product: any;
const workflows: string[] = [];
const customers: string[] = [];
const commands: string[] = [];
let w: any;
async function req(
  path: string,
  body?: any,
  key = randomUUID(),
  review = false,
) {
  commands.push(key);
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: review ? reviewCookie : cookie,
      "X-CSRF-Token": review ? reviewCsrf : csrf,
      "Idempotency-Key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const answers = (step: number) =>
  (
    ({
      1: {
        channel: "PHONE",
        source: "בדיקה",
        requestType: "NEW",
        urgency: "NORMAL",
      },
      2: {
        firstName: "לקוח",
        lastName: "בדיקה",
        identifierType: "SIMULATED_ID",
        identifier: "TEST-" + randomUUID(),
        birthDate: "1990-01-01",
        phone: "0501234567",
        email: "test@example.invalid",
        address: "רחוב בדוי 1",
        city: "עיר בדויה",
        preferredContact: "PHONE",
        language: "HE",
        verified: true,
        consent: true,
      },
      3: {
        name: "חיה",
        species: "DOG",
        breed: "מעורב",
        mixed: true,
        sex: "MALE",
        birthDate: "2023-01-01",
        weight: 5,
        chip: "9" + String(Date.now()).slice(-13) + "1",
        neutered: false,
        use: "COMPANION",
        residence: "בית",
      },
      4: {
        productId: product.id,
        startDate: new Date().toISOString().slice(0, 10),
        confirmed: true,
      },
      5: Object.fromEntries(
        medicalQuestions.map((q) => [q.key, { value: false }]),
      ),
      6: Object.fromEntries(bodySystems.map((q) => [q.key, { value: false }])),
      7: { none: true, records: [] },
      8: { vaccinated: true, records: [] },
      9: { productId: product.id },
      10: { confirmed: true, records: [] },
      11: { accepted: true },
      12: { requested: true },
      13: Object.fromEntries(declarations.map((d) => [d.key, true])),
      14: { reviewed: true },
      15: {
        frequency: "MONTHLY",
        method: "SIMULATED_TRANSFER",
        accepted: true,
      },
      16: {
        signerName: "לקוח בדיקה",
        signerRole: "POLICYHOLDER",
        accepted: true,
        strokes: [
          [
            [1, 1],
            [4, 4],
          ],
        ],
      },
      17: { confirmed: true },
    }) as Record<number, any>
  )[step];
async function create() {
  const r = await req("/business-actions/application.open/execute", {
    input: {},
  });
  expect(r.status).toBe(201);
  workflows.push(r.data.id);
  return r.data;
}
async function save(
  n: number,
  a = answers(n),
  complete = true,
  key = randomUUID(),
) {
  const r = await req(
    `/applications/${w.id}/steps/${n}`,
    { version: w.version, answers: a, complete },
    key,
  );
  if (r.status === 201) w = r.data;
  return r;
}
beforeAll(async () => {
  const r = await req("/auth/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  expect(r.status).toBe(201);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = r.data.csrf;
  const password = randomUUID() + randomUUID();
  employee = await db.employee.create({
    data: {
      email: randomUUID() + "@example.invalid",
      name: "חתם בדיקה",
      role: "UNDERWRITER",
      passwordHash: await argon2.hash(password),
    },
  });
  const review = await req("/auth/login", { email: employee.email, password });
  reviewCookie = review.headers.get("set-cookie")!.split(";")[0];
  reviewCsrf = review.data.csrf;
  product = await db.productVersion.create({
    data: {
      code: "ENROLLMENT-" + randomUUID(),
      version: 1,
      name: "מוצר הצטרפות בדיקה",
      species: "DOG",
      minAgeMonths: 2,
      maxAgeMonths: 120,
      premiumCents: 120001,
      annualLimitCents: 100000,
      deductibleCents: 10000,
      reimbursementBps: 8000,
      waitingDays: 30,
      coverages: [{ code: "VISIT", name: "ביקור", limitCents: 100000 }],
    },
  });
});
afterAll(async () => {
  for (const id of workflows) {
    const a = await db.application.findUnique({ where: { workflowId: id } });
    if (a?.customerId) customers.push(a.customerId);
    await db.approvalRequest.deleteMany({ where: { workflowId: id } });
    await db.workflowAttachment.deleteMany({ where: { workflowId: id } });
    await db.workflowStep.deleteMany({ where: { workflowId: id } });
    await db.application.deleteMany({ where: { workflowId: id } });
    await db.workflowInstance.deleteMany({ where: { id } });
    await db.auditEvent.deleteMany({ where: { entityId: id } });
  }
  for (const customerId of [...new Set(customers)]) {
    const policies = await db.policy.findMany({ where: { customerId } });
    await db.charge.deleteMany({
      where: { policyId: { in: policies.map((p) => p.id) } },
    });
    await db.ledgerEntry.deleteMany({ where: { customerId } });
    await db.document.deleteMany({ where: { customerId } });
    await db.task.deleteMany({ where: { customerId } });
    await db.auditEvent.deleteMany({ where: { customerId } });
    await db.policy.deleteMany({ where: { customerId } });
    await db.pet.deleteMany({ where: { customerId } });
    await db.customer.deleteMany({ where: { id: customerId } });
  }
  await db.command.deleteMany({ where: { key: { in: commands } } });
  if (product) {
    await db.productRider.deleteMany({ where: { productId: product.id } });
    await db.productVersion.delete({ where: { id: product.id } });
  }
  if (employee) {
    await db.session.deleteMany({ where: { employeeId: employee.id } });
    await db.employee.delete({ where: { id: employee.id } });
  }
  await db.$disconnect();
});
describe.sequential("Enrollment workflow on real PostgreSQL", () => {
  it("only advertises implemented actions permitted for the employee", async () => {
    const admin = await req("/business-actions");
    expect(admin.data.length).toBe(14);
    const reviewer = await req(
      "/business-actions",
      undefined,
      randomUUID(),
      true,
    );
    expect(reviewer.data.map((a: any) => a.id)).toEqual([
      "application.underwrite",
    ]);
    expect((await req("/business-actions/unknown/execute", {})).status).toBe(
      404,
    );
    expect(
      (
        await req(
          "/business-actions/application.open/execute",
          { input: {} },
          randomUUID(),
          true,
        )
      ).status,
    ).toBe(403);
  });
  it("rejects unauthorized workflow creation and CSRF bypass", async () => {
    expect((await req("/applications", {}, randomUUID(), true)).status).toBe(
      403,
    );
    const r = await fetch(base + "/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(r.status).toBe(403);
  });
  it("stores a draft, resumes it, rejects skipped steps and optimistic conflicts", async () => {
    w = await create();
    expect((await save(1, { notes: "טיוטה נשמרת" }, false)).status).toBe(201);
    const resumed = await req("/applications/" + w.id);
    expect(resumed.data.steps[0].answers.notes).toBe("טיוטה נשמרת");
    expect((await save(3)).status).toBe(409);
    const conflict = await req(`/applications/${w.id}/steps/1`, {
      version: 1,
      answers: answers(1),
      complete: true,
    });
    expect(conflict.status).toBe(409);
  });
  it("issues a policy only after all 18 steps and preserves monthly cents and snapshot documents", async () => {
    for (let n = 1; n <= 17; n++) {
      const r = await save(n);
      expect(r.status, JSON.stringify(r.data)).toBe(201);
    }
    expect(w.status).toBe("READY");
    const body = { version: w.version },
      key = randomUUID();
    const result = await req(`/applications/${w.id}/issue`, body, key);
    expect(result.status, JSON.stringify(result.data)).toBe(201);
    expect(result.data.policy.status).toBe("ACTIVE");
    const replay = await req(`/applications/${w.id}/issue`, body, key);
    expect(replay.data.policy.id).toBe(result.data.policy.id);
    const charges = await db.charge.findMany({
      where: { policyId: result.data.policy.id },
    });
    expect(charges).toHaveLength(12);
    expect(charges.reduce((s, c) => s + c.amountCents, 0)).toBe(120001);
    expect(result.data.documents).toHaveLength(5);
    const doc = await db.document.findUniqueOrThrow({
      where: { id: result.data.documents[0] },
    });
    expect((doc.snapshot as any).signature.simulated).toBe(true);
    expect((await save(1)).status).toBe(409);
  });
  it("allows one concurrent writer and appends immutable invalidation versions", async () => {
    w = await create();
    for (let n = 1; n <= 2; n++) expect((await save(n)).status).toBe(201);
    const old = await req("/applications/" + w.id + "/history");
    const body = { version: w.version, answers: answers(1), complete: true };
    const results = await Promise.all([
      req(`/applications/${w.id}/steps/1`, body),
      req(`/applications/${w.id}/steps/1`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    w = (await req("/applications/" + w.id)).data;
    expect(w.steps.find((s: any) => s.number === 2).completed).toBe(false);
    const history = (await req("/applications/" + w.id + "/history")).data;
    expect(
      history.find(
        (s: any) => s.id === old.data.find((s: any) => s.number === 2).id,
      ).completed,
    ).toBe(true);
    expect(
      (await req(`/applications/${w.id}/issue`, { version: w.version })).status,
    ).toBe(409);
  });
  it("validates attachments and requires a different underwriter for risk approval", async () => {
    w = await create();
    for (let n = 1; n <= 11; n++) {
      let a = answers(n);
      if (n === 3) a = { ...a, chip: "" };
      expect((await save(n, a)).status).toBe(201);
    }
    const bad = await req(`/applications/${w.id}/attachments`, {
      version: w.version,
      filename: "bad.pdf",
      kind: "MEDICAL",
      mediaType: "application/pdf",
      base64: Buffer.from("not pdf bytes").toString("base64"),
    });
    expect(bad.status).toBe(400);
    const upload = await req(`/applications/${w.id}/attachments`, {
      version: w.version,
      filename: "medical.pdf",
      kind: "MEDICAL",
      mediaType: "application/pdf",
      base64: Buffer.from("%PDF-1.4\n% simulation attachment").toString(
        "base64",
      ),
    });
    expect(upload.status).toBe(201);
    w = upload.data;
    expect((await save(12)).status).toBe(201);
    expect(w.status).toBe("WAITING_APPROVAL");
    expect((await save(13)).status).toBe(409);
    expect(
      (
        await req(`/applications/${w.id}/underwrite`, {
          version: w.version,
          decision: "APPROVE",
          reason: "בדיקה",
        })
      ).status,
    ).toBe(409);
    const decision = await req(
      `/applications/${w.id}/underwrite`,
      {
        version: w.version,
        decision: "APPROVE",
        reason: "אישור בדוי",
        excludedCategories: ["VISIT"],
      },
      randomUUID(),
      true,
    );
    expect(decision.status).toBe(201);
    w = decision.data;
    expect(
      w.steps.find((s: any) => s.number === 12).answers.excludedCategories,
    ).toEqual(["VISIT"]);
    for (let n = 13; n <= 17; n++) expect((await save(n)).status).toBe(201);
    const issue = await req(`/applications/${w.id}/issue`, {
      version: w.version,
    });
    expect(issue.status).toBe(201);
    expect(issue.data.policy.exclusions).toEqual(["VISIT"]);
  });
  it("prices configured riders and cancels a monthly schedule without over-crediting any installment", async () => {
    const rider = await db.productRider.create({
      data: {
        productId: product.id,
        code: "TEST_RIDER",
        name: "הרחבת בדיקה",
        premiumCents: 12345,
        limitIncreaseCents: 5000,
        coverage: { code: "PHYSIO", name: "פיזיותרפיה", limitCents: 50000 },
        species: "DOG",
        minAgeMonths: 2,
        maxAgeMonths: 120,
      },
    });
    w = await create();
    for (let n = 1; n <= 9; n++) expect((await save(n)).status).toBe(201);
    expect(
      (
        await save(10, {
          confirmed: true,
          records: [{ riderId: randomUUID() }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await save(10, { confirmed: true, records: [{ riderId: rider.id }] }))
        .status,
    ).toBe(201);
    for (let n = 11; n <= 17; n++) expect((await save(n)).status).toBe(201);
    const quote = w.steps.find((s: any) => s.number === 11).answers.quote;
    expect(quote.annualCents).toBe(132346);
    expect(quote.product.annualLimitCents).toBe(105000);
    expect(quote.product.coverages).toHaveLength(2);
    const issued = await req(`/applications/${w.id}/issue`, {
      version: w.version,
    });
    expect(issued.status).toBe(201);
    const policy = issued.data.policy;
    const charges = await db.charge.findMany({
      where: { policyId: policy.id },
      orderBy: { dueAt: "asc" },
    });
    const collection = await req(
      `/charges/${charges[0].id}/collect-simulated`,
      { amountCents: charges[0].amountCents },
    );
    expect(collection.status).toBe(201);
    const cancellation = await req(`/policies/${policy.id}/cancel`, {
      at: policy.startDate.slice(0, 10),
      reason: "ביטול בדיקה ביום תחילת הכיסוי",
    });
    expect(cancellation.status).toBe(201);
    expect(cancellation.data.creditCents).toBe(132346);
    expect(cancellation.data.refundDueCents).toBe(charges[0].amountCents);
    const updated = await db.charge.findMany({
      where: { policyId: policy.id },
    });
    expect(updated.every((c) => c.creditedCents === c.amountCents)).toBe(true);
  });
  it("requires reviewed medical evidence, protects medical documents and keeps the signed snapshot unchanged", async () => {
    w = await create();
    for (let n = 1; n <= 4; n++) expect((await save(n)).status).toBe(201);
    const upload = await req(`/applications/${w.id}/attachments`, {
      version: w.version,
      filename: "medical.pdf",
      kind: "MEDICAL",
      mediaType: "application/pdf",
      base64: Buffer.from("%PDF-1.4\n% fictional medical evidence").toString(
        "base64",
      ),
    });
    expect(upload.status).toBe(201);
    w = upload.data;
    const attachment = w.attachments[0];
    const positive = {
      ...answers(5),
      illness: {
        value: true,
        onset: "2025-01-01",
        diagnosis: "בדיקה <script>evil</script>",
        treatment: "טיפול בדוי",
        clinic: "מרפאה בדויה",
        currentStatus: "חלף",
        futureTreatment: false,
        attachmentId: attachment.id,
      },
    };
    expect((await save(5, positive)).status).toBe(201);
    for (let n = 6; n <= 12; n++) expect((await save(n)).status).toBe(201);
    expect(w.status).toBe("WAITING_APPROVAL");
    expect(
      (
        await req(
          `/applications/${w.id}/underwrite`,
          { version: w.version, decision: "APPROVE", reason: "נימוק" },
          randomUUID(),
          true,
        )
      ).status,
    ).toBe(409);
    const reviewed = await req(
      `/applications/${w.id}/attachments/${attachment.id}/review`,
      { version: w.version, status: "APPROVED", reason: "אסמכתה מדומה נבדקה" },
      randomUUID(),
      true,
    );
    expect(reviewed.status).toBe(201);
    w = reviewed.data;
    const decision = await req(
      `/applications/${w.id}/underwrite`,
      { version: w.version, decision: "APPROVE", reason: "בדיקה מלאה" },
      randomUUID(),
      true,
    );
    expect(decision.status).toBe(201);
    w = decision.data;
    for (let n = 13; n <= 17; n++) expect((await save(n)).status).toBe(201);
    const issued = await req(`/applications/${w.id}/issue`, {
      version: w.version,
    });
    expect(issued.status).toBe(201);
    const health = await db.document.findFirstOrThrow({
      where: { policyId: issued.data.policy.id, type: "HEALTH_DECLARATION" },
    });
    const before = JSON.stringify(health.snapshot);
    await db.customer.update({
      where: { id: health.customerId },
      data: { name: "שם שונה לאחר ההפקה" },
    });
    expect(
      JSON.stringify(
        (await db.document.findUniqueOrThrow({ where: { id: health.id } }))
          .snapshot,
      ),
    ).toBe(before);
    const html = await fetch(base + `/documents/${health.id}/preview`, {
      headers: { Cookie: cookie },
    });
    expect(html.status).toBe(200);
    const content = await html.text();
    expect(content).toContain("&lt;script&gt;evil&lt;/script&gt;");
    expect(content).not.toContain("<script>evil</script>");
    await db.employee.update({
      where: { id: employee.id },
      data: { role: "AUDITOR" },
    });
    try {
      expect(
        (
          await req(
            `/documents/${health.id}/preview`,
            undefined,
            randomUUID(),
            true,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await req(
            `/application-attachments/${attachment.id}`,
            undefined,
            randomUUID(),
            true,
          )
        ).status,
      ).toBe(403);
      const workspace = await req(
        `/customers/${health.customerId}/workspace`,
        undefined,
        randomUUID(),
        true,
      );
      expect(
        workspace.data.documents.every((d: any) => !("snapshot" in d)),
      ).toBe(true);
      expect(workspace.data.pets[0].medicalHistory).toContain("מוגבל");
    } finally {
      await db.employee.update({
        where: { id: employee.id },
        data: { role: "UNDERWRITER" },
      });
    }
  });
});
