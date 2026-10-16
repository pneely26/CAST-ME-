"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { extractImageAction } from "@/app/actions/imports";

/** Reads queued screenshots one at a time so the page can show real progress and per-image errors. */
export function ExtractRunner({ imageIds, names }: { imageIds: string[]; names: Record<string, string> }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [log, setLog] = useState<{ name: string; ok: boolean; text: string }[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !imageIds.length) return;
    started.current = true;
    (async () => {
      for (let n = 0; n < imageIds.length; n++) {
        setI(n);
        const id = imageIds[n];
        const r = await extractImageAction(id);
        const name = names[id] ?? "image";
        if (!r.ok) setLog((l) => [...l, { name, ok: false, text: r.error }]);
        else if (r.data.status === "ERROR") setLog((l) => [...l, { name, ok: false, text: r.message ?? "Couldn't read this image" }]);
        else setLog((l) => [...l, { name, ok: true, text: `${r.data.count} business(es) found` }]);
        router.refresh();
      }
      setI(imageIds.length);
    })();
  }, [imageIds, names, router]);

  if (!imageIds.length) return null;
  const doneAll = i >= imageIds.length;
  return (
    <div role="status" aria-live="polite" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
      <div className="font-medium">{doneAll ? `Finished reading ${imageIds.length} image(s).` : `Reading image ${i + 1} of ${imageIds.length}: ${names[imageIds[i]] ?? ""}…`}</div>
      <div className="mt-1 h-1.5 rounded bg-blue-100"><div className="h-full rounded bg-blue-600 transition-all" style={{ width: `${(Math.min(i, imageIds.length) / imageIds.length) * 100}%` }} /></div>
      {!!log.length && (
        <ul className="mt-1 text-xs">
          {log.map((l, k) => <li key={k} className={l.ok ? "" : "text-red-700"}>{l.name}: {l.text}</li>)}
        </ul>
      )}
    </div>
  );
}
