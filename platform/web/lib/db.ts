import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// The app connects as the restricted role `nazryx_app`. Row-level security in Postgres decides what each
// signed-in user can read; every query runs inside withUser(), which sets app.user_id for the transaction.
const g = globalThis as unknown as { __nzxPool?: Pool };
export const pool: Pool =
  g.__nzxPool ?? (g.__nzxPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

export type Db = PoolClient;

export async function withUser<T>(userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId ?? '']);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function rows<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends QueryResultRow = any>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

/** Postgres RAISE EXCEPTION messages are written for people (e.g. plan limits); pass them through. */
export function dbMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err?.code === 'P0001' && err.message) return err.message;
  if (err?.code === '23505') return 'That already exists.';
  return 'Something went wrong. Please try again.';
}
