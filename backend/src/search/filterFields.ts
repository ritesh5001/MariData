// Whitelisted filterable fields and their types (see .claude/docs/filters.md). The
// compiler refuses any identifier not in this map, so user input never reaches SQL as an
// identifier — only as $n-bound values.

export type FieldType = "text" | "number" | "date" | "timestamp" | "array";

export const FILTER_FIELDS: Record<string, FieldType> = {
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
  person_linkedin_url: "text",
  person_detailed_function: "text",
  person_title_normalized: "text",
  primary_title_faceting: "text",
  organization_name: "text",
  location_city: "text",
  location_state: "text",
  location_country: "text",
  location_postal_code: "text",
  job_start_date: "date",
  num_linkedin_connections: "number",
  relevance_boost: "number",
  modality: "text",
  tags: "array",
  source_type: "text",
  created_at: "timestamp",
};

// Fuzzy (%) needs a pg_trgm index; only these columns have one.
export const FUZZY_FIELDS = new Set([
  "person_name_downcase",
  "person_email",
  "organization_name",
]);
