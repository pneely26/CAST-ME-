import { prisma } from "@/lib/server/db";
import { getPlatforms } from "@/lib/server/profile";
import { PasteForm } from "./PasteForm";
import { PageHeader } from "@/components/ui";
import type { ParsedAgencySubmission, ParsedListing } from "@/lib/listing/parse";
import { str, type SP } from "@/lib/server/filters";

export const metadata = { title: "Paste a listing" };

export default async function PastePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const emailId = str(sp, "email");
  const email = emailId && /^[a-z0-9]+$/i.test(emailId) ? await prisma.emailMessage.findUnique({ where: { id: emailId } }) : null;
  const platforms = await getPlatforms();
  const isAgency = email ? email.kind === "AGENCY_SUBMISSION" : str(sp, "mode") === "agency";
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Paste a listing"
        description="Copy a breakdown you're viewing (for example on Actors Access), a casting notice, or an email from your agent, and paste it here. The app fills in the fields for you to check."
      />
      <PasteForm
        key={email?.id ?? "new"}
        platforms={platforms}
        initialMode={isAgency ? "AGENCY" : "LISTING"}
        initialText={email?.bodyText ?? ""}
        subject={email?.subject ?? null}
        emailId={email?.id ?? null}
        initialListing={email && !isAgency ? (email.parsed as unknown as ParsedListing) : null}
        initialAgency={email && isAgency ? (email.parsed as unknown as ParsedAgencySubmission) : null}
        defaultSource={email ? `Email: ${email.fromAddress ?? "casting email"}`.slice(0, 200) : ""}
      />
    </div>
  );
}
