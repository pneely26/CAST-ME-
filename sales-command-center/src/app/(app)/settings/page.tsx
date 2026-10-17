import { requireActor } from "@/server/auth";
import { can } from "@/server/policy";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { listUsers } from "@/server/services/users";
import { demoStatus } from "@/server/services/demo";
import { lastReminderRun } from "@/server/services/reminders";
import { externalChannels } from "@/server/services/notifications";
import { extractionStatus } from "@/server/extraction";
import { Badge, KV, PageHeader, Section } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { changeOwnPasswordAction, createUserAction, demoAction, resetPasswordAction, saveSettingsAction, setUserActiveAction, updateUserAction } from "@/app/actions/settings";
import { runRemindersAction } from "@/app/actions/notifications";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata = { title: "Settings" };

const ZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

function NumberField({ label, name, value, hint, min, max }: { label: string; name: string; value: number; hint?: string; min: number; max: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" name={name} defaultValue={value} min={min} max={max} required className="input" />
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export default async function SettingsPage() {
  const actor = await requireActor();
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true, email: true, role: true, createdAt: true } });
  const coord = can(actor, "settings.manage");
  const settings = await getSettings();
  const tz = settings.timezone;

  const account = (
    <Section title="My account">
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <KV label="Name">{me.name}</KV>
          <KV label="Role">{me.role === "COORDINATOR" ? "Coordinator" : "Sales rep"}</KV>
          <KV label="Email">{me.email}</KV>
          <KV label="Member since">{fmtDate(me.createdAt, tz)}</KV>
        </div>
        <ActionForm allowReadOnly action={changeOwnPasswordAction} resetOnSuccess className="space-y-2">
          <input type="password" name="current" autoComplete="current-password" required placeholder="Current password" aria-label="Current password" className="input" />
          <input type="password" name="password" autoComplete="new-password" required minLength={10} placeholder="New password (10+ characters)" aria-label="New password" className="input" />
          <input type="password" name="confirm" autoComplete="new-password" required minLength={10} placeholder="Repeat new password" aria-label="Repeat new password" className="input" />
          <SubmitButton className="btn-secondary">Change password</SubmitButton>
        </ActionForm>
      </div>
    </Section>
  );
  if (!coord) return <div className="max-w-4xl space-y-4"><PageHeader title="Settings" />{account}</div>;

  const [users, demo, lastRun] = await Promise.all([listUsers(actor), demoStatus(), lastReminderRun()]);
  const provider = extractionStatus();
  const channels = externalChannels.filter((c) => c.enabled()).map((c) => c.id);
  const zones = ZONES.includes(tz) ? ZONES : [tz, ...ZONES];

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader title="Settings & Users" subtitle="Changes here are recorded in the audit log." />

      <Section title="Users" subtitle="Deactivating someone signs them out and blocks login; their history is kept.">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th className="text-right">Assigned leads</th><th>Status</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="font-medium">{u.name}{u.id === actor.id && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                  <td>{u.email}</td>
                  <td>{u.role === "COORDINATOR" ? "Coordinator" : "Sales rep"}</td>
                  <td className="text-right tabular-nums">{u.role === "REP" ? u.assignedLeads : "—"}</td>
                  <td>{u.active ? <Badge tone="good">Active</Badge> : <Badge tone="muted">Deactivated</Badge>}</td>
                  <td className="min-w-[280px]">
                    <details>
                      <summary className="cursor-pointer text-sm text-accent">Manage</summary>
                      <div className="mt-2 space-y-3">
                        <ActionForm action={updateUserAction} className="grid gap-2 sm:grid-cols-2">
                          <input type="hidden" name="id" value={u.id} />
                          <input name="name" defaultValue={u.name} required className="input" aria-label="Name" />
                          <input name="email" type="email" defaultValue={u.email} required className="input" aria-label="Email" />
                          <input name="phone" defaultValue={u.phone ?? ""} placeholder="Phone" className="input" aria-label="Phone" />
                          <select name="role" defaultValue={u.role} className="input" aria-label="Role" disabled={u.id === actor.id}>
                            <option value="REP">Sales rep</option>
                            <option value="COORDINATOR">Coordinator</option>
                          </select>
                          {u.id === actor.id && <input type="hidden" name="role" value={u.role} />}
                          <div className="sm:col-span-2"><SubmitButton className="btn-secondary btn-sm">Save</SubmitButton></div>
                        </ActionForm>
                        <ActionForm action={resetPasswordAction} resetOnSuccess className="flex gap-2" confirm={`Reset ${u.name}'s password? They'll be signed out everywhere.`}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="password" name="password" required minLength={10} autoComplete="new-password" placeholder="New temporary password" aria-label={`New password for ${u.name}`} className="input" />
                          <SubmitButton className="btn-secondary btn-sm">Reset</SubmitButton>
                        </ActionForm>
                        {u.id !== actor.id && (
                          <ActionForm action={setUserActiveAction} confirm={u.active ? `Deactivate ${u.name}? They'll be signed out and can't log in until reactivated.` : undefined}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                            <SubmitButton className={u.active ? "btn-danger btn-sm" : "btn-secondary btn-sm"}>{u.active ? "Deactivate" : "Reactivate"}</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ActionForm action={createUserAction} resetOnSuccess className="grid gap-2 border-t border-line p-4 sm:grid-cols-3 lg:grid-cols-6">
          <input name="name" required placeholder="Full name" aria-label="Full name" className="input" />
          <input name="email" type="email" required placeholder="Email" aria-label="Email" className="input" />
          <input name="phone" placeholder="Phone (optional)" aria-label="Phone" className="input" />
          <select name="role" defaultValue="REP" aria-label="Role" className="input"><option value="REP">Sales rep</option><option value="COORDINATOR">Coordinator</option></select>
          <input type="password" name="password" required minLength={10} autoComplete="new-password" placeholder="Temporary password" aria-label="Temporary password" className="input" />
          <SubmitButton>Add user</SubmitButton>
        </ActionForm>
      </Section>

      <Section title="App settings">
        <ActionForm action={saveSettingsAction} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block"><span className="label">Business name</span><input name="businessName" defaultValue={settings.businessName} required maxLength={80} className="input" /></label>
          <label className="block">
            <span className="label">Time zone</span>
            <select name="timezone" defaultValue={tz} className="input">{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select>
            <span className="mt-0.5 block text-xs text-muted">All dates, schedules and reports use this zone.</span>
          </label>
          <label className="block"><span className="label">Week starts on</span><select name="weekStartsOn" defaultValue={String(settings.weekStartsOn)} className="input"><option value="1">Monday</option><option value="0">Sunday</option></select></label>
          <NumberField label="“Not visited” after (days)" name="staleVisitDays" value={settings.staleVisitDays} min={1} max={365} hint="Used for stale-lead views, reports and reminders." />
          <NumberField label="Default appointment length (minutes)" name="defaultAppointmentMinutes" value={settings.defaultAppointmentMinutes} min={5} max={480} />
          <NumberField label="Duplicate appointment window (minutes)" name="duplicateAppointmentWindowMinutes" value={settings.duplicateAppointmentWindowMinutes} min={0} max={1440} hint="Two active appointments for the same lead this close together are blocked as duplicates." />
          <NumberField label="Appointment reminder lead time (minutes)" name="reminderMinutesBefore" value={settings.reminderMinutesBefore} min={0} max={1440} />
          <div className="sm:col-span-2 lg:col-span-3"><SubmitButton>Save settings</SubmitButton></div>
        </ActionForm>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Reminders & notifications">
          <div className="space-y-2 p-4 text-sm">
            <p>Reminders are created in the app for follow-ups due today and overdue, appointments starting within {settings.reminderMinutesBefore} minutes, and a weekly digest of leads not visited in {settings.staleVisitDays}+ days. They are checked automatically while the app is in use, and can also be run on a schedule with <code>npm run reminders</code> or the <code>/api/cron/reminders</code> endpoint (requires <code>CRON_SECRET</code>).</p>
            <p className="text-muted">Last checked: {lastRun ? fmtDateTime(lastRun, tz) : "never"}</p>
            <p><b>Delivery:</b> in-app only. {channels.length ? `Also: ${channels.join(", ")}.` : "Email, text message and push delivery are not set up, so nothing is sent outside the app."}</p>
            <ActionForm action={runRemindersAction}><SubmitButton className="btn-secondary btn-sm">Check reminders now</SubmitButton></ActionForm>
          </div>
        </Section>
        <Section title="Integrations">
          <div className="space-y-2 p-4 text-sm">
            <p><b>Screenshot reading:</b> {provider.configured ? <>On — {provider.label}</> : <>Not configured. Set <code>ANTHROPIC_API_KEY</code> in the server environment to read screenshots automatically.</>}</p>
            <p><b>Scheduled reminders endpoint:</b> {process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16 ? "Enabled" : "Disabled (CRON_SECRET not set)"}</p>
            <p><b>File storage:</b> local disk on the server (<code>UPLOAD_DIR</code>). Include it in backups.</p>
          </div>
        </Section>
      </div>

      <Section title="Demonstration data" subtitle="Optional sample records for trying the app. Every demo record is labeled “Demo”. While loaded, demo records count in dashboards and reports (which say so) — remove them before relying on the figures.">
        <div className="flex flex-wrap items-center gap-3 p-4 text-sm">
          {demo.present ? (
            <>
              <Badge tone="warn">Demo data loaded: {demo.leads} lead(s), {demo.opps} opportunity(ies)</Badge>
              <ActionForm action={demoAction} confirm="Remove all demonstration data? Demo leads and their visits, appointments, follow-ups and sales are deleted. Real records are not touched.">
                <input type="hidden" name="op" value="remove" />
                <SubmitButton className="btn-danger btn-sm">Remove demo data</SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <span className="text-muted">No demo data. Every figure in the app comes from real records.</span>
              <ActionForm action={demoAction} confirm="Load sample demo leads, visits and sales? They are clearly labeled and can be removed here at any time.">
                <input type="hidden" name="op" value="load" />
                <SubmitButton className="btn-secondary btn-sm">Load demo data</SubmitButton>
              </ActionForm>
            </>
          )}
        </div>
      </Section>

      {account}
    </div>
  );
}
