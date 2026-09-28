/**
 * DEMO DATA seed. Every record here is FICTIONAL and flagged isDemo=true so the UI labels it
 * "DEMO DATA". None of it is real casting information. Remove it from Settings → Demo data.
 */
import { PrismaClient } from "@prisma/client";
import { createBreakdown } from "../src/lib/server/records";
import { runDetection } from "../src/lib/server/detection";
import { updateBreakdownRelevance, DEFAULT_PROFILE } from "../src/lib/server/profile";
import { generateAlerts } from "../src/lib/alerts/engine";
import { addWatch } from "../src/lib/server/watchlist";
import { normalizedTitleString } from "../src/lib/normalize";
import { DEFAULT_PLATFORMS } from "../src/lib/constants";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const now = new Date();
const days = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17) + n * DAY);
const DEMO_SOURCE = "DEMO DATA (fictional)";
const DEMO_URL = "https://example.com/demo-listing";

async function main() {
  const existing = await prisma.project.count({ where: { isDemo: true } });
  if (existing > 0 && !process.argv.includes("--force")) {
    console.log("Demo data already present. Run `npm run db:seed -- --force` to re-create it.");
    return;
  }
  if (existing > 0) await clearDemo();

  await prisma.actorProfile.upsert({ where: { id: "default" }, update: {}, create: DEFAULT_PROFILE });
  for (const name of DEFAULT_PLATFORMS) {
    await prisma.platform.upsert({ where: { name }, update: {}, create: { name, isCustom: false } });
  }

  const breakdowns = [
    { project: "The Lakeshore Hours", platform: "Netflix", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "CHICAGO", castingDirector: "Dana Whitfield, CSA", castingOffice: "Whitfield Casting", roleName: "Denise Porter", roleType: "Recurring", ageRange: "28-35", gender: "Female", characterDescription: "A sharp, warm ER nurse who keeps the night shift running.", postedDate: days(-5), submissionDeadline: days(3), visibility: "PUBLIC", verified: true },
    { project: "Paramount+ Untitled Series", platform: "Paramount+", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "ATLANTA", castingDirector: "Marcus Bell", castingOffice: "Bell & Harlow Casting", roleName: "Kira", roleType: "Series Regular", ageRange: "25-32", gender: "Female", ethnicity: "Black / African American", characterDescription: "Ambitious junior architect returning home to run the family business.", postedDate: days(-8), submissionDeadline: days(6), visibility: "PUBLIC", verified: true },
    { project: "Last Summer", platform: "Hulu", productionType: "Feature Film", unionStatus: "SAG-AFTRA", region: "LOS_ANGELES", castingDirector: "Tom Becker", roleName: "Kim", roleType: "Supporting", ageRange: "30-40", gender: "Male", characterDescription: "Laid-back surf instructor.", postedDate: days(-3), submissionDeadline: days(9), visibility: "PUBLIC", verified: false },
    { project: "Harbor Lights", platform: "Apple TV+", productionType: "Limited Series", unionStatus: "SAG-AFTRA", region: "NEW_YORK", castingDirector: "Lena Park", castingOffice: "Park Casting", roleName: "Nora Vance", roleType: "Guest Star", ageRange: "20s-30s", gender: "Female", characterDescription: "Lounge singer with a secret. Must sing — jazz standards.", postedDate: days(-10), submissionDeadline: days(10), visibility: "PUBLIC", verified: true },
    { project: "Crosstown Blues", platform: "HBO", productionType: "Feature Film", unionStatus: "SAG-AFTRA", region: "CHICAGO", castingDirector: "Dana Whitfield", castingOffice: "Whitfield Casting", roleName: "Rochelle", roleType: "Supporting", ageRange: "30-39", gender: "Female", characterDescription: "Record-store owner and reluctant witness.", postedDate: days(-20), submissionDeadline: days(-2), visibility: "PUBLIC", verified: true },
    { project: "Velvet Hour", platform: "Other", productionType: "Musical", unionStatus: "AEA", region: "CHICAGO", castingDirector: "Ruth Okafor", roleName: "Ensemble (Swing)", roleType: "Ensemble", ageRange: "20-35", gender: "All genders", characterDescription: "Strong dancers who sing. Tap a plus.", postedDate: days(-30), submissionDeadline: days(-12), visibility: "CLOSED", verified: true },
    { project: "The Southside Precinct", platform: "Netflix", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "CHICAGO", castingDirector: "Dana Whitfield", castingOffice: "Whitfield Casting", roleName: "Officer Jada Reyes", roleType: "Co-Star", ageRange: "25-35", gender: "Female", postedDate: days(-2), submissionDeadline: days(1), visibility: "PUBLIC", verified: true },
    { project: "Midnight Ledger", platform: "HBO", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "NEW_YORK", castingDirector: "Lena Park", castingOffice: "Park Casting", roleName: "Assistant DA", roleType: "Recurring", gender: "Any", characterDescription: "Precise, unflappable prosecutor.", postedDate: days(-1), submissionDeadline: days(14), visibility: "PUBLIC", verified: false },
    { project: "Peach State", platform: "Hulu", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "ATLANTA", castingDirector: "Marcus Bell", castingOffice: "Bell & Harlow Casting", roleName: "Principal Adeyemi", roleType: "Co-Star", ageRange: "40-50", gender: "Female", postedDate: days(-6), submissionDeadline: days(20), visibility: "PUBLIC", verified: true },
    { project: "Northern Line", platform: "Apple TV+", productionType: "TV Series", unionStatus: "SAG-AFTRA", region: "NATIONWIDE", castingDirector: "Sam Ortega", roleName: "Tess", roleType: "Guest Star", ageRange: "early 20s to mid 30s", gender: "Female", characterDescription: "Train conductor; must be comfortable with light choreography (dance).", postedDate: days(-4), submissionDeadline: days(12), visibility: "PUBLIC", verified: false },
    { project: "Gold Coast", platform: "Peacock", productionType: "Pilot", unionStatus: "SAG-AFTRA / Non-Union", region: "CHICAGO", castingDirector: "Priya Natarajan", roleName: "Real Estate Agent", roleType: "Co-Star", ageRange: "30s", gender: "Female", postedDate: days(-40), submissionDeadline: days(25), visibility: "UNKNOWN", verified: false },
  ] as const;

  for (const b of breakdowns) {
    await createBreakdown({ ...b, source: DEMO_SOURCE, sourceUrl: DEMO_URL, isDemo: true } as Parameters<typeof createBreakdown>[0]);
  }
  // make one record look stale (verified long ago)
  await prisma.project.updateMany({ where: { title: "Gold Coast", isDemo: true }, data: { verifiedAt: days(-40) } });
  await prisma.publicBreakdown.updateMany({ where: { project: { title: "Gold Coast" }, isDemo: true }, data: { verifiedAt: days(-40), importedAt: days(-40) } });

  // CD locations are independent of project regions (NY-based CD casting a Chicago project, etc.)
  await prisma.castingDirector.updateMany({ where: { normalizedName: "dana whitfield" }, data: { city: "New York", state: "NY", website: "https://example.com/whitfield-demo" } });
  await prisma.castingDirector.updateMany({ where: { normalizedName: "marcus bell" }, data: { city: "Los Angeles", state: "CA" } });
  await prisma.castingDirector.updateMany({ where: { normalizedName: "lena park" }, data: { city: "New York", state: "NY" } });
  await prisma.castingDirector.updateMany({ where: { normalizedName: "ruth okafor" }, data: { city: "Chicago", state: "IL" } });

  const submissions = [
    { projectTitleRaw: "Lakeshore Hours", role: "Denise Porter", castingDirectorRaw: "Dana Whitfield CSA", platform: "Netflix", region: "CHICAGO", dateSubmitted: days(-4), status: "Submitted" },
    { projectTitleRaw: "Untitled Paramount+ Series", role: "Kira", castingDirectorRaw: "Marcus Bell", platform: "Paramount+", region: "ATLANTA", dateSubmitted: days(-7), status: "Self-tape requested" },
    { projectTitleRaw: "Iron & Velvet", role: "Tasha", castingDirectorRaw: "Rosa Grant", platform: "HBO", region: "LOS_ANGELES", dateSubmitted: days(-6), status: "Submitted" },
    { projectTitleRaw: "The Last Summer", role: "June", castingDirectorRaw: "Ann Ruiz", platform: "Netflix", region: "LOS_ANGELES", dateSubmitted: days(-2), status: "Submitted" },
    { projectTitleRaw: "Harbour Lights (w/t)", role: "Nora Vance", castingDirectorRaw: "Lena Park", platform: "Apple TV+", region: "NEW_YORK", dateSubmitted: days(-9), status: "Callback" },
    { projectTitleRaw: "Untitled Peacock Pilot", role: "Dr. Simone Hale", castingDirectorRaw: "Dana Whitfield", platform: "Peacock", region: "CHICAGO", dateSubmitted: days(-3), status: "Submitted" },
    { projectTitleRaw: "IRON AND VELVET", role: "Tasha", castingDirectorRaw: "Rosa Grant", platform: "HBO", region: "LOS_ANGELES", dateSubmitted: days(-5), status: "Submitted" },
    { projectTitleRaw: "Glass Houses", role: "Maya", castingDirectorRaw: "Lena Park", platform: "Netflix", region: "NEW_YORK", dateSubmitted: days(-12), status: "Submitted" },
  ];
  let i = 0;
  for (const s of submissions) {
    const created = await prisma.agencySubmission.create({
      data: {
        ...s,
        normalizedTitle: normalizedTitleString(s.projectTitleRaw),
        region: s.region as never,
        source: "Agency report (DEMO DATA)",
        notes: "DEMO DATA — fictional agency submission for testing blind-spot detection.",
        importedAt: new Date(now.getTime() - (submissions.length - i++) * 60_000),
        isDemo: true,
      },
    });
    await runDetection(created.id);
  }
  // mark agency-created CDs/projects as demo too
  await prisma.project.updateMany({ where: { agencyReported: true }, data: { isDemo: true } });
  await prisma.castingDirector.updateMany({ where: { castings: { every: { project: { isDemo: true } } } }, data: { isDemo: true } });

  await updateBreakdownRelevance();

  const dana = await prisma.castingDirector.findUnique({ where: { normalizedName: "dana whitfield" } });
  const lena = await prisma.castingDirector.findUnique({ where: { normalizedName: "lena park" } });
  if (dana) await addWatch("CASTING_DIRECTOR", dana.name, { castingDirectorId: dana.id });
  if (lena) await addWatch("CASTING_DIRECTOR", lena.name, { castingDirectorId: lena.id });
  await addWatch("CASTING_OFFICE", "Bell & Harlow Casting");
  await addWatch("PLATFORM", "Netflix");
  await addWatch("REGION", "CHICAGO");

  await generateAlerts();
  const counts = {
    projects: await prisma.project.count(),
    breakdowns: await prisma.publicBreakdown.count(),
    submissions: await prisma.agencySubmission.count(),
    blindSpots: await prisma.blindSpot.groupBy({ by: ["classification"], _count: true }),
    alerts: await prisma.alert.count(),
  };
  console.log("Seeded DEMO DATA:", JSON.stringify(counts, null, 2));
}

async function clearDemo() {
  await prisma.watchlistItem.deleteMany({ where: { OR: [{ castingDirector: { isDemo: true } }, { project: { isDemo: true } }] } });
  await prisma.agencySubmission.deleteMany({ where: { isDemo: true } });
  await prisma.project.deleteMany({ where: { isDemo: true } });
  await prisma.castingDirector.deleteMany({ where: { isDemo: true } });
  await prisma.alert.deleteMany({});
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
