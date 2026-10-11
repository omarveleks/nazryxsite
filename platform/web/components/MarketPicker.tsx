import Link from 'next/link';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';

/** The manufacturer's target markets. 'all' is the general view across them. */
export function targetMarkets(targets?: string[] | null): string[] {
  const t = (targets ?? []).filter((c) => MFR_COUNTRIES.some((x) => x.code === c));
  return t.length ? t : ['TZ'];
}
export function pickMarket(param: string | undefined, targets: string[]): string {
  if (param === 'all' && targets.length > 1) return 'all';
  if (param && targets.includes(param)) return param;
  return targets.length > 1 ? 'all' : targets[0];
}
export const hasData = (c: string) => Boolean(MFR_COUNTRIES.find((x) => x.code === c)?.data);
export const dataMarkets = (targets: string[]) => targets.filter(hasData);

/** Pick a market or the general view. Keeps the page's other query parameters. */
export default function MarketPicker({ targets, current, path, params = {}, noAll }: { targets: string[]; current: string; path: string; params?: Record<string, string | undefined>; noAll?: boolean }) {
  if (targets.length < 2) return null;
  const href = (m: string) => {
    const q = new URLSearchParams(Object.entries({ ...params, market: m }).filter(([, v]) => v) as [string, string][]);
    return `${path}?${q}`;
  };
  return (
    <nav className="row" aria-label="Market" style={{ gap: 6 }}>
      <span className="lbl" style={{ marginRight: 4 }}>Market</span>
      {[...(noAll ? [] : ['all']), ...targets].map((m) => (
        <Link key={m} href={href(m)} className={`pill ${m === current ? 'solid' : ''}`} aria-current={m === current ? 'page' : undefined} style={{ textDecoration: 'none' }}>
          {m === 'all' ? 'All your markets' : countryName(m)}{m !== 'all' && !hasData(m) ? ' · agency' : ''}
        </Link>))}
    </nav>
  );
}

/** For a market where we do not publish data yet: say so plainly and offer the way forward. */
export function AgencyMarket({ code }: { code: string }) {
  return (
    <section className="card stack">
      <h2>{countryName(code)}: our team covers it directly</h2>
      <p className="muted">We have not loaded {countryName(code)}&apos;s register and essential medicines list into the portal yet. Our team works the
        market for you in the meantime, and the screens fill in as soon as the data is in.</p>
      <div className="row">
        <Link className="btn btn-blue btn-sm" href={`/m/services/report?country=${code}`}>Order a {countryName(code)} report</Link>
        <Link className="btn btn-ghost btn-sm" href="/expert">Ask our team</Link>
      </div>
    </section>
  );
}
