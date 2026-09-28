import { Nav } from "@/components/Nav";
import { prisma } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const [unreadAlerts, openBlindSpots] = await Promise.all([
    prisma.alert.count({ where: { readAt: null } }),
    prisma.blindSpot.count({ where: { reviewStatus: "UNREVIEWED", classification: { in: ["AGENCY_REPORTED_NOT_FOUND", "NEEDS_REVIEW"] } } }),
  ]);
  return (
    <div className="min-h-screen">
      <Nav unreadAlerts={unreadAlerts} openBlindSpots={openBlindSpots} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-10 hidden border-b border-line bg-paper/90 backdrop-blur lg:block">
          <form action="/search" className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-3">
            <input name="q" placeholder="Search projects, casting directors, offices, roles, platforms…" className="input max-w-xl bg-white" aria-label="Global search" />
            <button className="btn-secondary">Search</button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted sm:px-6">
          Uses only public, user-provided, or manually entered information. Never connects to Actors Access or Breakdown Express accounts.
        </footer>
      </div>
    </div>
  );
}
