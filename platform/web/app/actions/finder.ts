'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { MFR_COUNTRIES, canUse, tierIn } from '@/lib/mfr';
import { PIPELINE_STAGES, finderParams, finderQuery } from '@/lib/finder';

const codes = MFR_COUNTRIES.map((c) => c.code);
const market = (f: FormData) => (codes.includes(str(f, 'market', 2)) ? str(f, 'market', 2) : 'TZ');

/** Keep a finder search: the worker runs it every hour and the inbox tells of molecules it finds anew. */
export async function saveSearch(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const m = market(f), p = finderParams(Object.fromEntries(f.entries()) as Record<string, string>);
  const to = `/m/finder?${finderQuery(m, p)}`;
  if (!canUse(tierIn(u, m), 'portfolio')) redirect('/m/plan?want=data');
  const name = str(f, 'name', 80) || 'My search';
  try {
    await withUser(u.id, async (db) => {
      const n = await one(db, 'select count(*)::int as n from saved_searches where user_id = $1', [u.id]);
      if ((n?.n ?? 0) >= 20) throw new Error('Twenty saved searches is the most; remove one first.');
      // the molecules it matches today are already known: only later arrivals are news
      const ids = (await db.query(`select molecule_id from find_opportunities($1, $2, $3, $4, $5, $6, $7, false, $8)`,
        [m, p.category, p.demand, p.max, p.essential, p.form, p.price, p.mine])).rows.map((r: any) => r.molecule_id);
      await db.query('insert into saved_searches (user_id, name, country, params, seen_ids, checked_at) values ($1, $2, $3, $4, $5, now())',
        [u.id, name, m, JSON.stringify(p), ids]);
    });
  } catch (e) {
    back(to, { error: e instanceof Error && !('code' in e) ? e.message : dbMessage(e) });
  }
  back(to, { saved: '1' });
}

export async function deleteSearch(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from saved_searches where user_id = $1 and id = $2', [u.id, int(f, 'id')]));
  back('/m/finder', { market: str(f, 'market', 2), saved: '1' });
}

/** Shortlist a distributor (by its profile code) in a market. Idempotent. */
export async function addToPipeline(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const m = market(f), code = str(f, 'code', 12).toUpperCase(), to = str(f, 'return', 200).startsWith('/') ? str(f, 'return', 200) : `/m/partners?market=${m}`;
  if (!/^[0-9A-F]{8}$/.test(code)) back(to, { error: 'Pick a distributor profile.' });
  if (!canUse(tierIn(u, m), 'portfolio')) redirect('/m/plan?want=data');
  try {
    await withUser(u.id, async (db) => {
      const c = await one(db, 'select partner_in_market($1, $2) as id', [m, code]);
      if (!c?.id) throw new Error('That distributor profile is not in this market.');
      await db.query(`insert into partner_pipeline (user_id, country, company_id) values ($1, $2, $3) on conflict (user_id, country, company_id) do nothing`, [u.id, m, c.id]);
    });
  } catch (e) {
    back(to, { error: e instanceof Error && !('code' in e) ? e.message : dbMessage(e) });
  }
  back(to, { saved: '1', tab: 'pipeline' });
}

/** Move a pipeline entry to a stage and keep a note. */
export async function movePipeline(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const m = market(f), id = int(f, 'id'), stage = str(f, 'stage', 20), note = str(f, 'note', 600);
  const to = `/m/partners?market=${m}&tab=pipeline`;
  if (!PIPELINE_STAGES.some(([k]) => k === stage)) back(to, { error: 'Pick a stage.' });
  await withUser(u.id, (db) => db.query('update partner_pipeline set stage = $3, note = nullif($4, \'\'), updated_at = now() where user_id = $1 and id = $2', [u.id, id, stage, note]));
  back(to, { saved: '1' });
}

export async function removeFromPipeline(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const m = market(f);
  await withUser(u.id, (db) => db.query('delete from partner_pipeline where user_id = $1 and id = $2', [u.id, int(f, 'id')]));
  back(`/m/partners?market=${m}&tab=pipeline`, { saved: '1' });
}
