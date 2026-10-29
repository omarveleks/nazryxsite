import Link from 'next/link';
import { Bar } from '@/components/ui';
import { countryName } from '@/lib/mfr';
import { tt } from '@/lib/i18n';
import { musd, pct, type Imports as T } from '@/lib/trade';

/** Medicine imports a market reported: how big, growing or not, from where, and what kind. */
export default function Imports({ data: t_, market, compact }: { data: T; market: string; compact?: boolean }) {
  const t = tt();
  const name = countryName(market);
  const max = Math.max(...t_.years.map((y) => y.value));
  const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  return (
    <section className="card stack" id="imports">
      <div className="card-h"><div><h2>{t('Medicines imported into {market}', { market: t(name) })}</h2>
        <p className="note">What {name} reported importing under HS 3004 (medicines in doses or retail packs), in US dollars at the border. Source: UN Comtrade{t_.read_at ? `, read ${date(t_.read_at)}` : ''}.</p></div>
        {!compact && <Link className="btn-link" href={`/m/coverage?market=${market}`}>{t('How we read {market}', { market: t(name) })}</Link>}</div>
      <div className="grid g3">
        <div className="tile t-blue"><span className="k">{t('Imports in {year}', { year: t_.latest!.year })}</span><span className="v num">{musd(t_.latest!.value)}</span>
          <span className="small">{t_.change != null ? `${t_.change >= 0 ? '+' : ''}${Math.round(t_.change * 100)}% on ${t_.latest!.year - 1}` : 'first year reported'}</span></div>
        <div className="tile t-mint"><span className="k">{t('Top origin')}</span><span className="v" style={{ fontSize: 20, lineHeight: 1.2 }}>{t_.origins[0]?.name ?? '—'}</span>
          <span className="small">{t_.origins[0] ? `${pct(t_.origins[0].share)} of imports` : ''}</span></div>
        <div className="tile t-lav"><span className="k">{t('Per kilogram')}</span><span className="v num">{t_.latest!.kg ? `$${(t_.latest!.value / t_.latest!.kg).toFixed(0)}` : '—'}</span>
          <span className="small">{t_.latest!.kg ? `${Math.round(t_.latest!.kg / 1000).toLocaleString('en')} tonnes` : 'weight not reported'}{t_.bulk ? ` · bulk (HS 3003) ${musd(t_.bulk)}` : ''}</span></div>
      </div>
      {!compact && (
        <div className="grid g2" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 6 }}><span className="lbl">{t('By year')}</span>
            {t_.years.map((y) => <Bar key={y.year} label={String(y.year)} value={y.value} max={max} right={musd(y.value)} />)}</div>
          <div className="stack" style={{ gap: 6 }}><span className="lbl">{t('Where from, {year}', { year: t_.latest!.year })}</span>
            {t_.origins.slice(0, 8).map((o) => <Bar key={o.name} label={o.name} value={o.value} max={t_.origins[0].value} right={`${musd(o.value)} · ${pct(o.share)}`} />)}</div>
        </div>)}
      {!compact && t_.lines.length > 0 && (
        <div className="stack" style={{ gap: 6 }}><span className="lbl">{t('What kind, {year}', { year: t_.latest!.year })}</span>
          <div className="grid g2" style={{ gap: '4px 16px' }}>
            {t_.lines.map((l) => <Bar key={l.hs} label={<>{l.label} <span className="sub2">{l.hs}</span></>} value={l.value} max={t_.lines[0].value} right={`${musd(l.value)} · ${pct(l.share)}`} />)}</div></div>)}
      <p className="small muted">{t('Border values, not shelf sales: add the margins on the way to the pharmacy for the retail market. A reporting lag of one to two years is normal.')}</p>
    </section>
  );
}
