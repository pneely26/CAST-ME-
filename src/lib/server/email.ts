/**
 * Email inbox: reads casting emails from ONE folder/label of the user's own mailbox
 * over IMAP, read-only. Nothing is deleted, moved or marked as read in the mailbox.
 * Each email is parsed into a draft that the user reviews before anything is saved.
 *
 * Config (env): IMAP_HOST, IMAP_PORT (993), IMAP_USER, IMAP_PASSWORD (an app password),
 * IMAP_FOLDER (e.g. "Casting"), AGENT_EMAILS (comma-separated addresses or domains).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { emitAlert } from "../alerts/engine";
import { looksLikeAgencyEmail, parseAgencyText, parseListingText } from "../listing/parse";

export interface RawEmail {
  messageId: string;
  from: string | null;
  subject: string | null;
  date: Date | null;
  text: string;
}

export interface MailSource {
  fetchRecent(sinceDays: number): Promise<RawEmail[]>;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD);
}

export function emailFolder(): string {
  return process.env.IMAP_FOLDER || "Casting";
}

export function agentAddresses(): string[] {
  return (process.env.AGENT_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** IMAP mailbox opened read-only. */
export function imapSource(): MailSource {
  return {
    async fetchRecent(sinceDays) {
      const { ImapFlow } = await import("imapflow");
      const { simpleParser } = await import("mailparser");
      const client = new ImapFlow({
        host: process.env.IMAP_HOST!,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
        logger: false,
      });
      await client.connect();
      const out: RawEmail[] = [];
      try {
        await client.mailboxOpen(emailFolder(), { readOnly: true });
        const since = new Date(Date.now() - sinceDays * 86_400_000);
        const uids = (await client.search({ since }, { uid: true })) || [];
        const recent = uids.slice(-100); // newest 100
        if (recent.length) {
          for await (const msg of client.fetch(recent, { source: true, envelope: true }, { uid: true })) {
            if (!msg.source) continue;
            const mail = await simpleParser(msg.source);
            const text = (mail.text || (typeof mail.html === "string" ? mail.html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n").replace(/<[^>]+>/g, " ") : "") || "").trim();
            out.push({
              messageId: mail.messageId || `${emailFolder()}:${msg.uid}`,
              from: mail.from?.text ?? null,
              subject: mail.subject ?? null,
              date: mail.date ?? null,
              text,
            });
          }
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
      return out;
    },
  };
}

/** Parse new emails into review drafts. Already-seen messages are skipped. */
export async function processEmails(messages: RawEmail[], folder = emailFolder()) {
  const agents = agentAddresses();
  let created = 0;
  for (const m of messages) {
    if (!m.text || m.text.length < 20) continue;
    if (await prisma.emailMessage.findUnique({ where: { messageId: m.messageId } })) continue;
    const agency = looksLikeAgencyEmail(m.from, m.subject, agents);
    const parsed = agency
      ? parseAgencyText(m.text, { subject: m.subject, receivedAt: m.date })
      : parseListingText(m.text, { subject: m.subject });
    const e = await prisma.emailMessage.create({
      data: {
        messageId: m.messageId.slice(0, 500),
        folder,
        fromAddress: m.from?.slice(0, 300) ?? null,
        subject: m.subject?.slice(0, 500) ?? null,
        receivedAt: m.date,
        bodyText: m.text.slice(0, 50_000),
        kind: agency ? "AGENCY_SUBMISSION" : "CASTING_NOTICE",
        parsed: parsed as unknown as Prisma.InputJsonValue,
      },
    });
    created++;
    await emitAlert({
      type: "NEW_MATCH",
      title: `${agency ? "Agency email" : "Casting email"}: ${(m.subject ?? "(no subject)").slice(0, 120)}`,
      body: "New email in your casting folder — review it to save as " + (agency ? "an agency submission." : "an opportunity."),
      link: `/inbox#${e.id}`,
      dedupeKey: `EMAIL:${e.id}`,
    });
  }
  if (created) await audit("IMPORT", "EmailMessage", null, `Read ${created} new email(s) from “${folder}”`);
  return created;
}

export async function checkEmail(source?: MailSource, sinceDays = 21) {
  if (!source) {
    if (!emailConfigured()) return { ok: false as const, message: "Email is not configured.", created: 0 };
    source = imapSource();
  }
  try {
    const msgs = await source.fetchRecent(sinceDays);
    const created = await processEmails(msgs);
    return { ok: true as const, message: `${msgs.length} email(s) in “${emailFolder()}”, ${created} new.`, created };
  } catch (e) {
    const err = e as Error & { authenticationFailed?: boolean; mailboxMissing?: boolean; responseText?: string };
    const message = err.authenticationFailed
      ? "Email login failed. Check IMAP_USER and that IMAP_PASSWORD is an app password."
      : /mailbox|folder|nonexistent|doesn't exist/i.test(err.responseText ?? err.message)
        ? `Folder “${emailFolder()}” wasn't found. Create that label/folder or set IMAP_FOLDER.`
        : `Couldn't read email: ${err.message}`;
    return { ok: false as const, message, created: 0 };
  }
}
