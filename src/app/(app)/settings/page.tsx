import { prisma } from "@/lib/server/db";
import { getProfile } from "@/lib/server/profile";
import { addPlatformAction, removeDemoDataAction, removePlatformAction, updateProfileAction } from "@/app/actions/settings";
import { Badge, Flash, PageHeader, Section } from "@/components/ui";
import { Field, TextArea } from "@/components/FormFields";
import { DEFAULT_PLATFORMS } from "@/lib/constants";
import { extraChannels } from "@/lib/alerts/channels";
import { str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [profile, custom, demoCount] = await Promise.all([
    getProfile(),
    prisma.platform.findMany({ where: { isCustom: true }, orderBy: { name: "asc" } }),
    prisma.project.count({ where: { isDemo: true } }),
  ]);
  const join = (a: string[]) => a.join(", ");
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <Flash message={str(sp, "msg")} />
      <Flash message={str(sp, "error")} tone="bad" />

      <Section title="Actor profile" subtitle="Every field is editable. Relevance compares these values only against details explicitly stated in a breakdown.">
        <form action={updateProfileAction} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" name="name" defaultValue={profile.name} required />
          <Field label="Profession" name="profession" defaultValue={profile.profession} />
          <Field label="Union" name="union" defaultValue={profile.union} />
          <Field label="Location" name="location" defaultValue={profile.location} />
          <Field label="Gender" name="gender" defaultValue={profile.gender} />
          <Field label="Casting profile" name="castingProfile" defaultValue={profile.castingProfile} hint="Used only when a breakdown explicitly states an ethnicity/casting requirement." />
          <Field label="Professional casting range (display)" name="castingRange" defaultValue={profile.castingRange} />
          <Field label="Playing age — from" name="playingAgeMin" type="number" defaultValue={String(profile.playingAgeMin)} />
          <Field label="Playing age — to" name="playingAgeMax" type="number" defaultValue={String(profile.playingAgeMax)} />
          <TextArea label="Primary work (comma-separated)" name="primaryWork" defaultValue={join(profile.primaryWork)} rows={2} />
          <TextArea label="Training" name="training" defaultValue={join(profile.training)} rows={2} />
          <TextArea label="Additional (skills, other unions)" name="additional" defaultValue={join(profile.additional)} rows={2} />
          <TextArea label="Target markets" name="targetMarkets" defaultValue={join(profile.targetMarkets)} rows={2} />
          <TextArea label="Target platforms" name="targetPlatforms" defaultValue={join(profile.targetPlatforms)} rows={3} />
          <TextArea label="Preferred role types (optional)" name="roleTypes" defaultValue={join(profile.roleTypes)} rows={2} hint="e.g. Series Regular, Recurring. Leave blank to treat role type as informational." />
          <div className="sm:col-span-2 lg:col-span-3"><button className="btn-primary">Save profile & recompute relevance</button></div>
        </form>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Platforms" subtitle="Built-in platforms plus your custom ones." className="scroll-mt-4">
          <div id="platforms" className="p-4">
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_PLATFORMS.map((p) => <Badge key={p} tone="muted">{p}</Badge>)}
              {custom.map((p) => (
                <form key={p.id} action={removePlatformAction} className="inline-flex">
                  <input type="hidden" name="id" value={p.id} />
                  <button className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent ring-1 ring-accent/20" title="Remove">{p.name} ✕</button>
                </form>
              ))}
            </div>
            <form action={addPlatformAction} className="mt-3 flex gap-2">
              <input name="name" className="input" placeholder="Add custom platform (e.g. Tubi)" />
              <button className="btn-secondary">Add</button>
            </form>
          </div>
        </Section>

        <Section title="Alerts & monitoring">
          <div className="space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between"><span>In-app notifications</span><Badge tone="good">On</Badge></div>
            {extraChannels.map((c) => (
              <div key={c.id} className="flex items-center justify-between"><span className="capitalize">{c.id} notifications</span><Badge tone={c.enabled() ? "good" : "muted"}>{c.enabled() ? "Configured" : "Not configured"}</Badge></div>
            ))}
            <p className="text-xs text-muted">Deadline alerts fire {process.env.DEADLINE_ALERT_DAYS ?? 3} day(s) ahead. Records not re-verified in {process.env.STALE_AFTER_DAYS ?? 14} days show as STALE. Scheduled monitoring: run <code>npm run monitor</code> from cron (see README).</p>
          </div>
        </Section>
      </div>

      <Section title="Data & privacy">
        <div className="space-y-2 p-4 text-sm text-ink-soft">
          <p>This app never stores Actors Access, Breakdown Express, or agency passwords, and never connects to those services. Agency submission data stays in your own database.</p>
          <p>Only import information that is public or that you’re entitled to keep. Every external record keeps its source, source URL, discovery date and verification date.</p>
        </div>
        <form id="demo" action={removeDemoDataAction} className="flex flex-wrap items-center gap-3 border-t border-line p-4 text-sm">
          <span><Badge tone="warn">Demo data</Badge> {demoCount} demo project(s) in the database.</span>
          <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="yes" /> Remove all DEMO DATA</label>
          <button className="btn-danger" disabled={demoCount === 0}>Remove demo data</button>
        </form>
      </Section>
    </div>
  );
}
