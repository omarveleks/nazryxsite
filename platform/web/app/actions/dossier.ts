'use server';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { MFR_COUNTRIES, NEEDS_PLAN, canUse } from '@/lib/mfr';
import { saveUpload } from '@/lib/uploads';

const codes = MFR_COUNTRIES.map((c) => c.code);
const err = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));
const isRedirect = (e: unknown) => Boolean((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT'));

/** A document against a checklist item: stored with the account, the item ticked. */
export async function uploadDossierFile(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2), item = str(f, 'item', 200);
  const to = `/m/products/${product}/dossier?market=${country}`;
  if (!product || !codes.includes(country) || !item) back(to, { error: 'Pick the document.' });
  try {
    const saved = await saveUpload(f.get('file'), u.id);
    if (!saved) back(to, { error: 'Choose a file.' });
    await withUser(u.id, async (db) => {
      await db.query('insert into dossier_files (user_id, product_id, country, item, file_path, file_name, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7)',
        [u.owner_id ?? u.id, product, country, item, saved!.path, saved!.name, u.id]);
      await db.query(`insert into product_checklist (product_id, country, item, user_id) values ($1, $2, $3, $4) on conflict do nothing`, [product, country, item, u.owner_id ?? u.id]);
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(to, { error: err(e) });
  }
  back(to, { saved: '1' });
}

export async function deleteDossierFile(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2);
  await withUser(u.id, (db) => db.query('delete from dossier_files where id = $1', [int(f, 'id')]));
  back(`/m/products/${product}/dossier?market=${country}`, { saved: '1' });
}

/** Who gets an item done, by when, with a note. */
export async function setDossierMeta(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2), item = str(f, 'item', 200);
  const to = `/m/products/${product}/dossier?market=${country}`;
  if (!product || !codes.includes(country) || !item) back(to, { error: 'Pick the document.' });
  await withUser(u.id, (db) => db.query(`insert into dossier_meta (product_id, country, item, assignee_id, due_date, note) values ($1, $2, $3, $4::uuid, $5::date, $6)
    on conflict (product_id, country, item) do update set assignee_id = excluded.assignee_id, due_date = excluded.due_date, note = excluded.note, updated_at = now()`,
    [product, country, item, str(f, 'assignee_id', 40) || null, str(f, 'due_date', 10) || null, str(f, 'note', 300) || null]));
  back(to, { saved: '1' });
}

/** Paste a CTD module list or a table of contents: lines that name a checklist item tick it. */
export async function prefillFromCtd(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2), text = str(f, 'text', 20000).toLowerCase();
  const to = `/m/products/${product}/dossier?market=${country}`;
  if (!product || !codes.includes(country) || !text) back(to, { error: 'Paste the module list first.' });
  // what a CTD line usually says, and the checklist items it covers
  const RULES: [RegExp, RegExp][] = [
    [/\b1\.0\b|cover letter/, /cover letter/i], [/\b1\.2\b|application form/, /application form/i], [/\b1\.3\b|table of contents|toc\b/, /table of contents/i],
    [/\bcpp\b|certificate of pharmaceutical product/, /certificate of pharmaceutical product|cpp/i], [/manufacturing licen[cs]e/, /manufacturing licen[cs]e/i],
    [/\bgmp\b/, /gmp certificate/i], [/site master file|\bsmf\b/, /site master file/i], [/local (technical )?representative|\bltr\b/, /local technical representative/i],
    [/\bsmpc\b|summary of product characteristics/, /smpc/i], [/label|artwork|mock-?up/, /label artwork/i], [/leaflet|package insert|\bpil\b/, /leaflet|package insert/i],
    [/\b2\.3\b|quality overall summary|\bqos\b/, /qos/i], [/\b3\.2\.s\b|drug substance|\bapi\b/, /module 3 data|cep or apimf/i], [/\b3\.2\.p\b|drug product/, /module 3 data/i],
    [/nitrosamine/, /nitrosamine/i], [/process validation/, /process validation/i], [/batch record|\b3\.2\.r\b/, /biobatch|batch record/i], [/stability/, /stability data/i],
    [/\b5\.3\b|bioequivalence|\bbe study\b|\bbe\b/, /be study/i], [/biowaiver|dissolution/, /biowaiver/i], [/comparator/, /comparator/i], [/expert|\bcv\b/, /expert declarations/i],
    [/regulatory status|sra|wla/, /regulatory status/i], [/sample/, /sample packs/i], [/fee|payment/, /proof of payment/i], [/self-?screening/, /self-screening/i],
  ];
  let ticked = 0;
  await withUser(u.id, async (db) => {
    const items = (await db.query(`select name from reg_checklist where country = $1 and scope = 'medicine'`, [country])).rows.map((r: any) => r.name as string);
    const lines = text.split(/\n+/);
    const hit = new Set<string>();
    for (const [lineRe, itemRe] of RULES) {
      if (lines.some((l) => lineRe.test(l))) for (const it of items) if (itemRe.test(it)) hit.add(it);
    }
    for (const it of hit) {
      const r = await db.query(`insert into product_checklist (product_id, country, item, user_id) values ($1, $2, $3, $4) on conflict do nothing`, [product, country, it, u.owner_id ?? u.id]);
      ticked += r.rowCount ?? 0;
    }
  });
  back(to, { saved: '1', ticked: String(ticked) });
}

/** The regulatory review as a button on the checklist: a dossier review engagement for this product and market. */
export async function requestDossierReview(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2);
  const to = `/m/products/${product}/dossier?market=${country}`;
  if (!canUse(u.mfr_tier, 'dossier_review')) redirect(`/m/plan?want=${NEEDS_PLAN.dossier_review}`);
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const existing = await one(db, `select id from engagements where user_id = $1 and kind = 'dossier_review' and product_id = $2 and country = $3 and status = 'open'`, [u.owner_id ?? u.id, product, country]);
      if (existing) return existing.id as number;
      const project = await one(db, 'select id from projects where product_id = $1 and country = $2', [product, country]);
      const missing = await db.query(`select name from reg_checklist c where c.country = $1 and c.scope = 'medicine'
        and not exists (select 1 from product_checklist k where k.product_id = $2 and k.country = $1 and k.item = c.name) order by c.sort`, [country, product]);
      const detail = `Dossier review from the checklist. ${missing.rowCount} items still marked missing: ${missing.rows.slice(0, 12).map((r: any) => r.name).join('; ')}${missing.rowCount! > 12 ? '…' : ''}`;
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, detail, project_id) values ($1, 'dossier_review', $2, $3, $4, $5) returning id`,
        [u.owner_id ?? u.id, country, product, detail, project?.id ?? null]);
      await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', $1, $2)`, ['Dossier review requested', `${u.email} asked for a dossier review (engagement #${r!.id}).`]).catch(() => {});
      return r!.id as number;
    });
  } catch (e) {
    back(to, { error: err(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}
