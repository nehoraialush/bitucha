import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { Actor, need, actorPermissions, permissions } from "./auth";
import { InsuranceService } from "./service";
import { text, optional, choice, bool, integer } from "./validation";
const select = {
  version: true,
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  department: true,
  team: true,
  managerId: true,
  permissionMode: true,
  approvalLimitCents: true,
  permissionGrants: { select: { permission: true } },
  createdAt: true,
} as const;
const command = new InsuranceService();
export const permissionCatalog = [
  ...new Set(
    Object.values(permissions)
      .flat()
      .filter((p) => p !== "*"),
  ),
  "employee.write",
];
function profile(b: any) {
  const role = choice(b.role, Object.keys(permissions), "תפקיד");
  const permissionMode = choice(
    b.permissionMode || "ROLE",
    ["ROLE", "CUSTOM"],
    "מקור הרשאות",
  );
  const grants =
    permissionMode === "CUSTOM"
      ? Array.isArray(b.grants)
        ? b.grants.map((p: unknown) => text(p, "הרשאה", 100))
        : []
      : [];
  if (permissionMode === "CUSTOM" && !Array.isArray(b.grants))
    throw new BadRequestException("רשימת הרשאות חסרה");
  if (
    new Set(grants).size !== grants.length ||
    grants.some((p: string) => p !== "*" && !permissionCatalog.includes(p))
  )
    throw new BadRequestException("הרשאה לא מוכרת או כפולה");
  if (role !== "ADMIN" && grants.includes("*"))
    throw new ForbiddenException("הרשאת כל הפעולות מוגבלת לתפקיד מנהל");
  return {
    name: text(b.name, "שם עובד", 150),
    role,
    active: bool(b.active ?? true, "פעיל"),
    department: optional(b.department, 100),
    team: optional(b.team, 100),
    managerId: b.managerId ? text(b.managerId, "מנהל") : null,
    permissionMode,
    approvalLimitCents:
      b.approvalLimitCents == null || b.approvalLimitCents === ""
        ? null
        : integer(b.approvalLimitCents, "סמכות אישור באגורות"),
    grants,
  };
}
function authority(
  actor: Actor,
  p: { role: string; permissionMode: string; grants: string[] },
) {
  const mine = actorPermissions(actor);
  if (mine.includes("*")) return;
  const requested =
    p.permissionMode === "ROLE" ? permissions[p.role] : p.grants;
  if (requested.some((r) => !mine.includes(r)))
    throw new ForbiddenException(
      "אין סמכות להעניק או לשנות הרשאות מעבר להרשאות שלך",
    );
}
async function audit(
  tx: any,
  actor: Actor,
  id: string,
  action: string,
  after: any,
) {
  await tx.auditEvent.create({
    data: {
      employeeId: actor.id,
      action,
      entityId: id,
      processId: randomUUID(),
      after,
    },
  });
}
export class EmployeeService {
  async list(actor: Actor) {
    need(actor, "employee.write");
    return {
      employees: await db.employee.findMany({
        select,
        orderBy: { name: "asc" },
        take: 500,
      }),
      roles: Object.keys(permissions),
      permissionCatalog,
    };
  }
  async create(actor: Actor, b: any, key: unknown) {
    need(actor, "employee.write");
    const p = profile(b);
    authority(actor, p);
    const email = text(b.email, "דוא״ל", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException("דוא״ל לא תקין");
    const password = b.password;
    if (
      typeof password !== "string" ||
      password.length < 16 ||
      password.length > 256 ||
      !password.trim()
    )
      throw new BadRequestException("נדרשת סיסמה באורך 16 תווים לפחות");
    const k = text(key, "מזהה פעולה", 120);
    const credentialFingerprint = await argon2.hash(password, {
      salt: createHash("sha256")
        .update(actor.id + ":" + k)
        .digest()
        .subarray(0, 16),
    });
    return command.command(
      actor,
      "employee.create",
      k,
      { email, ...p, credentialFingerprint },
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(824773)::text`;
        if (
          p.managerId &&
          !(await tx.employee.findFirst({
            where: { id: p.managerId, active: true },
          }))
        )
          throw new BadRequestException("מנהל אינו פעיל או אינו קיים");
        const { grants, ...data } = p;
        const employee = await tx.employee.create({
          data: {
            ...data,
            email,
            passwordHash: await argon2.hash(password),
            permissionGrants: {
              create: grants.map((permission: string) => ({ permission })),
            },
          },
          select,
        });
        await audit(tx, actor, employee.id, "employee.create", employee);
        return employee;
      },
    );
  }
  async update(actor: Actor, id: string, b: any, key: unknown) {
    need(actor, "employee.write");
    const p = profile(b);
    authority(actor, p);
    return command.command(
      actor,
      "employee.update",
      key,
      { id, ...p, version: b.version },
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(824773)::text`;
        const old = await tx.employee.findUnique({ where: { id }, select });
        if (!old) throw new NotFoundException("עובד לא נמצא");
        if (old.version !== integer(b.version, "גרסת עובד", 1))
          throw new ConflictException("פרטי העובד השתנו. יש לרענן לפני שמירה");
        authority(actor, {
          role: old.role,
          permissionMode: old.permissionMode,
          grants: old.permissionGrants.map((g) => g.permission),
        });
        if (actor.id === id && !p.active)
          throw new ConflictException("לא ניתן להשבית את המשתמש המחובר");
        if (p.managerId === id)
          throw new BadRequestException("עובד אינו יכול להיות מנהל של עצמו");
        if (
          p.managerId &&
          !(await tx.employee.findFirst({
            where: { id: p.managerId, active: true },
          }))
        )
          throw new BadRequestException("מנהל אינו פעיל או אינו קיים");
        // Prevent management cycles in the reporting hierarchy.
        let manager = p.managerId;
        const seen = new Set<string>();
        while (manager) {
          if (manager === id || seen.has(manager))
            throw new BadRequestException("שיוך מנהל יוצר מעגל");
          seen.add(manager);
          manager =
            (
              await tx.employee.findUnique({
                where: { id: manager },
                select: { managerId: true },
              })
            )?.managerId || null;
        }
        await tx.employeePermission.deleteMany({ where: { employeeId: id } });
        const { grants, ...data } = p;
        const employee = await tx.employee.update({
          where: { id },
          data: {
            ...data,
            version: { increment: 1 },
            permissionGrants: {
              create: grants.map((permission: string) => ({ permission })),
            },
          },
          select,
        });
        const administrators = await tx.employee.count({
          where: {
            active: true,
            role: "ADMIN",
            OR: [
              { permissionMode: "ROLE" },
              { permissionGrants: { some: { permission: "*" } } },
            ],
          },
        });
        if (administrators === 0)
          throw new ConflictException(
            "יש להשאיר לפחות מנהל פעיל אחד עם כל ההרשאות",
          );
        if (
          actor.id === id &&
          !actorPermissions({
            id,
            name: employee.name,
            email: employee.email,
            role: employee.role,
            grants:
              employee.permissionMode === "CUSTOM"
                ? grants
                : permissions[employee.role],
          }).some((v) => v === "*" || v === "employee.write")
        )
          throw new ConflictException(
            "לא ניתן להסיר מעצמך את הרשאת ניהול העובדים",
          );
        await tx.session.deleteMany({ where: { employeeId: id } });
        await audit(tx, actor, id, "employee.update", employee);
        return employee;
      },
    );
  }
}
