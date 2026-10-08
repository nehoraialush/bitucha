import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import type { Request, Response } from "express";
import { db } from "./db";
export type Actor = { id: string; name: string; email: string; role: string };
export const permissions: Record<string, string[]> = {
  ADMIN: ["*"],
  SERVICE: ["customer.write", "case.write", "document.sign"],
  SALES: ["customer.write", "policy.write", "case.write", "application.read"],
  UNDERWRITER: ["underwriting.decide", "application.read"],
  CLAIMS: ["claim.write", "claim.decide"],
  CLAIMS_MANAGER: ["claim.write", "claim.decide", "claim.large"],
  FINANCE: ["payment.execute", "collection.write", "policy.cancel"],
  AUDITOR: [],
};
export function need(actor: Actor, permission: string) {
  if (!permissions[actor.role]?.some((p) => p === "*" || p === permission))
    throw new ForbiddenException("אין הרשאה לפעולה זו");
}
export type AuthRequest = Request & { actor: Actor; csrf: string };
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const attempts = new Map<string, { count: number; until: number }>();
export async function login(req: Request, res: Response, body: any) {
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const key = `${req.ip}:${email}`;
  const now = Date.now();
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const record = attempts.get(key);
  if (record && record.until > now && record.count >= 8)
    throw new HttpException("יותר מדי ניסיונות. יש להמתין 15 דקות", 429);
  const user = await db.employee.findUnique({ where: { email } });
  if (
    !user?.active ||
    password.length > 256 ||
    !(await argon2.verify(user.passwordHash, password))
  ) {
    attempts.set(key, {
      count: record && record.until > now ? record.count + 1 : 1,
      until: record && record.until > now ? record.until : now + 900000,
    });
    throw new UnauthorizedException("פרטי הכניסה שגויים");
  }
  attempts.delete(key);
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      employeeId: user.id,
      tokenHash: hash(token),
      csrf,
      expiresAt: new Date(now + 8 * 3600000),
    },
  });
  res.cookie("bitucha_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: 8 * 3600000,
  });
  return {
    employee: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    csrf,
    permissions: permissions[user.role],
  };
}
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.path === "/api/v1/auth/login" || req.path === "/api/v1/health") {
      if (req.path.endsWith("/login") && req.method !== "POST")
        throw new UnauthorizedException();
      return true;
    }
    const token = req.cookies?.bitucha_session;
    const session =
      typeof token === "string"
        ? await db.session.findUnique({
            where: { tokenHash: hash(token) },
            include: { employee: true },
          })
        : null;
    if (!session || session.expiresAt < new Date() || !session.employee.active)
      throw new UnauthorizedException("נדרשת התחברות");
    req.actor = {
      id: session.employee.id,
      name: session.employee.name,
      email: session.employee.email,
      role: session.employee.role,
    };
    req.csrf = session.csrf;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("x-csrf-token") !== session.csrf)
        throw new ForbiddenException("אימות הבקשה נכשל");
      const origin = req.get("origin");
      if (
        origin &&
        origin !== (process.env.WEB_ORIGIN || "http://localhost:5173")
      )
        throw new ForbiddenException("מקור הבקשה אינו מורשה");
    }
    return true;
  }
}
export async function logout(req: AuthRequest, res: Response) {
  const token = req.cookies?.bitucha_session;
  if (token) await db.session.deleteMany({ where: { tokenHash: hash(token) } });
  res.clearCookie("bitucha_session", { path: "/" });
  return { ok: true };
}
