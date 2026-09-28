import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { deadlineLabel, deadlineState, sourceState, SOURCE_STATE_LABEL, type SourceStateInput } from "@/lib/deadlines";
import { humanize } from "@/lib/constants";

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

type Tone = "neutral" | "accent" | "signal" | "good" | "bad" | "warn" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  accent: "bg-accent-soft text-accent ring-accent/20",
  signal: "bg-signal-soft text-signal ring-signal/25",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  bad: "bg-red-50 text-red-700 ring-red-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  muted: "bg-white text-muted ring-line",
};

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DemoBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Badge tone="warn" title="Fictional sample data — not real casting information">
      Demo data
    </Badge>
  );
}

export function RelevanceBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <Badge tone="muted">Not assessed</Badge>;
  const tone: Tone = tier === "HIGH" ? "good" : tier === "POSSIBLE" ? "accent" : "muted";
  return <Badge tone={tone}>{tier === "HIGH" ? "High relevance" : tier === "POSSIBLE" ? "Possible relevance" : "Low relevance"}</Badge>;
}

export function ClassificationBadge({ value }: { value: string }) {
  const map: Record<string, [Tone, string]> = {
    PUBLIC_MATCH: ["good", "Public match"],
    AGENCY_REPORTED_NOT_FOUND: ["signal", "Potential blind spot"],
    NEEDS_REVIEW: ["warn", "Needs review"],
    POSSIBLE_DUPLICATE: ["neutral", "Possible duplicate"],
  };
  const [tone, label] = map[value] ?? ["neutral", humanize(value)];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ReviewBadge({ value }: { value: string }) {
  const map: Record<string, Tone> = { UNREVIEWED: "muted", CONFIRMED_PUBLIC: "good", CONFIRMED_NOT_FOUND: "signal", DISMISSED: "neutral" };
  return <Badge tone={map[value] ?? "neutral"}>{humanize(value)}</Badge>;
}

export function SourceStateBadge(props: SourceStateInput & { now?: Date }) {
  const staleDays = Number(process.env.STALE_AFTER_DAYS ?? 14);
  const s = sourceState(props, props.now, staleDays);
  const tone: Tone = s === "CURRENT" ? "good" : s === "CASTING_CLOSED" ? "bad" : s === "STALE" ? "warn" : "muted";
  const title =
    s === "CURRENT"
      ? `Verified within the last ${staleDays} days`
      : s === "STALE"
        ? `Last verified more than ${staleDays} days ago — re-check the source`
        : s === "UNVERIFIED"
          ? "Source has not been verified"
          : "Casting closed or deadline passed";
  return (
    <Badge tone={tone} title={title}>
      {SOURCE_STATE_LABEL[s]}
    </Badge>
  );
}

export function DeadlineBadge({ deadline, now }: { deadline: Date | null | undefined; now?: Date }) {
  const state = deadlineState(deadline, now);
  const tone: Tone = state === "PASSED" ? "bad" : state === "TODAY" || state === "SOON" ? "signal" : state === "NONE" ? "muted" : "neutral";
  return <Badge tone={tone}>{deadlineLabel(deadline, now)}</Badge>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, subtitle, action, children, className }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: "signal" | "accent" }) {
  const inner = (
    <div className="card h-full px-4 py-3 transition-colors hover:border-stone-300">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "signal" && "text-signal", tone === "accent" && "text-accent")}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export function SourceLink({ url, name }: { url?: string | null; name?: string | null }) {
  if (!url) return <span className="text-muted">{name ?? "—"}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="link">
      {name ?? "Source"} ↗
    </a>
  );
}

export function Flash({ message, tone = "good" }: { message?: string | null; tone?: "good" | "bad" }) {
  if (!message) return null;
  return (
    <div className={cn("mb-4 rounded-md border px-3 py-2 text-sm", tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800")}>
      {message}
    </div>
  );
}
