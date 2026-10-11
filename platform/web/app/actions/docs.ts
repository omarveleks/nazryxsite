'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { ACCOUNT_DOC_KINDS, ENGAGEMENT_DOC_ITEMS, SUPPLIER_DOC_KINDS, TEAM_REQUEST_KINDS, requestDocLabel } from '@/lib/docs';
import { DOSSIER_ITEMS, SHIPMENT_DOCS } from '@/lib/format';
import { saveUpload } from '@/lib/uploads';
import { MFR_PLANS, PLAN_ORDER, type PlanKey } from '@/lib/mfr';

// Team document uploads everywhere: requests, engagements, customer accounts and suppliers. Every action re-checks
// the team role here and in the database (RLS). Internal files are never visible to customers.

const safe = (v: string, fallback: string) => (v.startsWith('/') && !v.startsWith('//') ? v : fallback);
const isRedirect = (e: unknown) => Boolean((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT'));
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));

/** Save the uploaded file, then run `fn` with it as the team. Redirects back with an error on any failure. */
async function withFile(f: FormData, to: string, fn: (db: any, uid: string, file: { path: string; name: string }) => Promise<void>) {
  const u = await requireTeam();
  try {
    const saved = await saveUpload(f.get('file'), u.id);
    if (!saved) throw new Error('Choose a file.');
    await withUser(u.id, (db) => fn(db, u.id, saved));
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(to, { error: errText(e) });
  }
}

async function tellUser(db: any, userId: string, subject: string, body: string, link?: string) {
  await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3)`, [userId, subject, body]);
  if (link) await db.query(`insert into feed_items (kind, title, link, user_id) values ('request', $1, $2, $3)`, [subject, link, userId]);
}

// ---------------------------------------------------------------- requests
/** A document on a request. Dossier documents mark their item ready; shipment documents mark theirs received. */
export async function uploadRequestDoc(f: FormData) {
  await requireTeam('requests');
  const id = int(f, 'request_id')!;
  const to = safe(str(f, 'return', 200), `/admin/requests/${id}`);
  const kind = str(f, 'kind', 20), item = str(f, 'item', 20) || null, internal = f.get('internal') === 'on';
  if (!TEAM_REQUEST_KINDS.includes(kind)) back(to, { error: 'Pick what the document is.' });
  if (item && !DOSSIER_ITEMS.some(([k]) => k === item) && !SHIPMENT_DOCS.some(([k]) => k === item)) back(to, { error: 'Unknown item.' });
  await withFile(f, to, async (db, uid, file) => {
    const r = await one(db, 'select user_id from requests where id = $1', [id]);
    if (!r) throw new Error('Request not found.');
    await db.query(`insert into request_files (request_id, path, file_name, kind, item, note, internal, from_team, uploaded_by)
                    values ($1, $2, $3, $4, $5, $6, $7, true, $8)`, [id, file.path, file.name, kind, item, str(f, 'note', 300) || null, internal, uid]);
    if (internal) return;
    if (item && DOSSIER_ITEMS.some(([k]) => k === item)) {
      await db.query(`insert into dossier_items (request_id, item, status, updated_by) values ($1, $2, 'have', $3)
                      on conflict (request_id, item) do update set status = 'have', updated_by = $3, updated_at = now()`, [id, item, uid]);
    }
    if (item && SHIPMENT_DOCS.some(([k]) => k === item)) {
      const o = await one(db, 'select id from orders where request_id = $1', [id]);
      if (o) await db.query(`insert into shipment_documents (order_id, doc, ready) values ($1, $2, true)
                             on conflict (order_id, doc) do update set ready = true, updated_at = now()`, [o.id, item]);
    }
    await db.query('update requests set updated_at = now() where id = $1', [id]);
    await tellUser(db, r.user_id, 'New document from Nazryx', `${requestDocLabel(kind, item)}: ${file.name} is on request #${id}.`, `/requests/${id}`);
  });
  redirect(`${to}${to.includes('?') ? '&' : '?'}saved=1`);
}

