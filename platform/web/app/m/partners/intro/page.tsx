import Link from 'next/link';
import Shell from '@/components/Shell';
import { pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Flash, PlanLock } from '@/components/ui';
import { requestIntro } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { canUse, MFR_COUNTRIES } from '@/lib/mfr';

export const metadata = { title: 'Request an introduction' };

const INTRO_SCOPES: [string, string, string][] = [
  ['selected', 'Specific products', 'You choose which products to put in front of the distributor.'],
  ['nazryx', 'Let Nazryx choose', 'We pick the products with the best chance in this market.'],
  ['all', 'Your entire portfolio', 'Every product you have with us.'],
];
const INTRO_PARTNER: [string, string][] = [['exclusive', 'An exclusive distributor'], ['non_exclusive', 'Non-exclusive is fine'], ['unsure', 'Not sure yet: advise us']];
const INTRO_START: [string, string][] = [['now', 'As soon as possible'], ['3m', 'In the next 3 months'], ['6m', 'In 6 months or more']];

// One form for an introduction: which distributor (or let us pick), which products (specific, our choice or all), and the
// basics our team needs before the first call.
export default async function IntroRequest({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const code = /^[0-9A-F]{8}$/.test((sp.code ?? '').toUpperCase()) ? sp.code!.toUpperCase() : null;
  const d = await withUser(u.id, async (db) => {
    const p = await one(db, 'select target_countries, primary_market, status from manufacturer_profiles where user_id = $1', [u.id]);
    return {
      p, targets: targetMarkets(p?.target_countries, u.mfr_markets),
      products: await rows(db, `select p.id, coalesce(m.inn, p.name) as name, p.strength, p.dosage_form from mfr_products p
                                left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by 2 limit 500`, [u.id]),
      phone: (await one(db, 'select whatsapp from users where id = $1', [u.id]))?.whatsapp as string | null,
    };
  });
  const market = pickMarket(undefined, d.targets, d.p?.primary_market);
  const countries = [...MFR_COUNTRIES.filter((c) => d.targets.includes(c.code)), ...MFR_COUNTRIES.filter((c) => c.core && !d.targets.includes(c.code))];
  return (
    <Shell user={u} title="Request an introduction" crumb={<><Link href="/m/partners">Distributors</Link> / Introduction</>}
      sub={code ? `To distributor ${code}` : 'We find the right distributors and make the introductions'}>
      <Flash sp={sp} />
      {!canUse(u.mfr_tier, 'partner_intro') ? <PlanLock need="entry" title="Introductions">We contact the distributor, present your products and help agree terms.</PlanLock>
        : d.p?.status !== 'approved' ? <section className="card"><p className="muted">Introductions open once our team approves your company. We will let you know.</p></section> : (
        <form action={requestIntro} className="stack">
          {code && <input type="hidden" name="code" value={code} />}
          <section className="card stack">
            <h2>Which products?</h2>
            <div className="stack" style={{ gap: 8 }}>{INTRO_SCOPES.map(([k, l, x], i) => (
              <label key={k} className="choice"><input type="radio" name="scope" value={k} defaultChecked={i === 1} />
                <span><b>{l}</b><br /><span className="note">{x}</span></span></label>))}</div>
            {d.products.length > 0 && (
              <details>
                <summary className="btn-link small">Choose specific products ({d.products.length})</summary>
                <div className="grid g3" style={{ marginTop: 10, gap: 6 }}>{d.products.map((x) => (
                  <label key={x.id} className="row small" style={{ gap: 6 }}><input type="checkbox" name="products" value={x.id} />
                    {x.name}{x.strength ? ` ${x.strength}` : ''}</label>))}</div>
                <p className="note" style={{ marginTop: 8 }}>Ticking products picks &ldquo;Specific products&rdquo; for you.</p>
              </details>)}
          </section>
          <section className="card stack">
            <h2>The basics</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="market">Market</label>
                <select className="input" id="market" name="market" defaultValue={market}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
              <div className="field"><label htmlFor="partner">What kind of partner?</label>
                <select className="input" id="partner" name="partner" defaultValue="unsure">{INTRO_PARTNER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="start">When do you want to start?</label>
                <select className="input" id="start" name="start" defaultValue="3m">{INTRO_START.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="contact">Who should we talk to? <span className="note">(name and phone)</span></label>
                <input className="input" id="contact" name="contact" defaultValue={[u.name, d.phone].filter(Boolean).join(', ')} /></div>
              <div className="field full"><label htmlFor="detail">Anything else? <span className="note">(prices, volumes, distributors to avoid)</span></label>
                <textarea className="input" id="detail" name="detail" rows={3} /></div>
            </div>
          </section>
          <div className="row"><button className="btn btn-blue" type="submit">Send to our team</button>
            <span className="note">{code ? `We start with distributor ${code}` : 'We shortlist the best distributors for you'} and reply within one working day.</span></div>
        </form>)}
      {!code && canUse(u.mfr_tier, 'partner_intro') && <p className="note">Have one in mind? <Link href="/m/partners">Pick a distributor first</Link>.</p>}
    </Shell>
  );
}
