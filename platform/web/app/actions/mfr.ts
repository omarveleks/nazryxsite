'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { findMolecule } from '@/lib/match';
import { AGENCY_KINDS, APPROACHES, GOALS, LAUNCH_SCOPES, CERTIFICATIONS, COMPANY_SIZES, CONTACT_ROLES, DOSAGE_FORMS, MFR_COUNTRIES, MFR_PLANS, NEEDS, REPORT_TYPES,
  SERVICES, THERAPEUTIC_AREAS, TIMELINES, countryName, suggestPlan, type PlanKey } from '@/lib/mfr';
import { DOSSIER_ITEMS } from '@/lib/format';
import { saveUpload } from '@/lib/uploads';

const codes = MFR_COUNTRIES.map((c) => c.code);
const pick = (f: FormData, k: string, allowed: readonly string[]) => [...new Set(f.getAll(k).map(String))].filter((v) => allowed.includes(v));
const safeNext = (v: string, fallback: string) => (v.startsWith('/') && !v.startsWith('//') ? v : fallback);

async function teamNote(db: any, subject: string, body: string) {
  await db.query(`insert into notifications (user_id, channel, subject, body) values (null, 'email', $1, $2)`, [subject, body]);
}

const ONB = '/m/onboarding';
const opts = (f: FormData, k: string, list: [string, string][] | string[]) =>
  pick(f, k, list.map((x) => (Array.isArray(x) ? x[0] : x)));
