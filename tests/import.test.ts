import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, parseXlsx, parseJson, parseUpload, parseDate, sanitizeUrl, escapeFormula, ImportError } from "@/lib/import/parse";
import { suggestMapping, validatePublicRow, validateAgencyRow } from "@/lib/import/mapping";

const csv = `Project,Casting Director,Role,Deadline,Region,Union,Platform,URL
"The Lakeshore Hours","Jane Doe, CSA",Denise,2026-10-02,Chicago,SAG-AFTRA,Netflix,https://example.com/a
,Missing Project,X,,,,,
Harbor Lights,Lee Park,Nora,13/45/2026,NYC,SAG-AFTRA,Apple TV,javascript:alert(1)
`;

describe("CSV import", () => {
  it("parses headers and rows, skipping blank lines", () => {
    const t = parseCsv(csv);
    expect(t.headers).toEqual(["Project", "Casting Director", "Role", "Deadline", "Region", "Union", "Platform", "URL"]);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]["Casting Director"]).toBe("Jane Doe, CSA");
  });
  it("suggests a column mapping", () => {
    const t = parseCsv(csv);
    const m = suggestMapping(t.headers, "PUBLIC_BREAKDOWN");
    expect(m.project).toBe("Project");
    expect(m.castingDirector).toBe("Casting Director");
    expect(m.deadline).toBe("Deadline");
    expect(m.url).toBe("URL");
  });
  it("validates rows: required fields, dates, urls, region & platform canonicalization", () => {
    const t = parseCsv(csv);
    const m = suggestMapping(t.headers, "PUBLIC_BREAKDOWN");
    const [a, b, c] = t.rows.map((r, i) => validatePublicRow(r, m, i + 1, "Test"));
    expect(a.valid).toBe(true);
    expect(a.value?.region).toBe("CHICAGO");
    expect(a.value?.deadline?.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(b.valid).toBe(false);
    expect(b.errors).toContain("Project is required");
    expect(c.valid).toBe(false);
    expect(c.errors.join(" ")).toMatch(/Unrecognized deadline/);
    expect(c.errors.join(" ")).toMatch(/URL/);
  });
  it("validates agency rows", () => {
    const t = parseCsv("Date Submitted,Project,Role,Casting Director,Platform\n09/03/2026,Iron & Velvet,Tasha,Rosa Grant,hbo max\n");
    const m = suggestMapping(t.headers, "AGENCY_SUBMISSION");
    const r = validateAgencyRow(t.rows[0], m, 1);
    expect(r.valid).toBe(true);
    expect(r.value?.dateSubmitted?.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(r.value?.platform).toBe("Max");
  });
  it("strips control characters", () => {
    const t = parseCsv("Project\n\"Bad\u0007Title\"\n");
    expect(t.rows[0].Project).toBe("BadTitle");
  });
});

describe("XLSX import", () => {
  it("parses the first worksheet including date cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Submissions");
    ws.addRow(["Date Submitted", "Project", "Role", "Casting Director"]);
    ws.addRow([new Date(Date.UTC(2026, 8, 3)), "Iron & Velvet", "Tasha", "Rosa Grant"]);
    ws.addRow(["2026-09-07", "Untitled Paramount+ Series", "Kira", "Mara Kell"]);
    const buf = await wb.xlsx.writeBuffer();
    const t = await parseXlsx(buf as ArrayBuffer);
    expect(t.headers).toEqual(["Date Submitted", "Project", "Role", "Casting Director"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]["Date Submitted"]).toBe("2026-09-03");
    const m = suggestMapping(t.headers, "AGENCY_SUBMISSION");
    expect(validateAgencyRow(t.rows[1], m, 2).value?.project).toBe("Untitled Paramount+ Series");
  });
  it("rejects files that are not real workbooks", async () => {
    const fake = new TextEncoder().encode("not,a,zip").buffer as ArrayBuffer;
    await expect(parseUpload("x.xlsx", fake, ["xlsx"])).rejects.toBeInstanceOf(ImportError);
  });
  it("rejects disallowed extensions", async () => {
    const buf = new TextEncoder().encode("a,b").buffer as ArrayBuffer;
    await expect(parseUpload("evil.exe", buf, ["csv", "xlsx"])).rejects.toThrow(/Unsupported/);
    await expect(parseUpload("data.json", buf, ["csv", "xlsx"])).rejects.toThrow(/Unsupported/);
  });
});

describe("JSON import", () => {
  it("accepts an array of objects", () => {
    const t = parseJson(JSON.stringify([{ Project: "A", Role: "B" }, { Project: "C", Deadline: "2026-10-01" }]));
    expect(t.headers).toEqual(["Project", "Role", "Deadline"]);
    expect(t.rows[1].Deadline).toBe("2026-10-01");
  });
  it("rejects non-array JSON", () => {
    expect(() => parseJson('{"a":1}')).toThrow(ImportError);
  });
});

describe("helpers", () => {
  it("parses dates", () => {
    expect(parseDate("9/3/26")?.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(parseDate("46268")?.toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(parseDate("garbage")).toBeNull();
  });
  it("sanitizes urls and formulas", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("example.com/x")).toBe("https://example.com/x");
    expect(escapeFormula("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeFormula("Normal")).toBe("Normal");
  });
});
