'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { BE_STATUS, DOSSIER_ITEMS, DOSSIER_STATUS, GMP_BY, ORDER_STATUSES, SHIPMENT_DOCS, STAGES } from '@/lib/format';
import { hashPassword } from '@/lib/password';
import { SERVICES } from '@/lib/mfr';
import { renderInvoice, totals, money, type InvoiceData } from '@/lib/invoice';

// Every action re-checks the team member's permission here, and the team role in the database (RLS policies / definer functions).

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
  await requireTeam('requests');
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
  await requireTeam('requests');
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
  await requireTeam('requests');
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
  await requireTeam('requests');
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
  await requireTeam('requests');
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

/** Answer an expert question; the customer is told by email and WhatsApp and sees it on the Ask the expert page. */
export async function answerQuestion(f: FormData) {
  await requireTeam('questions');
  const id = int(f, 'question_id'), answer = str(f, 'answer', 4000);
  if (!answer) back('/admin?tab=questions', { error: 'Write an answer.' });
  await team(async (db, uid) => {
    const q = await one(db, `update expert_questions set answer = $2, answered_by = $3, answered_at = now() where id = $1 returning user_id`, [id, answer, uid]);
    if (q) {
      await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', 'Your question is answered', $2),
                      ($1, 'whatsapp', 'Your question is answered', $2)`, [q.user_id, answer.slice(0, 500)]);
      await db.query(`insert into feed_items (kind, title, link, user_id) values ('request', 'Our expert answered your question', '/expert', $1)`, [q.user_id]);
    }
  }, '/admin?tab=questions');
  redirect('/admin?tab=questions&saved=1');
}

// ---------------------------------------------------------------- manufacturers
export async function reviewManufacturer(f: FormData) {
  await requireTeam('manufacturers');
  const user = str(f, 'user_id', 40), approve = str(f, 'decision', 10) === 'approve';
  await team(async (db) => {
    await db.query(`update manufacturer_profiles set status = $2, team_note = nullif($3, ''), reviewed_at = now() where user_id = $1`,
      [user, approve ? 'approved' : 'rejected', str(f, 'note', 300)]);
    await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3)`,
      [user, approve ? 'Your company is approved' : 'About your Nazryx account',
       approve ? 'Partner introductions are now open in your portal.' : str(f, 'note', 300) || 'Our team will be in touch.']);
  }, '/admin?tab=manufacturers');
  redirect('/admin?tab=manufacturers&saved=1');
}

export async function setEngagementStage(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!, stage = str(f, 'stage', 60), status = str(f, 'status', 12);
  const to = `/admin/engagements/${id}`;
  await team(async (db) => {
    const e = await one(db, 'select user_id, kind, stage from engagements where id = $1', [id]);
    if (!e) back(to, { error: 'Not found' });
    if (!SERVICES[e!.kind].milestones.includes(stage) || !['open', 'done', 'cancelled'].includes(status)) back(to, { error: 'Unknown stage' });
    await db.query('update engagements set stage = $2, status = $3, updated_at = now() where id = $1', [id, stage, status]);
    if (e!.stage !== stage) {
      await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3), ($1, 'whatsapp', $2, $3)`,
        [e!.user_id, `${SERVICES[e!.kind].label}: ${stage}`, `Your ${SERVICES[e!.kind].label.toLowerCase()} (#${id}) is now at "${stage}".`]);
    }
  }, to);
  redirect(`${to}?saved=1`);
}

export async function reviewEngagementFile(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!, file = int(f, 'file_id'), review = str(f, 'review', 12);
  const to = `/admin/engagements/${id}`;
  if (!['submitted', 'accepted', 'gap'].includes(review)) back(to, { error: 'Pick accepted or gap.' });
  await team(async (db) => {
    await db.query('update engagement_files set review = $2, team_comment = nullif($3, \'\') where id = $1 and engagement_id = $4',
      [file, review, str(f, 'comment', 600), id]);
    await db.query('update engagements set updated_at = now() where id = $1', [id]);
  }, to);
  redirect(`${to}?saved=1`);
}

export async function addObligation(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!, to = `/admin/engagements/${id}`;
  const kind = str(f, 'kind', 20), due = str(f, 'due_date', 10);
  if (!['renewal', 'variation', 'safety_report', 'other'].includes(kind) || !due) back(to, { error: 'Pick a type and a due date.' });
  await team(async (db) => {
    const e = await one(db, 'select user_id, country from engagements where id = $1', [id]);
    await db.query(`insert into obligations (user_id, product_id, country, kind, due_date, note) values ($1, $2, $3, $4, $5, $6)`,
      [e!.user_id, int(f, 'product_id'), str(f, 'country', 2) || e!.country, kind, due, str(f, 'note', 300) || null]);
  }, to);
  redirect(`${to}?saved=1`);
}

