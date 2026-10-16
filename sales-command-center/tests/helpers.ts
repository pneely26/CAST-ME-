import { execSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";

export const TEST_URL = process.env.TEST_DATABASE_URL;

/** Point Prisma at the test database (name must end in _test), apply migrations, wipe data. */
export async function setupTestDb(): Promise<PrismaClient> {
  if (!TEST_URL) throw new Error("TEST_DATABASE_URL not set");
  if (!new URL(TEST_URL).pathname.slice(1).endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a database whose name ends in _test");
  process.env.DATABASE_URL = TEST_URL;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "ignore" });
  const { prisma } = await import("@/server/db");
  await wipe(prisma);
  return prisma;
}

export async function wipe(p: PrismaClient) {
  const tables = await p.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await p.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function makeUsers(p: PrismaClient) {
  const coordinator = await p.user.create({ data: { email: "c@test", name: "Casey Coordinator", role: "COORDINATOR", passwordHash: "x" } });
  const rep = await p.user.create({ data: { email: "r@test", name: "Riley Rep", role: "REP", passwordHash: "x" } });
  const rep2 = await p.user.create({ data: { email: "r2@test", name: "Sam Second", role: "REP", passwordHash: "x" } });
  const actor = (u: { id: string; role: "COORDINATOR" | "REP"; name: string }) => ({ id: u.id, role: u.role, name: u.name });
  return { coordinator: actor(coordinator), rep: actor(rep), rep2: actor(rep2) };
}
