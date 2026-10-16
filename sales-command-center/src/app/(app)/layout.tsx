import { Shell } from "@/components/Shell";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { dateKeyInTz, dayRangeUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const settings = await getSettings();
  const today = dateKeyInTz(new Date(), settings.timezone);
  const { end } = dayRangeUtc(today, today, settings.timezone);
  const mine = actor.role === "REP";
  const [notifications, reschedules, followUpsDue] = await Promise.all([
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    prisma.rescheduleRequest.count({ where: { status: "PENDING", ...(mine ? { requestedById: actor.id } : {}) } }),
    prisma.followUp.count({ where: { status: "OPEN", dueAt: { lt: end }, ...(mine ? { assignedToId: actor.id } : {}), lead: { archivedAt: null } } }),
  ]);
  return (
    <Shell role={actor.role} name={actor.name} counts={{ notifications, reschedules, followUpsDue }}>
      {children}
    </Shell>
  );
}