export async function toggleObligation(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!, to = `/admin/engagements/${id}`;
  await team((db) => db.query('update obligations set done = not done where id = $1', [int(f, 'obligation_id')]), to);
  redirect(to);
}

// ---------------------------------------------------------------- claims and accounts
export async function reviewClaim(f: FormData) {
  await requireTeam('claims');
  await team((db) => db.query('select review_claim($1, $2, $3)', [int(f, 'claim_id'), str(f, 'decision') === 'approve', str(f, 'note', 500) || null]),
    '/admin?tab=claims');
  redirect('/admin?tab=claims');
}

export async function setPlan(f: FormData) {
  await requireTeam('accounts');
  await team((db) => db.query('select admin_set_plan($1, $2)', [str(f, 'user_id', 40), str(f, 'plan', 10) === 'paid' ? 'paid' : 'free']), '/admin?tab=accounts');
  redirect('/admin?tab=accounts');
}

export async function grantCredits(f: FormData) {
  await requireTeam('accounts');
  const n = Math.min(500, Math.max(1, int(f, 'credits') ?? 0));
  await team((db) => db.query('select admin_grant_credits($1, $2)', [str(f, 'user_id', 40), n]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts');
}

// ---------------------------------------------------------------- content
export async function postRegulatory(f: FormData) {
  await requireTeam('content');
  const t = str(f, 'title', 200);
  if (!t) back('/admin?tab=content', { error: 'Add a headline.' });
  await team((db) => db.query(`insert into feed_items (kind, title, body, link) values ('regulatory', $1, $2, $3)`,
    [t, str(f, 'body', 2000) || null, str(f, 'link', 300) || null]), '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

/** Typical months per registration route (shown to paid plans on molecule pages). */
export async function saveRoutes(f: FormData) {
  await requireTeam('content');
  await team(async (db) => {
    for (const key of ['full', 'abridged', 'eac']) {
      const lo = int(f, `low_${key}`), hi = int(f, `high_${key}`);
      if (lo !== null && hi !== null && hi < lo) back('/admin?tab=content', { error: 'Months: high must be at least low.' });
      await db.query('update registration_routes set months_low = $2, months_high = $3, description = coalesce(nullif($4, \'\'), description) where key = $1',
        [key, lo, hi ?? lo, str(f, `desc_${key}`, 300)]);
    }
  }, '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

/** Set the likely route for one molecule (overrides the default full dossier). */
export async function setMoleculeRoute(f: FormData) {
  await requireTeam('content');
  await team(async (db) => {
    const m = await one(db, 'select id from molecules where lower(inn) = lower($1)', [str(f, 'molecule', 200)]);
    if (!m) back('/admin?tab=content', { error: 'Molecule not found. Use the exact name.' });
    const route = str(f, 'route', 20);
    if (!route) { await db.query('delete from molecule_routes where molecule_id = $1', [m!.id]); return; }
    await db.query(`insert into molecule_routes (molecule_id, route_key, note, updated_at) values ($1, $2, $3, now())
                    on conflict (molecule_id) do update set route_key = excluded.route_key, note = excluded.note, updated_at = now()`,
      [m!.id, route, str(f, 'note', 300) || null]);
  }, '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

export async function addPrice(f: FormData) {
  await requireTeam('content');
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
  await requireTeam('content');
  await team(async (db) => {
    const r = await db.query('update molecules set use_case = $2 where lower(inn) = lower($1)', [str(f, 'molecule', 200), str(f, 'use_case', 1000)]);
    if (!r.rowCount) back('/admin?tab=content', { error: 'Molecule not found. Use the exact name.' });
  }, '/admin?tab=content');
  redirect('/admin?tab=content&saved=1');
}

// ---------------------------------------------------------------- review queue (applied by a recompute job)
export async function matchMolecule(f: FormData) {
  await requireTeam('data');
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
  await requireTeam('data');
  await team((db) => db.query('select team_reject_suggestion($1)', [int(f, 'from')]), '/admin?tab=review');
  redirect('/admin?tab=review');
}

export async function mergeCompanies(f: FormData) {
  await requireTeam('data');
  await team((db) => db.query('select team_merge_companies($1, $2)', [str(f, 'keep', 200), str(f, 'merge', 200)]), '/admin?tab=review');
  redirect('/admin?tab=review&saved=1');
}

export async function keepSeparate(f: FormData) {
  await requireTeam('data');
  await team((db) => db.query('select team_keep_separate($1, $2)', [str(f, 'a', 200), str(f, 'b', 200)]), '/admin?tab=review');
  redirect('/admin?tab=review');
}

export async function queueRecompute() {
  await requireTeam('data');
  await team((db) => db.query('select team_queue_recompute()'), '/admin');
  redirect('/admin?queued=1');
}

export async function resetPassword(f: FormData) {
  await requireTeam('accounts');
  const pw = String(f.get('password') ?? '');
  if (pw.length < 10) back('/admin?tab=accounts', { error: 'Temporary password: at least 10 characters.' });
  await team((db) => db.query('select admin_reset_password($1, $2)', [str(f, 'user_id', 40), hashPassword(pw)]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts&saved=1');
}

export async function resetTwoStep(f: FormData) {
  await requireTeam('accounts');
  await team((db) => db.query('select admin_reset_totp($1)', [str(f, 'user_id', 40)]), '/admin?tab=accounts');
  redirect('/admin?tab=accounts&saved=1');
}

/** Admin > Data updates > Sources: run a collector now, switch it off or on, or use a pull that was held. */
export async function updateSource(f: FormData) {
  await requireTeam('data');
  const key = str(f, 'key', 40), act = str(f, 'act', 20);
  const sql = act === 'run' ? 'update data_sources set run_now = true where key = $1'
    : act === 'use_held' ? 'update data_sources set release_held = true where key = $1 and held_path is not null'
    : act === 'off' ? 'update data_sources set enabled = false where key = $1'
    : 'update data_sources set enabled = true where key = $1';
  await team((db) => db.query(sql, [key]), '/admin?tab=data');
  redirect('/admin?tab=data&saved=1#sources');
}


/** The team's cost assumptions per market for the margin check (shares entered as percentages). */
export async function saveMarketCosts(f: FormData) {
  await requireTeam('data');
  const share = (k: string) => Math.min(5, Math.max(0, Number(str(f, k, 10)) / 100 || 0));
  await team((db) => db.query(`update market_costs set freight = $2, duty = $3, distributor = $4, pharmacy = $5, vat = $6, updated_at = now()
    where country = $1`, [str(f, 'country', 2), share('freight'), share('duty'), share('distributor'), share('pharmacy'), share('vat')]), '/admin?tab=data');
  redirect('/admin?tab=data&saved=1#costs');
}

// ---------------------------------------------------------------- billing
/** Our details printed on every invoice and order confirmation, and how invoices go out. */
export async function saveInvoiceSettings(f: FormData) {
  await requireTeam('accounts');
  const prefix = str(f, 'prefix', 10).toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'NZX';
  await team((db) => db.query(`update invoice_settings set issuer = $1, address = nullif($2, ''), tax_id = nullif($3, ''), email = $4,
      phone = nullif($5, ''), payment_details = nullif($6, ''), footer = nullif($7, ''), terms_days = $8, prefix = $9, recurring = $10,
      updated_at = now() where id = 1`,
    [str(f, 'issuer', 200) || 'Nazryx', str(f, 'address', 400), str(f, 'tax_id', 80), str(f, 'email', 120) || 'contact@nazryx.com',
      str(f, 'phone', 60), str(f, 'payment_details', 1000), str(f, 'footer', 600), Math.min(120, Math.max(0, int(f, 'terms_days') ?? 14)),
      prefix, f.get('recurring') === 'on']), '/admin?tab=billing');
  redirect('/admin?tab=billing&saved=1');
}

/** An invoice for any account: written out by the worker within a minute and filed in the customer's documents. */
export async function createInvoice(f: FormData) {
  await requireTeam('accounts');
  const to = '/admin?tab=billing';
  const lines = [0, 1, 2, 3, 4].map((i) => ({
    text: str(f, `text_${i}`, 200), qty: Number(str(f, `qty_${i}`, 10) || 1), unit: Number(str(f, `unit_${i}`, 20).replace(/,/g, '')),
  })).filter((l) => l.text);
  if (!lines.length) back(to, { error: 'Add at least one line.' });
  if (lines.some((l) => !Number.isFinite(l.unit) || l.unit < 0 || !Number.isFinite(l.qty) || l.qty <= 0)) back(to, { error: 'Check the quantities and prices.' });
  const currency = ['usd', 'eur', 'gbp'].includes(str(f, 'currency', 3)) ? str(f, 'currency', 3) : 'usd';
  await team(async (db, uid) => {
    const who = await one(db, 'select id from users where id::text = $1 or lower(email) = lower($1)', [str(f, 'account', 200)]);
    if (!who) back(to, { error: 'No account with that email.' });
    await db.query(`insert into invoice_orders (user_id, lines, currency, note, paid, created_by) values ($1, $2, $3, nullif($4, ''), $5, $6)`,
      [who.id, JSON.stringify(lines.map((l) => ({ text: l.text, qty: l.qty, unit_cents: Math.round(l.unit * 100) }))), currency,
        str(f, 'note', 600), f.get('paid') === 'on', uid]);
  }, to);
  redirect(`${to}&queued=1`);
}

export async function markInvoicePaid(f: FormData) {
  await requireTeam('accounts');
  const paid = f.get('paid') === '1';
  await team((db) => db.query(`update invoices set status = $2, paid_at = case when $2 = 'paid' then now() else null end where number = $1`,
    [str(f, 'number', 40), paid ? 'paid' : 'due']), '/admin?tab=billing');
  redirect('/admin?tab=billing&saved=1');
}

/** The invoice maker: saves the invoice (any customer, in or outside the portal) with its A4 page; optionally files it
 *  in a portal account's documents. Returns the number it was saved under. */
export async function saveMadeInvoice(data: InvoiceData, opts: { file: boolean; status: 'due' | 'paid' }): Promise<{ number?: string; error?: string }> {
  const u = await requireTeam('accounts');
  if (!data?.to?.name?.trim() && !data?.to?.company?.trim()) return { error: 'Add who it is for.' };
  if (!data.lines?.some((l) => l.text?.trim())) return { error: 'Add at least one line.' };
  try {
    return await withUser(u.id, async (db) => {
      const st = await one(db, 'select prefix from invoice_settings where id = 1');
      let number = (data.number || '').trim().slice(0, 40);
      const year = (data.issued || new Date().toISOString()).slice(0, 4);
      if (!number) {
        const n = await one(db, `select count(*)::int + 1 as n from invoices where extract(year from issued_at) = $1`, [Number(year)]);
        number = `${st?.prefix ?? 'NZX'}-${year}-${String(n.n).padStart(4, '0')}`;
        while (await one(db, 'select 1 from invoices where number = $1', [number])) number = number.replace(/(\d+)$/, (m) => String(Number(m) + 1).padStart(4, '0'));
      } else if (await one(db, 'select 1 from invoices where number = $1', [number])) {
        return { error: `Number ${number} is already used. Change it, or leave it empty for the next one.` };
      }
      const doc = { ...data, number };
      const html = renderInvoice(doc);
      const t = totals(doc);
      const acc = data.to.email ? await one(db, 'select id from users where lower(email) = lower($1)', [data.to.email.trim()]) : null;
      let docId: number | null = null;
      if (opts.file && acc) {
        const f = await one(db, 'insert into stored_files (name, size, data, uploaded_by) values ($1, $2, $3, $4) returning id',
          [`${data.kind} ${number}.html`, Buffer.byteLength(html), Buffer.from(html), u.id]);
        docId = (await one(db, `insert into account_documents (user_id, kind, title, file_path, file_name, uploaded_by)
                                values ($1, 'invoice', $2, $3, $4, $5) returning id`,
          [acc.id, `${data.kind} ${number}`, `db:${f.id}`, `${data.kind} ${number}.html`, u.id])).id;
        await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3)`,
          [acc.id, `${data.kind} ${number}`, `${data.kind} ${number} for ${money(t.balance, doc)} is in Settings, Documents.`]);
      }
      await db.query(`insert into invoices (number, user_id, plan, amount_cents, currency, status, issued_at, due_at, document_id, lines,
                        paid_at, kind, bill_to, data, html, created_by)
                      values ($1, $2, null, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [number, acc?.id ?? null, Math.round(t.total * 100), data.currency.toLowerCase().slice(0, 3), opts.status,
          data.issued || new Date().toISOString().slice(0, 10), data.due || null, docId, JSON.stringify(data.lines),
          opts.status === 'paid' ? new Date() : null, data.kind.slice(0, 40), (data.to.company || data.to.name).slice(0, 200),
          JSON.stringify(doc), html, u.id]);
      return { number };
    });
  } catch (e) {
    return { error: dbMessage(e) };
  }
}

export async function deleteInvoice(f: FormData) {
  await requireTeam('accounts');
  await team((db) => db.query("delete from invoices where number = $1 and plan is null and created_by is not null", [str(f, 'number', 40)]), '/admin?tab=billing');
  redirect('/admin?tab=billing&saved=1');
}
