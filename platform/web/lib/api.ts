import { createHash } from 'crypto';
import { pool, withUser } from './db';
import { TIER, canUse } from './mfr';

// The read API (Complete Market Access and up): a bearer key resolves to its account, and every query runs as that
// account under the same row security as the portal. Plain JSON, no pagination beyond a limit.
export type ApiUser = { id: string; tier: number; markets: string[]; language: string };

const WINDOW = 60_000, LIMIT = 120;   // calls per key per minute
const hits = new Map<string, { n: number; at: number }>();

export async function apiUser(req: Request): Promise<{ u: ApiUser } | { error: Response }> {
  const auth = req.headers.get('authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : new URL(req.url).searchParams.get('key') ?? '';
  if (!key.startsWith('nzx_')) return { error: json({ error: 'A key is required: Authorization: Bearer nzx_…' }, 401) };
  const hash = createHash('sha256').update(key).digest('hex');
  const now = Date.now(), h = hits.get(hash);
  if (h && now - h.at < WINDOW && h.n >= LIMIT) return { error: json({ error: `Rate limit: ${LIMIT} calls a minute.` }, 429) };
  hits.set(hash, h && now - h.at < WINDOW ? { n: h.n + 1, at: h.at } : { n: 1, at: now });
  const uid = (await pool.query('select api_key_user($1) as id', [hash])).rows[0]?.id as string | null;
  if (!uid) return { error: json({ error: 'Unknown or revoked key.' }, 401) };
  const row = await withUser(uid, async (db) => (await db.query(`
      select u.language, case when u.role = 'team' then 3 when mp.active_plan = 'data' then 1 when mp.active_plan = 'access' then 2 when mp.active_plan = 'entry' then 3 else 0 end as tier,
             case when mp.active_plan = 'entry' or u.role = 'team' or (mp.active_plan is not null and cardinality(coalesce(mp.paid_markets, '{}')) = 0)
                  then (select array_agg(code) from countries where enabled) else coalesce(mp.paid_markets, '{}') end as markets   -- no markets recorded: a plan from before markets were priced covers all
      from users u left join manufacturer_profiles mp on mp.user_id = u.id where u.id = $1`, [uid])).rows[0]);
  if (!row || row.tier < TIER.access) return { error: json({ error: 'The API is part of Complete Market Access.' }, 403) };
  pool.query('select api_key_touch($1)', [hash]).catch(() => {});
  return { u: { id: uid, tier: row.tier, markets: row.markets ?? [], language: row.language } };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

/** The market a call asks for, if the key's plan covers it. */
export function marketOf(req: Request, u: ApiUser): string | Response {
  const m = (new URL(req.url).searchParams.get('market') ?? '').toUpperCase().slice(0, 2);
  if (!m) return json({ error: 'market is required, e.g. market=TZ' }, 400);
  if (!u.markets.includes(m)) return json({ error: `${m} is not in this plan. Markets: ${u.markets.join(', ') || 'none'}.` }, 403);
  return m;
}

export const allowed = (u: ApiUser, feature: string) => canUse(u.tier, feature);
