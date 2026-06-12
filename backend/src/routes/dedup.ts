import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { findDuplicateGroups, mergeGroup, type DedupKey } from "../dedup/dedup.js";

export const dedupRouter = Router();

const listSchema = z.object({
  key: z.enum(["email", "linkedin", "name_org"]).default("email"),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Columns shown in the dedup review UI for each group member.
const MEMBER_COLUMNS = [
  "id",
  "person_name",
  "person_title",
  "organization_name",
  "person_email",
  "person_linkedin_url",
  "location_country",
  "tags",
  "created_at",
] as const;

dedupRouter.get("/dedup", async (req: Request, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "bad dedup query" });
    return;
  }
  try {
    const { groups, nextCursor } = await findDuplicateGroups(
      parsed.data.key as DedupKey,
      parsed.data.cursor,
      parsed.data.limit
    );

    // One fetch for all members of the returned groups.
    const allIds = groups.flatMap((g) => g.ids);
    const members = new Map<number, Record<string, unknown>>();
    if (allIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT ${MEMBER_COLUMNS.join(", ")} FROM persons WHERE id = ANY($1) ORDER BY id`,
        [allIds]
      );
      for (const r of rows) members.set(Number(r.id), r);
    }

    res.json({
      groups: groups.map((g) => ({
        key: g.key,
        count: g.count,
        members: g.ids.map((id) => members.get(id)).filter(Boolean),
      })),
      nextCursor,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "57014") {
      res.status(504).json({ error: "duplicate scan timed out — try a more selective key" });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

const mergeSchema = z.object({
  survivorId: z.number().int().positive(),
  mergeIds: z.array(z.number().int().positive()).min(1).max(100),
});

dedupRouter.post("/dedup/merge", async (req: Request, res: Response) => {
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "survivorId and mergeIds required" });
    return;
  }
  const { survivorId, mergeIds } = parsed.data;
  if (mergeIds.includes(survivorId)) {
    res.status(400).json({ error: "survivor cannot be in mergeIds" });
    return;
  }
  try {
    const person = await mergeGroup(survivorId, mergeIds);
    res.json({ person, merged: mergeIds.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
