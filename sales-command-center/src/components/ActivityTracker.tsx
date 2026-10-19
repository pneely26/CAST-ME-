"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Tells the server which page a rep opened, for the coordinator's activity log. */
export function ActivityTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const path = pathname + window.location.search;
    fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }), keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
