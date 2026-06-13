// Whitelisted filterable fields and their types (see .claude/docs/filters.md). The
// compiler refuses any identifier not in this map, so user input never reaches SQL as an
// identifier — only as $n-bound values.

export type FieldType = "text" | "number" | "date" | "timestamp" | "array";

export const FILTER_FIELDS: Record<string, FieldType> = {
  // identity / names
  person_name: "text",
  person_first_name: "text",
  person_last_name: "text",
  person_name_downcase: "text",
  // role
  person_title: "text",
  person_functions: "array",
  person_seniority: "text",
  person_detailed_function: "text",
  person_title_normalized: "text",
  primary_title_faceting: "text",
  // contact
  person_email_status: "text",
  email_confidence: "number",
  person_email: "text",
  person_email_analyzed: "text",
  person_phone: "text",
  person_sanitized_phone: "text",
  person_linkedin_url: "text",
  num_linkedin_connections: "number",
  // org
  organization_name: "text",
  current_organization_ids: "array",
  // location
  location_city: "text",
  location_city_full: "text",
  location_state: "text",
  location_state_full: "text",
  location_country: "text",
  location_postal_code: "text",
  // employment / scoring
  job_start_date: "date",
  modality: "text",
  prospected_by_team_ids: "array",
  excluded_by_team_ids: "array",
  relevance_boost: "number",
  random: "number",
  person_vacuumed_at: "timestamp",
  // provenance
  source_index: "text",
  source_type: "text",
  external_id: "text",
  source_score: "number",
  // platform
  tags: "array",
  created_at: "timestamp",
};

// Fuzzy (%) needs a pg_trgm index; only these columns have one.
export const FUZZY_FIELDS = new Set([
  "person_name_downcase",
  "person_email",
  "organization_name",
]);
