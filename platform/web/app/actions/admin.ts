'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { STAGES, ORDER_STATUSES } from '@/lib/format';
import { hashPassword } from '@/lib/password';

// Every action re-checks the team role here AND in the database (RLS policies / definer functions).

async function team<T>(fn: (db: Parameters<Parameters<typeof withUser>[1]>[0], uid: string) => Promise<T>, onError: string) {
  const u = await requireTeam();
  try {
    return await withUser(u.id, (db) => fn(db, u.id));
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    back(onError, { error: dbMessage(e) });
  }
}

async function notifyCustomer(db: any, requestId: number, subject: string, body: string) {
  const r = await one(db, 'select user_id from requests where id = $1', [requestId]);
  if (!r) return;
  await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3), ($1, 'whatsapp', $2, $3)`,
    [r.user_id, subject, body]);
  await db.query(`insert into feed_items (kind, title, link, user_id) values ('request', $1, $2, $3)`,
    [`${subject} on request #${requestId}`, `/requests/${requestId}`, r.user_id]);
}

// ---------------------------------------------------------------- requests
export async function setStage(f: FormData) {
  const id = int(f, 'request_id')!, stage = str(f, 'stage', 30);
  const to = `/admin/requests/${id}`;
  if (!STAGES.includes(stage as any)) back(to, { error: 'Unknown stage' });
  await team(async (db, uid) => {
    await db.query('update requests set stage = $2, updated_at = now(), closed_reason = case when $2 = $3 then $4 else null end where id = $1',
      [id, stage, 'Closed', str(f, 'closed_reason', 200) || 'Closed by Nazryx']);
    await db.query('insert into request_stage_history (request_id, stage, changed_by) values ($1, $2, $3)', [id, stage, uid]);
    await notifyCustomer(db, id, `Stage: ${stage}`, `Your request #${id} is now at "${stage}".`);
  }, to);
  redirect(to);
}

export async function addOfferAndQuote(f: FormData) {
  const id = int(f, 'request_id')!;
  const to = `/admin/requests/${id}`;
  await team(async (db) => {
    let supplierId = int(f, 'supplier_id');
    if (!supplierId) {
      const name = str(f, 'supplier_name', 200);
      if (!name) back(to, { error: 'Pick a supplier or add a new one.' });
      const s = await one(db, 'insert into suppliers (name, country, contact) values ($1, $2, $3) returning id',
        [name, str(f, 'supplier_country', 80) || null, str(f, 'supplier_contact', 300) || null]);
      supplierId = s!.id;
      const notes = str(f, 'supplier_notes', 2000);
      if (notes) await db.query('insert into supplier_notes (supplier_id, notes) values ($1, $2)', [supplierId, notes]);
    }
    const req = await one(db, 'select molecule_id from requests where id = $1', [id]);
    const price = str(f, 'price', 30);
    const offer = await one(db, `insert into supplier_offers (supplier_id, molecule_id, price, currency, unit, moq, lead_time_weeks, certs)
                                 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [supplierId, req?.molecule_id ?? null, price ? Number(price) : null, str(f, 'currency', 3) || 'USD', str(f, 'unit', 40) || null,
       str(f, 'moq', 60) || null, int(f, 'lead_time_weeks'), str(f, 'certs', 200) || null]);
    const n = await one(db, 'select count(*)::int as n from quotes where request_id = $1', [id]);
    const label = `Supplier ${String.fromCharCode(65 + (n?.n ?? 0))}`;
    const pvt = str(f, 'price_vs_target', 10);
    await db.query(`insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target)
                    values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, offer!.id, label, str(f, 'moq', 60) || null, int(f, 'lead_time_weeks'), str(f, 'certs', 200) || null,
       ['below', 'at', 'above'].includes(pvt) ? pvt : null]);
  }, to);
  redirect(to);
}

export async function setOrderStatus(f: FormData) {
  const id = int(f, 'request_id')!, order = int(f, 'order_id'), status = str(f, 'status', 30);
  const to = `/admin/requests/${id}`;
  if (!ORDER_STATUSES.includes(status as any)) back(to, { error: 'Unknown status' });
  await team(async (db) => {
    await db.query('update orders set status = $2, updated_at = now() where id = $1', [order, status]);
    await notifyCustomer(db, id, `Order ${status}`, `Order ${order} for request #${id}: ${status}.`);
  }, to);
  redirect(to);
}

