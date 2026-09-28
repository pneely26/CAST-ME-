import { describe, it, expect } from "vitest";
import { daysUntil, deadlineState, deadlineLabel, sortByDeadline, sourceState } from "@/lib/deadlines";

const now = new Date("2026-09-28T15:00:00Z");
const d = (s: string) => new Date(s + "T12:00:00Z");

describe("deadline calculations", () => {
  it("counts calendar days", () => {
    expect(daysUntil(d("2026-09-28"), now)).toBe(0);
    expect(daysUntil(d("2026-09-30"), now)).toBe(2);
    expect(daysUntil(d("2026-09-20"), now)).toBe(-8);
  });
  it("classifies states", () => {
    expect(deadlineState(null, now)).toBe("NONE");
    expect(deadlineState(d("2026-09-20"), now)).toBe("PASSED");
    expect(deadlineState(new Date("2026-09-28T23:00:00Z"), now)).toBe("TODAY");
    expect(deadlineState(d("2026-09-30"), now, 3)).toBe("SOON");
    expect(deadlineState(d("2026-10-20"), now, 3)).toBe("UPCOMING");
  });
  it("labels", () => {
    expect(deadlineLabel(d("2026-09-29"), now)).toBe("Due tomorrow");
    expect(deadlineLabel(d("2026-09-27"), now)).toBe("Passed 1 day ago");
    expect(deadlineLabel(null, now)).toBe("No deadline listed");
  });
  it("sorts by nearest deadline with undated last", () => {
    const items = [{ d: null }, { d: d("2026-10-05") }, { d: d("2026-09-30") }];
    expect(sortByDeadline(items, (x) => x.d).map((x) => x.d?.toISOString().slice(0, 10) ?? null)).toEqual(["2026-09-30", "2026-10-05", null]);
  });
  it("source freshness", () => {
    expect(sourceState({ verifiedAt: null }, now)).toBe("UNVERIFIED");
    expect(sourceState({ verifiedAt: d("2026-08-01") }, now, 14)).toBe("STALE");
    expect(sourceState({ verifiedAt: d("2026-09-25") }, now, 14)).toBe("CURRENT");
    expect(sourceState({ verifiedAt: d("2026-09-25"), projectStatus: "CASTING_CLOSED" }, now)).toBe("CASTING_CLOSED");
  });
});
