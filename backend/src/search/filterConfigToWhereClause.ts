import { z } from "zod";
import { FILTER_FIELDS, FUZZY_FIELDS, type FieldType } from "./filterFields.js";

// Compile a nested AND/OR filterConfig into a parameterized WHERE fragment.
// Contract (filters.md): every value binds as $n; identifiers are whitelist-validated;
// type mismatches reject with a 400-able error, never a raw DB error.

export interface FilterCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface FilterGroup {
  op: "AND" | "OR";
  conditions: (FilterCondition | FilterGroup)[];
}

export class FilterError extends Error {}

const MAX_DEPTH = 5;
const MAX_CONDITIONS = 50;

const conditionSchema = z.object({
  field: z.string().min(1).max(64),
  operator: z.string().min(1).max(32),
  value: z.unknown().optional(),
});

type GroupInput = {
  op: "AND" | "OR";
  conditions: unknown[];
};

const groupSchema: z.ZodType<GroupInput> = z.object({
  op: z.enum(["AND", "OR"]),
  conditions: z.array(z.unknown()).min(1).max(MAX_CONDITIONS),
});

export function parseFilterConfig(input: unknown): FilterGroup {
  return parseGroup(input, 1);
}

function parseGroup(input: unknown, depth: number): FilterGroup {
  if (depth > MAX_DEPTH) throw new FilterError("filter nesting too deep");
  const g = groupSchema.safeParse(input);
  if (!g.success) throw new FilterError("invalid filter group");
  const conditions = g.data.conditions.map((c) => {
    if (typeof c === "object" && c !== null && "op" in c) {
      return parseGroup(c, depth + 1);
    }
    const cond = conditionSchema.safeParse(c);
    if (!cond.success) throw new FilterError("invalid filter condition");
    return cond.data;
  });
  return { op: g.data.op, conditions };
}

// ---------------------------------------------------------------------------

interface Ctx {
  values: unknown[];
  startIdx: number;
  total: number;
}

export function filterConfigToWhereClause(
  config: FilterGroup,
  startIdx = 1
): { text: string; values: unknown[] } {
  const ctx: Ctx = { values: [], startIdx, total: 0 };
  const text = emitGroup(config, ctx);
  return { text, values: ctx.values };
}

function emitGroup(group: FilterGroup, ctx: Ctx): string {
  const parts = group.conditions.map((c) =>
    "op" in c ? emitGroup(c as FilterGroup, ctx) : emitCondition(c as FilterCondition, ctx)
  );
  return `(${parts.join(` ${group.op} `)})`;
}

function bind(ctx: Ctx, value: unknown): string {
  ctx.values.push(value);
  return `$${ctx.startIdx + ctx.values.length - 1}`;
}

function emitCondition(cond: FilterCondition, ctx: Ctx): string {
  ctx.total++;
  if (ctx.total > MAX_CONDITIONS) throw new FilterError("too many filter conditions");

  const type = FILTER_FIELDS[cond.field];
  if (!type) throw new FilterError(`unknown filter field: ${cond.field}`);
  const f = cond.field; // safe: whitelisted above

  switch (cond.operator) {
    case "is_null":
      return `${f} IS NULL`;
    case "is_not_null":
      return `${f} IS NOT NULL`;

    case "equals":
      return `${f} = ${bind(ctx, coerceScalar(type, cond.value, f))}`;
    case "not_equals":
      return `${f} <> ${bind(ctx, coerceScalar(type, cond.value, f))}`;

    case "in":
      return `${f} = ANY(${bind(ctx, coerceArray(type, cond.value, f))})`;
    case "not_in":
      return `NOT (${f} = ANY(${bind(ctx, coerceArray(type, cond.value, f))}))`;

    case "contains":
      requireText(type, cond.operator, f);
      return `${f} ILIKE '%' || ${bind(ctx, coerceString(cond.value, f))} || '%'`;
    case "starts_with":
      requireText(type, cond.operator, f);
      return `${f} ILIKE ${bind(ctx, coerceString(cond.value, f))} || '%'`;

    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      requireOrdered(type, cond.operator, f);
      const op = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[cond.operator]!;
      return `${f} ${op} ${bind(ctx, coerceScalar(type, cond.value, f))}`;
    }

    case "between": {
      requireOrdered(type, cond.operator, f);
      if (!Array.isArray(cond.value) || cond.value.length !== 2) {
        throw new FilterError(`between needs [lo, hi] for ${f}`);
      }
      const lo = bind(ctx, coerceScalar(type, cond.value[0], f));
      const hi = bind(ctx, coerceScalar(type, cond.value[1], f));
      return `${f} BETWEEN ${lo} AND ${hi}`;
    }

    case "array_contains":
      if (type !== "array") {
        throw new FilterError(`array_contains only applies to array fields (${f})`);
      }
      return `${f} @> ARRAY[${bind(ctx, coerceString(cond.value, f))}]`;

    case "fts":
      return `search_vector @@ plainto_tsquery('simple', ${bind(ctx, coerceString(cond.value, f))})`;

    case "fuzzy":
      if (!FUZZY_FIELDS.has(f)) {
        throw new FilterError(`fuzzy not supported on ${f}`);
      }
      return `${f} % ${bind(ctx, coerceString(cond.value, f).toLowerCase())}`;

    default:
      throw new FilterError(`unknown operator: ${cond.operator}`);
  }
}

// ---------------------------------------------------------------------------
// Value coercion. Numbers for numeric fields, ISO dates for date fields; anything that
// does not coerce throws FilterError (mapped to 400 by the route).

function coerceString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 500) {
    throw new FilterError(`expected a string value for ${field}`);
  }
  return v;
}

function coerceScalar(type: FieldType, v: unknown, field: string): string | number {
  switch (type) {
    case "number": {
      const n = typeof v === "number" ? v : Number(v);
      if (typeof v === "boolean" || v == null || v === "" || !Number.isFinite(n)) {
        throw new FilterError(`expected a number for ${field}`);
      }
      return n;
    }
    case "date":
    case "timestamp": {
      const s = coerceString(v, field);
      if (Number.isNaN(Date.parse(s))) {
        throw new FilterError(`expected an ISO date for ${field}`);
      }
      return s;
    }
    case "text":
      return coerceString(v, field);
    case "array":
      throw new FilterError(`use array_contains for array field ${field}`);
  }
}

function coerceArray(type: FieldType, v: unknown, field: string): (string | number)[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200) {
    throw new FilterError(`expected a non-empty array for ${field}`);
  }
  return v.map((item) => coerceScalar(type, item, field));
}

function requireText(type: FieldType, op: string, field: string): void {
  if (type !== "text") throw new FilterError(`${op} only applies to text fields (${field})`);
}

function requireOrdered(type: FieldType, op: string, field: string): void {
  if (type !== "number" && type !== "date" && type !== "timestamp") {
    throw new FilterError(`${op} only applies to number/date fields (${field})`);
  }
}
