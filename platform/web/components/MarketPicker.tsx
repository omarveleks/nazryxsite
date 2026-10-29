import Link from 'next/link';
import { tt } from '@/lib/i18n';
import { setPrimaryMarket } from '@/app/actions/mfr';
import { LockIcon, VerifiedIcon } from './Icons';
import { MFR_COUNTRIES, countryName, covers } from '@/lib/mfr';

/** The manufacturer's target markets, in the order of the market list. */
export function targetMarkets(targets?: string[] | null, paid?: string[] | null): string[] {
  // no profile at all (the team looking at the manufacturer side): every market with data
  if (targets == null && !paid?.length) return MFR_COUNTRIES.filter((x) => x.core).map((x) => x.code);
  // the markets they chose, and every market in their plan even if not chosen at sign-up
  const all = [...(targets ?? []), ...(paid ?? [])];
  const t = MFR_COUNTRIES.map((x) => x.code).filter((c) => all.includes(c));
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
export default function MarketPicker({ targets, current, path, u }: { targets: string[]; current: string; path: string;
  u?: { role: string; mfr_active: string | null; mfr_markets?: string[] } }) {
  const t = tt();
  if (targets.length < 2) return null;
  // with a plan, markets outside it carry a lock: opening one offers to add it
  const outside = (m: string) => Boolean(u?.mfr_active) && hasData(m) && !covers(u!, m);
  return (
    <form action={setPrimaryMarket} className="row" aria-label={t('Market')} style={{ gap: 6 }}>
      <input type="hidden" name="return" value={path} />
      <span className="lbl" style={{ marginRight: 4 }}>{t('Market')}</span>
      {targets.map((m) => (
        <button key={m} type="submit" name="market" value={m} className={`pill ${m === current ? 'solid' : ''}`} aria-pressed={m === current}
          style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }} title={outside(m) ? 'Not in your plan yet' : undefined}>
          {outside(m) && <LockIcon />}{outside(m) ? ' ' : ''}{t(countryName(m))}</button>))}
    </form>
  );
}

/** "Managed by Nazryx", with the trust badge. */
export const ManagedBadge = () => { const t = tt(); return <span className="pill blue" style={{ alignSelf: 'flex-start' }}><VerifiedIcon /> {t('Managed by Nazryx')}</span>; };

/** A market our team runs for the manufacturer on the ground. */
export function AgencyMarket({ code }: { code: string }) {
  const t = tt();
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <ManagedBadge />
      <h2 style={{ fontSize: 26 }}>{t(countryName(code))}</h2>
      <div className="grid g3">
        {[['Market read', 'What is open, what is crowded and what it is worth, for your products.'],
          ['Distributor and registration', 'The right partner, the dossier and the filing, handled in the country.'],
          ['Weekly reports', 'One contact and a written update on how your products are doing.']].map(([k, x]) => (
          <div key={k} className="tile t-white"><span className="k">{t(k)}</span><span className="small">{t(x)}</span></div>))}
      </div>
      <Link className="btn btn-blue btn-sm" href="/m/services" style={{ alignSelf: 'flex-start' }}>{t('Talk to our team about {market}', { market: t(countryName(code)) })}</Link>
    </section>
  );
}

/** The manufacturer's other markets that our team runs for them, as a row of badged tiles. */
export function ManagedShowcase({ codes }: { codes: string[] }) {
  const t = tt();
  if (!codes.length) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="lbl">{t('Also in your plan')}</span>
      <div className="grid g3">{codes.map((c) => (
        <Link key={c} href="/m/services" className="tile t-white" style={{ gap: 8 }}>
          <span className="v" style={{ fontSize: 20 }}>{t(countryName(c))}</span><ManagedBadge />
        </Link>))}</div>
    </section>
  );
}
