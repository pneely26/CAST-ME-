import { LoginForm } from "./LoginForm";
import { authConfigured } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="text-sm font-semibold tracking-[0.2em]">STEWART <span className="text-amber-400">BLIND SPOT</span></div>
          <p className="mt-1 text-xs text-stone-400">Private casting research tracker</p>
        </div>
        <div className="card p-6">
          {!authConfigured() && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Set <code>APP_PASSWORD_HASH</code> and <code>SESSION_SECRET</code> in <code>.env</code> (see README) to enable sign-in.
            </p>
          )}
          <LoginForm next={next ?? "/"} />
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            This app never asks for Actors Access, Breakdown Express, or agency credentials. Don’t enter them here.
          </p>
        </div>
      </div>
    </div>
  );
}
