// Destructive feature tests run ONLY on a newly created temporary database.
import { existsSync } from "node:fs";
import { Client } from "pg";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import assert from "node:assert/strict";
if (existsSync(".env")) process.loadEnvFile(".env");
const originalUrl = process.env.DATABASE_URL!;
const admin = new Client({ connectionString: originalUrl });
const name = "bitucha_reset_test_" + randomUUID().replaceAll("-", "");
assert(/^bitucha_reset_test_[a-f0-9]+$/.test(name));
const url = new URL(originalUrl);
url.pathname = "/" + name;
let child: ReturnType<typeof spawn> | undefined;
let testDb: any;
let created = false;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  process.env.DATABASE_URL = url.toString();
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    PORT: "3001",
    API_HOST: "127.0.0.1",
  };
  const migration = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/migrate.ts"],
    { env, stdio: "pipe" },
  );
  assert.equal(migration.status, 0, "Isolated database migration failed");
  testDb = (await import("../apps/api/src/db")).db;
  const password = randomUUID() + randomUUID();
  const passwordHash = await argon2.hash(password);
  const employee = await testDb.employee.create({
    data: {
      email: "reset-test@example.invalid",
      name: "מנהל בדיקה",
      role: "ADMIN",
      passwordHash,
    },
  });
  const viewer = await testDb.employee.create({
    data: {
      email: "viewer-test@example.invalid",
      name: "צופה",
      role: "AUDITOR",
      passwordHash,
    },
  });
  child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "apps/api/src/main.ts"],
    { env, stdio: ["ignore", "ignore", "ignore"] },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch("http://127.0.0.1:3001/api/v1/health")).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, "Isolated API did not start");
  let cookie = "",
    csrf = "";
  async function request(path: string, body?: any, key = randomUUID()) {
    const r = await fetch("http://127.0.0.1:3001/api/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const login = await request("/auth/login", {
    email: employee.email,
    password,
  });
  assert.equal(login.status, 201);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = login.data.csrf;
  const employees = await request("/employees");
  const administrator = employees.data.employees.find(
    (e: any) => e.id === employee.id,
  );
  const protectedAdministrator = await request(
    `/employees/${employee.id}/update`,
    { ...administrator, grants: ["employee.write"], permissionMode: "CUSTOM" },
  );
  assert.equal(protectedAdministrator.status, 409);
  assert.equal((await request("/auth/session")).status, 200);
  console.log(
    "PASS: last full administrator cannot be removed by permission changes",
  );
  const restoreKey = randomUUID();
  const restored = await request(
    "/system/restore-demo",
    { confirmed: true },
    restoreKey,
  );
  assert.equal(restored.status, 201, JSON.stringify(restored.data));
  assert.equal(await testDb.customer.count(), 100);
  assert.equal(await testDb.pet.count(), 140);
  assert.equal(await testDb.policy.count(), 120);
  assert.equal(await testDb.claim.count(), 200);
  const demoCustomer = await testDb.customer.findUniqueOrThrow({
    where: { id: "demo-customer-001" },
  });
  await testDb.customer.update({
    where: { id: demoCustomer.id },
    data: { notes: "יש לשמר שינוי משתמש" },
  });
  assert.equal(
    (await request("/system/restore-demo", { confirmed: true }, restoreKey))
      .status,
    201,
  );
  assert.equal(
    (await request("/system/restore-demo", { confirmed: true })).status,
    201,
  );
  assert.equal(await testDb.customer.count(), 100);
  assert.equal(await testDb.claim.count(), 200);
  assert.equal(
    (
      await testDb.customer.findUniqueOrThrow({
        where: { id: demoCustomer.id },
      })
    ).notes,
    "יש לשמר שינוי משתמש",
  );
  console.log(
    "PASS: demo restore creates all entities, preserves edits, and is idempotent",
  );
  let preview = await request("/system/reset-preview");
  assert.equal(preview.status, 200);
  assert.equal(
    (
      await request("/system/reset", {
        phrase: "wrong",
        password,
        fingerprint: preview.data.fingerprint,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/system/reset", {
        phrase: preview.data.phrase,
        password: "wrong-password",
        fingerprint: preview.data.fingerprint,
      })
    ).status,
    403,
  );
  await testDb.customer.create({
    data: { name: "תוספת בדיקה", phone: "0500000000" },
  });
  assert.equal(
    (
      await request("/system/reset", {
        phrase: preview.data.phrase,
        password,
        fingerprint: preview.data.fingerprint,
      })
    ).status,
    409,
  );
  assert.equal(await testDb.customer.count(), 101);
  preview = await request("/system/reset-preview");
  const body = {
      phrase: preview.data.phrase,
      password,
      fingerprint: preview.data.fingerprint,
    },
    key = randomUUID();
  const reset = await request("/system/reset", body, key);
  assert.equal(reset.status, 201, JSON.stringify(reset.data));
  for (const [table, count] of Object.entries(preview.data.counts)) {
    assert(typeof count === "number");
    const rows = await testDb.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${table}"`,
    );
    assert.equal(
      rows[0].count,
      table === "AuditEvent" || table === "Command" ? 1 : 0,
      table,
    );
  }
  const seedModule = await import("../apps/api/src/demo-data");
  const startupSeed = await testDb.$transaction((tx: any) =>
    seedModule.seedDemo(tx),
  );
  assert.equal(startupSeed.skipped, true);
  assert.equal(await testDb.customer.count(), 0);
  console.log(
    "PASS: explicit reset remains empty after automatic startup seeding",
  );
  assert.equal(await testDb.employee.count(), 2);
  assert.equal((await request("/auth/session")).status, 200);
  assert.equal(
    (await request("/system/reset", body, key)).data.resetId,
    reset.data.resetId,
  );
  console.log(
    "PASS: reset guards password, confirmation and stale preview; deletes business data atomically; preserves accounts and session",
  );
  const viewerLogin = await request("/auth/login", {
    email: viewer.email,
    password,
  });
  cookie = viewerLogin.headers.get("set-cookie")!.split(";")[0];
  csrf = viewerLogin.data.csrf;
  assert.equal((await request("/system/reset-preview")).status, 403);
  assert.equal(
    (await request("/system/restore-demo", { confirmed: true })).status,
    403,
  );
  console.log("PASS: non-admin reset and restore access denied");
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  csrf = login.data.csrf;
  const restoredAfterReset = await request("/system/restore-demo", {
    confirmed: true,
  });
  assert.equal(
    restoredAfterReset.status,
    201,
    JSON.stringify(restoredAfterReset.data),
  );
  assert.equal(await testDb.customer.count(), 100);
  assert.equal(await testDb.policy.count(), 120);
  assert.equal(await testDb.claim.count(), 200);
  console.log(
    "PASS: Restore Demo repopulates a reset system on explicit administrator request",
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : "Isolated reset test failed");
  process.exitCode = 1;
} finally {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => child!.once("exit", r)),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
  if (testDb) await testDb.$disconnect();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  process.env.DATABASE_URL = originalUrl;
}
