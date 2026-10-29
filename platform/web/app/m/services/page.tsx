import Link from 'next/link';
import Shell from '@/components/Shell';
import { targetMarkets } from '@/components/MarketPicker';
import { Flash, LockIcon, StagePill } from '@/components/ui';
import { startCheckout } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { AGENCY_KINDS, MFR_COUNTRIES, MFR_PLANS, NEEDS_PLAN, SERVICES, canUse, countryName, recommendServices, tierOf, type PlanKey } from '@/lib/mfr';

export const metadata = { title: 'Services' };

const GOALS: [string, string][] = [
  ['enter', 'Enter a new market'], ['grow', 'Sell more where we already are'],
  ['check', 'Check our dossier before filing'], ['keep', 'Keep our registrations in order'],
];
const DEPTH: [string, string, PlanKey][] = [
  ['data', 'Give us the market data. We take it from there.', 'data'],
  ['guide', 'Help us decide and prepare: who to supply, at what price, and how to get approved.', 'access'],
  ['full', 'Take it over completely: distributor, registration and launch, done for you.', 'entry'],
];

// What do you want? Three short answers lead to the plan or service that fits. Below: the three services and the
// work in progress.
export default async function Services({ searchParams }: { searchParams: Promise<{ goal?: string; market?: string; depth?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [u.id]),
    engagements: await rows(db, `select e.id, e.kind, e.country, e.stage, e.status, e.created_at, coalesce(m.inn, p.name) as product
                                 from engagements e left join mfr_products p on p.id = e.product_id left join molecules m on m.id = p.molecule_id
                                 where e.user_id = $1 and e.status = 'open' order by e.updated_at desc limit 8`, [u.id]),
  }));
  const targets = targetMarkets(d.p?.target_countries, u.mfr_markets);
  const goal = GOALS.some(([k]) => k === sp.goal) ? sp.goal! : null;
  const market = goal && MFR_COUNTRIES.some((c) => c.code === sp.market) ? sp.market! : null;
  const depth = goal && market && DEPTH.some(([k]) => k === sp.depth) ? sp.depth! : null;
  const step = !goal ? 1 : !market ? 2 : (goal === 'enter' || goal === 'grow') && !depth ? 3 : 4;
  const q = (extra: Record<string, string>) => `/m/services?${new URLSearchParams({ ...(goal ? { goal } : {}), ...(market ? { market } : {}), ...extra })}#want`;
  const open = new Set(d.engagements.map((e) => e.kind));
  const recs = new Map(recommendServices(d.p).map((r) => [r.kind, r.why]));
  const markets = [...MFR_COUNTRIES.filter((c) => targets.includes(c.code)), ...MFR_COUNTRIES.filter((c) => c.core && !targets.includes(c.code))];

  // the answer: a plan to subscribe to, or a service to open
  const result = step === 4 ? (() => {
    if (goal === 'check') return { kind: 'dossier_review' as const, plan: NEEDS_PLAN.dossier_review as PlanKey };
    if (goal === 'keep') return { kind: 'post_registration' as const, plan: null };
    const plan = DEPTH.find(([k]) => k === depth)![2];
    return { kind: plan === 'entry' ? 'market_entry' as const : null, plan };
  })() : null;
  const has = (plan: PlanKey | null) => !plan || u.mfr_tier >= tierOf(plan);

  const Choice = ({ href, children, on }: { href: string; children: React.ReactNode; on?: boolean }) => (
    <Link href={href} className={`choice ${on ? 'on' : ''}`} style={{ textDecoration: 'none', color: 'inherit', borderColor: on ? 'var(--blue)' : undefined }}>{children}</Link>);

  return (
    <Shell user={u} title={t('Services')} sub={t('Tell us what you want. We point you to the right help.')}
      actions={<Link className="btn btn-ghost btn-sm" href="/m/call">{t('Book a call')}</Link>}>
      <Flash sp={sp} />
      <section className="card stack" id="want" data-tour="services">
        <div className="between"><h2>{t('What do you want?')}</h2>{goal && <Link className="btn-link small" href="/m/services#want">{t('Start again')}</Link>}</div>
        <div className="grid g2">{GOALS.map(([k, l]) => <Choice key={k} href={`/m/services?goal=${k}#want`} on={goal === k}>{l}</Choice>)}</div>
        {step >= 2 && (<>
          <span className="lbl">{t('Where?')}</span>
          <div className="row" style={{ gap: 6 }}>{markets.map((c) => (
            <Link key={c.code} href={q({ market: c.code })} className={`pill ${market === c.code ? 'solid' : ''}`} style={{ textDecoration: 'none' }}>{c.name}</Link>))}</div>
        </>)}
        {step >= 3 && (goal === 'enter' || goal === 'grow') && (<>
          <span className="lbl">{t('How much should we do?')}</span>
          <div className="stack" style={{ gap: 8 }}>{DEPTH.map(([k, l]) => <Choice key={k} href={q({ depth: k })} on={depth === k}>{l}</Choice>)}</div>
        </>)}
        {result && (
          <div className="card tight stack" style={{ borderColor: 'var(--blue)', borderWidth: 2 }}>
            <span className="lbl">Our suggestion for {countryName(market)}</span>
            {result.plan && <h2>{MFR_PLANS[result.plan].name}{result.kind ? ` with ${SERVICES[result.kind].label.toLowerCase()}` : ''}</h2>}
            {!result.plan && result.kind && <h2>{SERVICES[result.kind].label}</h2>}
            <p className="muted">{result.kind ? SERVICES[result.kind].what : MFR_PLANS[result.plan!].for}</p>
            <div className="row">
              {has(result.plan) ? (result.kind
                ? <Link className="btn btn-blue" href={`/m/services/${result.kind}?country=${market}`}>{open.has(result.kind) ? 'Add to it' : 'Start'}</Link>
                : <Link className="btn btn-blue" href={`/m/market?market=${market}`}>Open {countryName(market)}</Link>)
                : result.plan === 'entry' ? <Link className="btn btn-blue" href="/m/plan?want=entry">{t('Get in touch')}</Link>
                : (<form action={startCheckout}><input type="hidden" name="plan" value={result.plan!} />
                    <button className="btn btn-blue" type="submit">Get {MFR_PLANS[result.plan!].name}</button></form>)}
              <Link className="btn btn-ghost" href={`/m/plan?want=${result.plan ?? 'data'}`}>{t('Compare plans')}</Link>
            </div>
          </div>)}
      </section>

      {d.engagements.length > 0 && (
        <section className="card">
          <div className="card-h"><h2>{t('In progress')}</h2></div>
          <div className="stack" style={{ gap: 10 }}>{d.engagements.map((e) => (
            <Link key={e.id} href={`/m/engagements/${e.id}`} className="between">
              <span><b>{SERVICES[e.kind].label}</b>{e.product ? ` · ${e.product}` : ''}{e.country ? ` · ${countryName(e.country)}` : ''}
                <span className="sub2"> · since {fmtDate(e.created_at)}</span></span>
              <StagePill stage={e.stage} /></Link>))}</div>
        </section>)}

      <h2>{t('Our services')}</h2>
      <div className="grid g3">{AGENCY_KINDS.map((k) => {
        const ok = canUse(u.mfr_tier, k), why = recs.get(k);
        return (
          <Link key={k} href={ok ? `/m/services/${k}` : `/m/plan?want=${NEEDS_PLAN[k]}`} className="card stack" style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}>
            <h2>{SERVICES[k].label}</h2>
            {!ok ? <span className="pill lav" style={{ alignSelf: 'flex-start' }}><LockIcon /> In {MFR_PLANS[NEEDS_PLAN[k]].name}</span>
              : open.has(k) ? <span className="pill blue" style={{ alignSelf: 'flex-start' }}>{t('In progress')}</span> : null}
            <p className="muted">{SERVICES[k].what}</p>
            {why && <p className="note">Fits because {why}.</p>}
            <span className="btn-link small" style={{ marginTop: 'auto' }}>{ok ? 'Open →' : 'See what unlocks it →'}</span>
          </Link>);
      })}</div>
      <p className="note">{t('A quick question instead?')} <Link href="/m/ask">{t('Ask our team')}</Link>.</p>
    </Shell>
  );
}
