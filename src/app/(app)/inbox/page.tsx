import Link from "next/link";
import { prisma } from "@/lib/server/db";
import { checkEmailAction, dismissEmailAction, switchEmailKindAction } from "@/app/actions/inbox";
import { agentAddresses, emailConfigured, emailFolder } from "@/lib/server/email";
import { Badge, Empty, Flash, PageHeader, Section } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { str, type SP } from "@/lib/server/filters";
import type { ParsedAgencySubmission, ParsedListing } from "@/lib/listing/parse";

export const metadata = { title: "Email Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const status = str(sp, "status") ?? "NEW";
  const emails = await prisma.emailMessage.findMany({
    where: ["NEW", "ACCEPTED", "DISMISSED"].includes(status) ? { status: status as "NEW" } : {},
    orderBy: { receivedAt: { sort: "desc", nulls: "last" } },
    take: 200,
  });
  const configured = emailConfigured();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Email Inbox"
        description="Casting notices and agent emails from one folder of your own mailbox, turned into drafts you review and save."
        actions={configured ? <form action={checkEmailAction}><button className="btn-primary">Check email now</button></form> : undefined}
      />
      <Flash message={str(sp, "msg")} />
      <Flash message={str(sp, "error")} tone="bad" />

      {!configured ? (
        <Section title="Connect your email (one-time setup)">
          <ol className="list-decimal space-y-2 p-4 pl-8 text-sm text-ink-soft">
            <li>In Gmail, create a label called <strong>Casting</strong>. Add a filter (or forward/move emails by hand) so casting notices, newsletters and emails from your agent get that label.</li>
            <li>Turn on 2-Step Verification for your Google account, then create an <strong>App password</strong> (Google Account → Security → App passwords). It only works for email and you can revoke it any time. Don't use your normal password.</li>
            <li>
              Add these lines to the app's <code>.env</code> file and restart the app:
              <pre className="mt-2 overflow-x-auto rounded-md bg-paper p-3 text-xs">{`IMAP_HOST="imap.gmail.com"
IMAP_PORT=993
IMAP_USER="you@gmail.com"
IMAP_PASSWORD="your 16-letter app password"
IMAP_FOLDER="Casting"
AGENT_EMAILS="youragency.com"`}</pre>
              <span className="text-xs">AGENT_EMAILS: your agents' addresses or agency domain, comma-separated — emails from them are treated as submissions. iCloud: <code>imap.mail.me.com</code>; Outlook: <code>outlook.office365.com</code>.</span>
            </li>
            <li>The app opens only that folder, read-only. It never deletes, moves, sends or marks emails as read. It checks automatically with <code>npm run monitor</code>.</li>
          </ol>
          <p className="border-t border-line px-4 py-3 text-sm text-ink-soft">No setup? You can still copy any email and use <Link href="/paste" className="link">Paste a listing</Link>.</p>
        </Section>
      ) : (
        <p className="text-xs text-muted">Reading folder <strong>{emailFolder()}</strong> (read-only){agentAddresses().length ? ` · agent addresses: ${agentAddresses().join(", ")}` : " · set AGENT_EMAILS so agent emails are recognised"}.</p>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {[["NEW", "To review"], ["ACCEPTED", "Saved"], ["DISMISSED", "Dismissed"], ["ALL", "All"]].map(([v, l]) => (
          <Link key={v} href={`/inbox?status=${v}`} className={status === v ? "btn-primary" : "btn-secondary"}>{l}</Link>
        ))}
      </div>

      <Section title={`${emails.length} email(s)`}>
        {emails.length === 0 ? <Empty>{configured ? "Nothing here. New emails in your casting folder will appear after a check." : "Connect your email to see casting emails here."}</Empty> : (
          <ul className="divide-y divide-line">
            {emails.map((e) => {
              const agency = e.kind === "AGENCY_SUBMISSION";
              const p = e.parsed as unknown as (ParsedListing & ParsedAgencySubmission) | null;
              const summary = agency
                ? [p?.project, p?.role, p?.castingDirector, p?.status].filter(Boolean).join(" · ")
                : [p?.project, p?.roles?.length ? `${p.roles.length} role(s)` : null, p?.castingDirector, p?.deadline ? `deadline ${p.deadline}` : null].filter(Boolean).join(" · ");
              return (
                <li key={e.id} id={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{e.subject ?? "(no subject)"}</div>
                      <div className="text-xs text-muted">{e.fromAddress} · {fmtDateTime(e.receivedAt)}</div>
                    </div>
                    <div className="flex gap-1.5">
                      <Badge tone={agency ? "signal" : "accent"}>{agency ? "Agency submission" : "Casting notice"}</Badge>
                      {e.status !== "NEW" && <Badge tone={e.status === "ACCEPTED" ? "good" : "neutral"}>{e.status === "ACCEPTED" ? "Saved" : "Dismissed"}</Badge>}
                    </div>
                  </div>
                  {summary && <p className="mt-1 text-sm text-ink-soft">Found: {summary}</p>}
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{e.bodyText.slice(0, 300)}</p>
                  {e.status === "NEW" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link href={`/paste?email=${e.id}`} className="btn-primary">Review &amp; save</Link>
                      <form action={switchEmailKindAction}><input type="hidden" name="id" value={e.id} /><button className="btn-secondary">Treat as {agency ? "casting notice" : "agency submission"}</button></form>
                      <form action={dismissEmailAction}><input type="hidden" name="id" value={e.id} /><button className="btn-ghost">Dismiss</button></form>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
