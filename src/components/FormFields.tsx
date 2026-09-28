import { REGIONS, REGION_LABELS, PRODUCTION_TYPES } from "@/lib/constants";

export function Field({ label, name, defaultValue, type = "text", required, placeholder, hint, className }: {
  label: string; name: string; defaultValue?: string | null; type?: string; required?: boolean; placeholder?: string; hint?: string; className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}{required && <span className="text-red-600"> *</span>}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} placeholder={placeholder} className="input" />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3, hint, className }: { label: string; name: string; defaultValue?: string | null; rows?: number; hint?: string; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} className="input" />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function RegionSelect({ name = "region", label = "Region", defaultValue }: { name?: string; label?: string; defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className="input">
        <option value="">Not stated</option>
        {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
      </select>
    </label>
  );
}

export function PlatformSelect({ platforms, defaultValue, name = "platform" }: { platforms: string[]; defaultValue?: string | null; name?: string }) {
  const known = !defaultValue || platforms.includes(defaultValue);
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        <span className="label">Platform</span>
        <select name={name} defaultValue={known ? (defaultValue ?? "") : "Other"} className="input">
          <option value="">Not stated</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">…or custom</span>
        <input name={`${name}Custom`} defaultValue={known ? "" : (defaultValue ?? "")} placeholder="e.g. Tubi" className="input" />
      </label>
    </div>
  );
}

export function ProductionTypeSelect({ defaultValue, name = "productionType" }: { defaultValue?: string | null; name?: string }) {
  return (
    <label className="block">
      <span className="label">Production type</span>
      <input name={name} list="production-types" defaultValue={defaultValue ?? ""} className="input" placeholder="TV Series, Feature Film…" />
      <datalist id="production-types">{PRODUCTION_TYPES.map((p) => <option key={p} value={p} />)}</datalist>
    </label>
  );
}

export function VisibilitySelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="block">
      <span className="label">Visibility</span>
      <select name="visibility" defaultValue={defaultValue ?? "PUBLIC"} className="input">
        <option value="PUBLIC">Public</option>
        <option value="UNKNOWN">Unknown</option>
        <option value="CLOSED">Closed</option>
      </select>
    </label>
  );
}

export function FormSection({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-semibold text-ink-soft">{title}</legend>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
