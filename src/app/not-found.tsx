import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted">That record doesn’t exist or was deleted.</p>
      <Link href="/" className="btn-secondary">Back to dashboard</Link>
    </div>
  );
}
