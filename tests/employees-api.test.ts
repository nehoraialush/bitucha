import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "../apps/api/src/db";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3000/api/v1";
let cookie = "",
  csrf = "",
  workerCookie = "",
  workerCsrf = "",
  worker: any,
  admin: any;
const keys: string[] = [];
const password = randomUUID() + randomUUID();
const email = randomUUID() + "@example.invalid";
async function req(
  path: string,
  body?: any,
  key = randomUUID(),
  asWorker = false,
) {
  keys.push(key);
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: asWorker ? workerCookie : cookie,
      "X-CSRF-Token": asWorker ? workerCsrf : csrf,
      "Idempotency-Key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const input = () => ({
  name: "עובד בדיקה",
  role: "UNDERWRITER",
  active: true,
  department: "חיתום",
  team: "בדיקות",
  managerId: admin.id,
  permissionMode: "CUSTOM",
  grants: ["application.read"],
  approvalLimitCents: 10000,
});
async function workerLogin() {
  const r = await req("/auth/login", { email, password });
  expect(r.status).toBe(201);
  workerCookie = r.headers.get("set-cookie")!.split(";")[0];
  workerCsrf = r.data.csrf;
  return r;
}
beforeAll(async () => {
  const login = await req("/auth/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  expect(login.status).toBe(201);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = login.data.csrf;
  admin = login.data.employee;
});
afterAll(async () => {
  if (worker) {
    await db.employeePermission.deleteMany({
      where: { employeeId: worker.id },
    });
    await db.session.deleteMany({ where: { employeeId: worker.id } });
    await db.auditEvent.deleteMany({ where: { entityId: worker.id } });
    await db.employee.deleteMany({ where: { id: worker.id } });
  }
  await db.command.deleteMany({ where: { key: { in: keys } } });
  await db.$disconnect();
});
describe.sequential(
  "Employee administration and effective action permissions",
  () => {
    it("creates an employee idempotently without exposing credential material", async () => {
      const body = { ...input(), email, password },
        key = randomUUID();
      const created = await req("/employees", body, key);
      expect(created.status, JSON.stringify(created.data)).toBe(201);
      worker = created.data;
      expect(worker.version).toBe(1);
      expect(worker.passwordHash).toBeUndefined();
      expect(worker.password).toBeUndefined();
      expect((await req("/employees", body, key)).data.id).toBe(worker.id);
      expect(
        (
          await req(
            "/employees",
            { ...body, password: password + "changed" },
            key,
          )
        ).status,
      ).toBe(409);
      expect(await db.employee.count({ where: { email } })).toBe(1);
      const stored = await db.employee.findUniqueOrThrow({
        where: { id: worker.id },
      });
      expect(stored.passwordHash).toContain("$argon2id$");
      const audit = await db.auditEvent.findMany({
        where: { entityId: worker.id },
      });
      expect(JSON.stringify(audit)).not.toContain(password);
    });
    it("enforces custom permissions instead of automatically granting the role permissions", async () => {
      const login = await workerLogin();
      expect(login.data.permissions).toEqual(["application.read"]);
      expect(
        (await req("/employees", undefined, randomUUID(), true)).status,
      ).toBe(403);
      expect((await req("/applications", {}, randomUUID(), true)).status).toBe(
        403,
      );
      expect(
        (await req("/business-actions", undefined, randomUUID(), true)).data,
      ).toEqual([]);
    });
    it("revokes old sessions on permission changes and rejects stale administrative writes", async () => {
      const body = {
        ...input(),
        version: worker.version,
        grants: ["application.read", "underwriting.decide"],
      };
      const update = await req(`/employees/${worker.id}/update`, body);
      expect(update.status).toBe(201);
      worker = update.data;
      expect(worker.version).toBe(2);
      expect(
        (await req("/auth/session", undefined, randomUUID(), true)).status,
      ).toBe(401);
      expect((await req(`/employees/${worker.id}/update`, body)).status).toBe(
        409,
      );
      const login = await workerLogin();
      expect(login.data.permissions).toContain("underwriting.decide");
      const session = await req("/auth/session", undefined, randomUUID(), true);
      expect(session.data.employee.approvalLimitCents).toBe(10000);
    });
    it("prevents privilege escalation, self-disable and management cycles", async () => {
      expect(
        (
          await req(`/employees/${worker.id}/update`, {
            ...input(),
            version: worker.version,
            grants: ["*"],
          })
        ).status,
      ).toBe(403);
      const listed = await req("/employees");
      const root = listed.data.employees.find((e: any) => e.id === admin.id);
      const body = {
        ...root,
        grants: root.permissionGrants.map((g: any) => g.permission),
      };
      expect(
        (await req(`/employees/${admin.id}/update`, { ...body, active: false }))
          .status,
      ).toBe(409);
      expect(
        (
          await req(`/employees/${admin.id}/update`, {
            ...body,
            managerId: worker.id,
          })
        ).status,
      ).toBe(400);
      expect((await req("/auth/session")).status).toBe(200);
    });
    it("enforces a configured claim approval limit in the server transaction", async () => {
      const update = await req(`/employees/${worker.id}/update`, {
        ...input(),
        version: worker.version,
        grants: [
          "application.read",
          "underwriting.decide",
          "claim.decide",
          "claim.large",
        ],
      });
      expect(update.status).toBe(201);
      worker = update.data;
      await workerLogin();
      const product = await db.productVersion.create({
        data: {
          code: "EMP-CAP-" + randomUUID(),
          version: 1,
          name: "מוצר בדיקת סמכות",
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
      let customerId = "",
        policyId = "";
      try {
        const customer = await req("/customers", {
          name: "תיק סמכות בדיקה",
          phone: "TEST-CAP",
        });
        expect(customer.status).toBe(201);
        customerId = customer.data.id;
        const pet = await req(`/customers/${customerId}/pets`, {
          name: "חיית סמכות בדיקה",
          species: "DOG",
          breed: "מעורב",
          sex: "MALE",
          birthDate: "2023-01-01",
          vaccinated: true,
          chip: "7" + String(Date.now()).slice(-13) + "1",
        });
        expect(pet.status).toBe(201);
        const policy = await req("/policies", {
          petId: pet.data.id,
          productId: product.id,
          startDate: new Date().toISOString().slice(0, 10),
        });
        expect(policy.status).toBe(201);
        policyId = policy.data.id;
        expect(
          (
            await req(`/policies/${policyId}/activate`, {
              accepted: true,
              paymentMethod: "SIMULATED_ANNUAL",
            })
          ).status,
        ).toBe(201);
        const claim = await req("/claims", {
          policyId,
          eventDate: new Date().toISOString().slice(0, 10),
          diagnosis: "בדיקת גבול סמכות",
          clinic: "מרפאה בדויה",
          lines: [
            { category: "VISIT", description: "ביקור", costCents: 20000 },
          ],
        });
        expect(claim.status).toBe(201);
        const denied = await req(
          `/claims/${claim.data.id}/decide`,
          { decision: "APPROVE", reason: "בדיקת סמכות" },
          randomUUID(),
          true,
        );
        expect(denied.status).toBe(403);
        expect(
          (await db.claim.findUniqueOrThrow({ where: { id: claim.data.id } }))
            .status,
        ).toBe("SUBMITTED");
        expect(
          (await db.policy.findUniqueOrThrow({ where: { id: policyId } }))
            .reservedCents,
        ).toBe(0);
        expect(
          (
            await req(`/claims/${claim.data.id}/decide`, {
              decision: "APPROVE",
              reason: "אישור מנהל בדיקה",
            })
          ).status,
        ).toBe(201);
      } finally {
        if (policyId) {
          const claims = await db.claim.findMany({ where: { policyId } });
          await db.paymentOrder.deleteMany({
            where: { claimId: { in: claims.map((c) => c.id) } },
          });
          await db.claimLine.deleteMany({
            where: { claimId: { in: claims.map((c) => c.id) } },
          });
          await db.claim.deleteMany({ where: { policyId } });
          await db.charge.deleteMany({ where: { policyId } });
        }
        if (customerId) {
          await db.document.deleteMany({ where: { customerId } });
          await db.ledgerEntry.deleteMany({ where: { customerId } });
          await db.auditEvent.deleteMany({ where: { customerId } });
          await db.policy.deleteMany({ where: { customerId } });
          await db.pet.deleteMany({ where: { customerId } });
          await db.customer.deleteMany({ where: { id: customerId } });
        }
        await db.productVersion.delete({ where: { id: product.id } });
      }
    });
    it("disables access and sessions for an inactive employee", async () => {
      const update = await req(`/employees/${worker.id}/update`, {
        ...input(),
        version: worker.version,
        active: false,
      });
      expect(update.status).toBe(201);
      worker = update.data;
      expect(
        (await req("/auth/session", undefined, randomUUID(), true)).status,
      ).toBe(401);
      expect((await req("/auth/login", { email, password })).status).toBe(401);
    });
  },
);
