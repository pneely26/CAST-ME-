import type { ReactNode } from "react";
import clsx from "clsx";

export function Field({ label, name, defaultValue, type = "text", required, placeholder, hint, className, inputMode, autoComplete, min, max, step }: {
  label: string; name: string; defaultValue?: string | number | null; type?: string; required?: boolean; placeholder?: string; hint?: ReactNode; className?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal"; autoComplete?: string; min?: string | number; max?: string | number; step?: string | number;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} required={required} placeholder={placeholder} className="input" inputMode={inputMode} autoComplete={autoComplete} min={min} max={max} step={step} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3, hint, className, placeholder, required }: { label: string; name: string; defaultValue?: string | null; rows?: number; hint?: ReactNode; className?: string; placeholder?: string; required?: boolean }) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} rows={rows} className="input" placeholder={placeholder} required={required} />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ label, name, defaultValue, options, empty, required, className, hint }: {
  label: string; name: string; defaultValue?: string | null; options: { value: string; label: string }[]; empty?: string; required?: boolean; className?: string; hint?: ReactNode;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="label">{label}{required && <span className="text-red-600" aria-hidden> *</span>}</span>
      <select name={name} defaultValue={defaultValue ?? ""} required={required} className="input">
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, name, defaultChecked, value = "on" }: { label: ReactNode; name: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-line" />
      {label}
    </label>
  );
}

export function Fieldset({ title, children, note, cols = 2 }: { title: string; children: ReactNode; note?: string; cols?: 2 | 3 }) {
  return (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <div className={clsx("grid gap-3", cols === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2")}>{children}</div>
    </fieldset>
  );
}