const oneOf = (v: string, list: [string, string][] | string[]) => (list.map((x) => (Array.isArray(x) ? x[0] : x)).includes(v) ? v : null);
const errText = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));
const isRedirect = (e: unknown) => Boolean((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT'));

/** Products from a pasted list, one per line, each matched to a molecule where possible. */
async function insertProducts(db: any, userId: string, text: string) {
  const lines = text.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 500);
  let added = 0, matched = 0;
  for (const line of lines) {
    const strength = line.match(/[\d.,]+\s*(mg|mcg|µg|g|ml|iu|%)(\s*\/\s*[\d.,]*\s*(ml|g))?/i)?.[0] ?? null;
    const form = line.match(/tablets?|capsules?|injection|infusion|syrup|suspension|cream|ointment|gel|drops|inhaler|powder|solution|suppositor(y|ies)/i)?.[0] ?? null;
    const id = await findMolecule(db, line);
    await db.query(`insert into mfr_products (user_id, name, molecule_id, strength, dosage_form) values ($1, $2, $3, $4, $5)`,
      [userId, line.slice(0, 200), id, strength, form]);
    added++; if (id) matched++;
  }
  return { added, matched };
}

/** Manufacturer onboarding, one step at a time, and later profile edits. Steps: company, manufacturing, markets,
 *  catalogue, needs, then the suggested plan. New profiles wait for the team's approval. */
export async function saveMfrStep(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const step = Math.min(Math.max(int(f, 'step') ?? 1, 1), 5);
  const here = `${ONB}?step=${step}`;
  let note = '';
  try {
    await withUser(u.id, async (db) => {
      const had = await one(db, 'select 1 as x from manufacturer_profiles where user_id = $1', [u.id]);
      if (step === 1) {
        const company = str(f, 'company_name', 200);
        if (!company) throw new Error('Enter your company name.');
        const v = [company, str(f, 'hq_country', 80) || null, str(f, 'website', 200) || null, oneOf(str(f, 'company_size', 40), COMPANY_SIZES),
          oneOf(str(f, 'contact_role', 60), CONTACT_ROLES)];
        if (had) await db.query(`update manufacturer_profiles set company_name = $2, hq_country = $3, website = $4, company_size = $5, contact_role = $6
                                 where user_id = $1`, [u.id, ...v]);
        else await db.query(`insert into manufacturer_profiles (user_id, company_name, hq_country, website, company_size, contact_role)
                             values ($1, $2, $3, $4, $5, $6)`, [u.id, ...v]);
        const phone = str(f, 'whatsapp', 40);
        if (phone) await db.query('update users set whatsapp = $2 where id = $1', [u.id, phone]);
      } else if (!had) {
        throw new Error('Start with your company.');
      } else if (step === 2) {
        await db.query(`update manufacturer_profiles set certifications = $2, dosage_forms = $3, therapeutic_areas = $4, plant_countries = $5,
                        export_markets = $6 where user_id = $1`,
          [u.id, pick(f, 'certifications', CERTIFICATIONS), opts(f, 'dosage_forms', DOSAGE_FORMS), opts(f, 'therapeutic_areas', THERAPEUTIC_AREAS),
            str(f, 'plant_countries', 200) || null, str(f, 'export_markets', 400) || null]);
      } else if (step === 3) {
        const targets = pick(f, 'target_countries', codes);
        if (!targets.length) throw new Error('Pick at least one market.');
        await db.query(`update manufacturer_profiles set target_countries = $2, registered_in = $3, timeline = $4, approach = $5 where user_id = $1`,
          [u.id, targets, pick(f, 'registered_in', codes), oneOf(str(f, 'timeline', 20), TIMELINES), oneOf(str(f, 'approach', 20), APPROACHES)]);
      } else if (step === 4) {
        const r = await insertProducts(db, u.id, str(f, 'list', 20000));
        if (r.added) note = `${r.added} products added, ${r.matched} matched to the market.`;
      } else if (step === 5) {
        await db.query('update manufacturer_profiles set goals = $2, services = $3, launch_scope = $4 where user_id = $1',
          [u.id, opts(f, 'goals', GOALS), opts(f, 'services', NEEDS), oneOf(str(f, 'launch_scope', 20), LAUNCH_SCOPES)]);
      }
      await db.query('update manufacturer_profiles set step = greatest(step, $2) where user_id = $1', [u.id, step + 1]);
    });
    if (step === 4) {
      // a catalogue file (Excel, PDF ...) for the team to load, alongside or instead of the pasted list
      const saved = await saveUpload(f.get('catalogue'), u.id);
      if (saved) {
        await withUser(u.id, (db) => db.query('update manufacturer_profiles set catalogue_path = $2, catalogue_name = $3 where user_id = $1',
          [u.id, saved.path, saved.name]));
        note = `${note} ${saved.name} uploaded; our team loads it for you.`.trim();
      }
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(here, { error: errText(e) });
  }
  if (u.onboarded && f.get('stay') === '1') back(here, { saved: '1', ...(note ? { note } : {}) });
  back(`${ONB}?step=${step + 1}`, note ? { note } : {});
}

/** Last onboarding step: take the suggested plan (or another), or explore first. Finishes onboarding either way. */
export async function choosePlan(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const plan = str(f, 'plan', 20);
  const chosen = (plan in MFR_PLANS ? plan : null) as PlanKey | null;
  const firstTime = !u.onboarded;
  const from = str(f, 'from', 20) === 'plan' ? '/m/plan' : `${ONB}?step=6`;
  try {
    await withUser(u.id, async (db) => {
      const p = await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]);
      if (!p) throw new Error('Start with your company.');
      const s = suggestPlan(p);
      await db.query(`update manufacturer_profiles set suggested_plan = $2, chosen_plan = coalesce($3, chosen_plan), completed_at = coalesce(completed_at, now())
                      where user_id = $1`, [u.id, s.plan, chosen]);
      await db.query('update users set onboarded = true where id = $1', [u.id]);
      const markets = (p.target_countries ?? []).map(countryName).join(', ') || 'none';
      if (chosen) {
        await db.query('insert into plan_requests (user_id, wanted, note) values ($1, $2, $3)',
          [u.id, `mfr:${chosen}`, `${MFR_PLANS[chosen].name}. Markets: ${markets}. ${str(f, 'note', 1000)}`.trim()]);
      }
      if (firstTime || chosen) {
        await teamNote(db, chosen ? `${p.company_name} chose ${MFR_PLANS[chosen].name}` : 'New manufacturer',
          `${p.company_name} (${u.email}) ${firstTime ? 'finished onboarding' : 'picked a plan'}. Suggested ${MFR_PLANS[s.plan].name}`
          + `${chosen ? `, chose ${MFR_PLANS[chosen].name}` : ', exploring first'}. Markets: ${markets}. Review in Admin > Manufacturers.`);
      }
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(from, { error: errText(e) });
  }
  redirect(chosen ? '/m/plan?requested=1' : '/m?welcome=1');
}

/** Add products by pasting a list; each is matched to a molecule where possible. */
export async function addMfrProducts(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const text = str(f, 'list', 20000);
  if (!text.trim()) back('/m/products', { error: 'Paste at least one product, one per line.' });
  let r = { added: 0, matched: 0 };
  try {
    r = await withUser(u.id, (db) => insertProducts(db, u.id, text));
  } catch (e) {
    back('/m/products', { error: dbMessage(e) });
  }
  redirect(`/m/products?added=${r.added}&matched=${r.matched}`);
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
