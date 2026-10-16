import type { NotificationType } from "@prisma/client";
import { prisma, type Tx } from "../db";
import type { Actor } from "../policy";

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Same key for the same user = one notification (prevents repeats from scheduled reminders). */
  dedupeKey: string;
}

/**
 * Delivery channels. In-app is always used. External channels (email, SMS, push) can be added by
 * implementing this interface and listing them in `externalChannels` — none are configured now,
 * so the app never claims to have sent anything outside the app.
 */
export interface NotificationChannel {
  id: string;
  enabled(): boolean;
  deliver(userId: string, n: NotificationInput): Promise<void>;
}

export const externalChannels: NotificationChannel[] = [];

export async function notify(tx: Tx, userId: string, n: NotificationInput) {
  const existing = await tx.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey: n.dedupeKey } } });
  if (existing) return existing;
  const channels = ["in_app"];
  for (const ch of externalChannels) {
    if (!ch.enabled()) continue;
    try {
      await ch.deliver(userId, n);
      channels.push(ch.id);
    } catch (e) {
      console.error(`[notify] channel ${ch.id} failed`, e);
    }
  }
  return tx.notification.create({ data: { userId, type: n.type, title: n.title.slice(0, 300), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey.slice(0, 300), channels } });
}

/** Notify every active coordinator. */
export async function notifyCoordinators(tx: Tx, n: NotificationInput, exceptUserId?: string) {
  const coords = await tx.user.findMany({ where: { role: "COORDINATOR", active: true, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true } });
  for (const c of coords) await notify(tx, c.id, n);
}

export async function markRead(actor: Actor, ids: string[] | "all", read = true) {
  const where = { userId: actor.id, ...(ids === "all" ? {} : { id: { in: ids } }) };
  return prisma.notification.updateMany({ where, data: { readAt: read ? new Date() : null } });
}
