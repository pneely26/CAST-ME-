/**
 * Create or reset a login.
 *   npm run create-user -- --role coordinator --email you@example.com --name "Your Name"
 * Prompts for the password (or set NEW_USER_PASSWORD).
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(q);
    (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {};
    rl.question("", (a) => {
      rl.close();
      process.stdout.write("\n");
      resolve(a);
    });
  });
}

async function main() {
  const prisma = new PrismaClient();
  const role = (arg("role") ?? "").toUpperCase() === "REP" ? "REP" : (arg("role") ?? "").toUpperCase() === "COORDINATOR" ? "COORDINATOR" : null;
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!role || !email || !name) {
    console.error('Usage: npm run create-user -- --role coordinator|rep --email you@example.com --name "Full Name"');
    process.exit(1);
  }
  const pw = process.env.NEW_USER_PASSWORD ?? (await askHidden(`Password for ${email} (10+ characters): `));
  if (pw.length < 10) {
    console.error("Password must be at least 10 characters.");
    process.exit(1);
  }
  const passwordHash = bcrypt.hashSync(pw, 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { name, role, passwordHash, active: true, sessionVersion: { increment: 1 } } })
    : await prisma.user.create({ data: { email, name, role, passwordHash } });
  await prisma.auditLog.create({ data: { action: existing ? "user.reset" : "user.created", entityType: "User", entityId: user.id, summary: `${existing ? "Reset" : "Created"} ${role.toLowerCase()} login for ${email} (command line)` } });
  console.log(`${existing ? "Updated" : "Created"} ${role === "REP" ? "sales rep" : "coordinator"} ${name} <${email}>`);
  await prisma.$disconnect();
}
main();
