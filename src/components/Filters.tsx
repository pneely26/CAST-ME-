import Link from "next/link";
import { REGIONS, REGION_LABELS } from "@/lib/constants";

export type Opt = { value: string; label: string };

export function Select({ name, label, value, options, any = "Any" }: { name: string; label: string; value?: string; options: Opt[]; any?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input">
        <option value="">{any}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export const regionOptions: Opt[] = REGIONS.map((r) => ({ value: r, label: REGION_LABELS[r] }));

export function FilterBar({ children, resetHref, action }: { children: React.ReactNode; resetHref: string; action?: string }) {
  return (
    <form action={action} method="get" className="card mb-5 grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {children}
      <div className="col-span-2 flex items-end gap-2 sm:col-span-3 lg:col-span-6">
        <button className="btn-primary">Apply filters</button>
        <Link href={resetHref} className="btn-ghost">Reset</Link>
      </div>
    </form>
  );
}

export function TextFilter({ name, label, value, placeholder, type = "text" }: { name: string; label: string; value?: string; placeholder?: string; type?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className="input" />
    </label>
  );
}
