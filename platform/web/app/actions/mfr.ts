'use server';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { teamCan } from '@/lib/team';
import { headers } from 'next/headers';
import { checkoutUrl, portalUrl, stripeReady } from '@/lib/stripe';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { findMolecule } from '@/lib/match';
import { AGENCY_KINDS, APPROACHES, GOALS, LAUNCH_SCOPES, CERTIFICATIONS, COMPANY_SIZES, CONTACT_ROLES, DOSAGE_FORMS, MFR_COUNTRIES, MFR_PLANS, NEEDS,
  SERVICES, THERAPEUTIC_AREAS, TIMELINES, NEEDS_PLAN, LAUNCH_STAGES, MFR_FILE_KINDS, WIZARD, type WizardStep, canUse, countryName, covers, suggestPlan, tierOf, yearly, type PlanKey } from '@/lib/mfr';
import { DOSSIER_ITEMS } from '@/lib/format';
import { saveUpload } from '@/lib/uploads';
import { TOUR } from '@/lib/tour';
import { catalogueLines, hasGenericColumn } from '@/lib/catalogue';

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

/** A catalogue upload adds its products by itself: CSV and text at once, Excel, Word and PDF in the worker within a minute.
 *  Returns what happened, for the message shown next. */
async function importCatalogue(userId: string, email: string, file: FormDataEntryValue | null) {
  const saved = await saveUpload(file, userId);
  if (!saved) return null;
  const raw = /\.(csv|txt)$/i.test(saved.name) && file && typeof file !== 'string' ? await file.text() : null;
  const text = raw !== null && !hasGenericColumn(raw) ? raw : null;   // generic and brand columns: the worker reads it
  return withUser(userId, async (db) => {
    if (text !== null) {
      const have = new Set((await db.query('select lower(name) as n from mfr_products where user_id = $1', [userId])).rows.map((x: { n: string }) => x.n));
      const r = await insertProducts(db, userId, catalogueLines(text).filter((l) => !have.has(l.toLowerCase())).join('\n'));
      await db.query(`insert into mfr_files (user_id, kind, file_path, file_name, status, added, matched) values ($1, 'catalogue', $2, $3, 'done', $4, $5)`,
        [userId, saved.path, saved.name, r.added, r.matched]);
      if (r.added > r.matched) await teamNote(db, 'Catalogue loaded: products to match', `${email}: ${r.added} products added from ${saved.name}, ${r.added - r.matched} to match.`);
      return { name: saved.name, reading: false, ...r };
    }
    await db.query(`insert into mfr_files (user_id, kind, file_path, file_name, status) values ($1, 'catalogue', $2, $3, 'queued')`, [userId, saved.path, saved.name]);
    await db.query("select pg_notify('ingest', 'catalogue')");
    return { name: saved.name, reading: true, added: 0, matched: 0 };
  });
}
const catalogueNote = (c: { name: string; reading: boolean; added: number; matched: number } | null) => !c ? ''
  : c.reading ? `Reading ${c.name}: your products appear in a minute.`
  : `${c.added} ${c.added === 1 ? 'product' : 'products'} added from ${c.name}, ${c.matched} matched to the market.`;

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
        if (phone) await db.query('update users set whatsapp = $2, notify_whatsapp = true where id = $1', [u.id, phone]);
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
      const c = await importCatalogue(u.id, u.email, f.get('catalogue'));
      if (c) note = `${note} ${catalogueNote(c)}`.trim();
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(here, { error: errText(e) });
  }
  if (u.onboarded && f.get('stay') === '1') back(here, { saved: '1', ...(note ? { note } : {}) });
  back(`${ONB}?step=${step + 1}`, note ? { note } : {});
}

