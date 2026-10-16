import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { getActor } from "@/server/auth";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getActor()) redirect("/");
  const { next } = await searchParams;
  const users = await prisma.user.count();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold">Sales Command Center</div>
          <p className="text-sm text-muted">Sign in to your workspace</p>
        </div>
        <div className="card p-6">
          {users === 0 && (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No accounts yet. Run <code>npm run setup</code> (or <code>npm run create-user</code>) to create the coordinator and rep logins.
            </p>
          )}
          <LoginForm next={next ?? "/"} />
        </div>
      </div>
    </div>
  );
}
