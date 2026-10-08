import { db } from "../apps/api/src/db";
import { seedDemo } from "../apps/api/src/demo-data";
import * as argon2 from "argon2";
const password = process.env.ADMIN_PASSWORD,
  email = process.env.ADMIN_EMAIL;
if (!password || password.length < 16 || !email)
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (16+ characters)");
try {
  const passwordHash = await argon2.hash(password);
  await db.employee.upsert({
    where: { email },
    create: { email, name: "מנהל סביבת פיתוח", role: "ADMIN", passwordHash },
    update: {},
  });
  if (process.env.DEMO_PASSWORD) {
    if (process.env.DEMO_PASSWORD.length < 16)
      throw new Error("DEMO_PASSWORD must contain 16+ characters");
    const demoHash = await argon2.hash(process.env.DEMO_PASSWORD);
    for (const [role, name] of [
      ["SERVICE", "נציג שירות"],
      ["UNDERWRITER", "חתם"],
      ["CLAIMS", "מסלק תביעות"],
      ["FINANCE", "נציג כספים"],
      ["AUDITOR", "מבקר"],
    ])
      await db.employee.upsert({
        where: { email: `${role.toLowerCase()}@bitucha.local` },
        create: {
          email: `${role.toLowerCase()}@bitucha.local`,
          name,
          role,
          passwordHash: demoHash,
        },
        update: {},
      });
  }
  const result = await db.$transaction((tx) => seedDemo(tx), {
    timeout: 120000,
  });
  console.log(
    result.skipped
      ? "Demo data is disabled after an explicit reset; use Restore Demo in administration"
      : "Demo data restored: existing records preserved, no reset performed",
  );
} finally {
  await db.$disconnect();
}
