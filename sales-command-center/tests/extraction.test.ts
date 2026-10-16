import { describe, it, expect } from "vitest";
import { AnthropicVisionProvider } from "@/server/extraction/anthropic";
import { autoMapHeaders, applyMapping, reviewFlags, isClean } from "@/lib/domain/imports";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

function cannedFetch(payload: unknown, capture: { body?: Record<string, unknown>; headers?: Headers }, stop = "end_turn") {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    capture.body = JSON.parse(String(init?.body));
    capture.headers = new Headers(init?.headers);
    const msg = { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: stop, stop_sequence: null, content: [{ type: "text", text: JSON.stringify(payload) }], usage: { input_tokens: 10, output_tokens: 10 } };
    return new Response(JSON.stringify(msg), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  }) as typeof fetch;
}

describe("Claude vision provider (mocked HTTP)", () => {
  it("sends the image server-side with structured output and maps the result without inventing values", async () => {
    const cap: { body?: Record<string, unknown>; headers?: Headers } = {};
    const out = {
      page_text: "Blue Door Bakery\n1200 N Clark St",
      leads: [{ businessName: "Blue Door Bakery", contactName: null, jobTitle: null, phone: null, email: null, address: "1200 N Clark St", city: null, state: null, zip: null, industry: null, notes: "  ", source_text: "Blue Door Bakery\n1200 N Clark St", confidence: { businessName: "high", contactName: null, jobTitle: null, phone: null, email: null, address: "medium", city: null, state: null, zip: null, industry: null, notes: "high" } }],
    };
    const p = new AnthropicVisionProvider("sk-test", "claude-opus-5-5", cannedFetch(out, cap));
    const r = await p.extract({ data: PNG, mime: "image/png", fileName: "a.png" });
    expect(cap.body?.model).toBe("claude-opus-5-5");
    expect(cap.body?.fallbacks).toBe("default");
    expect(cap.headers?.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(JSON.stringify(cap.body?.output_config)).toContain("json_schema");
    const content = (cap.body?.messages as { content: { type: string; source?: { data: string } }[] }[])[0].content;
    expect(content[0].type).toBe("image");
    expect(content[0].source?.data).toBe(PNG.toString("base64"));
    expect(r.rawText).toBe(out.page_text);
    expect(r.leads[0].values).toMatchObject({ businessName: "Blue Door Bakery", address: "1200 N Clark St", phone: null, notes: null });
    expect(r.leads[0].confidence.notes).toBeNull(); // blank value → no confidence claimed
  });

  it("reports refusals and truncation as errors instead of returning partial data", async () => {
    const p1 = new AnthropicVisionProvider("sk-test", "claude-opus-5-5", cannedFetch({ page_text: "", leads: [] }, {}, "refusal"));
    await expect(p1.extract({ data: PNG, mime: "image/png", fileName: "a.png" })).rejects.toThrow(/declined/);
    const p2 = new AnthropicVisionProvider("sk-test", "claude-opus-5-5", cannedFetch({ page_text: "", leads: [] }, {}, "max_tokens"));
    await expect(p2.extract({ data: PNG, mime: "image/png", fileName: "a.png" })).rejects.toThrow(/Crop/);
  });

  it("rejects image types the provider can't read", async () => {
    const p = new AnthropicVisionProvider("sk-test", "claude-opus-5-5", cannedFetch({}, {}));
    await expect(p.extract({ data: PNG, mime: "image/heic", fileName: "a.heic" })).rejects.toThrow(/PNG or JPEG/);
  });
});

describe("import mapping and review flags", () => {
  it("maps known headers and ignores unknown ones", () => {
    expect(autoMapHeaders(["Company Name", "Tel", "E-mail", "Mystery"])).toEqual({ "Company Name": "businessName", Tel: "phone", "E-mail": "email", Mystery: "" });
    expect(applyMapping({ A: "Cafe", B: " note 1 ", C: "note 2" }, { A: "businessName", B: "notes", C: "notes" })).toEqual({ businessName: "Cafe", notes: "note 1\nnote 2" });
  });
  it("flags missing and low-confidence values", () => {
    const f = reviewFlags({ businessName: "Cafe", phone: "555" }, { phone: "low" });
    expect(f.map((x) => x.message)).toEqual(expect.arrayContaining(["Phone number looks incomplete", "No address in the source — left blank"]));
    expect(isClean(f)).toBe(false);
    expect(isClean(reviewFlags({ businessName: "Cafe", phone: "312-555-0101", address: "1 Main" }, { businessName: "high" }))).toBe(true);
  });
});
