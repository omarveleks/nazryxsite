'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { BE_STATUS, DOSSIER_ITEMS, DOSSIER_STATUS, GMP_BY, ORDER_STATUSES, SHIPMENT_DOCS, STAGES } from '@/lib/format';
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

const VERDICTS: Record<string, string> = { go: 'Go', maybe: 'Worth a look', no: 'Skip' };

/** Our assessment inside a request (regulatory check, regulatory analysis, pricing). Saving it moves a new request to
 *  "Regulatory check" and tells the customer. */
export async function saveEvaluation(f: FormData) {
  const id = int(f, 'request_id')!, verdict = str(f, 'verdict', 10), summary = str(f, 'summary', 1200);
  const to = `/admin/requests/${id}`;
  if (!VERDICTS[verdict]) back(to, { error: 'Pick a verdict.' });
  if (!summary) back(to, { error: 'Write why, in two or three lines.' });
  await team(async (db, uid) => {
    const had = await one(db, 'select 1 as x from request_evaluations where request_id = $1', [id]);
    await db.query(`insert into request_evaluations (request_id, verdict, summary, regulatory_check, supply, price_range, route, evaluated_by, evaluated_at)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, now())
                    on conflict (request_id) do update set verdict = excluded.verdict, summary = excluded.summary,
                      regulatory_check = excluded.regulatory_check, supply = excluded.supply, price_range = excluded.price_range,
                      route = excluded.route, evaluated_by = excluded.evaluated_by, evaluated_at = now()`,
      [id, verdict, summary, str(f, 'regulatory_check', 1200) || null, str(f, 'supply', 300) || null, str(f, 'price_range', 200) || null,
       str(f, 'route', 600) || null, uid]);
    const r = await one(db, 'select stage from requests where id = $1', [id]);
    if (r?.stage === 'Product request') {   // the assessment starts the regulatory check
      await db.query("update requests set stage = 'Regulatory check', updated_at = now() where id = $1", [id]);
      await db.query("insert into request_stage_history (request_id, stage, changed_by) values ($1, 'Regulatory check', $2)", [id, uid]);
    } else {
      await db.query('update requests set updated_at = now() where id = $1', [id]);
    }
    await notifyCustomer(db, id, had ? 'Assessment updated' : 'Assessment ready',
      `Our assessment of request #${id}: ${VERDICTS[verdict]}. ${summary}`);
  }, to);
  redirect(`${to}?saved=1`);
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
    const shelf = int(f, 'shelf_life_pct'), stype = str(f, 'supplier_type', 20);
    await db.query(`insert into quotes (request_id, supplier_offer_id, label, moq, lead_time_weeks, certs, price_vs_target,
                                        payment_terms, shelf_life_pct, gmp_by, supplier_type, exclusive)
                    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, offer!.id, label, str(f, 'moq', 60) || null, int(f, 'lead_time_weeks'), str(f, 'certs', 200) || null,
       ['below', 'at', 'above'].includes(pvt) ? pvt : null, str(f, 'payment_terms', 200) || null,
       shelf !== null && shelf >= 0 && shelf <= 100 ? shelf : null, GMP_BY.includes(str(f, 'gmp_by', 80)) ? str(f, 'gmp_by', 80) : null,
       ['manufacturer', 'trader'].includes(stype) ? stype : null, f.get('exclusive') === 'on']);
  }, to);
  redirect(to);
}

export async function setOrderStatus(f: FormData) {
  const id = int(f, 'request_id')!, order = int(f, 'order_id'), status = str(f, 'status', 30);
  const to = `/admin/requests/${id}`;
  if (!ORDER_STATUSES.includes(status as any)) back(to, { error: 'Unknown status' });
  const eta = str(f, 'eta', 10);
  await team(async (db) => {
    const before = await one(db, 'select status from orders where id = $1', [order]);
    await db.query('update orders set status = $2, eta = $3, updated_at = now() where id = $1', [order, status, eta || null]);
    for (const [doc] of SHIPMENT_DOCS) {
      await db.query(`insert into shipment_documents (order_id, doc, ready) values ($1, $2, $3)
                      on conflict (order_id, doc) do update set ready = excluded.ready,
                        updated_at = case when shipment_documents.ready is distinct from excluded.ready then now() else shipment_documents.updated_at end`,
        [order, doc, f.get(`doc_${doc}`) === 'on']);
    }
    if (before?.status !== status) {
      await notifyCustomer(db, id, `Shipment ${status}`, `Shipment #${order} for request #${id}: ${status}.`);
    }
  }, to);
  redirect(`${to}?saved=1`);
}

/** Dossier readiness: each item the supplier's dossier needs, and the bioequivalence call. */
export async function saveDossier(f: FormData) {
  const id = int(f, 'request_id')!;
  const to = `/admin/requests/${id}`;
  const be = str(f, 'be_status', 20);
  await team(async (db, uid) => {
    await db.query(`insert into request_dossier (request_id, be_status, be_note, updated_at) values ($1, $2, $3, now())
                    on conflict (request_id) do update set be_status = excluded.be_status, be_note = excluded.be_note, updated_at = now()`,
      [id, BE_STATUS[be] ? be : null, str(f, 'be_note', 400) || null]);
    for (const [item] of DOSSIER_ITEMS) {
      const st = str(f, `item_${item}`, 20), note = str(f, `note_${item}`, 300) || null;
      if (!DOSSIER_STATUS[st]) {
        await db.query('delete from dossier_items where request_id = $1 and item = $2', [id, item]);
        continue;
      }
      await db.query(`insert into dossier_items (request_id, item, status, note, updated_by, updated_at) values ($1, $2, $3, $4, $5, now())
                      on conflict (request_id, item) do update set status = excluded.status, note = excluded.note,
                        updated_by = excluded.updated_by, updated_at = now()`, [id, item, st, note, uid]);
    }
    await notifyCustomer(db, id, 'Dossier readiness updated', `We updated the dossier readiness for request #${id}.`);
  }, to);
  redirect(`${to}?saved=1`);
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
    const kind = str(f, 'kind', 12) === 'suggested' ? 'suggested' : 'observed';
    await db.query(`insert into market_prices (country, molecule_id, price_low, price_high, currency, unit, created_by, kind, note)
                    values ('TZ', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [m!.id, lo, hi, str(f, 'currency', 3) || 'USD', str(f, 'unit', 40) || 'pack', uid, kind, str(f, 'note', 300) || null]);
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

export async function resetTwoStep(f: FormData) {
  await team((db) => db.query('select admin_reset_totp($1)', [str(f, 'user_id', 40)]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts&saved=1');
}
