'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { findMolecule } from '@/lib/match';
import { AGENCY_KINDS, CERTIFICATIONS, MFR_COUNTRIES, REPORT_TYPES, SERVICES } from '@/lib/mfr';
import { DOSSIER_ITEMS } from '@/lib/format';
import { saveUpload } from '@/lib/uploads';

const codes = MFR_COUNTRIES.map((c) => c.code);
const pick = (f: FormData, k: string, allowed: readonly string[]) => [...new Set(f.getAll(k).map(String))].filter((v) => allowed.includes(v));
const safeNext = (v: string, fallback: string) => (v.startsWith('/') && !v.startsWith('//') ? v : fallback);

async function teamNote(db: any, subject: string, body: string) {
  await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', $1, $2)`, [subject, body]);
}

/** Manufacturer onboarding and profile edits. New profiles wait for the team's approval. */
export async function saveMfrProfile(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const next = safeNext(str(f, 'next', 200), '/m?welcome=1');
  const company = str(f, 'company_name', 200);
  if (!company) back('/m/onboarding', { error: 'Enter your company name.' });
  const fields = [company, str(f, 'hq_country', 80) || null, str(f, 'website', 200) || null,
    pick(f, 'certifications', CERTIFICATIONS), pick(f, 'target_countries', codes)];
  try {
    await withUser(u.id, async (db) => {
      const had = await one(db, 'select 1 as x from manufacturer_profiles where user_id = $1', [u.id]);
      if (had) {
        await db.query(`update manufacturer_profiles set company_name = $2, hq_country = $3, website = $4, certifications = $5,
                        target_countries = $6 where user_id = $1`, [u.id, ...fields]);
      } else {
        await db.query(`insert into manufacturer_profiles (user_id, company_name, hq_country, website, certifications, target_countries)
                        values ($1, $2, $3, $4, $5, $6)`, [u.id, ...fields]);
        await teamNote(db, 'New manufacturer', `${company} (${u.email}) signed up. Review it in Admin > Manufacturers.`);
      }
      await db.query('update users set onboarded = true where id = $1', [u.id]);
    });
  } catch (e) {
    back('/m/onboarding', { error: dbMessage(e) });
  }
  redirect(next);
}

/** Add products by pasting a list; each is matched to a molecule where possible. */
export async function addMfrProducts(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const lines = str(f, 'list', 20000).split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 500);
  if (!lines.length) back('/m/products', { error: 'Paste at least one product, one per line.' });
  let added = 0, matched = 0;
  try {
    await withUser(u.id, async (db) => {
      for (const line of lines) {
        const strength = line.match(/[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%)(\s*\/\s*[\d.,]*\s*(ml|g))?/i)?.[0] ?? null;
        const form = line.match(/tablets?|capsules?|injection|infusion|syrup|suspension|cream|ointment|gel|drops|inhaler|powder|solution|suppositor(y|ies)/i)?.[0] ?? null;
        const id = await findMolecule(db, line);
        await db.query(`insert into mfr_products (user_id, name, molecule_id, strength, dosage_form) values ($1, $2, $3, $4, $5)`,
          [u.id, line.slice(0, 200), id, strength, form]);
        added++; if (id) matched++;
      }
    });
  } catch (e) {
    back('/m/products', { error: dbMessage(e) });
  }
  redirect(`/m/products?added=${added}&matched=${matched}`);
}

/** The manufacturer's own dossier self-check for one product. */
export async function updateProductChecks(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'product_id');
  const on = (k: string) => f.get(k) === 'on';
  await withUser(u.id, (db) => db.query(`update mfr_products set who_pq = $3, sra_approved = $4, ctd_ready = $5, be_study = $6, zone_ivb = $7
                                         where id = $1 and user_id = $2`,
    [id, u.id, on('who_pq'), on('sra_approved'), on('ctd_ready'), on('be_study'), on('zone_ivb')]));
  redirect(`/m/products/${id}?saved=1`);
}

export async function deleteMfrProduct(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from mfr_products where id = $1 and user_id = $2', [int(f, 'product_id'), u.id]));
  redirect('/m/products');
}

