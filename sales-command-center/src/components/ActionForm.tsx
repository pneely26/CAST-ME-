"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useReadOnly } from "./ReadOnly";

type Result = { ok: true; message?: string; redirect?: string; data?: unknown } | { ok: false; error: string; code?: string; details?: Record<string, unknown> };
type Action = (prev: Result | null, fd: FormData) => Promise<Result>;

/**
 * Form wrapper for server actions: shows pending state, success/error feedback,
 * optional confirmation for destructive or financially significant actions,
 * and follows a redirect returned by the action.
 */
export function ActionForm({
  action,
  children,
  confirm,
  className,
  resetOnSuccess,
  showSuccess = true,
  id,
  allowReadOnly,
}: {
  action: Action;
  children: ReactNode;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  showSuccess?: boolean;
  id?: string;
  /** show this form to view-only users too (e.g. marking notifications read, changing their own password) */
  allowReadOnly?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<Result | null, FormData>(action, null);

  useEffect(() => {
    if (!state?.ok) return;
    if (state.redirect) router.push(state.redirect);
    else router.refresh();
    if (resetOnSuccess) formRef.current?.reset();
  }, [state, router, resetOnSuccess]);

  const readOnly = useReadOnly();
  if (readOnly && !allowReadOnly) return null;

  return (
    <form
      id={id}
      ref={formRef}
      action={formAction}
      className={clsx(className, pending && "pointer-events-none opacity-70")}
      aria-busy={pending}
      onSubmit={(e) => {
        const needs = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("data-confirm") ?? confirm;
        if (needs && !window.confirm(needs)) {
          e.preventDefault();
          return;
        }
        // carry the clicked button's name/value (e.g. decision=merge) into the submitted FormData
        const btn = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const form = e.currentTarget;
        form.querySelectorAll("input[data-submitter]").forEach((el) => el.remove());
        if (btn?.name) {
          const hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = btn.name;
          hidden.value = btn.value;
          hidden.dataset.submitter = "1";
          form.appendChild(hidden);
        }
      }}
    >
      {children}
      {state && !state.ok && (
        <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      {state?.ok && showSuccess && state.message && !state.redirect && (
        <p role="status" className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, className = "btn-primary", confirm, name, value, disabled }: { children: ReactNode; className?: string; confirm?: string; name?: string; value?: string; disabled?: boolean }) {
  return (
    <button type="submit" className={className} data-confirm={confirm} name={name} value={value} disabled={disabled}>
      {children}
    </button>
  );
}