// ---------------------------------------------------------------- claims and accounts
export async function reviewClaim(f: FormData) {
  await team((db) => db.query('select review_claim($1, $2, $3)', [int(f, 'claim_id'), str(f, 'decision') === 'approve', str(f, 'note', 500) || null]),
    '/admin?tab=claims');
  redirect('/admin?tab=claims');
}

export async function setPlan(f: FormData) {
  await team((db) => db.query('select admin_set_plan($1, $2)', [str(f, 'user_id', 40), str(f, 'plan', 10) === 'paid' ? 'paid' : 'free']), '/admin?tab=accounts');
  redirect('/admin?tab=accounts');
}

export async function grantCredits(f: FormData) {
  const n = Math.min(500, Math.max(1, int(f, 'credits') ?? 0));
  await team((db) => db.query('select admin_grant_credits($1, $2)', [str(f, 'user_id', 40), n]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts');
}

// ---------------------------------------------------------------- content
export async function postRegulatory(f: FormData) {
  const t = str(f, 'title', 200);
  if (!t) back('/admin?tab=content', { error: 'Add a headline.' });
  await team((db) => db.query(`insert into feed_items (kind, title, body, link) values ('regulatory', $1, $2, $3)`,
    [t, str(f, 'body', 2000) || null, str(f, 'link', 300) || null]), '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

export async function addPrice(f: FormData) {
  await team(async (db, uid) => {
    const m = await one(db, 'select id from molecules where lower(inn) = lower($1)', [str(f, 'molecule', 200)]);
    if (!m) back('/admin?tab=content', { error: 'Molecule not found. Use the exact name.' });
    const lo = Number(str(f, 'low', 20)), hi = Number(str(f, 'high', 20));
    if (!(lo > 0 && hi >= lo)) back('/admin?tab=content', { error: 'Low and high must be positive, high ≥ low.' });
    await db.query(`insert into market_prices (country, molecule_id, price_low, price_high, currency, unit, created_by)
                    values ('TZ', $1, $2, $3, $4, $5, $6)`, [m!.id, lo, hi, str(f, 'currency', 3) || 'USD', str(f, 'unit', 40) || 'pack', uid]);
  }, '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

export async function editUseCase(f: FormData) {
  await team(async (db) => {
    const r = await db.query('update molecules set use_case = $2 where lower(inn) = lower($1)', [str(f, 'molecule', 200), str(f, 'use_case', 1000)]);
    if (!r.rowCount) back('/admin?tab=content', { error: 'Molecule not found. Use the exact name.' });
  }, '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

// ---------------------------------------------------------------- review queue (applied by a recompute job)
export async function matchMolecule(f: FormData) {
  await team(async (db) => {
    let target = int(f, 'to');
    if (!target) {
      const m = await one(db, 'select id from molecules where lower(inn) = lower($1)', [str(f, 'to_name', 200)]);
      target = m?.id ?? null;
    }
    if (!target) back('/admin?tab=review', { error: 'Target molecule not found.' });
    await db.query('select team_match_molecule($1, $2)', [int(f, 'from'), target]);
  }, '/admin?tab=review');
  redirect('/admin?tab=review&saved=1');
}

export async function rejectSuggestion(f: FormData) {
  await team((db) => db.query('select team_reject_suggestion($1)', [int(f, 'from')]), '/admin?tab=review');
  redirect('/admin?tab=review');
}

export async function mergeCompanies(f: FormData) {
  await team((db) => db.query('select team_merge_companies($1, $2)', [str(f, 'keep', 200), str(f, 'merge', 200)]), '/admin?tab=review');
  redirect('/admin?tab=review&saved=1');
}

export async function keepSeparate(f: FormData) {
  await team((db) => db.query('select team_keep_separate($1, $2)', [str(f, 'a', 200), str(f, 'b', 200)]), '/admin?tab=review');
  redirect('/admin?tab=review');
}

export async function queueRecompute() {
  await team((db) => db.query('select team_queue_recompute()'), '/admin');
  redirect('/admin?queued=1');
}

export async function resetPassword(f: FormData) {
  const pw = String(f.get('password') ?? '');
  if (pw.length < 10) back('/admin?tab=accounts', { error: 'Temporary password: at least 10 characters.' });
  await team((db) => db.query('select admin_reset_password($1, $2)', [str(f, 'user_id', 40), hashPassword(pw)]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts&saved=1');
}
