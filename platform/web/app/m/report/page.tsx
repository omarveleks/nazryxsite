import Link from 'next/link';
import { VerifiedIcon } from '@/components/Icons';
import { redirect } from 'next/navigation';
import Brand from '@/components/Brand';
import PrintButton from '@/components/PrintButton';
import { hasData, loadLive, targetMarkets } from '@/components/MarketPicker';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, registeredLine } from '@/lib/format';
import { HIGH_DEMAND, canUse, countryName, covers, mfrProductsSql, reasons, tierIn, byMolecule } from '@/lib/mfr';

export const metadata = { title: 'Market read' };

// The market read: one market against the manufacturer's catalogue, written to act on. Printable (Save as PDF).
export default async function MarketRead({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  if (!canUse(u.mfr_tier, 'market_read')) redirect('/m/plan?want=data');
  const asked = sp.market && hasData(sp.market) ? sp.market : null;
  if (asked && !canUse(tierIn(u, asked), 'market_read')) redirect(`/m/add-market?market=${asked}`);
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const p = await one(db, 'select company_name, target_countries, verified_at from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(p?.target_countries, u.mfr_markets);
    const market = asked ?? targets.find((c) => hasData(c) && covers(u, c)) ?? targets.find(hasData) ?? 'TZ';
    const h = await one(db, `select (select count(*)::int from registrations where country = $1 and active) as products,
        (select count(distinct ltr_id)::int from registrations where country = $1 and active) as distributors,
        (select count(distinct coalesce(ltr_id, registrant_id))::int from registrations where country = $1 and active) as companies,
        (select count(*)::int from country_molecules where country = $1 and on_national_list and registrants = 0 and rankable) as open`, [market]);
    const products = await rows(db, `${mfrProductsSql(market)} where p.user_id = $1 order by g.score desc nulls last, p.name`, [u.id]);
    const partners = canUse(tierIn(u, market), 'matching') ? await rows(db, `select code, products, open_to, top_classes from partner_search($1) limit 5`, [market]) : [];
    const route = canUse(tierIn(u, market), 'pathway') ? await rows(db, 'select label, months_low, months_high from country_routes where country = $1 and scope = \'medicine\' and months_low is not null order by sort', [market]) : [];
    return { p, market, h, products, partners, route };
  });
  const m = countryName(d.market);
  const top = byMolecule(d.products.filter((p) => p.molecule_id && p.registrants != null)).slice(0, 10);
  const high = d.products.filter((p) => Number(p.demand ?? 0) >= HIGH_DEMAND).length;
  return (
    <div className="report">
      <div className="between no-print"><Link href="/m/market" className="btn-link">← Back</Link><PrintButton /></div>
      <Brand href="/m" />
      <div><span className="lbl">Market read · {fmtDate(new Date())}</span>
        <h1>{m}, for {d.p?.company_name}</h1>
        {d.p?.verified_at && <span className="pill blue" style={{ marginTop: 6 }}><VerifiedIcon /> Verified manufacturer</span>}
        <p className="muted" style={{ marginTop: 6 }}>Prepared for one manufacturer. Not for circulation.</p></div>

      <section className="card stack"><h2>1. The market</h2>
        <p>{d.h?.products.toLocaleString('en')} registered products held by {d.h?.distributors ? `${d.h.distributors} distributors` : `${d.h?.companies} companies`}. {d.h?.open} essential medicines have nobody registered.</p></section>

      <section className="card stack"><h2>2. Your portfolio against it</h2>
        <p>{high} of your {d.products.length} products are in high demand in {m}.</p>
        <table className="tbl"><thead><tr><th>Product</th><th>Competition</th><th>Why</th></tr></thead>
          <tbody>{top.map((p) => <tr key={p.id}><td><b>{p.inn ?? p.name}</b>{(p.packs > 1 || p.variants) && <div className="sub2">{p.packs > 1 ? `${p.packs} products` : ''}{p.packs > 1 && p.variants ? ' · ' : ''}{p.variants}</div>}</td><td className="small">{registeredLine(p.registrants, p.registrations)}</td>
            <td className="small">{(() => { const r = reasons(p).join(', '); return r.charAt(0).toUpperCase() + r.slice(1); })()}</td></tr>)}</tbody></table></section>

      {d.partners.length > 0 && (
        <section className="card stack"><h2>3. {d.h?.distributors ? 'Distributor' : 'Partner'} shortlist</h2>
          <table className="tbl"><tbody>{d.partners.map((x) => <tr key={x.code}><td><b>{d.h?.distributors ? 'Distributor' : 'Company'} {x.code}</b><div className="sub2">Strongest in {x.top_classes}</div></td>
            <td className="r small">{x.products} products · open to {x.open_to} of yours</td></tr>)}</tbody></table>
          <p className="note">We make every introduction.</p></section>)}

      {d.route.length > 0 && (
        <section className="card stack"><h2>4. Route and timeline</h2>
          {d.route.map((r) => <div key={r.label} className="between"><span>{r.label}</span><span className="small">{r.months_low != null ? `about ${r.months_low}–${r.months_high ?? r.months_low} months` : 'confirmed per product'}</span></div>)}</section>)}

      <section className="card stack"><h2>{d.partners.length ? (d.route.length ? 5 : 4) : 3}. What we would do next</h2>
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Start with the top three products above: the clearest openings.</li>
          <li>Check their dossiers against {m}&apos;s requirements before anything is filed.</li>
          <li>Shortlist two distributors and let us make the introductions.</li>
        </ol></section>
      <p className="note">Nazryx · contact@nazryx.com</p>
    </div>
  );
}
