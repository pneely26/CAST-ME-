import Link from "next/link";
import type { NotificationType } from "@prisma/client";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { sp, type SP } from "@/server/services/leadQuery";
import { externalChannels } from "@/server/services/notifications";
import { lastReminderRun } from "@/server/services/reminders";
import { Badge, Empty, PageHeader, Tabs } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { markReadAction, runRemindersAction } from "@/app/actions/notifications";
import { fmtDateTime, relativeDay } from "@/lib/time";

export const metadata = { title: "Notifications" };

const TYPE_LABEL: Record<NotificationType, string> = {
  FOLLOW_UP_DUE: "Follow-up due",
  FOLLOW_UP_OVERDUE: "Overdue",
  APPOINTMENT_UPCOMING: "Upcoming",
  APPOINTMENT_CANCELED: "Canceled",
  RESCHEDULE_REQUESTED: "Reschedule",
  RESCHEDULE_APPROVED: "Approved",
  RESCHEDULE_DECLINED: "Declined",
  NEW_FEEDBACK: "Feedback",
  NEW_SALE: "Sale",
  LEAD_NOT_VISITED: "Not visited",
  LEAD_ASSIGNED: "Assigned",
};
const TYPE_TONE: Partial<Record<NotificationType, "bad" | "warn" | "good" | "info" | "accent">> = { FOLLOW_UP_OVERDUE: "bad", FOLLOW_UP_DUE: "warn", APPOINTMENT_UPCOMING: "info", APPOINTMENT_CANCELED: "bad", RESCHEDULE_REQUESTED: "warn", RESCHEDULE_APPROVED: "good", RESCHEDULE_DECLINED: "bad", NEW_SALE: "good", LEAD_ASSIGNED: "accent" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const tz = (await getSettings()).timezone;
  const view = sp(params, "view") === "all" ? "all" : "unread";
  const [items, unread, lastRun] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor.id, ...(view === "unread" ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
    lastReminderRun(),
  ]);
  const external = externalChannels.filter((c) => c.enabled()).map((c) => c.id);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Notifications"
        subtitle={`In-app notifications${external.length ? ` (also sent by ${external.join(", ")})` : ". Email, text and push notifications aren't set up, so nothing is sent outside the app"}.`}
        actions={
          unread > 0 ? (
            <ActionForm action={markReadAction} showSuccess={false}>
              <input type="hidden" name="all" value="1" />
              <SubmitButton className="btn-secondary">Mark all read</SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />
      <Tabs active={view} tabs={[{ key: "unread", label: `Unread (${unread})`, href: "/notifications" }, { key: "all", label: "All", href: "/notifications?view=all" }]} />
      <div className="card divide-y divide-line">
        {items.length ? (
          items.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? "" : "bg-accent-2/40"}`}>
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TYPE_TONE[n.type] ?? "neutral"}>{TYPE_LABEL[n.type]}</Badge>
                  <a href={`/notifications/${n.id}/open`} className={`hover:underline ${n.readAt ? "text-ink-2" : "font-medium"}`}>{n.title}</a>
                  {!n.readAt && <span className="sr-only">(unread)</span>}
                </div>
                {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                <p className="mt-0.5 text-xs text-muted" title={fmtDateTime(n.createdAt, tz)}>{relativeDay(n.createdAt, tz)} · {fmtDateTime(n.createdAt, tz)}</p>
              </div>
              <ActionForm action={markReadAction} showSuccess={false}>
                <input type="hidden" name="ids" value={n.id} />
                {n.readAt && <input type="hidden" name="unread" value="1" />}
                <SubmitButton className="btn-ghost btn-sm">{n.readAt ? "Mark unread" : "Mark read"}</SubmitButton>
              </ActionForm>
            </div>
          ))
        ) : (
          <Empty>{view === "unread" ? <>You&apos;re all caught up. <Link className="link" href="/notifications?view=all">See all notifications</Link></> : "No notifications yet."}</Empty>
        )}
      </div>
      <p className="text-xs text-muted">
        Reminders for due and overdue follow-ups, upcoming appointments and leads not visited recently are checked automatically while the app is in use{lastRun ? ` (last checked ${fmtDateTime(lastRun, tz)})` : ""}.
      </p>
      {actor.role === "COORDINATOR" && (
        <ActionForm action={runRemindersAction}>
          <SubmitButton className="btn-secondary btn-sm">Check reminders now</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
