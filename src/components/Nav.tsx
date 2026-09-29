"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/web-monitor", label: "Web Monitor" },
  { href: "/blind-spots", label: "Blind Spots" },
  { href: "/casting-directors", label: "Casting Directors" },
  { href: "/projects", label: "Projects" },
  { href: "/submissions", label: "Agency Submissions" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/reports", label: "Reports" },
  { href: "/imports", label: "Imports" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ unreadAlerts, openBlindSpots, newFindings = 0 }: { unreadAlerts: number; openBlindSpots: number; newFindings?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  const links = (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={() => setOpen(false)}
          className={clsx(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
            isActive(n.href) ? "bg-white/10 font-medium text-white" : "text-stone-300 hover:bg-white/5 hover:text-white",
          )}
        >
          {n.label}
          {n.href === "/web-monitor" && newFindings > 0 && (
            <span className="rounded bg-sky-400/90 px-1.5 text-[11px] font-semibold text-stone-900">{newFindings}</span>
          )}
          {n.href === "/blind-spots" && openBlindSpots > 0 && (
            <span className="rounded bg-amber-500/90 px-1.5 text-[11px] font-semibold text-stone-900">{openBlindSpots}</span>
          )}
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-black/20 bg-ink px-4 py-3 text-white lg:hidden">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          STEWART <span className="text-amber-400">BLIND SPOT</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/alerts" className="relative text-sm text-stone-300" aria-label="Alerts">
            Alerts{unreadAlerts > 0 && <span className="ml-1 rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-stone-900">{unreadAlerts}</span>}
          </Link>
          <button onClick={() => setOpen((o) => !o)} className="rounded border border-white/20 px-2 py-1 text-sm" aria-expanded={open} aria-label="Menu">
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && (
        <div className="fixed inset-x-0 top-[53px] z-20 max-h-[80vh] overflow-y-auto bg-ink shadow-xl lg:hidden">
          {links}
          <div className="flex flex-wrap gap-1 border-t border-white/10 p-2 text-sm">
            <Link href="/search" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-stone-300">Search</Link>
            <Link href="/audit" onClick={() => setOpen(false)} className="rounded-md px-3 py-2 text-stone-300">Audit log</Link>
            <form action="/logout" method="post">
              <button className="rounded-md px-3 py-2 text-stone-400">Sign out</button>
            </form>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-ink text-white lg:flex">
        <Link href="/" className="block border-b border-white/10 px-5 py-5">
          <div className="text-[13px] font-semibold tracking-[0.18em]">STEWART</div>
          <div className="text-[13px] font-semibold tracking-[0.18em] text-amber-400">BLIND SPOT</div>
          <div className="mt-1 text-[11px] text-stone-400">Casting research tracker</div>
        </Link>
        <div className="flex-1 overflow-y-auto">{links}</div>
        <div className="border-t border-white/10 p-3 text-sm">
          <Link href="/search" className="block rounded-md px-3 py-2 text-stone-300 hover:bg-white/5 hover:text-white">
            Search
          </Link>
          <Link href="/alerts" className="flex items-center justify-between rounded-md px-3 py-2 text-stone-300 hover:bg-white/5 hover:text-white">
            Alerts
            {unreadAlerts > 0 && <span className="rounded bg-amber-500 px-1.5 text-[11px] font-semibold text-stone-900">{unreadAlerts}</span>}
          </Link>
          <Link href="/audit" className="block rounded-md px-3 py-2 text-stone-300 hover:bg-white/5 hover:text-white">
            Audit log
          </Link>
          <form action="/logout" method="post">
            <button className="w-full rounded-md px-3 py-2 text-left text-stone-400 hover:bg-white/5 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}
