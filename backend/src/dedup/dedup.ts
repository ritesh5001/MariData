import { pool } from "../db/pool.js";
import { EDITABLE_FIELDS } from "../persons/editableFields.js";

// Duplicate detection over three natural keys. Group queries keyset over the group key
// (no OFFSET) and run under a statement_timeout — on a huge table the GROUP BY is bounded
// by the btree indexes on email/linkedin; name+org may time out and report so.

export type DedupKey = "email" | "linkedin" | "name_org";

const KEY_EXPRS: Record<DedupKey, string> = {
  email: "person_email",
  linkedin: "person_linkedin_url",
  name_org: "person_name_downcase || ' @ ' || organization_name",
};

const KEY_NOT_NULL: Record<DedupKey, string> = {
  email: "person_email IS NOT NULL",
  linkedin: "person_linkedin_url IS NOT NULL",
  name_org: "person_name_downcase IS NOT NULL AND organization_name IS NOT NULL",
};

export interface DedupGroup {
  key: string;
  count: number;
  ids: number[];
}

export async function findDuplicateGroups(
  key: DedupKey,
  cursor: string | undefined,
  limit: number
): Promise<{ groups: DedupGroup[]; nextCursor: string | null }> {
  const expr = KEY_EXPRS[key];
  const values: unknown[] = [];
  let cursorCond = "";
  if (cursor !== undefined) {
    values.push(cursor);
    cursorCond = `AND ${expr} > $${values.length}`;
  }
  values.push(limit + 1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 10000");
    // Member ids are capped per group: review UIs show a sample; merge takes explicit ids.
    const { rows } = await client.query<{ key: string; count: number; ids: number[] }>(
      `SELECT ${expr} AS key, count(*)::bigint AS count,
              (array_agg(id ORDER BY id))[1:20] AS ids
       FROM persons
       WHERE ${KEY_NOT_NULL[key]} ${cursorCond}
       GROUP BY ${expr}
       HAVING count(*) > 1
       ORDER BY ${expr}
       LIMIT $${values.length}`,
      values
    );
    await client.query("COMMIT");

    const hasMore = rows.length > limit;
    const groups = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      key: r.key,
      count: Number(r.count),
      ids: r.ids.map(Number),
    }));
    return {
      groups,
      nextCursor: hasMore && groups.length > 0 ? groups[groups.length - 1]!.key : null,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Merge a duplicate group into one surviving row, atomically:
//  - lock all rows, verify they exist
//  - scalar fields: survivor keeps its value, else first non-null from the others
//    (newest first — highest id wins ties)
//  - array fields: union of all values, original order preserved
//  - delete the merged rows
export async function mergeGroup(
  survivorId: number,
  mergeIds: number[]
): Promise<Record<string, unknown>> {
  const allIds = [survivorId, ...mergeIds];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM persons WHERE id = ANY($1) FOR UPDATE",
      [allIds]
    );
    if (rows.length !== allIds.length) {
      throw new Error("one or more rows no longer exist");
    }
    const survivor = rows.find((r) => Number(r.id) === survivorId);
    if (!survivor) throw new Error("survivor row not found");
    const donors = rows
      .filter((r) => Number(r.id) !== survivorId)
      .sort((a, b) => Number(b.id) - Number(a.id));

    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [field, type] of Object.entries(EDITABLE_FIELDS)) {
      if (type === "array") {
        const union: string[] = [];
        for (const row of [survivor, ...donors]) {
          for (const v of (row[field] as string[] | null) ?? []) {
            if (!union.includes(v)) union.push(v);
          }
        }
        if (union.length > 0 && unionDiffers(survivor[field] as string[] | null, union)) {
          values.push(union);
          sets.push(`${field} = $${values.length}`);
        }
      } else if (survivor[field] == null) {
        const donor = donors.find((d) => d[field] != null);
        if (donor) {
          values.push(type === "jsonb" ? JSON.stringify(donor[field]) : donor[field]);
          sets.push(`${field} = $${values.length}${type === "jsonb" ? "::jsonb" : ""}`);
        }
      }
    }

    if (sets.length > 0) {
      values.push(survivorId);
      await client.query(
        `UPDATE persons SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values
      );
    }
    await client.query("DELETE FROM persons WHERE id = ANY($1)", [mergeIds]);
    const merged = await client.query("SELECT * FROM persons WHERE id = $1", [
      survivorId,
    ]);
    await client.query("COMMIT");
    return merged.rows[0] as Record<string, unknown>;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function unionDiffers(current: string[] | null, union: string[]): boolean {
  if (current == null) return true;
  return current.length !== union.length || union.some((v, i) => current[i] !== v);
}
