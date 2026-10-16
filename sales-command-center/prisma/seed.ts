/**
 * Database seeding.
 *   npm run db:demo                 add clearly-labeled demonstration data (needs one coordinator and one rep)
 *   npm run db:seed -- --remove-demo  remove all demonstration data (real records are never touched)
 * Real logins are created with `npm run create-user` — this script never creates users or real records.
 */
import "../scripts/load-env";
import { prisma } from "../src/server/db";
import { loadDemoData, removeDemoData, demoStatus } from "../src/server/services/demo";

async function main() {
  const coordinator = await prisma.user.findFirst({ where: { role: "COORDINATOR", active: true } });
  if (process.argv.includes("--remove-demo")) {
    if (!coordinator) throw new Error("No active coordinator.");
    const r = await removeDemoData({ id: coordinator.id, role: coordinator.role, name: coordinator.name });
    console.log(`Removed demo data: ${r.leads} lead(s), ${r.visits} visit(s).`);
  } else if (process.argv.includes("--demo")) {
    if (!coordinator) throw new Error('Create a coordinator first: npm run create-user -- --role coordinator --email you@example.com --name "Your Name"');
    const s = await loadDemoData({ id: coordinator.id, role: coordinator.role, name: coordinator.name });
    console.log(`Loaded demo data: ${s.leads} lead(s), ${s.opps} opportunity(ies). Every record is labeled "Demo" and can be removed in Settings.`);
  } else {
    const s = await demoStatus();
    console.log(`Nothing to seed. Real data comes from you. Demo data present: ${s.present ? "yes" : "no"}. Use --demo or --remove-demo.`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