export async function deleteRequestDoc(f: FormData) {
  await requireTeam('requests');
  const id = int(f, 'request_id')!, file = int(f, 'file_id');
  const to = safe(str(f, 'return', 200), `/admin/requests/${id}`);
  const u = await requireTeam();
  try {
    await withUser(u.id, (db) => db.query('delete from request_files where id = $1 and request_id = $2', [file, id]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(`${to}${to.includes('?') ? '&' : '?'}saved=1`);
}

// ---------------------------------------------------------------- engagements
export async function uploadEngagementDoc(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!;
  const to = `/admin/engagements/${id}`;
  const item = str(f, 'item', 20) || 'other', internal = f.get('internal') === 'on';
  if (!ENGAGEMENT_DOC_ITEMS.some(([k]) => k === item)) back(to, { error: 'Pick what the document is.' });
  await withFile(f, to, async (db, uid, file) => {
    const e = await one(db, 'select user_id, kind from engagements where id = $1', [id]);
    if (!e) throw new Error('Engagement not found.');
    await db.query(`insert into engagement_files (engagement_id, item, file_path, file_name, from_team, internal, uploaded_by, review)
                    values ($1, $2, $3, $4, true, $5, $6, 'accepted')`, [id, item, file.path, file.name, internal, uid]);
    if (internal) return;
    await db.query('update engagements set updated_at = now() where id = $1', [id]);
    await tellUser(db, e.user_id, item === 'report' ? 'Your report is ready' : 'New document from Nazryx', `${file.name} is on your engagement page.`);
  });
  redirect(`${to}?saved=1`);
}

export async function deleteEngagementDoc(f: FormData) {
  await requireTeam('manufacturers');
  const id = int(f, 'engagement_id')!, file = int(f, 'file_id');
  const to = `/admin/engagements/${id}`;
  const u = await requireTeam();
  try {
    await withUser(u.id, (db) => db.query('delete from engagement_files where id = $1 and engagement_id = $2', [file, id]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(`${to}?saved=1`);
}

// ---------------------------------------------------------------- accounts
/** A document for one customer account: agreements, invoices, NDAs ... Found by account id or email. */
export async function uploadAccountDoc(f: FormData) {
  await requireTeam('accounts');
  const to = safe(str(f, 'return', 200), '/admin?tab=documents');
  const kind = str(f, 'kind', 20), internal = f.get('internal') === 'on';
  if (!ACCOUNT_DOC_KINDS[kind]) back(to, { error: 'Pick what the document is.' });
  await withFile(f, to, async (db, uid, file) => {
    const email = str(f, 'email', 200).toLowerCase();
    const acc = await one(db, 'select id from users where id::text = $1 or email = $2', [str(f, 'user_id', 40), email || '-']);
    if (!acc) throw new Error('No account with that email.');
    await db.query(`insert into account_documents (user_id, kind, title, file_path, file_name, internal, uploaded_by)
                    values ($1, $2, $3, $4, $5, $6, $7)`, [acc.id, kind, str(f, 'title', 200) || null, file.path, file.name, internal, uid]);
    if (!internal) await tellUser(db, acc.id, 'New document from Nazryx', `${ACCOUNT_DOC_KINDS[kind]}: ${file.name} is in Settings > Documents.`, '/settings#documents');
  });
  redirect(`${to}${to.includes('?') ? '&' : '?'}saved=1`);
}

export async function deleteAccountDoc(f: FormData) {
  await requireTeam('accounts');
  const to = safe(str(f, 'return', 200), '/admin?tab=documents');
  const u = await requireTeam();
  try {
    await withUser(u.id, (db) => db.query('delete from account_documents where id = $1', [int(f, 'doc_id')]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(`${to}${to.includes('?') ? '&' : '?'}saved=1`);
}

// ---------------------------------------------------------------- suppliers (team only, never shown to customers)
export async function uploadSupplierDoc(f: FormData) {
  await requireTeam('documents');
  const to = '/admin?tab=documents';
  const kind = str(f, 'kind', 20);
  if (!SUPPLIER_DOC_KINDS[kind]) back(to, { error: 'Pick what the document is.' });
  const expires = str(f, 'expires_on', 10);
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) back(to, { error: 'Use a valid expiry date.' });
  await withFile(f, to, async (db, uid, file) => {
    let sid = int(f, 'supplier_id');
    if (!sid) {
      const name = str(f, 'supplier_name', 200);
      if (!name) throw new Error('Pick a supplier or enter a new one.');
      sid = (await one(db, 'insert into suppliers (name, country) values ($1, $2) returning id', [name, str(f, 'supplier_country', 80) || null]))!.id;
    }
    await db.query(`insert into supplier_documents (supplier_id, kind, product, expires_on, file_path, file_name, uploaded_by)
                    values ($1, $2, $3, $4, $5, $6, $7)`, [sid, kind, str(f, 'product', 200) || null, expires || null, file.path, file.name, uid]);
  });
  redirect(`${to}&saved=1`);
}

export async function deleteSupplierDoc(f: FormData) {
  await requireTeam('documents');
  const u = await requireTeam();
  try {
    await withUser(u.id, (db) => db.query('delete from supplier_documents where id = $1', [int(f, 'doc_id')]));
  } catch (e) {
    back('/admin?tab=documents', { error: dbMessage(e) });
  }
  redirect('/admin?tab=documents&saved=1');
}

// ---------------------------------------------------------------- plan prices
export async function savePlanPrices(f: FormData) {
  await requireTeam('content');
  const u = await requireTeam();
  try {
    await withUser(u.id, async (db) => {
      for (const k of PLAN_ORDER) {
        const amount = k === 'entry' ? null : int(f, `amount_mfr_${k}`);
        if (amount != null && (amount <= 0 || amount > 100000)) throw new Error('Use a monthly price in whole US dollars.');
        await db.query(`insert into plan_prices (key, amount_usd, note, updated_at) values ($1, $2, $3, now())
                        on conflict (key) do update set amount_usd = excluded.amount_usd, note = excluded.note, updated_at = now()`,
          [`mfr_${k}`, amount, str(f, `note_mfr_${k}`, 200) || null]);
      }
    });
  } catch (e) {
    back('/admin?tab=content', { error: e instanceof Error && !('code' in e) ? e.message : dbMessage(e) });
  }
  redirect('/admin?tab=content&saved=1');
}

// ---------------------------------------------------------------- manufacturer plans
/** Turn on (or change, or end) the plan a manufacturer has agreed and paid for. Unlocks the matching screens. */
export async function setMfrPlan(f: FormData) {
  await requireTeam('accounts');
  const u = await requireTeam();
  const uid = str(f, 'user_id', 40), plan = str(f, 'plan', 10);
  const to = safe(str(f, 'return', 200), `/admin/accounts/${uid}`);
  if (plan && !(PLAN_ORDER as string[]).includes(plan)) back(to, { error: 'Unknown plan.' });
  try {
    await withUser(u.id, async (db) => {
      await db.query(`update manufacturer_profiles set active_plan = $2, active_since = case when $2::text is null then null else now() end
                      where user_id = $1`, [uid, plan || null]);
      if (plan) {
        await db.query("update plan_requests set status = 'done' where user_id = $1 and status = 'open' and wanted like 'mfr:%'", [uid]);
        await tellUser(db, uid, 'Your plan is active', `${MFR_PLANS[plan as PlanKey].name} is now active. Everything it includes is unlocked.`, '/m/plan');
        // the worker issues the order confirmation and the invoice (amount from the form, else the list price)
        const amount = int(f, 'amount_usd') ?? (await one(db, 'select amount_usd from plan_prices where key = $1', [`mfr_${plan}`]))?.amount_usd ?? null;
        if (f.get('documents') === 'on') {
          await db.query(`insert into payment_events (kind, user_id, plan, amount_cents) values ('manual_activation', $1, $2, $3)`,
            [uid, plan, amount != null ? amount * 100 : null]);
        }
      }
    });
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  redirect(`${to}${to.includes('?') ? '&' : '?'}saved=1`);
}

/** The verified badge: our team has checked the manufacturer's GMP and certification pack. */
export async function setVerified(f: FormData) {
  await requireTeam('manufacturers');
  const u = await requireTeam();
  const uid = str(f, 'user_id', 40);
  try {
    await withUser(u.id, (db) => db.query('update manufacturer_profiles set verified_at = case when $2 then now() else null end where user_id = $1',
      [uid, f.get('on') === '1']));
  } catch (e) {
    back(`/admin/accounts/${uid}`, { error: dbMessage(e) });
  }
  redirect(`/admin/accounts/${uid}?saved=1`);
}
