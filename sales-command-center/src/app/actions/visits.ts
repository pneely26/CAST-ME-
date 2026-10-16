"use server";

import { revalidatePath } from "next/cache";
import type { InterestLevel, LeadStatus, VisitOutcome, VisitType } from "@prisma/client";
import { actorOrThrow } from "@/server/auth";
import { toResult, invalid, type ActionResult } from "@/server/errors";
import { recordVisit } from "@/server/services/visits";
import { saveUpload } from "@/server/storage";
import { getSettings } from "@/server/settings";
import { bool, id, str, strOrNull, zonedDate } from "@/server/form";

export async function recordVisitAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const tz = (await getSettings()).timezone;
    const leadId = id(fd, "leadId");
    const visitAt = zonedDate(fd, "visitDate", "visitTime", tz) ?? new Date();
    const wantsFollowUp = bool(fd, "wantFollowUp");
    const wantsAppt = bool(fd, "wantAppointment");
    const apptStart = wantsAppt ? zonedDate(fd, "apptDate", "apptTime", tz, "10:00") : null;
    if (wantsAppt && !apptStart) throw invalid("Choose a date for the next appointment.");
    const minutes = Number(str(fd, "apptMinutes", 4) ?? 45);
    const file = fd.get("attachment");
    const attachment = file instanceof File && file.size > 0 ? await saveUpload(file, `visits/${leadId}`) : null;
    const visit = await recordVisit(
      actor,
      {
        leadId,
        repId: strOrNull(fd, "repId", 40),
        visitAt,
        type: (str(fd, "type") || "WALK_IN") as VisitType,
        outcome: str(fd, "outcome") as VisitOutcome,
        contactEncountered: strOrNull(fd, "contactEncountered", 150),
        feedback: strOrNull(fd, "feedback", 10000),
        objections: strOrNull(fd, "objections", 5000),
        interestLevel: (strOrNull(fd, "interestLevel", 10) as InterestLevel | null) ?? null,
        followUpAction: wantsFollowUp ? strOrNull(fd, "followUpAction", 500) : null,
        followUpDueAt: wantsFollowUp ? zonedDate(fd, "followUpDate", "followUpTime", tz) : null,
        nextAppointmentStart: apptStart,
        nextAppointmentEnd: apptStart ? new Date(apptStart.getTime() + (Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 480) : 45) * 60_000) : null,
        appointmentId: strOrNull(fd, "appointmentId", 40),
        notes: strOrNull(fd, "notes", 10000),
        newStatus: (strOrNull(fd, "newStatus", 40) as LeadStatus | null) ?? null,
        clientKey: strOrNull(fd, "clientKey", 80),
        allowOverlap: bool(fd, "allowOverlap"),
      },
      attachment,
    );
    revalidatePath("/", "layout");
    const back = str(fd, "returnTo", 200);
    const safeBack = back && back.startsWith("/") && !back.startsWith("//") ? back : `/leads/${leadId}?tab=visits`;
    const sale = str(fd, "outcome") === "SALE_COMPLETED";
    return {
      ok: true,
      data: { id: visit.id },
      message: "Visit saved",
      redirect: sale ? `/sales/new?lead=${leadId}&visit=${visit.id}&msg=${encodeURIComponent("Visit saved — now record the sale")}` : `${safeBack}${safeBack.includes("?") ? "&" : "?"}msg=${encodeURIComponent("Visit saved")}`,
    };
  } catch (e) {
    return toResult(e);
  }
}
