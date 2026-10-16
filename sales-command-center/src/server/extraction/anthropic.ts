import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { EXTRACT_FIELDS, cleanValue, extractionSchema, type ExtractionProvider, type ExtractionResult } from "./types";

const PROMPT = `You are reading a screenshot that lists one or more businesses (sales leads) — for example a map search, a directory listing, a spreadsheet, or a contact card.

Transcribe; do not research or infer.
- page_text: every piece of readable text in the image, top to bottom, exactly as written.
- leads: one entry per distinct business shown. For each field, copy the value exactly as it appears in the image. If a field is not visible in the image, return null — never guess, complete, reformat, or look up a phone number, email, address, ZIP, or contact name.
- notes: only text in the image that describes this business but doesn't fit another field (e.g. hours, rating, "closed Mondays"), copied verbatim. null if none.
- source_text: the exact text from the image that this lead was read from.
- confidence: per field, "high" if clearly legible, "medium" if partly legible or you are unsure which business it belongs to, "low" if it is hard to read. null when the value is null.
If the image contains no businesses, return an empty leads array.`;

const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Claude vision extraction. The API key is read on the server from ANTHROPIC_API_KEY and never sent to the browser. */
export class AnthropicVisionProvider implements ExtractionProvider {
  id = "anthropic";
  label: string;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = process.env.EXTRACTION_MODEL || "claude-opus-5-5", fetchImpl?: typeof fetch) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    this.model = model;
    this.label = `Claude vision (${model})`;
  }

  async extract(image: { data: Buffer; mime: string; fileName: string }): Promise<ExtractionResult> {
    if (!SUPPORTED.has(image.mime)) throw new Error(`${image.mime} images can't be read by the vision provider — convert to PNG or JPEG.`);
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(extractionSchema) },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.mime as "image/png", data: image.data.toString("base64") } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new Error("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.");
      if (e instanceof Anthropic.RateLimitError) throw new Error("The vision provider is rate limiting requests. Try this image again in a minute.");
      if (e instanceof Anthropic.BadRequestError) throw new Error(`The vision provider rejected the request: ${e.message}`);
      if (e instanceof Anthropic.APIError) throw new Error(`Vision provider error${e.status ? ` (${e.status})` : ""}: ${e.message}`);
      throw e;
    }
    if (response.stop_reason === "refusal") throw new Error("The vision provider declined to read this image.");
    if (response.stop_reason === "max_tokens") throw new Error("This image has more text than one extraction can return. Crop it into smaller screenshots.");
    const out = response.parsed_output;
    if (!out) throw new Error("The vision provider returned output that couldn't be read.");
    return {
      rawText: out.page_text,
      leads: out.leads.map((l) => ({
        values: Object.fromEntries(EXTRACT_FIELDS.map((f) => [f, cleanValue(l[f])])),
        confidence: Object.fromEntries(EXTRACT_FIELDS.map((f) => [f, cleanValue(l[f]) ? (l.confidence[f] ?? "low") : null])),
        sourceText: l.source_text,
      })),
    };
  }
}
