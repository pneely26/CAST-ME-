import Link from "next/link";
import { requireActor } from "@/server/auth";
import { prisma } from "@/server/db";
import { getActiveTemplate } from "@/server/services/schedule";
import { repOptions } from "@/server/options";
import { territoryOptions } from "@/server/services/territories";
import { sp, type SP } from "@/server/services/leadQuery";
import { Empty, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { saveTemplateAction } from "@/app/actions/schedule";
import { WEEKDAYS } from "@/lib/labels";

export const metadata = { title: "Recurring weekly plan" };

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export default async function TemplatePage({ searchParams }: { searchParams: Promise<SP> }) {
  const params = await searchParams;
  const actor = await requireActor();
  const reps = actor.role === "COORDINATOR" ? await repOptions() : [{ id: actor.id, name: actor.name }];
  const repId = actor.role === "REP" ? actor.id : (sp(params, "rep") ?? reps[0]?.id);
  if (!repId) return <div className="card"><Empty>Add a sales rep first.</Empty></div>;
  const [template, territories] = await Promise.all([getActiveTemplate(prisma, repId), territoryOptions()]);
  const day = (w: number) => template?.days.find((d) => d.weekday === w);
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        back={{ href: `/schedule${actor.role === "COORDINATOR" ? `?rep=${repId}` : ""}`, label: "Schedule" }}
        title="Recurring weekly plan"
        subtitle="The default territory for each weekday. Changing it updates every week that hasn't been individually changed; one-off day changes are kept."
      />
      {actor.role === "COORDINATOR" && reps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">{reps.map((r) => <Link key={r.id} href={`/schedule/template?rep=${r.id}`} className={r.id === repId ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{r.name}</Link>)}</div>
      )}
      <ActionForm action={saveTemplateAction} className="card overflow-x-auto">
        <input type="hidden" name="repId" value={repId} />
        <table className="tbl min-w-[860px]">
          <thead><tr><th>Day</th><th>Area</th><th>Label</th><th>Start</th><th>End</th><th>Visit target</th><th>Notes</th></tr></thead>
          <tbody>
            {ORDER.map((w) => {
              const d = day(w);
              return (
                <tr key={w}>
                  <td className="font-medium">{WEEKDAYS[w]}</td>
                  <td>
                    <select name={`areaId_${w}`} defaultValue={d?.areaId ?? ""} className="input min-w-[160px]">
                      <option value="">—</option>
                      {territories.map((t) => <optgroup key={t.id} label={t.name}>{t.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
                    </select>
                    <select name={`territoryId_${w}`} defaultValue={d?.areaId ? "" : (d?.territoryId ?? "")} className="input mt-1 min-w-[160px] text-xs" aria-label={`${WEEKDAYS[w]} territory`}>
                      <option value="">or whole territory…</option>
                      {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td><input name={`label_${w}`} defaultValue={d?.label ?? ""} className="input" placeholder={w === 5 ? "Follow-ups & appointments" : ""} /></td>
                  <td><input type="time" name={`startTime_${w}`} defaultValue={d?.startTime ?? ""} className="input" /></td>
                  <td><input type="time" name={`endTime_${w}`} defaultValue={d?.endTime ?? ""} className="input" /></td>
                  <td><input type="number" min={0} max={200} name={`visitTarget_${w}`} defaultValue={d?.visitTarget ?? ""} className="input w-24" /></td>
                  <td><input name={`notes_${w}`} defaultValue={d?.notes ?? ""} className="input" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3"><SubmitButton>Save recurring plan</SubmitButton></div>
      </ActionForm>
      <p className="text-xs text-muted">Leave a day blank for no default plan. Example: Monday Area A, Tuesday Area B … Friday “Follow-ups & appointments”.</p>
    </div>
  );
}
