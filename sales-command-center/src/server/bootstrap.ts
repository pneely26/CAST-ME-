import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { loadDemoData } from "./services/demo";

/**
 * First-start setup for hosted deployments where there is no command line (e.g. a Render blueprint).
 * Runs only when the database has no users at all, so it can never overwrite or re-create accounts:
 *   BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD  → the first coordinator login
 *   BOOTSTRAP_DEMO=true                                → also a demo rep login and clearly-labeled demo data
 *   BOOTSTRAP_REP_EMAIL / BOOTSTRAP_REP_PASSWORD       → optional; the demo rep login (defaults: demo-rep@example.com
 *                                                        and the coordinator's password)
 */
export async function bootstrapIfEmpty() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!email) return;
  if ((await prisma.user.count()) > 0) return;
  if (password.length < 10) {
    console.error("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD must be at least 10 characters — no login was created.");
    return;
  }
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || email.split("@")[0];
  const coordinator = await prisma.user.create({ data: { email, name, role: "COORDINATOR", passwordHash: bcrypt.hashSync(password, 12) } });
  await prisma.auditLog.create({ data: { action: "user.created", entityType: "User", entityId: coordinator.id, summary: `Created coordinator ${email} on first start (BOOTSTRAP_ADMIN_EMAIL)` } });
  console.log(`[bootstrap] Created coordinator ${email}`);

  if (process.env.BOOTSTRAP_DEMO !== "true") return;
  const repEmail = process.env.BOOTSTRAP_REP_EMAIL?.trim().toLowerCase() || "demo-rep@example.com";
  const repPassword = (process.env.BOOTSTRAP_REP_PASSWORD ?? "").length >= 10 ? process.env.BOOTSTRAP_REP_PASSWORD! : password;
  const rep = await prisma.user.create({ data: { email: repEmail, name: "Demo Rep", role: "REP", passwordHash: bcrypt.hashSync(repPassword, 12) } });
  await prisma.auditLog.create({ data: { action: "user.created", entityType: "User", entityId: rep.id, summary: `Created demo sales rep ${repEmail} on first start (BOOTSTRAP_DEMO)` } });
  await loadDemoData({ id: coordinator.id, role: "COORDINATOR", name: coordinator.name });
  console.log(`[bootstrap] Created demo rep ${repEmail} and loaded labeled demo data`);
}
