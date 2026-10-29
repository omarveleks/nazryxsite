import { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { PRICE_SQL, priceFor, packOf, unitShort, type MoleculePrice } from '@/lib/prices';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { finderParams } from '@/lib/finder';

export const dynamic = 'force-dynamic';

// Tables as CSV, for Excel (UTF-8 with a byte-order mark so accents open right): the products against a market, the
// portfolio grid, the distributors in a market, and the tenders. Basic Market Data and up, in the plan's markets.
const csv = (head: string[], body: (string | number | null | undefined)[][]) => {
  const cell = (v: string | number | null | undefined) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n');
};
const file = (name: string, text: string) => new Response(text, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });

export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u) return new Response('Sign in', { status: 401 });
  if (u.role !== 'team' && u.account_type !== 'manufacturer') return new Response('Manufacturer accounts only', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const what = sp.get('what') ?? 'products', market = (sp.get('market') ?? 'TZ').toUpperCase().slice(0, 2);
  if (!canUse(tierIn(u, market), 'portfolio')) return new Response('Your plan does not include exports for this market.', { status: 403 });
  const day = new Date().toISOString().slice(0, 10);
  return withUser(u.id, async (db) => {
    if (what === 'products') {
      const list = await rows(db, `select p.name, p.molecule_id, m.inn, p.strength, p.dosage_form, m.category, cm.registrants, cm.registrations, cm.on_national_list, g.demand, g.score
          from mfr_products p left join molecules m on m.id = p.molecule_id
          left join country_molecules cm on cm.molecule_id = p.molecule_id and cm.country = $2
          left join visible_gap_scores g on g.molecule_id = p.molecule_id and g.country = $2 where p.user_id = $1 order by g.score desc nulls last, p.name`, [u.id, market]);
      const prices = await rows(db, `${PRICE_SQL} where country = $1 and molecule_id in (select molecule_id from mfr_products where user_id = $2 and molecule_id is not null)`, [market, u.id]) as MoleculePrice[];
      const price = (mid: number | null, form: string | null) => { const p = priceFor(prices.find((x) => x.molecule_id === mid), form); return p ? [`${p.currency} ${(Number(p.unit_price) * packOf(p)).toFixed(2)} per ${unitShort(p)}`, p.confidence ?? ''] : ['', '']; };
      return file(`nazryx-products-${market}-${day}.csv`, csv(
        ['Product', 'Molecule', 'Strength', 'Form', 'Class', `Companies selling in ${countryName(market)}`, 'Registered products', 'On essential list', 'Demand', 'Fit score', 'Price', 'Price confidence'],
        list.map((r) => [r.name, r.inn, r.strength, r.dosage_form, r.category, r.registrants, r.registrations, r.on_national_list ? 'yes' : '', r.demand, r.score, ...price(r.molecule_id, r.dosage_form)])));
    }
    if (what === 'grid') {
      const targets = ((await rows(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]))[0]?.target_countries ?? []) as string[];
      const list = await rows(db, `select distinct on (coalesce(m.inn, p.name)) p.id, coalesce(m.inn, p.name) as name, p.molecule_id from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by 2`, [u.id]);
      const facts = await rows(db, 'select molecule_id, country, registrants from country_molecules where country = any($1) and molecule_id = any($2)', [targets, list.map((x) => x.molecule_id).filter(Boolean)]);
      const mine = await rows(db, `select distinct r.molecule_id, r.country from registrations r join manufacturer_profiles mp on mp.user_id = $1 where r.active and r.manufacturer_id = any(mp.company_ids)`, [u.id]);
      return file(`nazryx-portfolio-grid-${day}.csv`, csv(['Medicine', ...targets.map(countryName)], list.map((r) => [r.name, ...targets.map((c) => {
        if (mine.some((m) => m.molecule_id === r.molecule_id && m.country === c)) return 'Registered by you';
        const f = facts.find((x) => x.molecule_id === r.molecule_id && x.country === c);
        return f ? (f.registrants === 0 ? 'Open' : `${f.registrants} companies`) : '';
      })])));
    }
    if (what === 'partners') {
      if (!canUse(tierIn(u, market), 'distributors')) return new Response('Distributor lists are part of Complete Market Access.', { status: 403 });
      const list = await rows(db, 'select * from partner_search($1, null, null, false, 0, $2)', [market, 'size']);
      const names = Object.fromEntries((await rows(db, 'select code, name from partner_names($1)', [market])).map((r) => [r.code, r.name]));
      return file(`nazryx-distributors-${market}-${day}.csv`, csv(['Code', 'Name', 'Registered products', 'Molecules', 'Classes', 'Strongest in', 'Open to your molecules', 'Local'],
        list.map((r) => [r.code, names[r.code] ?? '', r.products, r.molecules, r.classes, r.top_classes, r.open_to, r.local_maker ? 'yes' : ''])));
    }
    if (what === 'finder') {
      const p = finderParams(Object.fromEntries(sp.entries()));
      const list = await rows(db, 'select * from find_opportunities($1, $2, $3, $4, $5, $6, $7, false, $8)', [market, p.category, p.demand, p.max, p.essential, p.form, p.price, p.mine]);
      return file(`nazryx-opportunities-${market}-${day}.csv`, csv(['Molecule', 'Class', 'Companies selling it', 'Registered products', 'On essential list', 'On WHO list', 'Demand', 'Fit score', 'Forms', 'Price USD per unit', 'Unit', 'Price confidence', 'In your catalogue', 'Made locally'],
        list.map((r) => [r.inn, r.category, r.registrants, r.registrations, r.on_national_list ? 'yes' : '', r.on_who_eml ? 'yes' : '', r.demand, r.score, r.forms, r.unit_usd, r.unit, r.confidence, r.mine ? 'yes' : '', r.local_made])));
    }
    if (what === 'tenders') {
      const list = await rows(db, `select coalesce(t.title_en, t.title) as title, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, t.published, t.closing, t.awarded, t.quantity, t.unit_price, t.value, t.currency, t.bidders, t.url,
          exists (select 1 from mfr_products p where p.user_id = $2 and p.molecule_id = any(t.molecule_ids)) as mine
          from tenders t where t.country = $1 order by coalesce(t.awarded, t.closing, t.published) desc nulls last limit 2000`, [market, u.id]);
      const d = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');
      return file(`nazryx-tenders-${market}-${day}.csv`, csv(['Title', 'Buyer', 'Stage', 'Published', 'Closing', 'Awarded', 'Quantity', 'Unit price', 'Value', 'Currency', 'Bidders', 'Your molecule', 'Link'],
        list.map((r) => [r.title, r.buyer, r.stage, d(r.published), d(r.closing), d(r.awarded), r.quantity, r.unit_price, r.value, r.currency, r.bidders, r.mine ? 'yes' : '', r.url])));
    }
    return new Response('Unknown export', { status: 404 });
  });
}
