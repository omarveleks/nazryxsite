import Link from 'next/link';
import { setPrimaryMarket } from '@/app/actions/mfr';
import { VerifiedIcon } from './Icons';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';

/** The manufacturer's target markets, in the order of the market list. */
export function targetMarkets(targets?: string[] | null): string[] {
  const t = MFR_COUNTRIES.map((x) => x.code).filter((c) => (targets ?? []).includes(c));
  return t.length ? t : ['TZ'];
}
/** The market a page shows: one named in the link, else the manufacturer's chosen market, else the first with data. */
export function pickMarket(param: string | undefined, targets: string[], primary?: string | null): string {
  if (param && targets.includes(param)) return param;
  if (primary && targets.includes(primary)) return primary;
  return targets.find(hasData) ?? targets[0];
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

/** Switch the market shown across the portal. Only there for manufacturers with more than one market. */
export default function MarketPicker({ targets, current, path }: { targets: string[]; current: string; path: string }) {
  if (targets.length < 2) return null;
  return (
    <form action={setPrimaryMarket} className="row" aria-label="Market" style={{ gap: 6 }}>
      <input type="hidden" name="return" value={path} />
      <span className="lbl" style={{ marginRight: 4 }}>Market</span>
      {targets.map((m) => (
        <button key={m} type="submit" name="market" value={m} className={`pill ${m === current ? 'solid' : ''}`} aria-pressed={m === current}
          style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }}>{countryName(m)}</button>))}
    </form>
  );
}

/** "Managed by Nazryx", with the trust badge. */
export const ManagedBadge = () => <span className="pill blue" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> Managed by Nazryx</span>;

/** A market our team runs for the manufacturer on the ground. */
export function AgencyMarket({ code }: { code: string }) {
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <ManagedBadge />
      <h2 style={{ fontSize: 26 }}>{countryName(code)}</h2>
      <div className="grid g3">
        {[['Market read', 'What is open, what is crowded and what it is worth, for your products.'],
          ['Distributor and registration', 'The right partner, the dossier and the filing, handled in the country.'],
          ['Weekly reports', 'One contact and a written update on how your products are doing.']].map(([t, x]) => (
          <div key={t} className="tile t-white"><span className="k">{t}</span><span className="small">{x}</span></div>))}
      </div>
      <Link className="btn btn-blue btn-sm" href="/m/services" style={{ alignSelf: 'flex-start' }}>Talk to our team about {countryName(code)}</Link>
    </section>
  );
}

/** The manufacturer's other markets that our team runs for them, as a row of badged tiles. */
export function ManagedShowcase({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="lbl">Also in your plan</span>
      <div className="grid g3">{codes.map((c) => (
        <Link key={c} href="/m/services" className="tile t-white" style={{ gap: 8 }}>
          <span className="v" style={{ fontSize: 20 }}>{countryName(c)}</span><ManagedBadge />
        </Link>))}</div>
    </section>
  );
}