/** One screen of the first-time sign-up. Saves the answer and moves to the next screen. */
export async function saveWizard(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const q = str(f, 'q', 20) as WizardStep;
  const i = WIZARD.indexOf(q);
  if (i < 0 || q === 'plan') redirect(ONB);
  const here = `${ONB}?q=${q}`;
  let note = '';
  try {
    await withUser(u.id, async (db) => {
      const had = await one(db, 'select 1 as x from manufacturer_profiles where user_id = $1', [u.id]);
      if (q === 'company') {
        const company = str(f, 'company_name', 200);
        if (!company) throw new Error('Enter your company name.');
        if (had) await db.query('update manufacturer_profiles set company_name = $2, hq_country = $3 where user_id = $1', [u.id, company, str(f, 'hq_country', 80) || null]);
        else await db.query('insert into manufacturer_profiles (user_id, company_name, hq_country) values ($1, $2, $3)', [u.id, company, str(f, 'hq_country', 80) || null]);
      } else if (!had) {
        throw new Error('Start with your company.');
      } else if (q === 'markets') {
        const targets = pick(f, 'target_countries', codes);
        if (!targets.length) throw new Error('Pick at least one market.');
        await db.query('update manufacturer_profiles set target_countries = $2 where user_id = $1', [u.id, targets]);
      } else if (q === 'goals') {
        await db.query('update manufacturer_profiles set goals = $2 where user_id = $1', [u.id, opts(f, 'goals', GOALS)]);
      } else if (q === 'help') {
        await db.query('update manufacturer_profiles set services = $2 where user_id = $1', [u.id, opts(f, 'services', NEEDS)]);
      } else if (q === 'timeline') {
        await db.query('update manufacturer_profiles set timeline = $2 where user_id = $1', [u.id, oneOf(str(f, 'choice', 20), TIMELINES)]);
      } else if (q === 'scope') {
        await db.query('update manufacturer_profiles set launch_scope = $2 where user_id = $1', [u.id, oneOf(str(f, 'choice', 20), LAUNCH_SCOPES)]);
      } else if (q === 'products') {
        const r = await insertProducts(db, u.id, str(f, 'list', 20000));
        if (r.added) note = `${r.added} products added, ${r.matched} matched to the market.`;
      }
      await db.query('update manufacturer_profiles set step = greatest(step, $2) where user_id = $1', [u.id, i + 2]);
    });
    if (q === 'products') {
      const c = await importCatalogue(u.id, u.email, f.get('catalogue'));
      if (c) note = `${note} ${catalogueNote(c)}`.trim();
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(here, { error: errText(e) });
  }
  back(ONB, { q: WIZARD[i + 1], ...(note ? { note } : {}) });
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
      if (firstTime) await db.query('update manufacturer_profiles set tour_step = -1 where user_id = $1', [u.id]);   // offer the tour on Home
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
  redirect(firstTime ? '/m?welcome=1' : chosen ? '/m/plan?requested=1' : '/m?welcome=1');
}

async function origin() {
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
}

/** Subscribe to Basic Market Data or Complete Market Access by card. Without card payments set up, it becomes a
 *  plan request our team invoices. Complete Market Entry is always a conversation (choosePlan). */
export async function startCheckout(f: FormData) {
  const u = await requireUser({ allowOnboarding: true, manufacturer: true });
  const plan = str(f, 'plan', 10) as PlanKey;
  if (plan !== 'data' && plan !== 'access') return choosePlan(f);
  if (!u.onboarded) {
    // paying from the last sign-up screen finishes sign-up; the tour starts when they come back
    await withUser(u.id, async (db) => {
      await db.query('update users set onboarded = true where id = $1', [u.id]);
      await db.query(`update manufacturer_profiles set tour_step = -1, completed_at = coalesce(completed_at, now()), chosen_plan = $2 where user_id = $1`, [u.id, plan]);
    });
  }
  if (u.mfr_tier >= tierOf(plan)) redirect('/m/plan');
  if (!stripeReady()) return choosePlan(f);
  const interval = str(f, 'interval', 5) === 'year' ? 'year' : 'month';
  const d = await withUser(u.id, async (db) => ({
    price: await one(db, 'select amount_usd from plan_prices where key = $1', [`mfr_${plan}`]),
    p: await one(db, 'select stripe_customer, primary_market, target_countries from manufacturer_profiles where user_id = $1', [u.id]),
  }));
  if (!d.price?.amount_usd) return choosePlan(f);
  // the plan includes one market: the one chosen on the plan page, else the market they work on now
  const chosen = str(f, 'market', 2);
  const targets: string[] = d.p?.target_countries ?? [];
  const market = targets.includes(chosen) ? chosen : d.p?.primary_market && targets.includes(d.p.primary_market) ? d.p.primary_market : targets[0] ?? 'TZ';
  let url = '';
  try {
    url = await checkoutUrl({ userId: u.id, email: u.email, plan, planName: `${MFR_PLANS[plan].name} (${countryName(market)})`,
      amountUsd: interval === 'year' ? yearly(d.price.amount_usd) : d.price.amount_usd, interval, markets: [market],
      origin: await origin(), customer: d.p?.stripe_customer });
  } catch (e) {
    back('/m/plan', { error: `Card payment could not start: ${(e as Error).message}. Try again, or ask us to invoice you.` });
  }
  redirect(url);
}

/** The card, invoices and cancellation, on the payment provider's own page. */
export async function openBillingPortal() {
  const u = await requireUser({ manufacturer: true });
  const p = await withUser(u.id, (db) => one(db, 'select stripe_customer from manufacturer_profiles where user_id = $1', [u.id]));
  if (!p?.stripe_customer || !stripeReady()) back('/m/plan', { error: 'Your plan is invoiced by our team. Write to us to change it.' });
  let url = '';
  try {
    url = await portalUrl(p!.stripe_customer, await origin());
  } catch (e) {
    back('/m/plan', { error: (e as Error).message });
  }
  redirect(url);
}

/** Add one product picked from the medicine search, with its strength and form. */
export async function addMfrProduct(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const back_ = safeNext(str(f, 'return', 200), '/m/products');
  const name = str(f, 'name', 160), strength = str(f, 'strength', 40), form = str(f, 'form', 40);
  if (!name) back(back_, { error: 'Pick a medicine first.' });
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const full = [name, strength, form].filter(Boolean).join(' ');
      const mol = await findMolecule(db, name);
      const atc = str(f, 'atc', 10) || (await one(db, 'select atc from medicine_catalog where lower(name) = lower($1)', [name]))?.atc || null;
      const r = await one(db, `insert into mfr_products (user_id, name, molecule_id, strength, dosage_form, atc) values ($1, $2, $3, $4, $5, $6) returning id`,
        [u.id, full.slice(0, 200), mol, strength || null, form || null, atc]);
      return r!.id as number;
    });
  } catch (e) {
    back(back_, { error: dbMessage(e) });
  }
  redirect(`/m/products/${id}?added=1`);
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

