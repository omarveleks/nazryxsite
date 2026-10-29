import Link from 'next/link';
import { countryName } from '@/lib/mfr';
import { Empty } from '@/components/ui';

type Check = { kind: string; country: string | null; form_type: string | null; value: string | null; n: number | null; detail: any;
  inn: string | null; product: string | null; user_id: string | null; email: string | null; total: number };

const pct = (v: string | number | null) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);
const num = (v: unknown) => (v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: 2 }));
const where = (x: Check) => [x.inn, x.country && countryName(x.country)].filter(Boolean).join(' · ');

// alert kinds the worker writes (ingest/price_checks.py), in the order the team should look at them
const ALERTS: [string, string, (x: Check) => string][] = [
  ['outlier', 'Shelf price far from its neighbours (over 3x either way)', (x) =>
    `${where(x)}: shelf ${num(x.detail?.shelf)}, neighbours say ${num(x.detail?.estimate)} per ${x.detail?.unit}${x.detail?.strength ? ` (${x.detail.strength})` : ''}`],
  ['implausible', 'Unit price no medicine has (a pack read as one unit, or a currency mix-up)', (x) =>
    `${where(x)}: $${num(x.value)} per ${x.detail?.unit} (${x.detail?.basis})`],
  ['wide_range', 'Very wide price range in one market (mixed packs or forms)', (x) =>
    `${where(x)}: ${num(x.detail?.lo)} to ${num(x.detail?.hi)} per ${x.detail?.unit} (${num(x.value)}x)`],
  ['no_price', 'Portfolio products with no price for their form', (x) =>
    `${where(x)}: ${x.n} product${x.n === 1 ? '' : 's'} (${(x.detail?.forms ?? []).join(', ')})`],
  ['single_source', 'Estimates resting on one country only', (x) => `${where(x)}: from ${x.detail?.source}`],
  ['no_gap', 'Estimates with no price gap known for that country and product type (taken at 1.0)', (x) => `${where(x)}: from ${x.detail?.source}`],
  ['fx_stale', 'Exchange rates not updated', (x) => `${x.detail?.currency}: ${num(x.value)} days old`],
];
const CLASSES: [string, string][] = [
  ['class_device_is_medicine', 'Filed as a device, but the ingredient is a medicine'],
  ['class_supplement_is_medicine', 'Filed as a supplement, but the ingredient is a medicine'],
  ['class_says_supplement', 'Filed as a medicine, but the name says dietary supplement'],
  ['class_sold_as_device', 'Filed as a medicine, sold as a medical device in most markets'],
  ['class_missing', 'Matched medicines with no therapeutic class'],
];

export default function ChecksSection({ checks }: { checks: Check[] | null }) {
  if (!checks) return null;
  const of = (k: string) => checks.filter((x) => x.kind === k);
  const acc = of('accuracy').sort((a, b) => (a.country ?? '').localeCompare(b.country ?? '') || (a.form_type === 'all' ? -1 : b.form_type === 'all' ? 1 : 0));
  const list = (k: string, label: string, line: (x: Check) => React.ReactNode) => {
    const xs = of(k);
    if (!xs.length) return null;
    return (
      <details key={k}><summary className="small"><b>{xs[0].total.toLocaleString('en')}</b> · {label}</summary>
        <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{xs.map((x, i) => <li key={i}>{line(x)}</li>)}</ul>
        {xs[0].total > xs.length && <p className="note">Showing {xs.length} of {xs[0].total.toLocaleString('en')}.</p>}
      </details>);
  };
  return (
    <section className="card stack" id="checks">
      <div className="card-h"><div><h2>Price and class checks</h2><p className="note">Run after every price rebuild. Accuracy: where a market&rsquo;s real
        shelf price is known (3 or more prices), what we would have estimated from its neighbours alone. Typical error is the middle
        of the errors; bias above 100% means estimates run high.</p></div></div>
      {acc.length === 0 ? <Empty>No checks yet: they appear after the next price rebuild.</Empty> : (
        <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Market</th><th>Product type</th><th className="r">Medicines tested</th>
          <th className="r">Typical error</th><th className="r">Within 50%</th><th className="r">Bias</th></tr></thead>
          <tbody>{acc.map((x, i) => (
            <tr key={i}><td>{x.form_type === 'all' ? <b>{countryName(x.country!)}</b> : ''}</td><td>{x.form_type === 'all' ? <b>All</b> : x.form_type}</td>
              <td className="r num">{x.n}</td>
              <td className="r num">{Number(x.value) > 0.5 ? <span className="pill peach">{pct(x.value)}</span> : pct(x.value)}</td>
              <td className="r num">{pct(x.detail?.within_50)}</td><td className="r num">{pct(x.detail?.bias)}</td></tr>))}</tbody></table></div>)}
      <div className="stack" style={{ gap: 6 }}>
        {ALERTS.map(([k, label, line]) => list(k, label, line))}
        {CLASSES.map(([k, label]) => list(k, label, (x) => <>{x.product}{x.user_id && <> · <Link href={`/admin/accounts/${x.user_id}`}>{x.email}</Link></>}
          <span className="sub2"> · {x.detail?.why}</span></>))}
        {list('gap', 'Price gaps in use (measured on 10 or more medicines, else set by hand)', (x) =>
          `${countryName(x.country!)} vs ${x.detail?.source}, ${x.form_type}: ${num(x.value)}x (${x.detail?.basis}${x.n ? `, ${x.n} medicines` : ''})`)}
      </div>
    </section>);
}
