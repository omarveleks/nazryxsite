import Link from 'next/link';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';

/** The manufacturer's target markets. 'all' is the general view across them. */
export function targetMarkets(targets?: string[] | null): string[] {
  const t = MFR_COUNTRIES.map((x) => x.code).filter((c) => (targets ?? []).includes(c));
  return t.length ? t : ['TZ'];
}
export function pickMarket(param: string | undefined, targets: string[]): string {
  if (param === 'all' && targets.length > 1) return 'all';
  if (param && targets.includes(param)) return param;
  return targets.length > 1 ? 'all' : targets[0];
}
// Markets whose data is loaded (registrations present), refreshed at most once a minute. Call loadLive(db) in the
// page's data loader before using hasData().
let LIVE = new Set<string>(['TZ']);
let LIVE_AT = 0;
export async function loadLive(db: { query: (q: string) => Promise<{ rows: { country: string }[] }> }) {
  if (Date.now() - LIVE_AT < 60_000) return;
  const r = await db.query('select distinct country from country_molecules where registrations > 0');
  LIVE = new Set(r.rows.map((x) => x.country));
  LIVE_AT = Date.now();
}
export const hasData = (c: string) => LIVE.has(c);
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
          {m === 'all' ? 'All your markets' : countryName(m)}
        </Link>))}
    </nav>
  );
}

/** A market without screens in the portal: our team works it directly. Kept short on purpose. */
export function AgencyMarket({ code }: { code: string }) {
  const core = MFR_COUNTRIES.find((c) => c.code === code)?.core;
  return (
    <section className="card stack">
      <h2>{countryName(code)}</h2>
      <p className="muted">{core ? `Our team is preparing your ${countryName(code)} view.` : `Our team works ${countryName(code)} with you directly.`}
        {' '}Tell us what you need there and we come back within one working day.</p>
      <Link className="btn btn-blue btn-sm" href="/m/services" style={{ alignSelf: 'flex-start' }}>Talk to our team</Link>
    </section>
  );
}
