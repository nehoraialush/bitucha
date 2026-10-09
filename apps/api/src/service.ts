import {
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "./generated/client";
import { db } from "./db";
import { Actor, need, permissions, actorPermissions } from "./auth";
import {
  text,
  optional,
  integer,
  date,
  choice,
  bool,
  today,
} from "./validation";
import {
  ageMonths,
  anniversary,
  assessClaim,
  cancellationCredit,
  Terms,
} from "../../../packages/domain/src/insurance";
type Tx = Prisma.TransactionClient;
const json = (v: any) => JSON.parse(JSON.stringify(v));
const must = <T>(v: T | null): T => {
  if (v === null) throw new NotFoundException("הרשומה לא נמצאה");
  return v;
};
async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  id: string,
  customerId: string | null,
  before: any,
  after: any,
  reason = "",
) {
  await tx.auditEvent.create({
    data: {
      employeeId: actor.id,
      action,
      entityId: id,
      customerId,
      before: before == null ? Prisma.JsonNull : json(before),
      after: json(after),
      reason,
      processId: randomUUID(),
    },
  });
}
async function document(
  tx: Tx,
  type: string,
  title: string,
  customerId: string,
  policyId: string | null,
  claimId: string | null,
  snapshot: any,
) {
  return tx.document.create({
    data: {
      type,
      title,
      customerId,
      policyId,
      claimId,
      snapshot: json({
        ...snapshot,
        policy:
          snapshot.policy ??
          (policyId
            ? await tx.policy.findUnique({ where: { id: policyId } })
            : null),
        customer: await tx.customer.findUnique({ where: { id: customerId } }),
      }),
    },
  });
}
async function lockedPolicy(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Policy" WHERE id=${id} FOR UPDATE`;
  return must(
    await tx.policy.findUnique({
      where: { id },
      include: { pet: true, customer: true },
    }),
  );
}
export class InsuranceService {
  async command(
    actor: Actor,
    action: string,
    key: unknown,
    body: any,
    fn: (tx: Tx) => Promise<any>,
  ) {
    const k = text(key, "מזהה פעולה", 120);
    const requestHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    for (let retry = 0; ; retry++)
      try {
        return await db.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id + ":" + action + ":" + k}))::text`;
            const old = await tx.command.findUnique({
              where: {
                employeeId_action_key: { employeeId: actor.id, action, key: k },
              },
            });
            if (old) {
              if (old.requestHash !== requestHash)
                throw new ConflictException("מזהה הפעולה כבר שימש לבקשה אחרת");
              return old.response;
            }
            const result = json(await fn(tx));
            await tx.command.create({
              data: {
                employeeId: actor.id,
                action,
                key: k,
                requestHash,
                response: result,
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 15000,
          },
        );
      } catch (e: any) {
        if (
          (e.code === "P2034" ||
            e.code === "P2002" ||
            (e.code === "P2010" &&
              ["40001", "40P01"].includes(
                e.meta?.code || e.meta?.driverAdapterError?.cause?.originalCode,
              ))) &&
          retry < 3
        )
          continue;
        throw e;
      }
  }
  async customers(q: string) {
    return db.customer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { email: { contains: q, mode: "insensitive" } },
              { identifier: { contains: q } },
              ...(Number.isInteger(Number(q)) ? [{ number: Number(q) }] : []),
            ],
          }
        : {},
      orderBy: { number: "asc" },
      take: 200,
      include: { _count: { select: { pets: true, policies: true } } },
    });
  }
  async workspace(id: string, actor: Actor) {
    const medical = actorPermissions(actor).some((p) =>
      ["*", "application.read", "claim.write"].includes(p),
    );
    const applicationRead = actorPermissions(actor).some((p) =>
      ["*", "application.read"].includes(p),
    );
    const customer = must(
      await db.customer.findUnique({
        where: { id },
        include: {
          pets: true,
          policies: {
            include: {
              product: true,
              claims: { include: { lines: true, payment: true } },
              charges: true,
            },
          },
          cases: true,
          tasks: true,
        },
      }),
    );
    const [documents, audit, ledger] = await Promise.all([
      db.document.findMany({
        where: {
          customerId: id,
          ...(!applicationRead
            ? {
                type: {
                  notIn: [
                    "APPLICATION",
                    "HEALTH_DECLARATION",
                    "UNDERWRITING",
                    "SIMULATED_SIGNATURE",
                  ],
                },
              }
            : {}),
        },
        select: {
          id: true,
          number: true,
          customerId: true,
          policyId: true,
          claimId: true,
          type: true,
          title: true,
          signedAt: true,
          signedBy: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      db.auditEvent.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      db.ledgerEntry.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const employees = await db.employee.findMany({
      where: { id: { in: [...new Set(audit.map((a) => a.employeeId))] } },
      select: { id: true, name: true },
    });
    return {
      ...customer,
      pets: customer.pets.map((p) =>
        medical
          ? p
          : { ...p, medicalHistory: "מידע רפואי מוגבל לפי הרשאה", profile: {} },
      ),
      documents,
      audit: audit.map((a) => ({
        ...a,
        employeeName: employees.find((e) => e.id === a.employeeId)?.name,
      })),
      ledger,
    };
  }
  async createCustomer(actor: Actor, b: any) {
    need(actor, "customer.write");
    const data = {
      name: text(b.name, "שם", 150),
      phone: text(b.phone, "טלפון", 30),
      email: optional(b.email, 150) || null,
      address: optional(b.address, 500),
      notes: optional(b.notes),
    };
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      throw new BadRequestException("דוא״ל לא תקין");
    return db.$transaction(async (tx) => {
      const c = await tx.customer.create({ data });
      await audit(tx, actor, "customer.create", c.id, c.id, null, c);
      return c;
    });
  }
  async updateCustomer(actor: Actor, id: string, b: any) {
    need(actor, "customer.write");
    return db.$transaction(async (tx) => {
      const old = must(await tx.customer.findUnique({ where: { id } }));
      if (integer(b.version, "גרסה", 1) !== old.version)
        throw new ConflictException("התיק השתנה. יש לרענן");
      const result = await tx.customer.updateMany({
        where: { id, version: old.version },
        data: {
          name: text(b.name, "שם", 150),
          phone: text(b.phone, "טלפון", 30),
          address: optional(b.address, 500),
          notes: optional(b.notes),
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException("התיק השתנה");
      const c = await tx.customer.findUniqueOrThrow({ where: { id } });
      await audit(tx, actor, "customer.update", id, id, old, c);
      return c;
    });
  }
  async createPet(actor: Actor, customerId: string, b: any) {
    need(actor, "customer.write");
    const birthDate = date(b.birthDate, "תאריך לידה");
    if (birthDate > today()) throw new BadRequestException("תאריך לידה עתידי");
    const chip = optional(b.chip, 30) || null;
    if (chip && !/^\d{15}$/.test(chip))
      throw new BadRequestException("מספר שבב חייב להכיל 15 ספרות");
    return db.$transaction(async (tx) => {
      must(await tx.customer.findUnique({ where: { id: customerId } }));
      const p = await tx.pet.create({
        data: {
          customerId,
          name: text(b.name, "שם חיה", 100),
          species: choice(b.species, ["DOG", "CAT"], "סוג"),
          breed: text(b.breed, "גזע", 100),
          sex: choice(b.sex, ["MALE", "FEMALE"], "מין"),
          birthDate,
          chip,
          vaccinated: bool(b.vaccinated, "חיסונים"),
          neutered: bool(b.neutered ?? false, "עיקור"),
          medicalHistory: optional(b.medicalHistory),
        },
      });
      await audit(tx, actor, "pet.create", p.id, customerId, null, p);
      return p;
    });
  }
  async products() {
    return db.productVersion.findMany({
      where: { published: true },
      include: { riders: true },
      orderBy: [{ code: "asc" }, { version: "desc" }],
    });
  }
  async createPolicy(actor: Actor, b: any, key: unknown) {
    need(actor, "policy.write");
    return this.command(actor, "policy.create", key, b, async (tx) => {
      const pet = must(
        await tx.pet.findUnique({ where: { id: text(b.petId, "חיה") } }),
      );
      const product = must(
        await tx.productVersion.findUnique({
          where: { id: text(b.productId, "מוצר") },
        }),
      );
      if (!product.published) throw new BadRequestException("מוצר לא פורסם");
      const startDate = date(b.startDate, "תחילת כיסוי");
      if (startDate < today())
        throw new BadRequestException("אין הרשאה להפקה רטרואקטיבית");
      const months = ageMonths(pet.birthDate, startDate);
      if (
        product.species !== pet.species ||
        months < product.minAgeMonths ||
        months > product.maxAgeMonths
      )
        throw new BadRequestException("בעל החיים אינו עומד בתנאי הזכאות");
      const existing = await tx.policy.findFirst({
        where: {
          petId: pet.id,
          status: { notIn: ["CANCELLED", "EXPIRED"] },
          startDate: { lt: anniversary(startDate) },
          endDate: { gt: startDate },
        },
      });
      if (existing)
        throw new ConflictException("קיימת פוליסה או הצעה חופפת לבעל החיים");
      const requiresReview =
        !!pet.medicalHistory || !pet.vaccinated || !pet.chip;
      const policy = await tx.policy.create({
        data: {
          customerId: pet.customerId,
          petId: pet.id,
          productId: product.id,
          startDate,
          endDate: anniversary(startDate),
          snapshot: json(product),
          premiumCents: product.premiumCents,
          annualLimitCents: product.annualLimitCents,
          status: requiresReview ? "UNDERWRITING_PENDING" : "QUOTED",
          underwritingReason: requiresReview
            ? "נדרשת בדיקה: היסטוריה רפואית, חיסונים או שבב חסר"
            : "אישור אוטומטי לפי כללי סימולציה",
        },
      });
      await audit(
        tx,
        actor,
        "policy.quote",
        policy.id,
        pet.customerId,
        null,
        policy,
      );
      await document(
        tx,
        "QUOTE",
        "הצעת ביטוח",
        pet.customerId,
        policy.id,
        null,
        policy,
      );
      return policy;
    });
  }
  async underwrite(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "underwriting.decide");
    const decision = choice(b.decision, ["APPROVE", "REJECT"], "החלטה");
    const reason = text(b.reason, "נימוק");
    return this.command(
      actor,
      "policy.underwrite",
      key,
      { id, ...b },
      async (tx) => {
        const p = await lockedPolicy(tx, id);
        if (p.status !== "UNDERWRITING_PENDING")
          throw new ConflictException("הפוליסה אינה ממתינה לחיתום");
        const exclusions = Array.isArray(b.excludedCategories)
          ? b.excludedCategories.map((x: unknown) => text(x, "החרגה", 100))
          : [];
        const terms = p.snapshot as unknown as Terms;
        if (
          exclusions.some(
            (code: string) => !terms.coverages.some((c) => c.code === code),
          )
        )
          throw new BadRequestException("החרגה אינה קיימת בכיסויי הפוליסה");
        const updated = await tx.policy.update({
          where: { id },
          data: {
            exclusions,
            status: decision === "APPROVE" ? "QUOTED" : "DECLINED",
            underwritingReason: reason,
            version: { increment: 1 },
          },
        });
        await audit(
          tx,
          actor,
          "underwriting.decision",
          id,
          p.customerId,
          p,
          updated,
          reason,
        );
        return updated;
      },
    );
  }
  async activate(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    if (b.accepted !== true) throw new BadRequestException("נדרש אישור תנאים");
    choice(b.paymentMethod, ["SIMULATED_ANNUAL"], "אמצעי תשלום");
    return this.command(
      actor,
      "policy.activate",
      key,
      { id, ...b },
      async (tx) => {
        const p = await lockedPolicy(tx, id);
        if (p.status !== "QUOTED")
          throw new ConflictException("נדרשת הצעה מאושרת");
        const policy = await tx.policy.update({
          where: { id },
          data: {
            status: "ACTIVE",
            conditionsAccepted: true,
            paymentMethod: b.paymentMethod,
            version: { increment: 1 },
          },
        });
        const charge = await tx.charge.create({
          data: {
            policyId: id,
            amountCents: p.premiumCents,
            dueAt: p.startDate,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            customerId: p.customerId,
            policyId: id,
            referenceId: charge.id,
            kind: "CHARGE",
            amountCents: p.premiumCents,
          },
        });
        await audit(tx, actor, "policy.activate", id, p.customerId, p, policy);
        await document(
          tx,
          "POLICY",
          "פוליסת ביטוח — סימולציה",
          p.customerId,
          id,
          null,
          { policy, customer: p.customer, pet: p.pet, terms: p.snapshot },
        );
        return policy;
      },
    );
  }
  async createClaim(actor: Actor, b: any, key: unknown) {
    need(actor, "claim.write");
    const eventDate = date(b.eventDate, "מועד אירוע");
    if (eventDate > today())
      throw new BadRequestException("אירוע עתידי אינו מותר");
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 30)
      throw new BadRequestException("יש להזין 1–30 טיפולים");
    const lines = b.lines.map((l: any, position: number) => ({
      position,
      category: text(l.category, "כיסוי", 100),
      description: text(l.description, "תיאור טיפול", 500),
      costCents: integer(l.costCents, "עלות באגורות", 1, 10000000),
    }));
    return this.command(actor, "claim.create", key, b, async (tx) => {
      const p = await lockedPolicy(tx, text(b.policyId, "פוליסה"));
      if (!["ACTIVE", "CANCELLED", "EXPIRED", "SUSPENDED"].includes(p.status))
        throw new ConflictException("הפוליסה לא הופעלה");
      const c = await tx.claim.create({
        data: {
          policyId: p.id,
          eventDate,
          diagnosis: text(b.diagnosis, "אבחנה", 1000),
          clinic: text(b.clinic, "מרפאה", 200),
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await audit(tx, actor, "claim.submit", c.id, p.customerId, null, c);
      return c;
    });
  }
  async evaluate(tx: Tx, id: string) {
    const c = must(
      await tx.claim.findUnique({
        where: { id },
        include: { lines: { orderBy: { position: "asc" } } },
      }),
    );
    const p = await lockedPolicy(tx, c.policyId);
    const previous = await tx.claimLine.findMany({
      where: {
        claim: {
          policyId: p.id,
          status: { in: ["APPROVED", "PARTIALLY_APPROVED", "PAID"] },
          id: { not: id },
        },
      },
    });
    const usedByCategory: Record<string, number> = {};
    for (const l of previous)
      usedByCategory[l.category] =
        (usedByCategory[l.category] || 0) + l.approvedCents;
    const result = assessClaim({
      terms: p.snapshot as unknown as Terms,
      start: p.startDate,
      end: p.endDate,
      cancelledAt: p.cancelledAt,
      event: c.eventDate,
      availableCents: p.annualLimitCents - p.reservedCents - p.paidCents,
      usedByCategory,
      excludedCategories: p.exclusions as string[],
      suspended: !!(await tx.policySuspension.findFirst({
        where: {
          policyId: p.id,
          startDate: { lte: c.eventDate },
          OR: [{ endDate: null }, { endDate: { gt: c.eventDate } }],
        },
      })),
      lines: c.lines,
    });
    return { c, p, result };
  }
  async assess(id: string) {
    return db.$transaction(async (tx) => (await this.evaluate(tx, id)).result);
  }
  async decideClaim(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "claim.decide");
    const decision = choice(
      b.decision,
      ["APPROVE", "REJECT", "NEEDS_INFORMATION"],
      "החלטה",
    );
    const reason = text(b.reason, "נימוק");
    return this.command(
      actor,
      "claim.decide",
      key,
      { id, ...b },
      async (tx) => {
        const { c, p, result } = await this.evaluate(tx, id);
        if (!["SUBMITTED", "NEEDS_INFORMATION"].includes(c.status))
          throw new ConflictException("לתביעה כבר קיימת החלטה");
        if (result.approvedCents > 500000 && decision === "APPROVE")
          need(actor, "claim.large");
        if (
          decision === "APPROVE" &&
          actor.approvalLimitCents != null &&
          result.approvedCents > actor.approvalLimitCents
        )
          throw new ForbiddenException(
            "הסכום חורג מסמכות האישור שהוגדרה לעובד",
          );
        const amount = decision === "APPROVE" ? result.approvedCents : 0;
        const status =
          decision === "APPROVE"
            ? result.status
            : decision === "REJECT"
              ? "REJECTED"
              : "NEEDS_INFORMATION";
        for (let i = 0; i < c.lines.length; i++)
          await tx.claimLine.update({
            where: { id: c.lines[i].id },
            data: {
              approvedCents:
                decision === "APPROVE" ? result.lines[i].approvedCents : 0,
              reason: decision === "APPROVE" ? result.lines[i].reason : reason,
            },
          });
        const updated = await tx.claim.update({
          where: { id },
          data: {
            status,
            reason,
            approvedCents: amount,
            version: { increment: 1 },
          },
        });
        if (amount > 0) {
          await tx.policy.update({
            where: { id: p.id },
            data: {
              reservedCents: { increment: amount },
              version: { increment: 1 },
            },
          });
          await tx.paymentOrder.create({
            data: { claimId: id, amountCents: amount },
          });
        }
        await audit(
          tx,
          actor,
          "claim.decision",
          id,
          p.customerId,
          c,
          { ...updated, calculation: result },
          reason,
        );
        await document(
          tx,
          "CLAIM_DECISION",
          "החלטה בתביעה",
          p.customerId,
          p.id,
          id,
          { claim: updated, calculation: result, reason },
        );
        return updated;
      },
    );
  }
  async executePayment(actor: Actor, id: string, key: unknown) {
    need(actor, "payment.execute");
    return this.command(actor, "payment.execute", key, { id }, async (tx) => {
      const order = must(
        await tx.paymentOrder.findUnique({
          where: { id },
          include: { claim: true },
        }),
      );
      const p = await lockedPolicy(tx, order.claim.policyId);
      const fresh = await tx.paymentOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== "APPROVED")
        throw new ConflictException("הוראת התשלום כבר בוצעה או בוטלה");
      await tx.paymentOrder.update({
        where: { id },
        data: { status: "EXECUTED", executedAt: new Date() },
      });
      await tx.claim.update({
        where: { id: order.claimId },
        data: { status: "PAID", version: { increment: 1 } },
      });
      await tx.policy.update({
        where: { id: p.id },
        data: {
          reservedCents: { decrement: order.amountCents },
          paidCents: { increment: order.amountCents },
          version: { increment: 1 },
        },
      });
      await tx.ledgerEntry.create({
        data: {
          customerId: p.customerId,
          policyId: p.id,
          referenceId: id,
          kind: "CLAIM_PAYMENT_SIMULATED",
          amountCents: order.amountCents,
        },
      });
      await audit(
        tx,
        actor,
        "payment.execute_simulated",
        id,
        p.customerId,
        fresh,
        { status: "EXECUTED", amountCents: order.amountCents },
      );
      await document(
        tx,
        "PAYMENT",
        "אישור תשלום מדומה",
        p.customerId,
        p.id,
        order.claimId,
        { amountCents: order.amountCents, orderId: id },
      );
      return { status: "EXECUTED" };
    });
  }
  async collect(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "collection.write");
    const amount = integer(b.amountCents, "סכום", 1);
    return this.command(
      actor,
      "charge.collect",
      key,
      { id, ...b },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Charge" WHERE id=${id} FOR UPDATE`;
        const charge = must(
          await tx.charge.findUnique({
            where: { id },
            include: { policy: true },
          }),
        );
        if (
          amount >
          charge.amountCents - charge.creditedCents - charge.paidCents
        )
          throw new BadRequestException("הסכום גבוה מיתרת החוב");
        const updated = await tx.charge.update({
          where: { id },
          data: { paidCents: { increment: amount } },
        });
        await tx.ledgerEntry.create({
          data: {
            customerId: charge.policy.customerId,
            policyId: charge.policyId,
            referenceId: id,
            kind: "COLLECTION_SIMULATED",
            amountCents: amount,
          },
        });
        await audit(
          tx,
          actor,
          "charge.collect_simulated",
          id,
          charge.policy.customerId,
          charge,
          updated,
        );
        await document(
          tx,
          "RECEIPT",
          "קבלת סימולציה",
          charge.policy.customerId,
          charge.policyId,
          null,
          { amountCents: amount, chargeId: id },
        );
        return updated;
      },
    );
  }
  async cancellationPreview(id: string, at: string) {
    const p = must(
      await db.policy.findUnique({ where: { id }, include: { charges: true } }),
    );
    const d = date(at, "מועד ביטול");
    let credit: number;
    try {
      credit = cancellationCredit(p.premiumCents, p.startDate, p.endDate, d);
    } catch {
      throw new BadRequestException("תאריך הביטול מחוץ לתקופה");
    }
    const paid = p.charges.reduce((s, c) => s + c.paidCents, 0);
    return {
      creditCents: credit,
      refundCents: Math.max(0, paid - (p.premiumCents - credit)),
      debtCents: Math.max(0, p.premiumCents - credit - paid),
      at: d.toISOString().slice(0, 10),
    };
  }
  async cancelPolicy(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.cancel");
    const reason = text(b.reason, "סיבת ביטול");
    const at = date(b.at, "מועד ביטול");
    if (at < today())
      throw new BadRequestException("ביטול רטרואקטיבי לא נתמך בשלב זה");
    return this.command(
      actor,
      "policy.cancel",
      key,
      { id, ...b },
      async (tx) => {
        const p = await lockedPolicy(tx, id);
        if (!["ACTIVE", "SUSPENDED"].includes(p.status))
          throw new ConflictException("הפוליסה אינה פעילה");
        let credit: number;
        try {
          credit = cancellationCredit(
            p.premiumCents,
            p.startDate,
            p.endDate,
            at,
          );
        } catch {
          throw new BadRequestException("תאריך הביטול מחוץ לתקופה");
        }
        const charges = await tx.charge.findMany({
          where: { policyId: id, kind: "PREMIUM" },
          orderBy: [{ dueAt: "desc" }, { id: "asc" }],
        });
        if (!charges.length)
          throw new ConflictException("אין לוח חיובים לפוליסה");
        let remainingCredit = credit;
        for (const charge of charges) {
          const allocation = Math.min(
            remainingCredit,
            charge.amountCents - charge.creditedCents,
          );
          if (allocation > 0)
            await tx.charge.update({
              where: { id: charge.id },
              data: { creditedCents: { increment: allocation } },
            });
          remainingCredit -= allocation;
        }
        if (remainingCredit !== 0)
          throw new ConflictException("לוח החיובים אינו תואם לפרמיית הפוליסה");
        const refund = Math.max(
          0,
          charges.reduce((sum, charge) => sum + charge.paidCents, 0) -
            (p.premiumCents - credit),
        );
        const updated = await tx.policy.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancelledAt: at,
            version: { increment: 1 },
          },
        });
        await tx.ledgerEntry.create({
          data: {
            customerId: p.customerId,
            policyId: id,
            referenceId: id,
            kind: "CANCELLATION_CREDIT",
            amountCents: credit,
          },
        });
        if (refund)
          await tx.ledgerEntry.create({
            data: {
              customerId: p.customerId,
              policyId: id,
              referenceId: id,
              kind: "REFUND_DUE",
              amountCents: refund,
            },
          });
        await audit(
          tx,
          actor,
          "policy.cancel",
          id,
          p.customerId,
          p,
          { ...updated, creditCents: credit, refundDueCents: refund },
          reason,
        );
        await document(
          tx,
          "CANCELLATION",
          "אישור ביטול פוליסה",
          p.customerId,
          id,
          null,
          {
            policy: updated,
            reason,
            creditCents: credit,
            refundDueCents: refund,
          },
        );
        return { ...updated, creditCents: credit, refundDueCents: refund };
      },
    );
  }
  async caseCreate(actor: Actor, b: any) {
    need(actor, "case.write");
    return db.$transaction(async (tx) => {
      must(
        await tx.customer.findUnique({
          where: { id: text(b.customerId, "לקוח") },
        }),
      );
      const c = await tx.serviceCase.create({
        data: {
          customerId: b.customerId,
          subject: text(b.subject, "נושא", 200),
          description: text(b.description, "תיאור"),
          priority: choice(b.priority, ["NORMAL", "HIGH", "URGENT"], "דחיפות"),
          assignedTo: actor.id,
        },
      });
      await audit(tx, actor, "case.create", c.id, c.customerId, null, c);
      return c;
    });
  }
  async caseStatus(actor: Actor, id: string, b: any) {
    need(actor, "case.write");
    const reason = text(b.reason, "סיכום טיפול");
    const status = choice(b.status, ["OPEN", "CLOSED"], "מצב");
    return db.$transaction(async (tx) => {
      const old = must(await tx.serviceCase.findUnique({ where: { id } }));
      if (old.status === status)
        throw new ConflictException("הפנייה כבר במצב המבוקש");
      const c = await tx.serviceCase.update({
        where: { id },
        data: { status },
      });
      await audit(tx, actor, "case.status", id, c.customerId, old, c, reason);
      return c;
    });
  }
  async sign(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "document.sign");
    if (b.accepted !== true)
      throw new BadRequestException("נדרש אישור מפורש לחתימה מדומה");
    return this.command(
      actor,
      "document.sign",
      key,
      { id, ...b },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id} FOR UPDATE`;
        const doc = must(await tx.document.findUnique({ where: { id } }));
        if (doc.signedAt) throw new ConflictException("המסמך כבר חתום");
        const updated = await tx.document.update({
          where: { id },
          data: { signedAt: new Date(), signedBy: actor.name },
        });
        // A signed edition gets a separate document/PDF; previous finalized bytes stay unchanged.
        const signedEdition = await tx.document.create({
          data: {
            customerId: doc.customerId,
            policyId: doc.policyId,
            claimId: doc.claimId,
            type: doc.type,
            title: doc.title + " — מהדורה חתומה מדומה",
            snapshot: {
              ...(doc.snapshot as any),
              sourceDocumentNumber: doc.number,
              sourceDocumentId: doc.id,
            },
            signedAt: updated.signedAt,
            signedBy: actor.name,
          },
        });
        await tx.documentArtifact.create({
          data: { documentId: signedEdition.id },
        });
        await audit(
          tx,
          actor,
          "document.sign_simulated",
          id,
          doc.customerId,
          doc,
          updated,
          "חתימה מדומה ללא אימות משפטי",
        );
        return updated;
      },
    );
  }
  async productVersion(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "product.manage");
    return this.command(
      actor,
      "product.version",
      key,
      { id, ...b },
      async (tx) => {
        const old = must(await tx.productVersion.findUnique({ where: { id } }));
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${old.code}))::text`;
        const latest = await tx.productVersion.findFirstOrThrow({
          where: { code: old.code },
          orderBy: { version: "desc" },
        });
        const deductibleCents = integer(b.deductibleCents, "השתתפות עצמית"),
          annualLimitCents = integer(b.annualLimitCents, "תקרה", 1),
          reimbursementBps = integer(
            b.reimbursementBps,
            "שיעור החזר",
            1,
            10000,
          );
        if (!Array.isArray(b.coverages) || !b.coverages.length)
          throw new BadRequestException("נדרש כיסוי אחד לפחות");
        const coverages = b.coverages.map((c: any) => ({
          code: text(c.code, "קוד כיסוי", 100),
          name: text(c.name, "שם כיסוי", 150),
          limitCents: integer(c.limitCents, "תקרת משנה", 1, annualLimitCents),
        }));
        if (
          new Set(coverages.map((c: any) => c.code)).size !== coverages.length
        )
          throw new BadRequestException("כיסוי כפול");
        const result = await tx.productVersion.create({
          data: {
            code: old.code,
            version: latest.version + 1,
            name: text(b.name, "שם מוצר", 150),
            species: old.species,
            minAgeMonths: old.minAgeMonths,
            maxAgeMonths: old.maxAgeMonths,
            premiumCents: integer(b.premiumCents, "פרמיה", 1),
            annualLimitCents,
            deductibleCents,
            reimbursementBps,
            waitingDays: integer(b.waitingDays, "אכשרה", 0, 365),
            waitingWaiverAllowed: bool(
              b.waitingWaiverAllowed ?? old.waitingWaiverAllowed,
              "כלל ביטול אכשרה",
            ),
            minClaimFreeMonths: integer(
              b.minClaimFreeMonths ?? old.minClaimFreeMonths,
              "חודשים ללא תביעות",
              1,
              120,
            ),
            coverages,
          },
        });
        await audit(
          tx,
          actor,
          "product.version",
          result.id,
          null,
          old,
          result,
          "גרסה חדשה; פוליסות קיימות אינן משתנות",
        );
        return result;
      },
    );
  }
  async suspend(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    const reason = text(b.reason, "סיבה");
    return this.command(
      actor,
      "policy.suspend",
      key,
      { id, ...b },
      async (tx) => {
        const p = await lockedPolicy(tx, id);
        if (
          p.status !== "ACTIVE" ||
          today() < p.startDate ||
          today() >= p.endDate
        )
          throw new ConflictException("נדרשת פוליסה פעילה בתקופה הנוכחית");
        await tx.policySuspension.create({
          data: { policyId: id, startDate: today(), reason },
        });
        const result = await tx.policy.update({
          where: { id },
          data: { status: "SUSPENDED", version: { increment: 1 } },
        });
        await audit(
          tx,
          actor,
          "policy.suspend",
          id,
          p.customerId,
          p,
          result,
          reason,
        );
        await document(
          tx,
          "ENDORSEMENT",
          "נספח השעיית כיסוי",
          p.customerId,
          id,
          null,
          { policy: result, reason },
        );
        return result;
      },
    );
  }
  async reinstate(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    const reason = text(b.reason, "סיבה");
    return this.command(
      actor,
      "policy.reinstate",
      key,
      { id, ...b },
      async (tx) => {
        const p = await lockedPolicy(tx, id);
        if (p.status !== "SUSPENDED" || today() >= p.endDate)
          throw new ConflictException("הפוליסה אינה ניתנת להפעלה מחדש");
        const period = must(
          await tx.policySuspension.findFirst({
            where: { policyId: id, endDate: null },
          }),
        );
        await tx.policySuspension.update({
          where: { id: period.id },
          data: { endDate: today() },
        });
        const result = await tx.policy.update({
          where: { id },
          data: { status: "ACTIVE", version: { increment: 1 } },
        });
        await audit(
          tx,
          actor,
          "policy.reinstate",
          id,
          p.customerId,
          p,
          result,
          reason,
        );
        await document(
          tx,
          "ENDORSEMENT",
          "נספח הפעלת כיסוי מחדש",
          p.customerId,
          id,
          null,
          { policy: result, reason },
        );
        return result;
      },
    );
  }
  async taskCreate(actor: Actor, b: any) {
    need(actor, "case.write");
    return db.$transaction(async (tx) => {
      const c = must(
        await tx.customer.findUnique({
          where: { id: text(b.customerId, "לקוח") },
        }),
      );
      const task = await tx.task.create({
        data: {
          customerId: c.id,
          title: text(b.title, "משימה", 200),
          dueAt: date(b.dueAt, "מועד יעד"),
          assignedTo: actor.id,
        },
      });
      await audit(tx, actor, "task.create", task.id, c.id, null, task);
      return task;
    });
  }
  async taskComplete(actor: Actor, id: string) {
    need(actor, "case.write");
    return db.$transaction(async (tx) => {
      const old = must(await tx.task.findUnique({ where: { id } }));
      if (old.status !== "OPEN")
        throw new ConflictException("המשימה כבר הושלמה");
      const result = await tx.task.updateMany({
        where: { id, status: "OPEN" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (!result.count) throw new ConflictException("המשימה כבר הושלמה");
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      await audit(tx, actor, "task.complete", id, old.customerId, old, task);
      return task;
    });
  }
  async reports() {
    const [customers, pets, policies, claims, charges, payments] =
      await Promise.all([
        db.customer.count(),
        db.pet.count(),
        db.policy.groupBy({ by: ["status"], _count: true }),
        db.claim.groupBy({ by: ["status"], _count: true }),
        db.charge.aggregate({
          _sum: { amountCents: true, paidCents: true, creditedCents: true },
        }),
        db.paymentOrder.aggregate({
          where: { status: "EXECUTED" },
          _sum: { amountCents: true },
        }),
      ]);
    return {
      customers,
      pets,
      policies,
      claims,
      chargedCents: charges._sum.amountCents || 0,
      collectedCents: charges._sum.paidCents || 0,
      creditedCents: charges._sum.creditedCents || 0,
      claimPaidCents: payments._sum.amountCents || 0,
      debtCents: Math.max(
        0,
        (charges._sum.amountCents || 0) -
          (charges._sum.paidCents || 0) -
          (charges._sum.creditedCents || 0),
      ),
    };
  }
}
