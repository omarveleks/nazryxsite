import Link from 'next/link';
import Shell from '@/components/Shell';
import { loadLive, dataMarkets, targetMarkets } from '@/components/MarketPicker';
import { ConfidenceChip, Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { PRICE_SQL, packOf, priceFor, unitShort, type MoleculePrice } from '@/lib/prices';

export const metadata = { title: 'Pricing' };

const STEPS: [string, string, string][] = [
  ['freight', 'Freight and insurance', 'to the port or airport of entry'],
  ['duty', 'Duty and border fees', 'import duty, inspection, port handling'],
  ['distributor', 'Distributor margin', 'the importer who holds the registration and sells to pharmacies'],
  ['pharmacy', 'Pharmacy margin', 'retail mark-up'],
  ['vat', 'VAT', 'where medicines are not exempt'],
];
type Costs = Record<string, number>;

// Your ex-works price, landed and marked up the way each market does it, against what the shelf pays today, in every
// market at once. The margins are each market's typical shares; every one can be overridden to test a deal.
export default async function Simulator({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const num = (v?: string) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n >= 0 ? n : null; };
  const exw = num(sp.exw), units = num(sp.units);
  const over: Partial<Costs> = Object.fromEntries(STEPS.map(([k]) => [k, num(sp[k])]).filter(([, v]) => v != null).map(([k, v]) => [k, (v as number) / 100]));
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.id]);
    const markets = dataMarkets(targetMarkets(prof?.target_countries, u.mfr_markets));
    const mine = await rows(db, `select distinct m.id, m.inn, min(p.dosage_form) as form from mfr_products p join molecules m on m.id = p.molecule_id where p.user_id = $1 group by m.id, m.inn order by m.inn`, [u.id]);
    const molecule = mine.find((x) => x.id === Number(sp.molecule)) ?? (Number(sp.molecule) ? await one(db, 'select id, inn, dosage_form as form from molecules where id = $1', [Number(sp.molecule)]) : null) ?? mine[0] ?? null;
    const prices = molecule ? await rows(db, `${PRICE_SQL} where molecule_id = $1 and country = any($2)`, [molecule.id, markets]) as MoleculePrice[] : [];
    const costs = Object.fromEntries((await rows(db, 'select * from market_costs where country = any($1)', [markets])).map((c) => [c.country, c]));
    return { markets, mine, molecule, prices, costs };
  });
  const mol = d.molecule;
  const row = (c: string) => {
    const open = canUse(tierIn(u, c), 'market');
    const p = priceFor(d.prices.find((x) => x.country === c), mol?.form);
    const base = d.costs[c] ?? {};
    const shares: Costs = Object.fromEntries(STEPS.map(([k]) => [k, over[k] ?? Number(base[k] ?? 0)]));
    const chain = STEPS.reduce((m, [k]) => m * (1 + shares[k]), 1);
    const liquid = p ? p.unit === 'ml' || p.unit === 'g' : false;
    const pack = units ?? (p ? (liquid ? packOf(p) : 30) : 30);
    const perUSD = p && Number(p.unit_usd) ? Number(p.unit_price) / Number(p.unit_usd) : null;
    const shelfUsd = exw != null ? (exw / pack) * chain : null;                            // USD per unit on the shelf
    const shelf = shelfUsd != null && perUSD ? shelfUsd * perUSD : null;                     // local currency per unit
    const target = p ? (Number(p.unit_usd) / chain) * pack : null;                          // max ex-works per pack to match the median
    const lo = p ? Number(p.lo ?? p.unit_price) : null, hi = p ? Number(p.hi ?? p.unit_price) : null, avg = p ? Number(p.unit_price) : null;
    const where = shelf == null || lo == null ? null : shelf <= lo ? ['mint', 'Cheapest'] : shelf <= avg! ? ['mint', 'Competitive'] : shelf <= hi! ? ['peach', 'Premium'] : ['peach', 'Above market'];
    return { c, open, p, shares, chain, liquid, pack, shelf, shelfUsd, target, lo, hi, avg, where, perUSD };
  };
  const table = d.markets.map(row);
  const focus = table.find((r) => r.c === sp.market) ?? table.find((r) => r.open && r.p) ?? table[0];
  const money = (v: number) => (v < 1 ? v.toFixed(3) : fmtMoney(v));
  return (
    <Shell user={u} title={t('Pricing')} sub={t('Your ex-works price on every shelf, against what the market pays')}>
      <form method="get" className="card tight stack" style={{ gap: 10 }} aria-label={t('Pricing inputs')}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="small" style={{ flex: '2 1 200px' }}>{t('Molecule')}
            <select className="input" name="molecule" defaultValue={mol?.id ?? ''}>
              {d.mine.length === 0 && <option value="">{t('Add products to pick one')}</option>}
              {d.mine.map((m) => <option key={m.id} value={m.id}>{m.inn}</option>)}
              {mol && !d.mine.some((m) => m.id === mol.id) && <option value={mol.id}>{mol.inn}</option>}
            </select></label>
          <label className="small" style={{ flex: '1 1 150px' }}>{t('Your ex-works price (USD per pack)')}
            <input className="input" name="exw" type="number" step="any" min="0" defaultValue={exw ?? ''} placeholder="e.g. 2.40" /></label>
          <label className="small" style={{ flex: '1 1 120px' }}>{t('Units per pack')}
            <input className="input" name="units" type="number" step="any" min="0" defaultValue={units ?? ''} placeholder="30" /></label>
          <button className="btn btn-blue btn-sm" type="submit">{t('Simulate')}</button>
        </div>
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Override the margins (percent; blank keeps each market’s typical share)')}</summary>
          <div className="row" style={{ marginTop: 8 }}>
            {STEPS.map(([k, l]) => <label key={k} className="small" style={{ flex: '1 1 120px' }}>{t(l)}
              <input className="input" name={k} type="number" step="any" min="0" max="500" defaultValue={over[k] != null ? Math.round(over[k]! * 1000) / 10 : ''} placeholder={t('market')} /></label>)}
          </div>
        </details>
      </form>
      {!mol ? <Empty>Add your products first; the simulator prices each of your molecules against every market. <Link href="/m/products">{t('My products')}</Link></Empty> : (<>
        <section className="card stack">
          <div className="card-h"><div><h2>{t('{molecule} across your markets', { molecule: mol.inn })}</h2>
            <p className="note">{exw != null ? `At $${money(exw)} ex-works per pack of ${focus?.pack ?? 30}, landed and marked up the way each market does it.` : 'Enter your ex-works price to see where it lands on each shelf. Without it: the most you could charge to match each market’s median.'}</p></div></div>
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>{t('Market')}</th><th className="r">{t('Market median')}</th><th className="r hide-m">{t('Range')}</th><th className="r">{t('Max ex-works per pack')}</th>{exw != null && <><th className="r">{t('Your shelf price')}</th><th>{t('Position')}</th></>}<th className="r hide-m">{t('Mark-ups')}</th></tr></thead>
            <tbody>{table.map((r) => (
              <tr key={r.c}>
                <td><Link href={`/m/simulator?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]), market: r.c, molecule: String(mol.id) }).toString()}`}><b>{t(countryName(r.c))}</b></Link>
                  {r.p && <div className="sub2">per {unitShort(r.p)}{r.p.strength ? ` · ${r.p.strength}` : ''}</div>}</td>
                {!r.open ? <td colSpan={exw != null ? 5 : 3}><PlanLock compact need="data" title={t('{market} prices', { market: t(countryName(r.c)) })} u={u} market={r.c} /></td>
                  : !r.p ? <td colSpan={exw != null ? 5 : 3} className="small muted">No shelf price read for {mol.inn} in {countryName(r.c)} yet.</td> : (<>
                  <td className="r"><span className="num">{r.p.currency} {money(r.avg! * (r.liquid ? r.pack : 1))}</span> <ConfidenceChip level={r.p.confidence} /><div className="sub2">${money(Number(r.p.unit_usd) * (r.liquid ? r.pack : 1))}</div></td>
                  <td className="r hide-m small num">{money(r.lo! * (r.liquid ? r.pack : 1))}–{money(r.hi! * (r.liquid ? r.pack : 1))}</td>
                  <td className="r"><b className="num">${money(r.target!)}</b>{exw != null && <div className={`sub2 ${r.target! >= exw ? '' : ''}`}>{r.target! >= exw ? `+${Math.round(((r.target! - exw) / exw) * 100)}% headroom` : `${Math.round(((r.target! - exw) / exw) * 100)}% to cut`}</div>}</td>
                  {exw != null && <><td className="r num">{r.p.currency} {money(r.shelf! * (r.liquid ? r.pack : 1))}<div className="sub2">${money(r.shelfUsd! * (r.liquid ? r.pack : 1))}</div></td>
                    <td><span className={`pill ${r.where![0]}`}>{r.where![1]}</span></td></>}
                </>)}
                <td className="r hide-m small muted num">×{r.chain.toFixed(2)}</td>
              </tr>))}</tbody>
          </table></div>
          <p className="small muted">{t('Max ex-works: the price per pack at which, after every mark-up, the product sells at the market median. Mark-ups: the factor from ex-works to shelf.')}</p>
        </section>
        {focus && focus.open && (
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Step by step in {market}', { market: t(countryName(focus.c)) })}</h2>
              <p className="note">{exw != null ? `From $${money(exw)} ex-works per pack to the shelf.` : `Backwards from the median shelf price to the most you can charge.`}</p></div>
              <Link className="btn-link" href={`/m/market?market=${focus.c}`}>{t('Market')}</Link></div>
            {(() => {
              const perPack = exw ?? focus.target;
              if (perPack == null) return <Empty>No shelf price read for {mol.inn} in {countryName(focus.c)} yet; enter an ex-works price to see the chain anyway.</Empty>;
              let running = perPack;
              const steps = STEPS.map(([k, l, note]) => { const before = running; running = running * (1 + focus.shares[k]); return { k, l, note, share: focus.shares[k], before, after: running }; });
              return (<div className="tbl-wrap" tabIndex={0}><table className="tbl">
                <thead><tr><th>{t('Step')}</th><th className="r">{t('Share')}</th><th className="r">{t('USD per pack')}</th>{focus.perUSD && <th className="r hide-m">{focus.p!.currency} per pack</th>}</tr></thead>
                <tbody>
                  <tr><td><b>{t('Ex-works')}</b><div className="sub2">{t('your price, at the factory gate')}</div></td><td className="r"></td><td className="r num">${money(perPack)}</td>{focus.perUSD && <td className="r hide-m num">{money(perPack * focus.perUSD)}</td>}</tr>
                  {steps.map((s) => <tr key={s.k}><td>{t(s.l)}<div className="sub2">{t(s.note)}</div></td><td className="r num">{Math.round(s.share * 1000) / 10}%</td><td className="r num">${money(s.after)}<div className="sub2">+${money(s.after - s.before)}</div></td>{focus.perUSD && <td className="r hide-m num">{money(s.after * focus.perUSD)}</td>}</tr>)}
                  <tr><td><b>{t('On the shelf')}</b><div className="sub2">{focus.p ? `market median ${focus.p.currency} ${money(focus.avg! * (focus.liquid ? focus.pack : 1))} per ${focus.liquid ? 'pack' : 'pack of ' + focus.pack}` : ''}</div></td><td className="r num">×{focus.chain.toFixed(2)}</td><td className="r"><b className="num">${money(running)}</b></td>{focus.perUSD && <td className="r hide-m"><b className="num">{money(running * focus.perUSD)}</b></td>}</tr>
                </tbody></table></div>);
            })()}
            <p className="small muted">Shares are {countryName(focus.c)}&rsquo;s typical ones, kept by our team from distributor terms and tariff schedules; override any of them above to test a deal. Shelf prices are read from pharmacies and official lists.</p>
          </section>)}
      </>)}
    </Shell>
  );
}
