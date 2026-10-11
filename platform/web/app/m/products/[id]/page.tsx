import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Badges, Empty, Flash, Locked } from '@/components/ui';
import { deleteMfrProduct, requestService, updateProductChecks } from '@/app/actions/mfr';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { BE_STATUS, beSuggestion, levelLabel, registeredLine } from '@/lib/format';
import { AGENCY_KINDS, MFR_COUNTRIES, MFR_PRODUCTS_SQL, SERVICES, reasons } from '@/lib/mfr';

export const metadata = { title: 'Product' };

export default async function MfrProduct({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const paid = u.plan === 'paid' || u.role === 'team';
  const d = await withUser(u.id, async (db) => {
    const p = await one(db, `${MFR_PRODUCTS_SQL} where p.id = $1 and p.user_id = $2`, [id, u.id]);
    if (!p) return null;
    if (!p.molecule_id) return { p };
    const origin = await rows(db, `select initcap(lower(coalesce(manufacturing_country, 'unknown'))) as country, count(*)::int as n
        from registrations where molecule_id = $1 and active group by 1 order by n desc limit 5`, [p.molecule_id]);
    const lapsed = Number((await one(db, `select count(*)::int as n from registrations where molecule_id = $1 and not active`, [p.molecule_id]))?.n ?? 0);
    const routeKey = (await one(db, 'select route_key from molecule_routes where molecule_id = $1', [p.molecule_id]))?.route_key
      ?? (p.who_pq || p.sra_approved ? 'abridged' : 'full');
    const route = await one(db, 'select label, description, months_low, months_high from registration_routes where key = $1', [routeKey]);
    const price = paid ? await one(db, `select price_low, price_high, currency, unit, note from market_prices where molecule_id = $1 and kind = 'suggested'
        order by observed_at desc limit 1`, [p.molecule_id]) : null;
    // distributor names stay hidden on the manufacturer side: introductions go through Nazryx (partner finder)
    return { p, origin, lapsed, route, price };
  });
  if (!d) notFound();
  const { p } = d;
  const be = p.be_study ? null : beSuggestion(p.forms ?? p.dosage_form);
  const ret = `/m/products/${id}`;
  return (
    <Shell user={u} title={p.inn ?? p.name} crumb={<><Link href="/m/products">My products</Link> / {p.inn ?? p.name}</>}
      sub={[p.inn ? p.name : null, p.category].filter(Boolean).join(' · ') || 'Product'}>
      <Flash sp={sp} />
      <div className="split">
        <div className="stack">
          {!p.molecule_id ? (
            <section className="card stack"><h2>Not matched yet</h2>
              <p className="muted">We could not match &quot;{p.name}&quot; to a molecule on the market by name. Our team will match it; meanwhile you can still ask for any service below.</p></section>
          ) : (<>
            <section className="card stack">
              <div className="card-h"><h2>Why Tanzania</h2>{p.registrants != null && <Badges m={p} />}</div>
              {p.registrants == null ? <Empty>Not on the Tanzania market or the official lists yet.</Empty> : (
                <table className="tbl"><tbody>
                  <tr><td>Official TMDA list</td><td className="r">{p.on_national_list ? (p.facility_level ? `Level ${p.facility_level}: ${levelLabel(p.facility_level)}` : 'Yes') : 'No'}</td></tr>
                  <tr><td>WHO essential list</td><td className="r">{p.on_who_eml ? 'Yes' : 'No'}</td></tr>
                  <tr><td>Competition</td><td className="r">{registeredLine(p.registrants, p.registrations)}</td></tr>
                  <tr><td>Registered products made in</td><td className="r">{d.origin!.length ? d.origin!.map((o) => `${o.country} ${o.n}`).join(', ') : 'Nowhere yet'}</td></tr>
                  <tr><td>Made locally</td><td className="r">{Number(p.local_made) > 0 ? `Yes, ${p.local_made} products` : 'No'}</td></tr>
                  <tr><td>Registrations lapsed or cancelled</td><td className="r">{d.lapsed}</td></tr>
                  {p.channel_flag === 'programme' && <tr><td>Channel</td><td className="r">Mostly bought through public and donor programmes</td></tr>}
                </tbody></table>)}
              {p.registrants != null && <p className="note">In short: {reasons(p).join(', ')}.</p>}
            </section>
            <section className="card stack">
              <h2>Route and timeline</h2>
              {d.route && <p><b>{d.route.label}</b>{d.route.months_low != null ? `: about ${d.route.months_low}–${d.route.months_high ?? d.route.months_low} months` : ''}. <span className="muted">{d.route.description}</span></p>}
              <p className="muted">Bioequivalence: {p.be_study ? 'you have a study' : be ? BE_STATUS[be].toLowerCase() : 'we confirm in the dossier review'}.</p>
              <span className="lbl">Suggested selling price in Tanzania</span>
              {!paid ? <Locked title="Suggested price">The price band we suggest for this product in Tanzania.</Locked>
                : d.price ? <p><b>{d.price.currency} {Number(d.price.price_low).toFixed(2)}–{Number(d.price.price_high).toFixed(2)}</b> per {d.price.unit}{d.price.note ? ` · ${d.price.note}` : ''}</p>
                : <p className="note">Not set yet. Order a price check and we answer within 24 hours.</p>}
            </section>
          </>)}
          <section className="card stack">
            <h2>Your dossier for this product</h2>
            <p className="note">Tell us what you have. It sets the likely route; our team checks the documents in a dossier review.</p>
            <form action={updateProductChecks} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="product_id" value={id} />
              {[['who_pq', 'WHO prequalified'], ['sra_approved', 'Approved by a stringent regulator (EU, US, UK, Japan ...)'], ['ctd_ready', 'Dossier in CTD format'],
                ['be_study', 'Bioequivalence study available'], ['zone_ivb', 'Stability data for climatic zone IVb']].map(([k, l]) => (
                <label key={k} className="row small" style={{ gap: 8 }}><input type="checkbox" name={k} defaultChecked={p[k]} /> {l}</label>))}
              <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save</button>
            </form>
          </section>
        </div>
        <div className="stack">
          {AGENCY_KINDS.map((k) => (
            <section key={k} className="card stack" style={{ gap: 8 }}>
              <h2>{SERVICES[k].label}</h2>
              <p className="note">{SERVICES[k].what}</p>
              <form action={requestService} className="row">
                <input type="hidden" name="kind" value={k} /><input type="hidden" name="product_id" value={id} /><input type="hidden" name="return" value={ret} />
                <select className="input" name="country" aria-label="Country" defaultValue="TZ" style={{ flex: '1 1 140px' }}>
                  {MFR_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
                <button className="btn btn-blue btn-sm" type="submit">Request</button>
              </form>
            </section>))}
          <section className="card stack" style={{ gap: 8 }}>
            <h2>More</h2>
            <div className="row">
              <Link className="btn btn-ghost btn-sm" href={`/m/services?product=${id}#report`}>24-hour report</Link>
              {p.category && <Link className="btn btn-ghost btn-sm" href={`/m/partners?class=${encodeURIComponent(p.category)}&molecule=${p.molecule_id ?? ''}`}>Find partners</Link>}
            </div>
            <form action={deleteMfrProduct}><input type="hidden" name="product_id" value={id} />
              <button className="btn-link small" type="submit">Remove this product</button></form>
          </section>
        </div>
      </div>
    </Shell>
  );
}