/** Empty the portfolio in one go: every product (and its launch tracker rows) and the molecules watched. */
export async function deleteAllMfrProducts() {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, async (db) => {
    await db.query('delete from mfr_products where user_id = $1', [u.id]);
    await db.query('delete from watches where user_id = $1', [u.id]);
  });
  redirect('/m/products?cleared=1');
}

/** Ask for a service: market entry, dossier and regulatory review, renewals and compliance. */
export async function requestService(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const kind = str(f, 'kind', 30), country = str(f, 'country', 2), product = int(f, 'product_id');
  const ret = safeNext(str(f, 'return', 200), '/m/services');
  if (!(AGENCY_KINDS as readonly string[]).includes(kind)) back(ret, { error: 'Pick a service.' });
  if (!canUse(u.mfr_tier, kind)) redirect(`/m/plan?want=${NEEDS_PLAN[kind]}`);
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

/** An introduction request: a distributor (or let us pick), which products (specific, our choice or the whole
 *  portfolio) and the basics. Starts a market entry engagement for the team. */
export async function requestIntro(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const code = str(f, 'code', 12).toUpperCase();
  const back_ = `/m/partners/intro${code ? `?code=${code}` : ''}`;
  if (code && !/^[0-9A-F]{8}$/.test(code)) back('/m/partners', { error: 'Pick a distributor profile.' });
  if (!canUse(u.mfr_tier, 'partner_intro')) redirect(`/m/plan?want=${NEEDS_PLAN.partner_intro}`);
  const picked = [...new Set(f.getAll('products').map((x) => parseInt(String(x), 10)).filter(Number.isFinite))];
  const scope = picked.length ? 'selected' : ['selected', 'nazryx', 'all'].includes(str(f, 'scope', 12)) ? str(f, 'scope', 12) : 'nazryx';
  if (scope === 'selected' && !picked.length) back(back_, { error: 'Tick the products you want to put forward, or let us choose.' });
  const country = codes.includes(str(f, 'market', 2)) ? str(f, 'market', 2) : 'TZ';
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const names = picked.length ? (await db.query(`select coalesce(m.inn, p.name) as n from mfr_products p left join molecules m on m.id = p.molecule_id
                                                     where p.user_id = $1 and p.id = any($2) order by 1`, [u.id, picked])).rows.map((r: any) => r.n) : [];
      const lines = [
        code ? `Distributor profile ${code}.` : 'Nazryx to shortlist the distributors.',
        `Products: ${scope === 'all' ? 'the entire portfolio' : scope === 'nazryx' ? 'Nazryx to choose' : names.join(', ')}.`,
        `Partner: ${({ exclusive: 'exclusive', non_exclusive: 'non-exclusive is fine', unsure: 'not sure yet' } as Record<string, string>)[str(f, 'partner', 20)] ?? 'not sure yet'}.`,
        `Start: ${({ now: 'as soon as possible', '3m': 'within 3 months', '6m': 'in 6 months or more' } as Record<string, string>)[str(f, 'start', 4)] ?? 'not given'}.`,
        str(f, 'contact', 200) ? `Contact: ${str(f, 'contact', 200)}.` : '',
        str(f, 'detail', 1500),
      ].filter(Boolean).join('\n');
      const r = await one(db, `insert into engagements (user_id, kind, country, product_id, detail) values ($1, 'market_entry', $2, $3, $4) returning id`,
        [u.id, country, picked.length === 1 ? picked[0] : null, lines]);
      await teamNote(db, 'Introduction requested', `${u.email} asked for an introduction${code ? ` to distributor profile ${code}` : ''} in ${country}. Engagement #${r!.id}.`);
      return r!.id as number;
    });
  } catch (e) {
    back(back_, { error: dbMessage(e) });
  }
  redirect(`/m/engagements/${id}?new=1`);
}

