import type { SourceAdapter } from "./types";
import { publicDataImportAdapter } from "./public-data-import";
import { permittedApiTemplateAdapter } from "./permitted-api-template";

export const adapters: SourceAdapter<any, any, any>[] = [publicDataImportAdapter, permittedApiTemplateAdapter]; // eslint-disable-line @typescript-eslint/no-explicit-any

export function getAdapter(id: string) {
  return adapters.find((a) => a.id === id) ?? null;
}

/** Scheduled adapters that are enabled AND declare themselves compliant/automated. */
export function scheduledAdapters() {
  return adapters.filter((a) => a.enabled && a.mode === "SCHEDULED" && a.compliance.automated && a.compliance.termsUrl);
}
