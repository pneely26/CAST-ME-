import { prisma } from "../db";
import { assertCan, type Actor } from "../policy";
import { invalid } from "../errors";
import { createLead } from "./leads";
import { recordVisit } from "./visits";
import { createAppointment } from "./appointments";
import { createFollowUp } from "./followups";
import { saveOpportunity } from "./opportunities";
import { refreshLeadRollups } from "./rollups";

/**
 * Optional demonstration data. Every demo lead, opportunity and territory is flagged `isDemo` and shown
 * with a "Demo" label; removing demo data deletes exactly those records and everything attached to them.
 * Real records are never touched. Names end in "(demo)" so they can't be mistaken for real businesses.
 */
const DEMO_TERRITORY = "Demo Territory";

const H = 3_600_000;
const D = 24 * H;

export async function demoStatus() {
  const [leads, opps, territories] = await Promise.all([
    prisma.lead.count({ where: { isDemo: true } }),
    prisma.opportunity.count({ where: { isDemo: true } }),
    prisma.territory.count({ where: { isDemo: true } }),
  ]);
  return { leads, opps, territories, present: leads + opps + territories > 0 };
}

export async function loadDemoData(actor: Actor) {
  assertCan(actor, "settings.manage", "Only the coordinator can load demo data.");
  if ((await demoStatus()).present) throw invalid("Demo data is already loaded. Remove it first to load a fresh copy.");
  const rep = await prisma.user.findFirst({ where: { role: "REP", active: true }, orderBy: { createdAt: "asc" } });
  if (!rep) throw invalid("Add a sales rep first — demo leads are assigned to a rep.");
  const repActor = { id: rep.id, role: rep.role, name: rep.name };

  const territory = await prisma.territory.create({ data: { name: DEMO_TERRITORY, color: "#9333ea", notes: "Demonstration data — safe to remove in Settings.", isDemo: true } });
  const [north, south] = await Promise.all([
    prisma.area.create({ data: { territoryId: territory.id, name: "Demo North" } }),
    prisma.area.create({ data: { territoryId: territory.id, name: "Demo South" } }),
  ]);

  const defs = [
    { businessName: "Corner Coffee (demo)", contactName: "Sam Lee", phone: "555-010-0001", address: "100 Example Ave", city: "Chicago", state: "IL", zip: "60601", industry: "Cafe", areaId: north.id },
    { businessName: "Maple Hardware (demo)", contactName: "Jordan Diaz", phone: "555-010-0002", address: "200 Example Ave", city: "Chicago", state: "IL", zip: "60601", industry: "Retail", areaId: north.id },
    { businessName: "Riverside Dental (demo)", contactName: "Dr. Kim", phone: "555-010-0003", address: "300 Example Ave", city: "Chicago", state: "IL", zip: "60602", industry: "Healthcare", areaId: north.id },
    { businessName: "Sunrise Bakery (demo)", contactName: null, phone: "555-010-0004", address: "400 Example Ave", city: "Chicago", state: "IL", zip: "60602", industry: "Bakery", areaId: south.id },
    { businessName: "Lakeview Auto (demo)", contactName: "Pat Morgan", phone: "555-010-0005", address: "500 Example Ave", city: "Chicago", state: "IL", zip: "60603", industry: "Automotive", areaId: south.id },
    { businessName: "Green Leaf Salon (demo)", contactName: "Alex Chen", phone: null, address: "600 Example Ave", city: "Chicago", state: "IL", zip: "60603", industry: "Salon", areaId: south.id },
  ];
  const leads = [];
  for (const d of defs) leads.push(await createLead(actor, { ...d, assignedRepId: rep.id, source: "Demo data", notes: "Demonstration lead." }, { isDemo: true, allowDuplicate: true, source: "demo data" }));
  const [coffee, hardware, dental, bakery, auto] = leads;
  const now = Date.now();

  await recordVisit(repActor, { leadId: coffee.id, visitAt: new Date(now - 6 * D), type: "WALK_IN", outcome: "INTERESTED", contactEncountered: "Sam Lee", feedback: "Demo: owner liked the brochure and wants pricing.", interestLevel: "HIGH", followUpAction: "Send pricing sheet", followUpDueAt: new Date(now - 1 * D) });
  await recordVisit(repActor, { leadId: hardware.id, visitAt: new Date(now - 3 * D), type: "WALK_IN", outcome: "DECISION_MAKER_UNAVAILABLE", feedback: "Demo: decision maker out until next week.", followUpAction: "Stop by again", followUpDueAt: new Date(now + 2 * D) });
  await recordVisit(repActor, { leadId: dental.id, visitAt: new Date(now - 40 * D), type: "WALK_IN", outcome: "LEFT_INFORMATION", feedback: "Demo: left information with the front desk." });
  await recordVisit(repActor, { leadId: auto.id, visitAt: new Date(now - 10 * D), type: "SCHEDULED_APPOINTMENT", outcome: "SALE_COMPLETED", contactEncountered: "Pat Morgan", feedback: "Demo: signed up on the spot." });
  await createFollowUp(actor, { leadId: bakery.id, dueAt: new Date(now + 4 * H), action: "Call to find the owner's name" });
  const start = new Date(Math.ceil((now + 2 * D) / H) * H);
  await createAppointment(actor, { leadId: coffee.id, repId: rep.id, startAt: start, endAt: new Date(start.getTime() + 45 * 60_000), title: "Pricing review (demo)", allowOverlap: true });

  const won = await saveOpportunity(actor, null, { leadId: auto.id, product: "Starter package (demo)", status: "WON", estimatedValue: 1500, finalAmount: 1200, paymentStatus: "PAID", confirmed: true, closedAt: new Date(now - 10 * D) });
  const open = await saveOpportunity(actor, null, { leadId: coffee.id, product: "Growth package (demo)", status: "PROPOSAL", estimatedValue: 2400 });
  await prisma.opportunity.updateMany({ where: { id: { in: [won.id, open.id] } }, data: { isDemo: true } });
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "demo.loaded", entityType: "Demo", summary: `Loaded demonstration data: ${leads.length} leads in “${DEMO_TERRITORY}”, assigned to ${rep.name}` } });
  return demoStatus();
}

