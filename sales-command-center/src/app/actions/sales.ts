"use server";

import { revalidatePath } from "next/cache";
import type { OpportunityStatus, PaymentStatus } from "@prisma/client";
import { actorOrThrow } from "@/server/auth";
import { toResult, type ActionResult } from "@/server/errors";
import { archiveOpportunity, saveOpportunity } from "@/server/services/opportunities";
import { getSettings } from "@/server/settings";
import { bool, id, int, str, strOrNull, zonedDate } from "@/server/form";

export async function saveOpportunityAction(_: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await actorOrThrow();
    const tz = (await getSettings()).timezone;
    const oppId = strOrNull(fd, "id", 40);
    const opp = await saveOpportunity(
      actor,
      oppId,
      {
        leadId: id(fd, "leadId"),
        repId: strOrNull(fd, "repId", 40),
        product: str(fd, "product", 200) ?? "",
        status: (str(fd, "status") || "PROSPECTING") as OpportunityStatus,
        openedAt: zonedDate(fd, "openedAt", null, tz, "12:00") ?? undefined,
        expectedCloseAt: zonedDate(fd, "expectedCloseAt", null, tz, "12:00"),
        closedAt: zonedDate(fd, "closedAt", null, tz, "12:00"),
        estimatedValue: strOrNull(fd, "estimatedValue", 20),
        finalAmount: strOrNull(fd, "finalAmount", 20),
        commissionRatePct: strOrNull(fd, "commissionRatePct", 10),
        commissionAmount: strOrNull(fd, "commissionAmount", 20),
        paymentStatus: (str(fd, "paymentStatus") || "NOT_APPLICABLE") as PaymentStatus,
        notes: strOrNull(fd, "notes", 10000),
        lostReason: strOrNull(fd, "lostReason", 1000),
        signed44: bool(fd, "signed44"),
        runDate: strOrNull(fd, "runDate", 10),
        goStatus: strOrNull(fd, "goStatus", 300),
        calledToDesk: bool(fd, "calledToDesk"),
        tentativeRunDate: strOrNull(fd, "tentativeRunDate", 10),
        sourceVisitId: strOrNull(fd, "sourceVisitId", 40),
        confirmed: bool(fd, "confirmed"),
      },
      int(fd, "version"),
    );
    revalidatePath("/", "layout");
    return { ok: true, data: { id: opp.id }, message: "Saved", redirect: `/sales/${opp.id}?msg=${encodeURIComponent(opp.status === "WON" ? "Sale recorded" : "Opportunity saved")}` };
  } catch (e) {
    return toResult(e);
  }
}

export async function archiveOpportunityAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    const actor = await actorOrThrow();
    const oppId = id(fd);
    const archive = str(fd, "archive") !== "false";
    await archiveOpportunity(actor, oppId, archive);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined, message: archive ? "Archived" : "Restored", redirect: archive ? "/sales?msg=Opportunity+archived" : `/sales/${oppId}` };
  } catch (e) {
    return toResult(e);
  }
}
