// Whitelist of columns a PATCH may write, with their value type. Identifiers used in
// UPDATE statements come only from this map. id / created_at / search_vector (generated)
// are not editable.

export type EditableType =
  | "text"
  | "number"
  | "int"
  | "date"
  | "timestamp"
  | "jsonb"
  | "array";

export const EDITABLE_FIELDS: Record<string, EditableType> = {
  person_name: "text",
  person_first_name: "text",
  person_last_name: "text",
  person_name_downcase: "text",
  person_title: "text",
  person_functions: "array",
  person_seniority: "text",
  person_email_status: "text",
  email_confidence: "number",
  person_email: "text",
  person_phone: "text",
  person_sanitized_phone: "text",
  person_email_analyzed: "text",
  person_linkedin_url: "text",
  person_detailed_function: "text",
  person_title_normalized: "text",
  primary_title_faceting: "text",
  organization_name: "text",
  current_organization_ids: "array",
  location_city: "text",
  location_city_full: "text",
  location_state: "text",
  location_state_full: "text",
  location_country: "text",
  location_postal_code: "text",
  location_geojson: "jsonb",
  job_start_date: "date",
  modality: "text",
  prospected_by_team_ids: "array",
  excluded_by_team_ids: "array",
  relevance_boost: "number",
  num_linkedin_connections: "int",
  predictive_scores: "jsonb",
  person_vacuumed_at: "timestamp",
  random: "number",
  source_index: "text",
  source_type: "text",
  external_id: "text",
  source_score: "number",
  tags: "array",
};

export class EditError extends Error {}

// Coerce one PATCH value to its column type; null clears the column. Throws EditError
// (mapped to 400) on mismatch.
export function coerceEditValue(
  field: string,
  type: EditableType,
  v: unknown
): unknown {
  if (v === null) return null;
  switch (type) {
    case "text": {
      if (typeof v !== "string") throw new EditError(`${field}: expected string`);
      const s = v.trim();
      return s === "" ? null : s;
    }
    case "number": {
      const n = typeof v === "number" ? v : Number(v);
      if (typeof v === "boolean" || v === "" || !Number.isFinite(n)) {
        throw new EditError(`${field}: expected number`);
      }
      return n;
    }
    case "int": {
      const n = typeof v === "number" ? v : Number(v);
      if (typeof v === "boolean" || v === "" || !Number.isInteger(n)) {
        throw new EditError(`${field}: expected integer`);
      }
      return n;
    }
    case "date":
    case "timestamp": {
      if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
        throw new EditError(`${field}: expected ISO date`);
      }
      return v;
    }
    case "array": {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
        throw new EditError(`${field}: expected string array`);
      }
      const arr = v.map((s) => s.trim()).filter((s) => s !== "");
      return arr.length === 0 ? null : arr;
    }
    case "jsonb": {
      if (typeof v !== "object") throw new EditError(`${field}: expected JSON`);
      return JSON.stringify(v);
    }
  }
}