/** Ask for an agency service: market entry, dossier review, local representative, EAC roll-out, after registration. */
export async function requestService(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const kind = str(f, 'kind', 30), country = str(f, 'country', 2), product = int(f, 'product_id');
  const ret = safeNext(str(f, 'return', 200), '/m/services');
  if (!(AGENCY_KINDS as readonly string[]).includes(kind)) back(ret, { error: 'Pick a service.' });
  if (country && !codes.includes(country)) back(ret, { error: 'Pick a country.' });
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, detail) values ($1, $2, $3, $4, $5) returning id`,
        [u.id, kind, country || null, product, str(f, 'detail', 2000) || null]);
      await teamNote(db, `New ${SERVICES[kind].label} request`, `${u.email} asked for ${SERVICES[kind].label}${country ? ` in ${country}` : ''}. Engagement #${r!.id}.`);
      return r!.id as number;
    });
  } catch (e) {
    back(ret, { error: dbMessage(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}

/** Order a 24-hour report. */
export async function orderReport(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const type = str(f, 'report_type', 30), country = str(f, 'country', 2) || 'TZ', product = int(f, 'product_id');
  if (!REPORT_TYPES.some(([k]) => k === type)) back('/m/services', { error: 'Pick a report.' });
  if (!codes.includes(country)) back('/m/services', { error: 'Pick a country.' });
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, report_type, detail, due_at)
                               values ($1, 'report', $2, $3, $4, $5, now() + interval '24 hours') returning id`,
        [u.id, country, product, type, str(f, 'detail', 2000) || null]);
      await teamNote(db, '24-hour report ordered', `${u.email} ordered a ${type} report for ${country}. Due in 24 hours. Engagement #${r!.id}.`);
      return r!.id as number;
    });
  } catch (e) {
    back('/m/services', { error: dbMessage(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}

/** Ask the team to introduce an anonymised distributor from the partner finder. */
export async function requestIntro(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const code = str(f, 'code', 12).toUpperCase(), product = int(f, 'product_id');
  if (!/^[0-9A-F]{8}$/.test(code)) back('/m/partners', { error: 'Pick a distributor profile.' });
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, detail) values ($1, 'partner_intro', 'TZ', $2, $3) returning id`,
        [u.id, product, `Distributor profile ${code}${str(f, 'class', 120) ? ` (${str(f, 'class', 120)})` : ''}. ${str(f, 'detail', 1000)}`.trim()]);
      await teamNote(db, 'Introduction requested', `${u.email} asked to meet distributor profile ${code}. Engagement #${r!.id}.`);
      return r!.id as number;
    });
  } catch (e) {
    back('/m/partners', { error: dbMessage(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}

export async function postEngagementMessage(f: FormData) {
  const u = await requireUser({ manufacturer: true, shared: true });
  const id = int(f, 'engagement_id'), body = str(f, 'body', 4000);
  const team = u.role === 'team';
  const to = team ? `/admin/engagements/${id}` : `/m/engagements/${id}`;
  if (!body) back(to, { error: 'Write a message.' });
  await withUser(u.id, async (db) => {
    await db.query('insert into engagement_messages (engagement_id, from_team, author_id, body) values ($1, $2, $3, $4)', [id, team, u.id, body]);
    if (team) {
      const e = await one(db, 'select user_id from engagements where id = $1', [id]);
      if (e) await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', 'Message from Nazryx', $2)`, [e.user_id, body.slice(0, 500)]);
      await db.query('update engagements set updated_at = now() where id = $1', [id]);
    } else {
      await teamNote(db, `Message on engagement #${id}`, `${u.email}: ${body.slice(0, 300)}`);
    }
  });
  redirect(to);
}

/** Upload a dossier document (client) or a deliverable such as a report (team). */
export async function uploadEngagementFile(f: FormData) {
  const u = await requireUser({ manufacturer: true, shared: true });
  const id = int(f, 'engagement_id');
  const team = u.role === 'team';
  const to = team ? `/admin/engagements/${id}` : `/m/engagements/${id}`;
  const item = str(f, 'item', 30);
  if (item && item !== 'report' && item !== 'other' && !DOSSIER_ITEMS.some(([k]) => k === item)) back(to, { error: 'Pick what the document is.' });
  try {
    const saved = await saveUpload(f.get('file'), u.id);
    if (!saved) back(to, { error: 'Choose a file.' });
    await withUser(u.id, async (db) => {
      await db.query(`insert into engagement_files (engagement_id, item, file_path, file_name, from_team, uploaded_by) values ($1, $2, $3, $4, $5, $6)`,
        [id, item || 'other', saved!.path, saved!.name, team, u.id]);
      if (team) {
        const e = await one(db, 'select user_id, kind from engagements where id = $1', [id]);
        if (e) await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3)`,
          [e.user_id, e.kind === 'report' ? 'Your report is ready' : 'New document from Nazryx', `${saved!.name} is on your engagement page.`]);
      } else {
        await teamNote(db, `Document uploaded on engagement #${id}`, `${u.email} uploaded ${saved!.name}.`);
      }
    });
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    back(to, { error: e instanceof Error && !('code' in e) ? e.message : dbMessage(e) });
  }
  revalidatePath(to);
  redirect(`${to}?uploaded=1`);
}
