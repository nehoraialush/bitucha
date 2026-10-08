import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
import { Client } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(824771)");
  await client.query(
    'CREATE TABLE IF NOT EXISTS "_BituchaMigration" (name text PRIMARY KEY, checksum text NOT NULL, "appliedAt" timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir("prisma/migrations"))
    .filter((n) => !n.startsWith("."))
    .sort()) {
    const sql = await readFile(
      `prisma/migrations/${name}/migration.sql`,
      "utf8",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = await client.query(
      'SELECT checksum FROM "_BituchaMigration" WHERE name=$1',
      [name],
    );
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum)
        throw new Error(`Migration checksum changed: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO "_BituchaMigration" (name,checksum) VALUES ($1,$2)',
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(824771)");
  await client.end();
}
