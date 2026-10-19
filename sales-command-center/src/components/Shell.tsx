"use client";

import { ReadOnlyProvider } from "./ReadOnly";
import { ActivityTracker } from "./ActivityTracker";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";

export interface NavCounts {
  notifications: number;
  reschedules: number;
  followUpsDue: number;
}

type Item = { href: string; label: string; badge?: keyof NavCounts; icon: string };

const COORDINATOR_NAV: Item[] = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/leads", label: "Leads", icon: "☰" },
  { href: "/territories", label: "Areas & Territories", icon: "◎" },
  { href: "/schedule", label: "Schedule", icon: "▤" },
  { href: "/appointments", label: "Appointments", icon: "◷" },
  { href: "/reschedules", label: "Reschedules", icon: "⇄", badge: "reschedules" },
  { href: "/visits", label: "Visits & Feedback", icon: "✎" },
  { href: "/follow-ups", label: "Follow-ups", icon: "↻", badge: "followUpsDue" },
  { href: "/sales", label: "Sales", icon: "$" },
  { href: "/reports", label: "Reports", icon: "▥" },
  { href: "/activity", label: "Rep Activity", icon: "◴" },
  { href: "/import", label: "Import Leads", icon: "⇪" },
];

const REP_NAV: Item[] = [
  { href: "/today", label: "Today's Route", icon: "➤" },
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/leads", label: "My Leads", icon: "☰" },
  { href: "/schedule", label: "Schedule", icon: "▤" },
  { href: "/appointments", label: "Appointments", icon: "◷" },
  { href: "/reschedules", label: "Reschedule Requests", icon: "⇄" },
  { href: "/visits", label: "My Visits", icon: "✎" },
  { href: "/follow-ups", label: "Follow-ups", icon: "↻", badge: "followUpsDue" },
  { href: "/sales", label: "My Sales", icon: "$" },
  { href: "/reports", label: "My Reports", icon: "▥" },
];

const REP_TABS: Item[] = [
  { href: "/today", label: "Today", icon: "➤" },
  { href: "/leads", label: "Leads", icon: "☰" },
  { href: "/follow-ups", label: "Follow-ups", icon: "↻", badge: "followUpsDue" },
  { href: "/schedule", label: "Schedule", icon: "▤" },
  { href: "/notifications", label: "Alerts", icon: "●", badge: "notifications" },
];

export function Shell({ role, name, counts, children }: { role: "COORDINATOR" | "REP"; name: string; counts: NavCounts; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = role === "COORDINATOR" ? COORDINATOR_NAV : REP_NAV;
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

  const links = (
    <ul className="space-y-0.5 p-2">
      {nav.map((n) => (
        <li key={n.href}>
          <Link
            href={n.href}
            onClick={() => setOpen(false)}
            aria-current={active(n.href) ? "page" : undefined}
            className={clsx("flex items-center gap-2.5 rounded-md px-3 py-2 text-sm", active(n.href) ? "bg-white/10 font-medium text-white" : "text-gray-300 hover:bg-white/5 hover:text-white")}
          >
            <span aria-hidden className="w-4 text-center text-xs opacity-70">{n.icon}</span>
            <span className="flex-1">{n.label}</span>
            {n.badge && counts[n.badge] > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-gray-900">{counts[n.badge]}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );

  const footer = (
    <div className="border-t border-white/10 p-2 text-sm">
      <Link href="/notifications" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-md px-3 py-2 text-gray-300 hover:bg-white/5 hover:text-white">
        Notifications {counts.notifications > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-gray-900">{counts.notifications}</span>}
      </Link>
      {role === "COORDINATOR" && (
        <>
          <Link href="/settings" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-gray-300 hover:bg-white/5 hover:text-white">Settings & Users</Link>
          <Link href="/audit" onClick={() => setOpen(false)} className="block rounded-md px-3 py-2 text-gray-300 hover:bg-white/5 hover:text-white">Audit log</Link>
        </>
      )}
      <div className="mt-1 flex items-center justify-between px-3 py-2">
        <span className="truncate text-xs text-gray-400" title={name}>{name} · {role === "COORDINATOR" ? "Coordinator" : "Sales rep"}</span>
        <form action="/logout" method="post"><button className="text-xs text-gray-400 hover:text-white">Sign out</button></form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-gray-900 lg:flex">
        <Link href="/" className="border-b border-white/10 px-5 py-4 text-sm font-semibold text-white">Sales Command Center</Link>
        <nav className="flex-1 overflow-y-auto" aria-label="Main">{links}</nav>
        {footer}
      </aside>

      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-gray-900 px-4 py-3 text-white lg:hidden">
        <Link href={role === "REP" ? "/today" : "/"} className="text-sm font-semibold">Sales Command Center</Link>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-menu" className="rounded border border-white/20 px-2.5 py-1 text-sm">{open ? "Close" : "Menu"}</button>
      </div>
      {open && (
        <div id="mobile-menu" className="fixed inset-x-0 top-[52px] bottom-0 z-30 overflow-y-auto bg-gray-900 lg:hidden">
          <nav aria-label="Main">{links}</nav>
          {footer}
        </div>
      )}

      <div className="lg:pl-60">
        <main className={clsx("mx-auto max-w-7xl px-4 py-5 sm:px-6", role === "REP" && "pb-24 lg:pb-6")}>{role === "REP" && <ActivityTracker />}<ReadOnlyProvider readOnly={role === "REP"}>{children}</ReadOnlyProvider></main>
      </div>

      {/* rep bottom tabs on phones */}
      {role === "REP" && (
        <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
          {REP_TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined} className={clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", active(t.href) ? "font-semibold text-accent" : "text-muted")}>
              <span aria-hidden className="text-base leading-none">{t.icon}</span>
              {t.label}
              {t.badge && counts[t.badge] > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-amber-400 px-1 text-[10px] font-semibold text-gray-900">{counts[t.badge]}</span>}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
