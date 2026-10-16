import { prisma, type Tx } from "./db";
import { DEFAULT_TZ, isValidTimeZone } from "@/lib/time";

export interface AppSettings {
  timezone: string;
  staleVisitDays: number; // "not visited in N days"
  defaultAppointmentMinutes: number;
  duplicateAppointmentWindowMinutes: number; // same lead within this window = duplicate
  reminderMinutesBefore: number; // upcoming appointment reminders
  weekStartsOn: number; // 1 = Monday
  businessName: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timezone: process.env.APP_TIMEZONE && isValidTimeZone(process.env.APP_TIMEZONE) ? process.env.APP_TIMEZONE : DEFAULT_TZ,
  staleVisitDays: 30,
  defaultAppointmentMinutes: 45,
  duplicateAppointmentWindowMinutes: 180,
  reminderMinutesBefore: 120,
  weekStartsOn: 1,
  businessName: "Sales Command Center",
};

export async function getSettings(tx: Tx = prisma): Promise<AppSettings> {
  const rows = await tx.appSetting.findMany();
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in s) (s as unknown as Record<string, unknown>)[r.key] = r.value;
  }
  if (!isValidTimeZone(s.timezone)) s.timezone = DEFAULT_TZ;
  return s;
}
