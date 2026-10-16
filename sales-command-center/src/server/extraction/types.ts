import { z } from "zod";

/** Lead fields an extraction provider may return. Every value is exactly as read, or null when not visible. */
export const EXTRACT_FIELDS = ["businessName", "contactName", "jobTitle", "phone", "email", "address", "city", "state", "zip", "industry", "notes"] as const;
export type ExtractField = (typeof EXTRACT_FIELDS)[number];
export type Confidence = "high" | "medium" | "low";

export const FIELD_LABEL: Record<ExtractField, string> = {
  businessName: "Business name",
  contactName: "Contact",
  jobTitle: "Title",
  phone: "Phone",
  email: "Email",
  address: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  industry: "Industry",
  notes: "Notes",
};

const val = z.string().nullable();
const conf = z.enum(["high", "medium", "low"]).nullable();

/** Structured output schema the vision model must fill. */
export const extractionSchema = z.object({
  page_text: z.string(),
  leads: z.array(
    z.object({
      businessName: val,
      contactName: val,
      jobTitle: val,
      phone: val,
      email: val,
      address: val,
      city: val,
      state: val,
      zip: val,
      industry: val,
      notes: val,
      source_text: z.string(),
      confidence: z.object({
        businessName: conf,
        contactName: conf,
        jobTitle: conf,
        phone: conf,
        email: conf,
        address: conf,
        city: conf,
        state: conf,
        zip: conf,
        industry: conf,
        notes: conf,
      }),
    }),
  ),
});
export type ExtractionOutput = z.infer<typeof extractionSchema>;

export interface ExtractedLead {
  values: Partial<Record<ExtractField, string | null>>;
  confidence: Partial<Record<ExtractField, Confidence | null>>;
  sourceText: string;
}

export interface ExtractionResult {
  rawText: string;
  leads: ExtractedLead[];
}

export interface ExtractionProvider {
  id: string;
  label: string;
  extract(image: { data: Buffer; mime: string; fileName: string }): Promise<ExtractionResult>;
}

/** Normalize a provider value: trim, and treat empty strings as "not visible". Never invents a value. */
export function cleanValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}
