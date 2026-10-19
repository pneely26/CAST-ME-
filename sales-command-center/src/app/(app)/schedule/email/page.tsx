import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { emailStatus } from "@/server/email";
import { getScheduleEmailSettings, repSchedule } from "@/server/services/scheduleEmail";
import { sp, type SP } from "@/server/services/leadQuery";
import { Badge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox } from "@/components/fields";
import { saveScheduleEmailSettingsAction, sendScheduleEmailsAction } from "@/app/actions/scheduleEmail";
import { dateKeyInTz, fmtDateKey, fmtDateTime, isDateKey, nextWorkDay } from "@/lib/time";

export const metadata = { title: "Schedule email" };

export default async function ScheduleEmailPage({ searchParams }: { searchParams: Promise<SP> }) {
  const q = await searchParams;
  const actor = await requireActor();
  if (!can(actor, "settings.manage")) return <div className="card"><Empty>Only the coordinator can send schedule emails.</Empty></div>;
  const [settings, cfg] = await Promise.all([getSettings(), getScheduleEmailSettings()]);
  const tz = settings.timezone;
  const email = emailStatus();
  const today = dateKeyInTz(new Date(), tz);
  const date = isDateKey(sp(q, "date")) ? sp(q, "date")! : nextWorkDay(today, cfg.skipWeekends);
  const reps = await prisma.user.findMany({ where: { role: "REP", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
  const counts = await Promise.all(reps.map(async (r) => (await repSchedule(r.id, date)).items));
  const recent = await prisma.auditLog.findMany({ where: { action: { in: ["email.schedule", "email.scheduleFailed"] } }, orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } } } });

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader back={{ href: "/schedule", label: "Schedule" }} title="Email reps their schedule" subtitle="Each rep gets their appointments and planned visits for the day, with every lead's details: control number, prospect, address, phones, business info, problems and BC notes." />
      <Flash message={sp(q, "msg")} tone={sp(q, "tone") === "bad" ? "bad" : "good"} />

      {email.configured ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Email is set up. Messages are sent from <b>{email.from}</b>, and replies go to you.</p>
      ) : (
        <div role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Email isn&apos;t set up yet, so nothing can be sent.</b> You can still preview each rep&apos;s email below. To turn sending on, add these in Render → your service → <b>Environment</b>, then save (Render restarts the app):
          <ul className="ml-5 mt-1 list-disc">
            <li><code>SMTP_HOST</code>: e.g. <code>smtp.gmail.com</code> (Gmail) or <code>smtp.office365.com</code> (Outlook / Microsoft 365)</li>
            <li><code>SMTP_PORT</code>: <code>587</code></li>
            <li><code>SMTP_USER</code>: the email address that sends</li>
            <li><code>SMTP_PASS</code>: its password. For Gmail, use an <i>app password</i> (Google Account → Security → App passwords).</li>
            <li><code>EMAIL_FROM</code> (optional), e.g. <code>Your Name &lt;you@gmail.com&gt;</code></li>
          </ul>
        </div>
      )}

      <Section title="Send now" subtitle={`Schedule for ${fmtDateKey(date, { weekday: "long", month: "long", day: "numeric" })}`}>
        <form method="get" className="flex flex-wrap items-end gap-2 border-b border-line-2 p-4">
          <label className="block"><span className="label">Day</span><input type="date" name="date" defaultValue={date} className="input" /></label>
          <button className="btn-secondary">Show</button>
        </form>
        {reps.length ? (
          <ActionForm action={sendScheduleEmailsAction} confirm={`Email the ticked reps their schedule for ${fmtDateKey(date)}?`}>
            <input type="hidden" name="date" value={date} />
            <ul className="divide-y divide-line-2">
              {reps.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Checkbox name="reps" value={r.id} defaultChecked={counts[i].length > 0} label={<span><b>{r.name}</b> <span className="text-muted">{r.email}</span></span>} />
                  <Badge tone={counts[i].length ? "accent" : "muted"}>{counts[i].length} stop{counts[i].length === 1 ? "" : "s"}</Badge>
                  <a className="link ml-auto text-sm" href={`/api/schedule-email/preview?rep=${r.id}&date=${date}`} target="_blank" rel="noopener">Preview email</a>
                </li>
              ))}
            </ul>
            <div className="border-t border-line-2 p-4">
              <SubmitButton disabled={!email.configured}>Send schedule emails</SubmitButton>
              <p className="mt-2 text-xs text-muted">Reps with nothing scheduled that day aren&apos;t emailed.</p>
            </div>
          </ActionForm>
        ) : <Empty>No active sales reps.</Empty>}
      </Section>

      <Section title="Send automatically" subtitle="Every day at the time you choose, each rep is emailed the next day's schedule.">
        <ActionForm action={saveScheduleEmailSettingsAction} className="space-y-3 p-4">
          <Checkbox name="enabled" defaultChecked={cfg.enabled} label="Email each rep their next-day schedule automatically" />
          <label className="block max-w-40"><span className="label">Send at ({tz.replace("_", " ")})</span><input type="time" name="time" defaultValue={cfg.time} required className="input" /></label>
          <Checkbox name="skipWeekends" defaultChecked={cfg.skipWeekends} label="Skip weekends: on Friday, send Monday's schedule" />
          <SubmitButton className="btn-secondary">Save</SubmitButton>
          <p className="text-xs text-muted">On Render&apos;s free plan the app goes to sleep when nobody has used it for about 15 minutes, and an asleep app can&apos;t send. To make sure the email goes out on time, have a free scheduler such as cron-job.org call <code>/api/cron/reminders</code> every 15 minutes, with the <code>CRON_SECRET</code> header described in the README.</p>
        </ActionForm>
      </Section>

      <Section title="Recently sent">
        {recent.length ? (
          <ul className="divide-y divide-line-2">
            {recent.map((r) => <li key={r.id} className="px-4 py-2 text-sm">{r.action === "email.scheduleFailed" ? <Badge tone="bad">Failed</Badge> : <Badge tone="good">Sent</Badge>} {r.summary}<div className="text-xs text-muted">{fmtDateTime(r.createdAt, tz)} · {r.actor?.name ?? "automatic"}</div></li>)}
          </ul>
        ) : <Empty>No schedule emails sent yet.</Empty>}
      </Section>
    </div>
  );
}
