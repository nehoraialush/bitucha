import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { db } from "../apps/api/src/db";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api/v1";
let cookie = "",
  csrf = "",
  customer: any,
  pet: any,
  product: any,
  policy: any,
  claims: any[] = [],
  employeeId = "";
const today = new Date().toISOString().slice(0, 10);
async function request(
  path: string,
  method = "GET",
  body?: any,
  key?: string,
  headers: Record<string, string> = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-CSRF-Token": csrf,
      ...(key ? { "Idempotency-Key": key } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
beforeAll(async () => {
  const login = await request("/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  expect(login.status).toBe(201);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = login.data.csrf;
  employeeId = login.data.employee.id;
  product = await db.productVersion.create({
    data: {
      code: "TEST-" + randomUUID(),
      version: 1,
      name: "מוצר בדיקות מבודד",
      species: "DOG",
      minAgeMonths: 2,
      maxAgeMonths: 120,
      premiumCents: 120000,
      annualLimitCents: 100000,
      deductibleCents: 0,
      reimbursementBps: 10000,
      waitingDays: 0,
      coverages: [{ code: "VISIT", name: "ביקור", limitCents: 100000 }],
    },
  });
});
afterAll(async () => {
  if (customer) {
    const policies = await db.policy.findMany({
      where: { customerId: customer.id },
    });
    const ids = policies.map((p) => p.id);
    const c = await db.claim.findMany({ where: { policyId: { in: ids } } });
    const claimIds = c.map((c) => c.id);
    await db.paymentOrder.deleteMany({ where: { claimId: { in: claimIds } } });
    await db.claimLine.deleteMany({ where: { claimId: { in: claimIds } } });
    await db.claim.deleteMany({ where: { policyId: { in: ids } } });
    await db.charge.deleteMany({ where: { policyId: { in: ids } } });
    await db.document.deleteMany({ where: { customerId: customer.id } });
    await db.ledgerEntry.deleteMany({ where: { customerId: customer.id } });
    await db.auditEvent.deleteMany({ where: { customerId: customer.id } });
    await db.serviceCase.deleteMany({ where: { customerId: customer.id } });
    await db.policySuspension.deleteMany({ where: { policyId: { in: ids } } });
    await db.task.deleteMany({ where: { customerId: customer.id } });
    await db.policy.deleteMany({ where: { customerId: customer.id } });
    await db.pet.deleteMany({ where: { customerId: customer.id } });
    await db.customer.delete({ where: { id: customer.id } });
  }
  if (product)
    await db.productVersion.deleteMany({ where: { code: product.code } });
  await db.$disconnect();
});
describe.sequential("API על PostgreSQL אמיתי", () => {
  it("חיתום ידני עם החרגה מונע כיסוי ומפיק מסמך חתום מדומה", async () => {
    const c = await request("/customers", "POST", {
      name: "תיק חיתום בדיקה",
      phone: "TEST-UW",
    });
    expect(c.status).toBe(201);
    const customerId = c.data.id;
    let policyId = "";
    try {
      const petResult = await request(`/customers/${customerId}/pets`, "POST", {
        name: "חיה לבדיקה",
        species: "DOG",
        breed: "מעורב",
        sex: "MALE",
        birthDate: "2023-01-01",
        vaccinated: true,
        medicalHistory: "הצהרת מצב רפואי בדויה",
      });
      expect(petResult.status).toBe(201);
      const q = await request(
        "/policies",
        "POST",
        { petId: petResult.data.id, productId: product.id, startDate: today },
        randomUUID(),
      );
      expect(q.data.status).toBe("UNDERWRITING_PENDING");
      policyId = q.data.id;
      expect(
        (
          await request(
            `/policies/${policyId}/underwrite`,
            "POST",
            {
              decision: "APPROVE",
              reason: "בדיקה",
              excludedCategories: ["UNKNOWN"],
            },
            randomUUID(),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            `/policies/${policyId}/underwrite`,
            "POST",
            {
              decision: "APPROVE",
              reason: "אישור עם החרגה",
              excludedCategories: ["VISIT"],
            },
            randomUUID(),
          )
        ).data.status,
      ).toBe("QUOTED");
      expect(
        (
          await request(
            `/policies/${policyId}/activate`,
            "POST",
            { accepted: true, paymentMethod: "SIMULATED_ANNUAL" },
            randomUUID(),
          )
        ).data.status,
      ).toBe("ACTIVE");
      const claim = await request(
        "/claims",
        "POST",
        {
          policyId,
          eventDate: today,
          diagnosis: "בדיקה",
          clinic: "מרפאה בדויה",
          lines: [
            { category: "VISIT", description: "ביקור", costCents: 10000 },
          ],
        },
        randomUUID(),
      );
      expect(claim.status).toBe(201);
      expect(
        (await request(`/claims/${claim.data.id}/assessment`)).data
          .approvedCents,
      ).toBe(0);
      const doc = await db.document.findFirstOrThrow({
        where: { policyId, type: "POLICY" },
      });
      const key = randomUUID();
      expect(
        (
          await request(
            `/documents/${doc.id}/sign-simulated`,
            "POST",
            { accepted: true },
            key,
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await request(
            `/documents/${doc.id}/sign-simulated`,
            "POST",
            { accepted: true },
            key,
          )
        ).status,
      ).toBe(201);
      expect(
        await db.auditEvent.count({
          where: { entityId: doc.id, action: "document.sign_simulated" },
        }),
      ).toBe(1);
    } finally {
      const claims = await db.claim.findMany({ where: { policyId } });
      await db.claimLine.deleteMany({
        where: { claimId: { in: claims.map((x) => x.id) } },
      });
      await db.claim.deleteMany({ where: { policyId } });
      await db.charge.deleteMany({ where: { policyId } });
      await db.document.deleteMany({ where: { customerId } });
      await db.ledgerEntry.deleteMany({ where: { customerId } });
      await db.auditEvent.deleteMany({ where: { customerId } });
      await db.policy.deleteMany({ where: { customerId } });
      await db.pet.deleteMany({ where: { customerId } });
      await db.customer.delete({ where: { id: customerId } });
    }
  });

  it("מחייב התחברות", async () =>
    expect(
      (await request("/customers", "GET", undefined, undefined, { Cookie: "" }))
        .status,
    ).toBe(401));
  it("מחייב CSRF לכתיבה", async () =>
    expect(
      (
        await request(
          "/customers",
          "POST",
          { name: "לא יישמר", phone: "DEMO" },
          undefined,
          { "X-CSRF-Token": "" },
        )
      ).status,
    ).toBe(403));
  it("שומר לקוח ובעל חיים עם ביקורת", async () => {
    const c = await request("/customers", "POST", {
      name: "לקוח בדיקה " + randomUUID(),
      phone: "TEST-ONLY",
    });
    expect(c.status).toBe(201);
    customer = c.data;
    const p = await request(`/customers/${customer.id}/pets`, "POST", {
      name: "חיית בדיקה",
      species: "DOG",
      breed: "מעורב",
      sex: "MALE",
      birthDate: "2023-01-01",
      chip: String(800000000000000 + Math.floor(Math.random() * 10000000000)),
      vaccinated: true,
      neutered: false,
    });
    expect(p.status).toBe(201);
    pet = p.data;
    expect(
      await db.auditEvent.count({ where: { customerId: customer.id } }),
    ).toBe(2);
  });
  it("דוחה תאריך לא קיים", async () =>
    expect(
      (
        await request(`/customers/${customer.id}/pets`, "POST", {
          name: "בדיקה",
          species: "DOG",
          breed: "מעורב",
          sex: "MALE",
          birthDate: "2026-02-31",
          vaccinated: true,
        })
      ).status,
    ).toBe(400));
  it("מפיק הצעה אמיתית ומונע הצעה חופפת", async () => {
    const b = { petId: pet.id, productId: product.id, startDate: today };
    const r = await request("/policies", "POST", b, randomUUID());
    expect(r.status).toBe(201);
    policy = r.data;
    expect(policy.status).toBe("QUOTED");
    expect((await request("/policies", "POST", b, randomUUID())).status).toBe(
      409,
    );
  });
  it("הפעלה חוזרת עם אותו מפתח אינה מכפילה חיוב", async () => {
    const key = randomUUID(),
      b = { accepted: true, paymentMethod: "SIMULATED_ANNUAL" };
    const r = await Promise.all([
      request(`/policies/${policy.id}/activate`, "POST", b, key),
      request(`/policies/${policy.id}/activate`, "POST", b, key),
    ]);
    expect(r.map((x) => x.status)).toEqual([201, 201]);
    expect(await db.charge.count({ where: { policyId: policy.id } })).toBe(1);
  });
  it("מונע גרסת לקוח מיושנת", async () => {
    const b = {
      name: customer.name,
      phone: customer.phone,
      version: customer.version,
    };
    expect(
      (await request(`/customers/${customer.id}`, "PATCH", b)).status,
    ).toBe(200);
    expect(
      (await request(`/customers/${customer.id}`, "PATCH", b)).status,
    ).toBe(409);
  });
  it("גרסת מוצר חדשה אינה משנה פוליסה קיימת", async () => {
    const r = await request(
      `/products/${product.id}/versions`,
      "POST",
      {
        name: "גרסה חדשה",
        premiumCents: 240000,
        annualLimitCents: 100000,
        deductibleCents: 1000,
        reimbursementBps: 9000,
        waitingDays: 10,
        coverages: [{ code: "VISIT", name: "ביקור", limitCents: 100000 }],
      },
      randomUUID(),
    );
    expect(r.status).toBe(201);
    expect(r.data.version).toBe(2);
    expect(
      (await db.policy.findUniqueOrThrow({ where: { id: policy.id } }))
        .premiumCents,
    ).toBe(120000);
    await expect(
      db.productVersion.update({
        where: { id: product.id },
        data: { premiumCents: 1 },
      }),
    ).rejects.toThrow();
  });
  it("משימה נשמרת ומושלמת פעם אחת", async () => {
    const t = await request("/tasks", "POST", {
      customerId: customer.id,
      title: "בדיקת המשך",
      dueAt: today,
    });
    expect(t.status).toBe(201);
    expect(
      (await request(`/tasks/${t.data.id}/complete`, "POST", {})).data.status,
    ).toBe("COMPLETED");
    expect(
      (await request(`/tasks/${t.data.id}/complete`, "POST", {})).status,
    ).toBe(409);
  });
  it("השעיה והפעלה מחדש משמרות תקופת השעיה", async () => {
    const p = await request(
      `/policies/${policy.id}/suspend`,
      "POST",
      { reason: "בדיקת השעיה" },
      randomUUID(),
    );
    expect(p.status).toBe(201);
    expect(p.data.status).toBe("SUSPENDED");
    const period = await db.policySuspension.findFirstOrThrow({
      where: { policyId: policy.id },
    });
    expect(period.endDate).toBeNull();
    const r = await request(
      `/policies/${policy.id}/reinstate`,
      "POST",
      { reason: "בדיקת הפעלה מחדש" },
      randomUUID(),
    );
    expect(r.data.status).toBe("ACTIVE");
    expect(
      (
        await db.policySuspension.findUniqueOrThrow({
          where: { id: period.id },
        })
      ).endDate,
    ).not.toBeNull();
  });
  it("שתי תביעות מקבילות אינן חורגות מתקרה", async () => {
    for (let i = 0; i < 2; i++) {
      const c = await request(
        "/claims",
        "POST",
        {
          policyId: policy.id,
          eventDate: today,
          diagnosis: "בדיקה",
          clinic: "מרפאה בדויה",
          lines: [
            { category: "VISIT", description: "טיפול", costCents: 80000 },
          ],
        },
        randomUUID(),
      );
      expect(c.status).toBe(201);
      claims.push(c.data);
    }
    const decisions = await Promise.all(
      claims.map((c) =>
        request(
          `/claims/${c.id}/decide`,
          "POST",
          { decision: "APPROVE", reason: "בדיקת מקביליות" },
          randomUUID(),
        ),
      ),
    );
    expect(decisions.map((x) => x.status)).toEqual([201, 201]);
    expect(decisions.reduce((s, r) => s + r.data.approvedCents, 0)).toBe(
      100000,
    );
    const p = await db.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(p.reservedCents).toBe(100000);
    expect(p.paidCents).toBe(0);
  });
  it("תשלום מדומה יחיד מעביר שריון לשולם", async () => {
    const order = await db.paymentOrder.findUniqueOrThrow({
      where: { claimId: claims[0].id },
    });
    const key = randomUUID();
    const r = await Promise.all([
      request(`/payment-orders/${order.id}/execute-simulated`, "POST", {}, key),
      request(`/payment-orders/${order.id}/execute-simulated`, "POST", {}, key),
    ]);
    expect(r.map((x) => x.status)).toEqual([201, 201]);
    expect(
      (
        await request(
          `/payment-orders/${order.id}/execute-simulated`,
          "POST",
          {},
          randomUUID(),
        )
      ).status,
    ).toBe(409);
    expect(
      await db.ledgerEntry.count({
        where: { referenceId: order.id, kind: "CLAIM_PAYMENT_SIMULATED" },
      }),
    ).toBe(1);
    const p = await db.policy.findUniqueOrThrow({ where: { id: policy.id } });
    expect(p.reservedCents + p.paidCents).toBe(100000);
  });
  it("גבייה מדומה חוזרת אינה מוכפלת", async () => {
    const charge = await db.charge.findFirstOrThrow({
      where: { policyId: policy.id },
    });
    const key = randomUUID();
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(
            `/charges/${charge.id}/collect-simulated`,
            "POST",
            { amountCents: 20000 },
            key,
          )
        ).status,
      ).toBe(201);
    expect(
      (await db.charge.findUniqueOrThrow({ where: { id: charge.id } }))
        .paidCents,
    ).toBe(20000);
    expect(
      (
        await request(
          `/charges/${charge.id}/collect-simulated`,
          "POST",
          { amountCents: 200000 },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("הרשאת מבקר אינה מאפשרת תשלום", async () => {
    const email = `audit-${randomUUID()}@example.invalid`,
      password = randomUUID();
    const u = await db.employee.create({
      data: {
        email,
        name: "בודק הרשאות",
        role: "AUDITOR",
        passwordHash: await argon2.hash(password),
      },
    });
    try {
      const l = await request("/auth/login", "POST", { email, password });
      const order = await db.paymentOrder.findUniqueOrThrow({
        where: { claimId: claims[1].id },
      });
      const r = await request(
        `/payment-orders/${order.id}/execute-simulated`,
        "POST",
        {},
        randomUUID(),
        {
          Cookie: l.headers.get("set-cookie")!.split(";")[0],
          "X-CSRF-Token": l.data.csrf,
        },
      );
      expect(r.status).toBe(403);
      expect(
        (await db.paymentOrder.findUniqueOrThrow({ where: { id: order.id } }))
          .status,
      ).toBe("APPROVED");
    } finally {
      await db.session.deleteMany({ where: { employeeId: u.id } });
      await db.employee.delete({ where: { id: u.id } });
    }
  });
  it("ביטול שומר תביעות ויוצר זיכוי והחזר ממתין", async () => {
    const before = await db.claim.count({ where: { policyId: policy.id } });
    const preview = await request(
      `/policies/${policy.id}/cancellation-preview?at=${today}`,
    );
    expect(preview.data.creditCents).toBe(120000);
    expect(preview.data.refundCents).toBe(20000);
    const result = await request(
      `/policies/${policy.id}/cancel`,
      "POST",
      { at: today, reason: "בדיקת ביטול" },
      randomUUID(),
    );
    expect(result.status).toBe(201);
    expect(result.data.refundDueCents).toBe(20000);
    expect(await db.claim.count({ where: { policyId: policy.id } })).toBe(
      before,
    );
    expect(
      await db.document.count({
        where: { policyId: policy.id, type: "CANCELLATION" },
      }),
    ).toBe(1);
  });
  it("פנייה נסגרת ונפתחת עם תיעוד", async () => {
    const c = await request("/service-cases", "POST", {
      customerId: customer.id,
      subject: "בדיקה",
      description: "בדיקה",
      priority: "NORMAL",
    });
    expect(c.status).toBe(201);
    expect(
      (
        await request(`/service-cases/${c.data.id}`, "PATCH", {
          status: "CLOSED",
          reason: "הטיפול הסתיים",
        })
      ).data.status,
    ).toBe("CLOSED");
    expect(
      (
        await request(`/service-cases/${c.data.id}`, "PATCH", {
          status: "OPEN",
          reason: "נדרש המשך",
        })
      ).data.status,
    ).toBe("OPEN");
  });
});