/** Delete every demo-flagged record and what hangs off it. Real records are untouched. */
export async function removeDemoData(actor: Actor) {
  assertCan(actor, "settings.manage", "Only the coordinator can remove demo data.");
  const demoLeads = (await prisma.lead.findMany({ where: { isDemo: true }, select: { id: true } })).map((l) => l.id);
  const demoTerritories = (await prisma.territory.findMany({ where: { isDemo: true }, select: { id: true } })).map((t) => t.id);
  const result = await prisma.$transaction(async (tx) => {
    const realOnDemoTerritory = await tx.lead.count({ where: { isDemo: false, territoryId: { in: demoTerritories } } });
    const appts = (await tx.appointment.findMany({ where: { leadId: { in: demoLeads } }, select: { id: true } })).map((a) => a.id);
    const opps = (await tx.opportunity.findMany({ where: { OR: [{ isDemo: true }, { leadId: { in: demoLeads } }] }, select: { id: true } })).map((o) => o.id);
    const fus = (await tx.followUp.findMany({ where: { leadId: { in: demoLeads } }, select: { id: true } })).map((f) => f.id);
    const vis = (await tx.visit.findMany({ where: { leadId: { in: demoLeads } }, select: { id: true } })).map((v) => v.id);
    const reqs = (await tx.rescheduleRequest.findMany({ where: { OR: [{ leadId: { in: demoLeads } }, { appointmentId: { in: appts } }] }, select: { id: true } })).map((r) => r.id);
    // notifications about demo records reference them by link or dedupe key
    const linked = [...demoLeads, ...appts, ...opps, ...fus, ...vis, ...reqs];
    const notifications = linked.length ? await tx.notification.deleteMany({ where: { OR: linked.flatMap((id) => [{ link: { contains: id } }, { dedupeKey: { contains: id } }]) } }) : { count: 0 };
    await tx.rescheduleRequest.deleteMany({ where: { OR: [{ leadId: { in: demoLeads } }, { appointmentId: { in: appts } }] } });
    await tx.appointment.deleteMany({ where: { id: { in: appts } } });
    await tx.auditLog.deleteMany({ where: { entityType: "Opportunity", entityId: { in: opps } } });
    await tx.opportunity.deleteMany({ where: { id: { in: opps } } });
    const visits = await tx.visit.deleteMany({ where: { leadId: { in: demoLeads } } });
    await tx.importRecord.updateMany({ where: { leadId: { in: demoLeads } }, data: { leadId: null } });
    await tx.auditLog.deleteMany({ where: { leadId: { in: demoLeads } } });
    const leads = await tx.lead.deleteMany({ where: { id: { in: demoLeads } } }); // stops, follow-ups, assignments cascade
    // keep a demo territory if a real lead was moved into it (just un-flag it)
    if (realOnDemoTerritory) await tx.territory.updateMany({ where: { id: { in: demoTerritories } }, data: { isDemo: false } });
    else {
      await tx.scheduleTemplateDay.updateMany({ where: { OR: [{ territoryId: { in: demoTerritories } }, { area: { territoryId: { in: demoTerritories } } }] }, data: { territoryId: null, areaId: null } });
      await tx.dayPlan.updateMany({ where: { OR: [{ territoryId: { in: demoTerritories } }, { area: { territoryId: { in: demoTerritories } } }] }, data: { territoryId: null, areaId: null } });
      await tx.area.deleteMany({ where: { territoryId: { in: demoTerritories } } });
      await tx.territory.deleteMany({ where: { id: { in: demoTerritories } } });
    }
    await tx.auditLog.create({ data: { actorId: actor.id, action: "demo.removed", entityType: "Demo", summary: `Removed demonstration data: ${leads.count} lead(s), ${visits.count} visit(s), ${notifications.count} notification(s)` } });
    return { leads: leads.count, visits: visits.count };
  }, { timeout: 30_000 });
  // rollups on real leads are unaffected (demo records only belonged to demo leads); refresh defensively anyway
  const touched = await prisma.lead.findMany({ where: { isDemo: false, visits: { none: {} }, visitCount: { gt: 0 } }, select: { id: true } });
  for (const l of touched) await prisma.$transaction((tx) => refreshLeadRollups(tx, l.id));
  return result;
}
