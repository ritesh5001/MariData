// Frontend mirror of the backend filter contract (filters.md). The backend re-validates
// everything; this model just drives the builder UI.

export type FieldType = "text" | "number" | "date" | "array";

export interface FieldDef {
  field: string;
  label: string;
  type: FieldType;
  fuzzy?: boolean;
}

export const FIELD_DEFS: FieldDef[] = [
  // identity / names
  { field: "person_name", label: "Name", type: "text" },
  { field: "person_first_name", label: "First name", type: "text" },
  { field: "person_last_name", label: "Last name", type: "text" },
  { field: "person_name_downcase", label: "Name (lowercase)", type: "text", fuzzy: true },
  // role
  { field: "person_title", label: "Title", type: "text" },
  { field: "person_title_normalized", label: "Title (normalized)", type: "text" },
  { field: "primary_title_faceting", label: "Title (facet)", type: "text" },
  { field: "person_detailed_function", label: "Detailed function", type: "text" },
  { field: "person_functions", label: "Functions", type: "array" },
  { field: "person_seniority", label: "Seniority", type: "text" },
  // contact
  { field: "person_email", label: "Email", type: "text", fuzzy: true },
  { field: "person_email_analyzed", label: "Email (analyzed)", type: "text" },
  { field: "person_email_status", label: "Email status", type: "text" },
  { field: "email_confidence", label: "Email confidence", type: "number" },
  { field: "person_phone", label: "Phone", type: "text" },
  { field: "person_sanitized_phone", label: "Phone (sanitized)", type: "text" },
  { field: "person_linkedin_url", label: "LinkedIn URL", type: "text" },
  { field: "num_linkedin_connections", label: "LinkedIn connections", type: "number" },
  // org
  { field: "organization_name", label: "Organization", type: "text", fuzzy: true },
  { field: "current_organization_ids", label: "Organization IDs", type: "array" },
  // location
  { field: "location_city", label: "City", type: "text" },
  { field: "location_city_full", label: "City (full)", type: "text" },
  { field: "location_state", label: "State", type: "text" },
  { field: "location_state_full", label: "State (full)", type: "text" },
  { field: "location_country", label: "Country", type: "text" },
  { field: "location_postal_code", label: "Postal code", type: "text" },
  // employment / scoring
  { field: "job_start_date", label: "Job start date", type: "date" },
  { field: "modality", label: "Modality", type: "text" },
  { field: "prospected_by_team_ids", label: "Prospected by team IDs", type: "array" },
  { field: "excluded_by_team_ids", label: "Excluded by team IDs", type: "array" },
  { field: "relevance_boost", label: "Relevance boost", type: "number" },
  { field: "random", label: "Random", type: "number" },
  { field: "person_vacuumed_at", label: "Vacuumed at", type: "date" },
  // provenance
  { field: "source_index", label: "Source index", type: "text" },
  { field: "source_type", label: "Source type", type: "text" },
  { field: "external_id", label: "External ID", type: "text" },
  { field: "source_score", label: "Source score", type: "number" },
  // platform
  { field: "tags", label: "Tags", type: "array" },
  { field: "created_at", label: "Created at", type: "date" },
];

export const OPERATORS_BY_TYPE: Record<FieldType, { op: string; label: string }[]> = {
  text: [
    { op: "equals", label: "equals" },
    { op: "not_equals", label: "does not equal" },
    { op: "contains", label: "contains" },
    { op: "starts_with", label: "starts with" },
    { op: "in", label: "is one of" },
    { op: "not_in", label: "is not one of" },
    { op: "fuzzy", label: "is similar to" },
    { op: "is_null", label: "is empty" },
    { op: "is_not_null", label: "is not empty" },
  ],
  number: [
    { op: "equals", label: "=" },
    { op: "not_equals", label: "≠" },
    { op: "gt", label: ">" },
    { op: "gte", label: "≥" },
    { op: "lt", label: "<" },
    { op: "lte", label: "≤" },
    { op: "between", label: "between" },
    { op: "is_null", label: "is empty" },
    { op: "is_not_null", label: "is not empty" },
  ],
  date: [
    { op: "equals", label: "on" },
    { op: "gt", label: "after" },
    { op: "gte", label: "on or after" },
    { op: "lt", label: "before" },
    { op: "lte", label: "on or before" },
    { op: "between", label: "between" },
    { op: "is_null", label: "is empty" },
    { op: "is_not_null", label: "is not empty" },
  ],
  array: [
    { op: "array_contains", label: "contains" },
    { op: "is_null", label: "is empty" },
    { op: "is_not_null", label: "is not empty" },
  ],
};

export interface FilterCondition {
  kind: "condition";
  field: string;
  operator: string;
  value?: unknown;
}

export interface FilterGroup {
  kind: "group";
  op: "AND" | "OR";
  conditions: (FilterCondition | FilterGroup)[];
}

export function emptyGroup(): FilterGroup {
  return { kind: "group", op: "AND", conditions: [] };
}

export function newCondition(): FilterCondition {
  return { kind: "condition", field: "person_title", operator: "contains", value: "" };
}

export function fieldDef(field: string): FieldDef {
  return FIELD_DEFS.find((f) => f.field === field) ?? FIELD_DEFS[0]!;
}

export function operatorsFor(field: string, fuzzyAllowed: boolean): { op: string; label: string }[] {
  const def = fieldDef(field);
  return OPERATORS_BY_TYPE[def.type].filter(
    (o) => o.op !== "fuzzy" || (fuzzyAllowed && def.fuzzy)
  );
}

// Strip UI markers and empty conditions into the wire format the backend expects.
// Returns null when the tree holds no usable conditions.
export function toWire(group: FilterGroup): Record<string, unknown> | null {
  const conditions = group.conditions
    .map((c) => {
      if (c.kind === "group") return toWire(c);
      if (!conditionComplete(c)) return null;
      const out: Record<string, unknown> = { field: c.field, operator: c.operator };
      if (!["is_null", "is_not_null"].includes(c.operator)) out.value = c.value;
      return out;
    })
    .filter((c): c is Record<string, unknown> => c !== null);
  if (conditions.length === 0) return null;
  return { op: group.op, conditions };
}

function conditionComplete(c: FilterCondition): boolean {
  if (["is_null", "is_not_null"].includes(c.operator)) return true;
  if (c.value == null || c.value === "") return false;
  if (Array.isArray(c.value)) {
    return c.value.length > 0 && (c.operator !== "between" || c.value.length === 2);
  }
  return true;
}

// Rehydrate a wire-format config (e.g. a loaded segment) into the UI tree.
export function fromWire(wire: unknown): FilterGroup {
  if (typeof wire !== "object" || wire === null || !("op" in wire)) return emptyGroup();
  const w = wire as { op?: unknown; conditions?: unknown };
  const group = emptyGroup();
  group.op = w.op === "OR" ? "OR" : "AND";
  if (Array.isArray(w.conditions)) {
    group.conditions = w.conditions.map((c: unknown) => {
      if (typeof c === "object" && c !== null && "op" in c) return fromWire(c);
      const cc = c as { field?: string; operator?: string; value?: unknown };
      return {
        kind: "condition" as const,
        field: cc.field ?? "person_title",
        operator: cc.operator ?? "contains",
        value: cc.value,
      };
    });
  }
  return group;
}
