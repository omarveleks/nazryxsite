import Link from 'next/link';
import { Bar } from '@/components/ui';
import { countryName } from '@/lib/mfr';
import { musd, pct, type Imports as T } from '@/lib/trade';

/** Medicine imports a market reported: how big, growing or not, from where, and what kind. */
export default function Imports({ t, market, compact }: { t: T; market: string; compact?: boolean }) {
  const name = countryName(market);
  const max = Math.max(...t.years.map((y) => y.value));
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  return (
    <section className="card stack" id="imports">
      <div className="card-h"><div><h2>Medicines imported into {name}</h2>
        <p className="note">What {name} reported importing under HS 3004 (medicines in doses or retail packs), in US dollars at the border. Source: UN Comtrade{t.read_at ? `, read ${date(t.read_at)}` : ''}.</p></div>
        {!compact && <Link className="btn-link" href={`/m/coverage?market=${market}`}>How we read {name}</Link>}</div>
      <div className="grid g3">
        <div className="tile t-blue"><span className="k">Imports in {t.latest!.year}</span><span className="v num">{musd(t.latest!.value)}</span>
          <span className="small">{t.change != null ? `${t.change >= 0 ? '+' : ''}${Math.round(t.change * 100)}% on ${t.latest!.year - 1}` : 'first year reported'}</span></div>
        <div className="tile t-mint"><span className="k">Top origin</span><span className="v" style={{ fontSize: 20, lineHeight: 1.2 }}>{t.origins[0]?.name ?? '—'}</span>
          <span className="small">{t.origins[0] ? `${pct(t.origins[0].share)} of imports` : ''}</span></div>
        <div className="tile t-lav"><span className="k">Per kilogram</span><span className="v num">{t.latest!.kg ? `$${(t.latest!.value / t.latest!.kg).toFixed(0)}` : '—'}</span>
          <span className="small">{t.latest!.kg ? `${Math.round(t.latest!.kg / 1000).toLocaleString('en')} tonnes` : 'weight not reported'}{t.bulk ? ` · bulk (HS 3003) ${musd(t.bulk)}` : ''}</span></div>
      </div>
      {!compact && (
        <div className="grid g2" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}><span className="lbl">By year</span>
            {t.years.map((y) => <Bar key={y.year} label={String(y.year)} value={y.value} max={max} right={musd(y.value)} />)}</div>
          <div className="stack" style={{ gap: 6 }}><span className="lbl">Where from, {t.latest!.year}</span>
            {t.origins.slice(0, 8).map((o) => <Bar key={o.name} label={o.name} value={o.value} max={t.origins[0].value} right={`${musd(o.value)} · ${pct(o.share)}`} />)}</div>
        </div>)}
      {!compact && t.lines.length > 0 && (
        <div className="stack" style={{ gap: 6 }}><span className="lbl">What kind, {t.latest!.year}</span>
          <div className="grid g2" style={{ gap: '4px 16px' }}>
            {t.lines.map((l) => <Bar key={l.hs} label={<>{l.label} <span className="sub2">{l.hs}</span></>} value={l.value} max={t.lines[0].value} right={`${musd(l.value)} · ${pct(l.share)}`} />)}</div></div>)}
      <p className="small muted">Border values, not shelf sales: add the margins on the way to the pharmacy for the retail market. A reporting lag of one to two years is normal.</p>
    </section>
  );
}
