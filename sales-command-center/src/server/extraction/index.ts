import "server-only";
import type { ExtractionProvider } from "./types";
import { AnthropicVisionProvider } from "./anthropic";

let override: ExtractionProvider | null | undefined;

/** Test hook: replace the provider (null = not configured). */
export function setExtractionProviderForTests(p: ExtractionProvider | null | undefined) {
  override = p;
}

/**
 * The configured screenshot reader, or null when none is set up.
 * Callers must show a "not configured" state rather than pretending to extract.
 */
export function getExtractionProvider(): ExtractionProvider | null {
  if (override !== undefined) return override;
  if ((process.env.EXTRACTION_PROVIDER ?? "anthropic") === "none") return null;
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? new AnthropicVisionProvider(key) : null;
}

export function extractionStatus() {
  const p = getExtractionProvider();
  return p ? { configured: true as const, label: p.label } : { configured: false as const, label: null };
}
