import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

export const cn = clsx;

const TONES: Record<Tone, string> = {
  neutral: "bg-gray-100 text-gray-700 ring-gray-200",
  accent: "bg-accent-2 text-accent ring-accent/20",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  muted: "bg-white text-muted ring-line",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-gray-400",
  accent: "bg-accent",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  info: "bg-sky-500",
  muted: "bg-gray-300",
};

/** Status badge: always shows text (never color alone). */
export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} />
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="mb-1 inline-block text-xs text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Section({ title, subtitle, action, children, className, id }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("card", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted">
      <div>{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, href, hint, tone }: { label: string; value: ReactNode; href?: string; hint?: ReactNode; tone?: "warn" | "bad" | "good" | "accent" }) {
  const inner = (
    <div className={cn("card h-full px-4 py-3 transition-colors", href && "hover:border-gray-300 hover:shadow-sm")}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && "text-amber-700", tone === "bad" && "text-red-700", tone === "good" && "text-emerald-700", tone === "accent" && "text-accent")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function KV({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export function Flash({ message, tone = "good" }: { message?: string | null; tone?: "good" | "bad" }) {
  if (!message) return null;
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("mb-4 rounded-md border px-3 py-2 text-sm", tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800")}>
      {message}
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string }[]; active: string }) {
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", t.key === active ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function DemoBadge({ show }: { show?: boolean }) {
  return show ? <Badge tone="warn" title="Optional demonstration data — not a real record">Demo</Badge> : null;
}