export async function postEngagementMessage(f: FormData) {
  const u = await requireUser({ manufacturer: true, shared: true });
  const id = int(f, 'engagement_id'), body = str(f, 'body', 4000);
  const team = u.role === 'team';
  if (team && !teamCan(u, 'manufacturers')) notFound();
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
  if (team && !teamCan(u, 'manufacturers')) notFound();
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

/** Put a product on the launch tracker for a market, or move it to another stage. */
export async function saveLaunch(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2), stage = str(f, 'stage', 12) || 'selected';
  const to = safeNext(str(f, 'return', 200), '/m/products?tab=launches');
  if (!codes.includes(country) || !LAUNCH_STAGES.some(([k]) => k === stage)) back(to, { error: 'Pick a market and a stage.' });
  try {
    await withUser(u.id, (db) => db.query(`insert into launches (user_id, product_id, country, stage) values ($1, $2, $3, $4)
                                           on conflict (product_id, country) do update set stage = excluded.stage, updated_at = now()`,
      [u.id, product, country, stage]));
  } catch (e) {
    back(to, { error: dbMessage(e) });
  }
  back(to, { saved: '1' });
}

export async function removeLaunch(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from launches where id = $1 and user_id = $2', [int(f, 'launch_id'), u.id]));
  redirect('/m/products?tab=launches');
}

/** The free full read: one product of the manufacturer's choice, with every section open. Once only. */
export async function chooseSample(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'product_id');
  try {
    await withUser(u.id, (db) => db.query(`update manufacturer_profiles set sample_product_id = $2 where user_id = $1 and sample_product_id is null
                                           and exists (select 1 from mfr_products where id = $2 and user_id = $1)`, [u.id, id]));
  } catch (e) {
    back('/m', { error: dbMessage(e) });
  }
  redirect(`/m/products/${id}?sample=1`);
}

/** Move through the guided tour (step 1..n), or end it (step 0). Lands on the page the step explains. Step -1 is the
 *  welcome offer shown on Home right after sign-up. */
export async function tourGo(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const step = int(f, 'step') ?? 0;
  const t = step >= 1 && step <= TOUR.length ? TOUR[step - 1] : null;
  const product = await withUser(u.id, async (db) => {
    await db.query('update manufacturer_profiles set tour_step = $2 where user_id = $1', [u.id, t ? step : null]);
    return t?.path.includes('{product}')
      ? (await one(db, 'select id from mfr_products where user_id = $1 order by (molecule_id is null), created_at limit 1', [u.id]))?.id : null;
  });
  if (!t) redirect('/m');
  redirect(t.path.includes('{product}') ? (product ? t.path.replace('{product}', String(product)) : '/m/products') : t.path);
}

