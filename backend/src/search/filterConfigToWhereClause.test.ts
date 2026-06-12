import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFilterConfig,
  filterConfigToWhereClause,
  FilterError,
} from "./filterConfigToWhereClause.js";

function compile(input: unknown, startIdx = 1) {
  return filterConfigToWhereClause(parseFilterConfig(input), startIdx);
}

const cond = (field: string, operator: string, value?: unknown) => ({
  op: "AND" as const,
  conditions: [{ field, operator, value }],
});

test("equals binds value as $n", () => {
  const w = compile(cond("person_seniority", "equals", "vp"));
  assert.equal(w.text, "(person_seniority = $1)");
  assert.deepEqual(w.values, ["vp"]);
});

test("not_equals", () => {
  const w = compile(cond("location_country", "not_equals", "US"));
  assert.equal(w.text, "(location_country <> $1)");
  assert.deepEqual(w.values, ["US"]);
});

test("in / not_in use = ANY with one array param", () => {
  const w = compile(cond("location_country", "in", ["US", "GB"]));
  assert.equal(w.text, "(location_country = ANY($1))");
  assert.deepEqual(w.values, [["US", "GB"]]);

  const n = compile(cond("location_country", "not_in", ["US"]));
  assert.equal(n.text, "(NOT (location_country = ANY($1)))");
});

test("contains / starts_with emit ILIKE with bound value", () => {
  const c = compile(cond("person_title", "contains", "founder"));
  assert.equal(c.text, "(person_title ILIKE '%' || $1 || '%')");
  assert.deepEqual(c.values, ["founder"]);

  const s = compile(cond("person_title", "starts_with", "VP"));
  assert.equal(s.text, "(person_title ILIKE $1 || '%')");
});

test("comparison operators on number and date fields", () => {
  const g = compile(cond("email_confidence", "gte", 0.8));
  assert.equal(g.text, "(email_confidence >= $1)");
  assert.deepEqual(g.values, [0.8]);

  const d = compile(cond("job_start_date", "lt", "2020-01-01"));
  assert.equal(d.text, "(job_start_date < $1)");

  const b = compile(cond("num_linkedin_connections", "between", [100, 500]));
  assert.equal(b.text, "(num_linkedin_connections BETWEEN $1 AND $2)");
  assert.deepEqual(b.values, [100, 500]);
});

test("numeric strings coerce; junk rejects", () => {
  const w = compile(cond("email_confidence", "gte", "0.5"));
  assert.deepEqual(w.values, [0.5]);
  assert.throws(() => compile(cond("email_confidence", "gte", "abc")), FilterError);
  assert.throws(() => compile(cond("job_start_date", "gt", "not-a-date")), FilterError);
});

test("is_null / is_not_null take no value", () => {
  assert.equal(compile(cond("person_email", "is_null")).text, "(person_email IS NULL)");
  assert.equal(
    compile(cond("person_email", "is_not_null")).text,
    "(person_email IS NOT NULL)"
  );
});

test("array_contains emits @> ARRAY[$n]", () => {
  const w = compile(cond("person_functions", "array_contains", "sales"));
  assert.equal(w.text, "(person_functions @> ARRAY[$1])");
  assert.deepEqual(w.values, ["sales"]);
  assert.throws(() => compile(cond("person_title", "array_contains", "x")), FilterError);
});

test("fts and fuzzy", () => {
  const f = compile(cond("person_name", "fts", "maria"));
  assert.equal(f.text, "(search_vector @@ plainto_tsquery('simple', $1))");

  const z = compile(cond("person_name_downcase", "fuzzy", "Mariia"));
  assert.equal(z.text, "(person_name_downcase % $1)");
  assert.deepEqual(z.values, ["mariia"]);
  assert.throws(() => compile(cond("person_title", "fuzzy", "x")), FilterError);
});

test("nested AND/OR groups parenthesize correctly", () => {
  const w = compile({
    op: "AND",
    conditions: [
      { field: "location_country", operator: "in", value: ["US", "GB"] },
      {
        op: "OR",
        conditions: [
          { field: "person_title", operator: "contains", value: "founder" },
          { field: "person_title", operator: "contains", value: "ceo" },
        ],
      },
    ],
  });
  assert.equal(
    w.text,
    "(location_country = ANY($1) AND (person_title ILIKE '%' || $2 || '%' OR person_title ILIKE '%' || $3 || '%'))"
  );
  assert.deepEqual(w.values, [["US", "GB"], "founder", "ceo"]);
});

test("startIdx offsets all placeholders", () => {
  const w = compile(cond("person_seniority", "equals", "vp"), 4);
  assert.equal(w.text, "(person_seniority = $4)");
});

test("unknown field rejected (injection via identifier)", () => {
  assert.throws(
    () => compile(cond("id; DROP TABLE persons; --", "equals", "x")),
    FilterError
  );
  assert.throws(() => compile(cond("pg_sleep(10)", "is_null")), FilterError);
});

test("unknown operator rejected", () => {
  assert.throws(() => compile(cond("person_name", "regex", ".*")), FilterError);
});

test("injection in a value stays a bound parameter", () => {
  const v = "x'; DROP TABLE persons; --";
  const w = compile(cond("person_name", "equals", v));
  assert.equal(w.text, "(person_name = $1)");
  assert.deepEqual(w.values, [v]);
  assert.ok(!w.text.includes("DROP"));
});

test("depth and size limits enforced", () => {
  let deep: unknown = cond("person_name", "is_null");
  for (let i = 0; i < 6; i++) deep = { op: "AND", conditions: [deep] };
  assert.throws(() => compile(deep), FilterError);

  const wide = {
    op: "AND",
    conditions: Array.from({ length: 51 }, () => ({
      field: "person_name",
      operator: "is_null",
    })),
  };
  assert.throws(() => compile(wide), FilterError);
});

test("malformed group rejected", () => {
  assert.throws(() => compile({ op: "XOR", conditions: [] }), FilterError);
  assert.throws(() => compile({ conditions: [] }), FilterError);
  assert.throws(() => compile("garbage"), FilterError);
});
