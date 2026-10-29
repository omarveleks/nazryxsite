import { tt } from '@/lib/i18n';
/** How a market's price moved: one reading a day, per unit, brand blue, with a table view (as YearChart). */
export default function PriceHistory({ rows, currency, unit, pack }: { rows: { day: string | Date; unit_price: number; confidence: string }[]; currency: string; unit: string; pack: number }) {
  const t = tt();
  const pts = rows.map((r) => ({ day: new Date(r.day), v: r.unit_price * pack, c: r.confidence }));
  if (pts.length < 2) return null;
  const W = 640, H = 160, padL = 48, padB = 22, padT = 10;
  const vals = pts.map((p) => p.v), lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || hi || 1, y0 = Math.max(0, lo - span * 0.2), y1 = hi + span * 0.2;
  const t0 = pts[0].day.getTime(), t1 = pts[pts.length - 1].day.getTime() || t0 + 1;
  const x = (d: Date) => padL + ((d.getTime() - t0) / (t1 - t0 || 1)) * (W - padL - 8);
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - y0) / (y1 - y0 || 1));
  const fmt = (v: number) => v.toLocaleString('en', { maximumFractionDigits: v < 10 ? 2 : 0 });
  const date = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const ticks = [y0, (y0 + y1) / 2, y1];
  const first = pts[0].v, last = pts[pts.length - 1].v, change = first ? (last - first) / first : 0;
  return (
    <figure style={{ margin: 0 }} className="stack">
      <div className="between"><span className="lbl">{t('Price over time')}</span>
        <span className="small">{date(pts[0].day)} to {date(pts[pts.length - 1].day)} · {change === 0 ? 'unchanged' : `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Price over time')} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((t, i) => (<g key={i}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#ECEAE3" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#5E5E58">{fmt(t)}</text></g>))}
        <path d={path} fill="none" stroke="#0066FF" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (i === 0 || i === pts.length - 1 || pts.length <= 20) && (
          <circle key={i} cx={x(p.day)} cy={y(p.v)} r={i === pts.length - 1 ? 4 : 2.5} fill={p.c === 'estimated' ? '#FFFFFF' : '#0066FF'} stroke="#0066FF" strokeWidth="2">
            <title>{`${date(p.day)}: ${currency} ${fmt(p.v)} per ${unit} (${p.c})`}</title></circle>))}
        <text x={padL} y={H - 6} fontSize="10" fill="#5E5E58">{date(pts[0].day)}</text>
        <text x={W - 4} y={H - 6} fontSize="10" fill="#5E5E58" textAnchor="end">{date(pts[pts.length - 1].day)}</text>
      </svg>
      <details><summary className="note" style={{ cursor: 'pointer' }}>{t('Show as table')}</summary>
        <table className="tbl small"><thead><tr><th>{t('Day')}</th><th className="r">Per {unit}</th><th>{t('Basis')}</th></tr></thead>
          <tbody>{[...pts].reverse().map((p, i) => <tr key={i}><td>{p.day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td className="r num">{currency} {fmt(p.v)}</td><td>{p.c}</td></tr>)}</tbody></table></details>
    </figure>
  );
}