/** The market shown across the portal (market picker). */
export async function setPrimaryMarket(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const market = str(f, 'market', 2), to = safeNext(str(f, 'return', 200), '/m');
  if (codes.includes(market)) {
    await withUser(u.id, (db) => db.query('update manufacturer_profiles set primary_market = $2 where user_id = $1', [u.id, market]));
    // the market goes in the link too, so it shows even without a saved profile (the team)
    const [path, hash] = to.split('#');
    const clean = path.replace(/([?&])market=[A-Z]{2}&?/, '$1').replace(/[?&]$/, '');
    redirect(`${clean}${clean.includes('?') ? '&' : '?'}market=${market}${hash ? `#${hash}` : ''}`);
  }
  redirect(to);
}

/** Upload a catalogue (PDF, Excel, Word ...) or a starter-pack document. The team loads catalogues for the manufacturer
 *  and checks GMP certificates for the Verified badge. */
export async function uploadMfrFile(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const kind = str(f, 'kind', 20) || 'catalogue';
  const to = safeNext(str(f, 'return', 200), '/m/products#files');
  const path = to.split('#')[0], hash = to.includes('#') ? `#${to.split('#')[1]}` : '';
  if (!MFR_FILE_KINDS[kind]) back(path, { error: 'Pick what the file is.' });
  if (kind === 'catalogue') {
    let c: Awaited<ReturnType<typeof importCatalogue>> = null;
    try {
      c = await importCatalogue(u.id, u.email, f.get('file'));
    } catch (e) {
      if (isRedirect(e)) throw e;
      back(path, { error: errText(e) });
    }
    if (!c) back(path, { error: 'Choose a file.' });
    redirect(c!.reading ? '/m/products?reading=1#add' : `/m/products?added=${c!.added}&matched=${c!.matched}`);
  }
  try {
    const saved = await saveUpload(f.get('file'), u.id);
    if (!saved) back(path, { error: 'Choose a file.' });
    await withUser(u.id, async (db) => {
      await db.query('insert into mfr_files (user_id, kind, file_path, file_name, note) values ($1, $2, $3, $4, $5)',
        [u.id, kind, saved!.path, saved!.name, str(f, 'note', 300) || null]);
      await teamNote(db, `${MFR_FILE_KINDS[kind]} uploaded`,
        `${u.email} uploaded ${saved!.name}.${kind === 'gmp' ? ' Check it for the Verified badge.' : ''}`);
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(path, { error: errText(e) });
  }
  redirect(`${path}${path.includes('?') ? '&' : '?'}uploaded=${kind}${hash}`);
}

export async function deleteMfrFile(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from mfr_files where id = $1 and user_id = $2', [int(f, 'file_id'), u.id]));
  redirect('/m/products?removed=1#files');
}

/** Competitor watch: follow a molecule (from your products, or any molecule by name). */
export async function watchMolecule(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const to = safeNext(str(f, 'return', 200), '/m/products?tab=watch');
  if (!canUse(u.mfr_tier, 'competitors')) redirect('/m/plan?want=data');
  try {
    await withUser(u.id, async (db) => {
      if (f.get('all') === '1') {
        await db.query(`insert into watches (user_id, molecule_id) select distinct $1::uuid, molecule_id from mfr_products
                        where user_id = $1 and molecule_id is not null on conflict do nothing`, [u.id]);
        return;
      }
      const mol = int(f, 'molecule_id') ?? (str(f, 'name', 120) ? await findMolecule(db, str(f, 'name', 120)) : null);
      if (!mol) throw new Error('We do not track that molecule in your markets yet. Check the spelling or pick one of your products.');
      await db.query('insert into watches (user_id, molecule_id) values ($1, $2) on conflict do nothing', [u.id, mol]);
    });
  } catch (e) {
    if (isRedirect(e)) throw e;
    back(to, { error: errText(e) });
  }
  back(to, { saved: '1' });
}

export async function unwatchMolecule(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const to = safeNext(str(f, 'return', 200), '/m/products?tab=watch');
  await withUser(u.id, (db) => db.query('delete from watches where user_id = $1 and molecule_id = $2', [u.id, int(f, 'molecule_id')]));
  back(to, { saved: '1' });
}

/** Add a market to the plan, from the market switch. By card: a small subscription for that market, at the plan's billing
 *  interval ($49 a month, or ten months a year). Invoiced plans: a request the team turns on. */
export async function addMarket(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const market = str(f, 'market', 2);
  const to = safeNext(str(f, 'return', 200), `/m/market?market=${market}`);
  if (!codes.includes(market)) back(to, { error: 'Pick a market.' });
  if (!u.mfr_active) redirect(`/m/plan?want=data&market=${market}`);
  if (covers(u, market)) redirect(to);
  const d = await withUser(u.id, async (db) => ({
    price: await one(db, "select amount_usd from plan_prices where key = 'mfr_market'"),
    p: await one(db, 'select stripe_customer, stripe_subscription, billing_interval from manufacturer_profiles where user_id = $1', [u.id]),
  }));
  const monthly = Number(d.price?.amount_usd ?? 49);
  if (stripeReady() && d.p?.stripe_subscription) {
    const interval = d.p.billing_interval === 'year' ? 'year' : 'month';
    let url = '';
    try {
      url = await checkoutUrl({ userId: u.id, email: u.email, plan: 'market', planName: `extra market: ${countryName(market)}`,
        amountUsd: interval === 'year' ? yearly(monthly) : monthly, interval, markets: [market], origin: await origin(),
        customer: d.p.stripe_customer, back: to });
    } catch (e) {
      back(to, { error: `Card payment could not start: ${(e as Error).message}. Try again, or ask us to add it.` });
    }
    redirect(url);
  }
  await withUser(u.id, async (db) => {
    await db.query(`insert into plan_requests (user_id, wanted, note) values ($1, $2, $3)`,
      [u.id, `market:${market}`, `Add ${countryName(market)} to the plan ($${monthly} a month)`]);
    await teamNote(db, `Add a market: ${countryName(market)}`, `${u.email} asked to add ${countryName(market)} to their plan.`);
  });
  back(to, { saved: 'market' });
}


/** Tick a document on a product's checklist for a market, or untick it. */
export async function toggleChecklist(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2), item = str(f, 'item', 200);
  await withUser(u.id, (db) => str(f, 'done', 1) === '1'
    ? db.query(`insert into product_checklist (product_id, country, item, user_id) select id, $2, $3, $4 from mfr_products
        where id = $1 and user_id = $4 on conflict do nothing`, [product, country, item, u.id])
    : db.query('delete from product_checklist where product_id = $1 and country = $2 and item = $3 and user_id = $4', [product, country, item, u.id]));
  redirect(`/m/products/${product}?market=${country}#documents`);
}

/** The competitor brands a manufacturer meets for one product (comma or line separated). */
export async function addCompetitors(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), market = str(f, 'market', 2);
  const brands = [...new Set(str(f, 'brands', 600).split(/[,;\n]+/).map((b) => b.trim().replace(/\s+/g, ' ')).filter((b) => b.length >= 2 && b.length <= 80))].slice(0, 15);
  await withUser(u.id, async (db) => {
    for (const b of brands) {
      await db.query(`insert into mfr_competitors (user_id, product_id, brand) select $1, id, $3 from mfr_products where id = $2 and user_id = $1
                      on conflict do nothing`, [u.id, product, b]);
    }
  });
  redirect(`/m/products/${product}?market=${market}#competitors`);
}

export async function removeCompetitor(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), market = str(f, 'market', 2);
  await withUser(u.id, (db) => db.query('delete from mfr_competitors where id = $1 and user_id = $2', [int(f, 'id'), u.id]));
  redirect(`/m/products/${product}?market=${market}#competitors`);
}

/** What the product is used for, so competitors and prices compare like with like. */
export async function setUseGroup(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), market = str(f, 'market', 2), g = str(f, 'use_group', 20);
  await withUser(u.id, (db) => db.query('update mfr_products set use_group = $3 where id = $1 and user_id = $2',
    [product, u.id, ['eye_drops', 'eye_surgery', 'joint', 'nasal'].includes(g) ? g : null]));
  redirect(`/m/products/${product}?market=${market}#competitors`);
}
