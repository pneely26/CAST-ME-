"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/db";
import { audit } from "@/lib/server/audit";
import { acceptFinding, checkSource } from "@/lib/server/webmonitor";
import { fid, flist, fplatform, fregion, fstr } from "@/lib/server/forms";
import { BLOCKED_REASON, isBlockedHost, MIN_INTERVAL_MINUTES } from "@/lib/web/policy";

const back = (q: string) => redirect(`/web-monitor?${q}`);

export async function addWebSourceAction(fd: FormData) {
  await requireUser();
  const name = fstr(fd, "name", 120);
  const rawUrl = fstr(fd, "url", 1000);
  const kind = fstr(fd, "kind", 10) === "RSS" ? "RSS" : "HTML";
  if (!name || !rawUrl) back("error=Name+and+URL+are+required#add");
  let url: URL;
  try {
    url = new URL(rawUrl!.startsWith("http") ? rawUrl! : `https://${rawUrl}`);
  } catch {
    return back("error=That+URL+is+not+valid#add");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") back("error=Only+http(s)+URLs+are+allowed#add");
  if (url.username || url.password) back("error=Don%E2%80%99t+put+usernames+or+passwords+in+the+URL#add");
  if (isBlockedHost(url.hostname)) back(`error=${encodeURIComponent(BLOCKED_REASON)}#add`);
  if (fd.get("termsConfirmed") !== "yes") back("error=Confirm+the+site+is+public+and+allows+automated+checking#add");
  const hours = Number(fstr(fd, "intervalHours", 4) ?? 6);
  const minIntervalMinutes = Math.max(MIN_INTERVAL_MINUTES, Math.round((Number.isFinite(hours) ? hours : 6) * 60));
  const existing = await prisma.webSource.findUnique({ where: { url: url.toString() } });
  if (existing) back("error=That+URL+is+already+a+source#sources");
  const s = await prisma.webSource.create({
    data: {
      name: name!,
      url: url.toString(),
      kind,
      region: fregion(fd),
      platform: fplatform(fd),
      keywords: flist(fd, "keywords"),
      excludeKeywords: flist(fd, "excludeKeywords"),
      itemSelector: fstr(fd, "itemSelector", 200),
      termsConfirmed: true,
      termsNote: fstr(fd, "termsNote", 1000),
      enabled: true,
      minIntervalMinutes,
    },
  });
  await audit("CREATE", "WebSource", s.id, `Added web monitor source: ${s.name} (${url.hostname})`, { url: s.url, termsNote: s.termsNote });
  revalidatePath("/web-monitor");
  back("msg=Source+added.+Use+%E2%80%9CCheck+now%E2%80%9D+to+run+it+immediately.#sources");
}

export async function toggleWebSourceAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  const s = await prisma.webSource.findUniqueOrThrow({ where: { id } });
  if (!s.enabled && isBlockedHost(new URL(s.url).hostname)) back(`error=${encodeURIComponent(BLOCKED_REASON)}#sources`);
  await prisma.webSource.update({ where: { id }, data: { enabled: !s.enabled } });
  await audit("EDIT", "WebSource", id, `${s.enabled ? "Paused" : "Resumed"} web source: ${s.name}`);
  revalidatePath("/web-monitor");
  back("msg=Saved#sources");
}

export async function deleteWebSourceAction(fd: FormData) {
  await requireUser();
  const id = fid(fd);
  if (fd.get("confirm") !== "yes") back("error=Tick+the+box+to+delete+a+source#sources");
  const s = await prisma.webSource.delete({ where: { id } });
  await audit("DELETE", "WebSource", id, `Deleted web source: ${s.name}`);
  revalidatePath("/web-monitor");
  back("msg=Source+deleted#sources");
}

export async function checkWebSourceAction(fd: FormData) {
  await requireUser();
  const r = await checkSource(fid(fd), { manual: true });
  revalidatePath("/", "layout");
  const msg = r.skipped ?? (r.ok ? `Checked: ${r.newFindings} new listing(s) found.` : `Check failed: ${r.message}`);
  back(`${r.ok ? "msg" : "error"}=${encodeURIComponent(msg)}#sources`);
}

export async function acceptFindingAction(fd: FormData) {
  await requireUser();
  const id = await acceptFinding(fid(fd), { project: fstr(fd, "project", 300) ?? undefined, roleName: fstr(fd, "roleName", 200) ?? undefined });
  revalidatePath("/", "layout");
  redirect(`/opportunities/${id}?msg=Added+from+the+web+monitor+as+UNVERIFIED.+Check+the+details+against+the+source+and+edit+as+needed.`);
}

export async function dismissFindingAction(fd: FormData) {
  await requireUser();
  await prisma.webFinding.update({ where: { id: fid(fd) }, data: { status: "DISMISSED" } });
  revalidatePath("/web-monitor");
}
