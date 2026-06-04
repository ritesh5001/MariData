import { pool } from "../db/pool.js";

export interface ImportJob {
  id: number;
  filename: string | null;
  mode: string;
  status: string;
  stage: string | null;
  rows_staged: number;
  rows_inserted: number;
  rows_conflicted: number;
  rows_errored: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export async function createJob(
  filename: string | null,
  mode: string
): Promise<ImportJob> {
  const { rows } = await pool.query<ImportJob>(
    `INSERT INTO import_jobs (filename, mode, status, stage)
     VALUES ($1, $2, 'running', 'staging') RETURNING *`,
    [filename, mode]
  );
  return rows[0]!;
}

export async function setStage(id: number, stage: string): Promise<void> {
  await pool.query(`UPDATE import_jobs SET stage = $2 WHERE id = $1`, [id, stage]);
}

export async function completeJob(
  id: number,
  counts: {
    rowsStaged: number;
    rowsInserted: number;
    rowsConflicted: number;
    rowsErrored: number;
  }
): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
       SET status = 'completed', stage = 'done',
           rows_staged = $2, rows_inserted = $3, rows_conflicted = $4, rows_errored = $5,
           finished_at = now()
     WHERE id = $1`,
    [
      id,
      counts.rowsStaged,
      counts.rowsInserted,
      counts.rowsConflicted,
      counts.rowsErrored,
    ]
  );
}

export async function failJob(id: number, message: string): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
       SET status = 'failed', error_message = $2, finished_at = now()
     WHERE id = $1`,
    [id, message]
  );
}

export async function getJob(id: number): Promise<ImportJob | null> {
  const { rows } = await pool.query<ImportJob>(
    `SELECT * FROM import_jobs WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listJobs(limit = 50): Promise<ImportJob[]> {
  const { rows } = await pool.query<ImportJob>(
    `SELECT * FROM import_jobs ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
