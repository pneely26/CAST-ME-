import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { assertCan, type Actor } from "../policy";
import { getSettings, type AppSettings } from "../settings";
import { isValidTimeZone } from "@/lib/time";

const intIn = (min: number, max: number, label: string) => z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`);

export const settingsSchema = z.object({
  businessName: z.string().trim().min(1, "Name is required").max(80),
  timezone: z.string().trim().refine(isValidTimeZone, "Unknown time zone — use a name like America/Chicago"),
  staleVisitDays: intIn(1, 365, "Not-visited days"),
  defaultAppointmentMinutes: intIn(5, 480, "Default appointment length"),
  duplicateAppointmentWindowMinutes: intIn(0, 1440, "Duplicate window"),
  reminderMinutesBefore: intIn(0, 1440, "Reminder lead time"),
  weekStartsOn: z.coerce.number().int().refine((n) => n === 0 || n === 1, "Week starts on Sunday or Monday"),
});

export async function saveSettings(actor: Actor, raw: Record<string, unknown>) {
  assertCan(actor, "settings.manage", "Only the coordinator can change settings.");
  const d = settingsSchema.parse(raw);
  const before = await getSettings();
  const changed = (Object.keys(d) as (keyof AppSettings)[]).filter((k) => before[k] !== d[k]);
  if (!changed.length) return before;
  await prisma.$transaction(async (tx) => {
    for (const k of changed) await tx.appSetting.upsert({ where: { key: k }, update: { value: d[k] as Prisma.InputJsonValue }, create: { key: k, value: d[k] as Prisma.InputJsonValue } });
    await audit(tx, actor, "settings.updated", { type: "Settings" }, `Settings changed: ${changed.map((k) => `${k} ${before[k]} → ${d[k]}`).join("; ")}`);
  });
  return getSettings();
}
