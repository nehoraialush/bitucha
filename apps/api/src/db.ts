import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
import { PrismaClient } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
export const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
