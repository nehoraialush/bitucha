import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { Actor, need, actorPermissions } from "./auth";
import { InsuranceService } from "./service";
import { integer, text, choice } from "./validation";
import {
  latestSteps,
  validateStep,
  declarations,
} from "../../../packages/domain/src/enrollment";
import { Prisma } from "./generated/client";
export const stable = (v: any): any =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
export const digest = (v: any) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const json = (v: any) => JSON.parse(JSON.stringify(v));
const command = new InsuranceService();
const limits = new Map<string, { count: number; until: number }>();
function throttle(token: string) {
  const key = tokenDigest(token),
    now = Date.now();
  if (limits.size > 5000)
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const old = limits.get(key);
  const record =
    old && old.until > now ? old : { count: 0, until: now + 60000 };
  if (++record.count > 90)
    throw new ForbiddenException("יותר מדי בקשות חתימה. נסו בעוד דקה");
  limits.set(key, record);
}
function metadata(r: any) {
  return {
    id: r.id,
    status: r.status,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    signedAt: r.signedAt,
    contentHash: r.contentHash,
    workflowVersion: r.workflowVersion,
  };
}
function safeEvent(e: any) {
  return {
    id: e.id,
    kind: e.kind,
    actorType: e.actorType,
    payload: e.payload,
    createdAt: e.createdAt,
  };
}
async function lookup(
  tx: Prisma.TransactionClient | typeof db,
  token: unknown,
) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new NotFoundException("קישור חתימה אינו תקין");
  const r = await tx.signingRequest.findUnique({
    where: { tokenHash: tokenDigest(token) },
  });
  if (!r || r.status === "REVOKED" || r.expiresAt < new Date())
    throw new NotFoundException("קישור החתימה פג או בוטל");
  return r;
}
export class SigningService {
  async create(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "policy.write");
    const token = randomBytes(32).toString("hex");
    const result = await command.command(
      actor,
      "application.signing.create",
      key,
      { id, version: b.version },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id=${id} FOR UPDATE`;
        const w = await tx.workflowInstance.findUnique({
          where: { id },
          include: { steps: true, application: true },
        });
        if (!w || w.type !== "ENROLLMENT")
          throw new NotFoundException("בקשה לא נמצאה");
        if (
          w.version !== integer(b.version, "גרסה", 1) ||
          ["COMPLETED", "REJECTED"].includes(w.status)
        )
          throw new ConflictException("גרסה מיושנת או בקשה סגורה");
        const steps = latestSteps(w.steps);
        for (let n = 1; n <= 15; n++)
          if (!steps[n]?.completed)
            throw new ConflictException(
              "יש להשלים את ההצטרפות עד לוח התשלומים לפני שליחת חתימה",
            );
        if (steps[16]?.completed)
          throw new ConflictException(
            "כבר נחתם. יש לפתוח את שלב החתימה מחדש לפני יצירת קישור",
          );
        const answers = (n: number) => steps[n].answers as any;
        const quote = answers(11).quote;
        if (new Date(quote.validUntil) < new Date())
          throw new ConflictException("הצעת המחיר פגה");
        // Recipient bundle excludes employee IDs, internal notes and source attachments.
        const snapshot = json({
          createdAt: new Date().toISOString(),
          endDate: answers(4).eligibility.endDate,
          version: 1,
          definitionVersion: w.definitionVersion,
          applicationNumber: w.application!.number,
          customer: answers(2),
          pet: answers(3),
          startDate: answers(4).startDate,
          terms: {
            ...quote.product,
            ...(answers(12).waitingWaiver
              ? { waitingDays: 0, waitingWaiver: answers(12).waitingWaiver }
              : {}),
          },
          exclusions: answers(12).excludedCategories || [],
          schedule: answers(15).schedule,
          declarations: declarations,
          medical: [5, 6, 7, 8].map((n) => ({
            number: n,
            answers: answers(n),
          })),
          // This hash binds the same data used by the existing step-16 signature protocol.
          enrollmentHash: digest({
            quote: answers(11).quote,
            declarations: answers(13),
            payment: answers(15),
            underwriting: answers(12),
          }),
        });
        delete snapshot.customer.verified;
        delete snapshot.customer.customerId;
        delete snapshot.pet.petId;
        if (snapshot.terms.waitingWaiver)
          delete snapshot.terms.waitingWaiver.approvedBy;
        await tx.signingRequest.updateMany({
          where: { workflowId: id, status: "PENDING" },
          data: { status: "REVOKED" },
        });
        const r = await tx.signingRequest.create({
          data: {
            workflowId: id,
            tokenHash: tokenDigest(token),
            snapshot,
            contentHash: digest(snapshot),
            workflowVersion: w.version,
            expiresAt: new Date(Date.now() + 48 * 3600000),
            createdBy: actor.id,
          },
        });
        await tx.auditEvent.create({
          data: {
            employeeId: actor.id,
            action: "signing.request.create",
            entityId: r.id,
            processId: id,
            after: {
              contentHash: r.contentHash,
              expiresAt: r.expiresAt.toISOString(),
            },
          },
        });
        return { ...metadata(r), tokenHash: r.tokenHash };
      },
    );
    const { tokenHash, ...out } = result as any;
    return { ...out, token: tokenHash === tokenDigest(token) ? token : null };
  }
  async monitor(actor: Actor, id: string) {
    need(actor, "application.read");
    const requests = await db.signingRequest.findMany({
      where: { workflowId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { events: { orderBy: { createdAt: "asc" }, take: 500 } },
    });
    return requests.map((r) => ({
      ...metadata(r),
      events: r.events.map(safeEvent),
    }));
  }
  async revoke(actor: Actor, id: string, key: unknown) {
    need(actor, "policy.write");
    return command.command(actor, "signing.revoke", key, { id }, async (tx) => {
      const r = await tx.signingRequest.findUnique({ where: { id } });
      if (!r) throw new NotFoundException();
      if (r.status !== "PENDING")
        throw new ConflictException("הבקשה כבר אינה פעילה");
      await tx.signingRequest.update({
        where: { id },
        data: { status: "REVOKED" },
      });
      await tx.auditEvent.create({
        data: {
          employeeId: actor.id,
          action: "signing.revoke",
          entityId: id,
          processId: r.workflowId,
        },
      });
      return { status: "REVOKED" };
    });
  }
  async assist(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "signing.assist");
    const message = text(b.message, "הודעה", 1000);
    return command.command(
      actor,
      "signing.assist",
      key,
      { id, message },
      async (tx) => {
        const r = await tx.signingRequest.findUnique({ where: { id } });
        if (!r || r.status !== "PENDING" || r.expiresAt < new Date())
          throw new ConflictException("בקשת חתימה אינה פעילה");
        if ((await tx.signingEvent.count({ where: { requestId: id } })) >= 500)
          throw new ConflictException("מגבלת אירועים");
        return safeEvent(
          await tx.signingEvent.create({
            data: {
              requestId: id,
              kind: "MESSAGE",
              actorType: "AGENT",
              payload: { message, agentName: actor.name },
            },
          }),
        );
      },
    );
  }
  async view(token: unknown) {
    const r = await lookup(db, token);
    throttle(token as string);
    const events = await db.signingEvent.findMany({
      where: { requestId: r.id },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return {
      ...metadata(r),
      snapshot: r.snapshot,
      events: events.map(safeEvent),
    };
  }
  async event(token: unknown, b: any) {
    const r = await lookup(db, token);
    throttle(token as string);
    if (r.status !== "PENDING")
      throw new ConflictException("המסמכים כבר נחתמו");
    const kind = choice(
      b.kind,
      [
        "OPENED",
        "DOCUMENT_VIEWED",
        "SIGNING_STARTED",
        "HELP_REQUEST",
        "MESSAGE",
      ],
      "אירוע",
    );
    if (b.trackingAccepted !== true)
      throw new BadRequestException("נדרשת הסכמה למעקב התקדמות");
    const payload =
      kind === "MESSAGE" || kind === "HELP_REQUEST"
        ? { message: text(b.message, "הודעה", 1000) }
        : kind === "DOCUMENT_VIEWED"
          ? {
              document: choice(
                b.document,
                ["AGREEMENT", "HEALTH", "PAYMENT"],
                "מסמך",
              ),
            }
          : { consent: true };
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SigningRequest" WHERE id=${r.id} FOR UPDATE`;
      const active = await lookup(tx, token);
      if (active.status !== "PENDING")
        throw new ConflictException("הבקשה נסגרה");
      if ((await tx.signingEvent.count({ where: { requestId: r.id } })) >= 500)
        throw new ConflictException("מגבלת אירועים");
      return safeEvent(
        await tx.signingEvent.create({
          data: { requestId: r.id, kind, actorType: "CUSTOMER", payload },
        }),
      );
    });
  }
  async sign(token: unknown, b: any, key: unknown) {
    const r = await lookup(db, token);
    throttle(token as string);
    const creator = await db.employee.findUnique({
      where: { id: r.createdBy },
      include: { permissionGrants: true },
    });
    if (!creator?.active) throw new ForbiddenException("הבקשה אינה זמינה");
    const actor: Actor = {
      ...creator,
      grants:
        creator.permissionMode === "CUSTOM"
          ? creator.permissionGrants.map((g) => g.permission)
          : undefined,
    };
    need(actor, "policy.write");
    const expected = (r.snapshot as any).customer;
    const answers = {
      signerName: b.signerName,
      signerRole: "POLICYHOLDER",
      accepted: b.accepted,
      strokes: b.strokes,
    };
    const errors = validateStep(16, answers);
    if (errors.length) throw new BadRequestException(errors.join("; "));
    if (
      b.contentHash !== r.contentHash ||
      b.trackingAccepted !== true ||
      b.reviewedDocuments !== true
    )
      throw new BadRequestException("נדרשת קריאת המסמכים, הסכמה ותוכן תואם");
    if (
      text(b.signerName, "שם החותם") !==
      expected.firstName + " " + expected.lastName
    )
      throw new BadRequestException("שם החותם חייב להתאים לבעל הבקשה");
    return command.command(
      actor,
      "signing.complete",
      key,
      { id: r.id, answers, contentHash: b.contentHash },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id=${r.workflowId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "SigningRequest" WHERE id=${r.id} FOR UPDATE`;
        const active = await lookup(tx, token);
        if (active.status !== "PENDING")
          throw new ConflictException("החתימה כבר הושלמה");
        const w = await tx.workflowInstance.findUniqueOrThrow({
          where: { id: r.workflowId },
          include: { steps: true },
        });
        if (
          w.version !== r.workflowVersion ||
          ["COMPLETED", "REJECTED"].includes(w.status)
        )
          throw new ConflictException("תוכן הבקשה השתנה. נדרש קישור חדש");
        const steps = latestSteps(w.steps);
        for (let n = 1; n <= 15; n++)
          if (!steps[n]?.completed)
            throw new ConflictException("תהליך אינו מוכן לחתימה");
        const viewed = await tx.signingEvent.findMany({
          where: { requestId: r.id, kind: "DOCUMENT_VIEWED" },
        });
        for (const document of ["AGREEMENT", "HEALTH", "PAYMENT"])
          if (!viewed.some((e) => (e.payload as any).document === document))
            throw new ConflictException("יש לפתוח את שלושת המסמכים לפני חתימה");
        const signedAt = new Date();
        await tx.workflowStep.create({
          data: {
            workflowId: w.id,
            number: 16,
            revision: (steps[16]?.revision || 0) + 1,
            definitionVersion: w.definitionVersion,
            employeeId: creator.id,
            completed: true,
            answers: json({
              ...answers,
              signedAt: signedAt.toISOString(),
              simulated: true,
              documentHash: (r.snapshot as any).enrollmentHash,
              signingRequestId: r.id,
              bundleHash: r.contentHash,
              source: "REMOTE_LINK",
            }),
          },
        });
        await tx.workflowInstance.update({
          where: { id: w.id },
          data: { version: { increment: 1 }, currentStep: 17, status: "DRAFT" },
        });
        await tx.signingRequest.update({
          where: { id: r.id },
          data: { status: "SIGNED", signedAt },
        });
        await tx.signingEvent.create({
          data: {
            requestId: r.id,
            kind: "COMPLETED",
            actorType: "CUSTOMER",
            payload: {
              signedAt: signedAt.toISOString(),
              contentHash: r.contentHash,
            },
          },
        });
        await tx.auditEvent.create({
          data: {
            employeeId: creator.id,
            action: "signing.remote.completed",
            entityId: r.id,
            processId: w.id,
            after: {
              signerName: answers.signerName,
              contentHash: r.contentHash,
              source: "CUSTOMER_LINK",
            },
          },
        });
        return {
          status: "SIGNED",
          signedAt: signedAt.toISOString(),
          contentHash: r.contentHash,
        };
      },
    );
  }
}
