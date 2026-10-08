import { seedDemo } from "./demo-data";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import { Actor, need } from "./auth";
import { db } from "./db";
import { Prisma } from "./generated/client";
import { InsuranceService } from "./service";
// Explicit list: authentication, employee accounts and migration records are preserved.
export const resetTables = [
  "WorkflowAttachment",
  "WorkflowStep",
  "ApprovalRequest",
  "Application",
  "WorkflowInstance",
  "PolicySuspension",
  "Task",
  "PaymentOrder",
  "ClaimLine",
  "Claim",
  "Charge",
  "LedgerEntry",
  "Document",
  "ServiceCase",
  "Command",
  "AuditEvent",
  "Policy",
  "Pet",
  "Customer",
  "ProductRider",
  "ProductVersion",
] as const;
export const resetPhrase = "איפוס נתוני המערכת";
const command = new InsuranceService();
async function counts(tx: Prisma.TransactionClient) {
  const result: Record<string, number> = {};
  for (const table of resetTables) {
    const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    result[table] = Number(rows[0].count);
  }
  return result;
}
const fingerprint = (v: Record<string, number>) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class SystemResetService {
  async preview(actor: Actor) {
    need(actor, "system.reset");
    return db.$transaction(
      async (tx) => {
        const c = await counts(tx);
        return {
          counts: c,
          fingerprint: fingerprint(c),
          phrase: resetPhrase,
          preserved: [
            "Employee",
            "Session",
            "_BituchaMigration",
            "SystemSetting",
          ],
          simulationOnly: true,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async restore(actor: Actor, b: any, key: unknown) {
    need(actor, "system.reset");
    if (b.confirmed !== true)
      throw new BadRequestException("נדרש אישור החזרת נתוני דוגמה");
    return command.command(
      actor,
      "system.restore_demo",
      key,
      { confirmed: true },
      async (tx) => {
        const result = await seedDemo(tx, true);
        await tx.auditEvent.create({
          data: {
            employeeId: actor.id,
            action: "system.restore_demo",
            entityId: "demo-dataset",
            processId: randomUUID(),
            after: result,
          },
        });
        return result;
      },
    );
  }
  async execute(actor: Actor, b: any, key: unknown) {
    need(actor, "system.reset");
    if (b.phrase !== resetPhrase)
      throw new BadRequestException("משפט האישור אינו תואם");
    if (typeof b.password !== "string" || b.password.length > 256)
      throw new ForbiddenException("נדרש אימות סיסמה");
    const employee = await db.employee.findUnique({ where: { id: actor.id } });
    if (
      !employee?.active ||
      !(await argon2.verify(employee.passwordHash, b.password))
    )
      throw new ForbiddenException("אימות הסיסמה נכשל");
    if (
      typeof b.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(b.fingerprint)
    )
      throw new BadRequestException("נדרשת תצוגה מקדימה של המחיקה");
    // The password is never persisted in idempotency records or audit.
    return command.command(
      actor,
      "system.reset",
      key,
      { phrase: b.phrase, fingerprint: b.fingerprint },
      async (tx) => {
        await tx.$executeRawUnsafe(
          `LOCK TABLE ${resetTables.map((t) => `"${t}"`).join(", ")} IN ACCESS EXCLUSIVE MODE`,
        );
        const before = await counts(tx);
        if (fingerprint(before) !== b.fingerprint)
          throw new ConflictException(
            "הנתונים השתנו מאז התצוגה המקדימה. יש לבדוק מחדש את היקף המחיקה",
          );
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${resetTables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`,
        );
        await tx.systemSetting.upsert({
          where: { key: "demo-data-state" },
          create: { key: "demo-data-state", value: { enabled: false } },
          update: { value: { enabled: false } },
        });
        const receipt = {
          resetId: randomUUID(),
          deleted: before,
          performedBy: actor.id,
          performedAt: new Date().toISOString(),
          preserved: [
            "Employee",
            "Session",
            "_BituchaMigration",
            "SystemSetting",
          ],
        };
        await tx.auditEvent.create({
          data: {
            employeeId: actor.id,
            action: "system.reset",
            entityId: receipt.resetId,
            processId: receipt.resetId,
            after: receipt,
          },
        });
        return receipt;
      },
    );
  }
}
