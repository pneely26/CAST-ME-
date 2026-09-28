import { toggleWatchAction } from "@/app/actions/watchlist";

export function WatchButton({ type, value, watchId, castingDirectorId, projectId, back }: {
  type: string; value: string; watchId?: string | null; castingDirectorId?: string; projectId?: string; back: string;
}) {
  return (
    <form action={toggleWatchAction}>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="value" value={value} />
      <input type="hidden" name="watchId" value={watchId ?? ""} />
      <input type="hidden" name="castingDirectorId" value={castingDirectorId ?? ""} />
      <input type="hidden" name="projectId" value={projectId ?? ""} />
      <input type="hidden" name="back" value={back} />
      <button className={watchId ? "btn-secondary" : "btn-primary"}>{watchId ? "Unwatch" : "Watch"}</button>
    </form>
  );
}
