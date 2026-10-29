import Link from 'next/link';
import { countryName } from '@/lib/mfr';

export type GridRow = { id: number; name: string; inn: string | null; molecule_id: number | null; group: string | null; packs: number; variants: string };
export type GridFact = { molecule_id: number; country: string; registrants: number; registrations: number; on_national_list: boolean };
export type Mine = { molecule_id: number; country: string };
export type Launch = { product_id: number; country: string; stage: string };

/** Every product against every market in one grid: registered by you, in progress, how many others sell it, or open. */
export default function PortfolioGrid({ rows, markets, facts, mine, launches, hasData, market }: {
  rows: GridRow[]; markets: string[]; facts: GridFact[]; mine: Mine[]; launches: Launch[]; hasData: (c: string) => boolean; market: string;
}) {
  const cell = (r: GridRow, c: string) => {
    if (!hasData(c)) return <span className="muted">—</span>;
    if (r.molecule_id && mine.some((m) => m.molecule_id === r.molecule_id && m.country === c)) return <span className="pill mint" title="A registration under your company holds this here">Yours</span>;
    const l = launches.find((x) => x.product_id === r.id && x.country === c);
    if (l) return <Link className="pill blue" href="/m/products?tab=launches" title="On your launch tracker">{l.stage}</Link>;
    const f = r.molecule_id ? facts.find((x) => x.molecule_id === r.molecule_id && x.country === c) : null;
    if (!f) return <span className="muted">—</span>;
    if (f.registrants === 0) return <Link className="pill peach" href={`/m/products/${r.id}?market=${c}`} title={f.on_national_list ? 'On the essential list, nobody registered' : 'Nobody registered'}>{f.on_national_list ? 'Open · essential' : 'Open'}</Link>;
    return <Link className="pill" href={`/m/products/${r.id}?market=${c}`} title={`${f.registrations} registered products from ${f.registrants} companies`}>{f.registrants} {f.registrants === 1 ? 'company' : 'companies'}</Link>;
  };
  const totals = markets.map((c) => ({
    c, yours: rows.filter((r) => r.molecule_id && mine.some((m) => m.molecule_id === r.molecule_id && m.country === c)).length,
    open: rows.filter((r) => r.molecule_id && facts.some((f) => f.molecule_id === r.molecule_id && f.country === c && f.registrants === 0)).length,
  }));
  return (
    <section className="card stack">
      <div className="card-h"><h2>Your portfolio across your markets</h2>
        <span className="note">{rows.length} {rows.length === 1 ? 'medicine' : 'medicines'} · {markets.length} {markets.length === 1 ? 'market' : 'markets'}</span></div>
      <div className="row small" style={{ gap: 14 }}>
        {totals.map((t) => <span key={t.c}><b>{countryName(t.c)}</b>: {t.yours ? `${t.yours} registered by you · ` : ''}{t.open} open</span>)}
      </div>
      <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Medicine</th>{markets.map((c) => <th key={c} className={c === market ? '' : 'hide-m'}>{countryName(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}><td><Link href={`/m/products/${r.id}?market=${market}`}><b>{r.inn ?? r.name}</b></Link>{r.variants && <div className="sub2">{r.variants}</div>}</td>
            {markets.map((c) => <td key={c} className={c === market ? '' : 'hide-m'}>{cell(r, c)}</td>)}</tr>))}
        </tbody></table></div>
      <p className="note"><span className="pill mint">Yours</span> a registration under your company · <span className="pill peach">Open</span> nobody registered ·
        a count: companies selling it there · <span className="pill blue">Stage</span> on your launch tracker. On a phone, the market shown is the one selected above.</p>
    </section>
  );
}
