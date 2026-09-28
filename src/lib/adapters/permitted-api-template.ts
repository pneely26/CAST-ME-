import type { SourceAdapter } from "./types";

/**
 * TEMPLATE for a future permitted public API / feed.
 *
 * Before enabling an adapter like this:
 *  1. Confirm the source's terms of service permit automated access for personal research.
 *  2. Use only official API endpoints or public pages that allow it (check robots.txt / terms).
 *  3. Store API keys in environment variables — never agency or Actors Access credentials.
 *  4. Respect published rate limits (set compliance.minIntervalMinutes).
 *  5. Map fetched records to PublicRow and reuse publicDataImportAdapter.save() for persistence.
 *
 * This adapter is disabled and its fetch() returns nothing.
 */
export const permittedApiTemplateAdapter: SourceAdapter<unknown, unknown, unknown> = {
  id: "PERMITTED_API_TEMPLATE",
  name: "Permitted public API (template)",
  description: "Placeholder for a future official API or permitted public feed. Disabled.",
  mode: "SCHEDULED",
  enabled: false,
  compliance: {
    automated: true,
    basis: "Not configured. Requires a source whose terms explicitly permit this use.",
    minIntervalMinutes: 360,
  },
  async fetch() {
    return [];
  },
  normalize(_raw, index) {
    return { index, valid: false, errors: ["Template adapter — not implemented"], value: null };
  },
  validate(item) {
    return item;
  },
  async save() {
    return { saved: 0, skipped: 0, errors: [], createdIds: [] };
  },
};
