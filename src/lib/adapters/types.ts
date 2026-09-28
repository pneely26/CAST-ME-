/**
 * Source Adapter architecture.
 *
 * Every data source (manual file import today; permitted public APIs later) implements this
 * interface so new sources can be added without touching the rest of the app.
 *
 * COMPLIANCE: an adapter may only use data that is public, provided by the user, or available
 * through an official API whose terms permit this use. Adapters must never log in to Actors
 * Access / Breakdown Express, use representative credentials, bypass CAPTCHAs or rate limits,
 * or scrape pages behind authentication. Adapters that cannot meet this stay MANUAL_IMPORT.
 */
export type AdapterMode = "MANUAL_IMPORT" | "SCHEDULED";

export interface AdapterCompliance {
  /** Does this adapter make network requests on its own? */
  automated: boolean;
  /** Human-readable statement of what data is used and why it is permitted. */
  basis: string;
  /** Link to the source's terms / API docs that permit this use (required for automated adapters). */
  termsUrl?: string;
  /** Minimum interval between runs, respecting the source's rate limits. */
  minIntervalMinutes?: number;
}

export interface AdapterContext {
  now: Date;
  /** For manual import adapters: the uploaded rows and user-chosen column mapping. */
  input?: unknown;
}

export interface NormalizedResult<T> {
  index: number;
  valid: boolean;
  errors: string[];
  value: T | null;
}

export interface SaveSummary {
  saved: number;
  skipped: number;
  errors: string[];
  createdIds: string[];
}

export interface SourceAdapter<TRaw = unknown, TNormalized = unknown, TSaveOptions = unknown> {
  id: string;
  name: string;
  description: string;
  mode: AdapterMode;
  enabled: boolean;
  compliance: AdapterCompliance;
  fetch(ctx: AdapterContext): Promise<TRaw[]>;
  normalize(raw: TRaw, index: number, ctx: AdapterContext): NormalizedResult<TNormalized>;
  validate(item: NormalizedResult<TNormalized>): NormalizedResult<TNormalized>;
  save(items: NormalizedResult<TNormalized>[], ctx: AdapterContext, options: TSaveOptions): Promise<SaveSummary>;
}
