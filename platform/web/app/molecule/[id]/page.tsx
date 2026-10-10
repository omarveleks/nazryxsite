import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import EnrichButton from '@/components/EnrichButton';
import { Badges, Flash, Locked, Tabs, Empty } from '@/components/ui';
import { togglePortfolio, toggleWatch } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { GLOBAL_LIST, channelLabel, levelLabel, registeredLine, title, COVERAGE_NOTE } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export default async function Molecule({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string }>;
}) {
  const { id: idStr } = await params;
  const sp = await searchParams;
  const id = Number(idStr);
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser();
  const paid = u.plan === 'paid' || u.role === 'team';
  const tab = sp.tab ?? 'overview';
  const d = await withUser(u.id, async (db) => {
    const m = await one(db, `
      select m.id, m.inn, m.category, m.use_case, m.canonical_key, cm.*,
             exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = $2) as enriched,
             (select json_build_object('id', r.id, 'stage', r.stage, 'verdict', e.verdict) from requests r
                left join request_evaluations e on e.request_id = r.id
                where r.molecule_id = m.id and r.user_id = $2 order by (r.stage = 'Closed'), r.updated_at desc limit 1) as request,
             exists (select 1 from portfolio_items p where p.molecule_id = m.id and p.user_id = $2) as in_portfolio,
             exists (select 1 from watches w where w.molecule_id = m.id and w.user_id = $2) as watched
      from molecules m left join country_molecules cm on cm.molecule_id = m.id and cm.country = $3
      where m.id = $1`, [id, u.id, COUNTRY]);
    if (!m) return null;
    m.supply = paid ? (await one(db, 'select molecule_supply_confirmed($1) as s', [id]))?.s : null;
    const open = m.enriched || paid;
    if (!open) return { m, open };
    const competitors = await rows(db, `
      select c.id, c.display_name, count(*)::int as products, min(r.reg_year) as since,
             string_agg(distinct initcap(lower(r.manufacturing_country)), ', ') as made_in
      from registrations r join companies c on c.id = r.ltr_id
      where r.molecule_id = $1 and r.country = $2 and r.active group by c.id order by products desc, since nulls last`, [id, COUNTRY]);
    const alternatives = m.category ? await rows(db, `
      select m2.id, m2.inn, cm.registrants, cm.registrations from molecules m2
      join country_molecules cm on cm.molecule_id = m2.id and cm.country = $3
      where m2.category = $1 and m2.id <> $2 order by cm.on_national_list desc, cm.registrants, m2.inn limit 8`, [m.category, id, COUNTRY]) : [];
    const combos = await rows(db, `
      select m2.id, m2.inn, cm.registrations from molecules m2
      join country_molecules cm on cm.molecule_id = m2.id and cm.country = $3 and cm.registrations > 0
      where m2.id <> $1 and string_to_array(m2.canonical_key, ' ') @> string_to_array($2, ' ')
      order by cm.registrations desc limit 6`, [id, m.canonical_key, COUNTRY]);
    const forms = await rows(db, `select distinct dosage_form, strength from registrations where molecule_id = $1 and active
                                  and dosage_form is not null order by 1 limit 12`, [id]);
    const prices = paid ? await rows(db, `select price_low, price_high, currency, unit, observed_at from market_prices
                                          where molecule_id = $1 and country = $2 order by observed_at desc limit 6`, [id, COUNTRY]) : [];
    return { m, open, competitors, alternatives, combos, forms, prices, supply: m.supply };
  });
  if (!d) notFound();
  const { m } = d;
  const free = !paid;
  const back = `/molecule/${id}${tab !== 'overview' ? `?tab=${tab}` : ''}`;
  const tabs = [
    { key: 'overview', label: 'Overview', href: `/molecule/${id}` },
    { key: 'competitors', label: 'Competitors', href: `/molecule/${id}?tab=competitors` },
    { key: 'alternatives', label: 'Alternatives', href: `/molecule/${id}?tab=alternatives` },
    { key: 'price', label: 'Price', href: `/molecule/${id}?tab=price`, locked: free },
    { key: 'suppliers', label: 'Suppliers', href: `/molecule/${id}?tab=suppliers`, locked: free },
  ];
  const actions = (
    <>
      <form action={togglePortfolio}><input type="hidden" name="molecule_id" value={id} /><input type="hidden" name="return" value={back} />
        <button className="btn btn-ghost btn-sm" type="submit">{m.in_portfolio ? 'In your portfolio ✓' : 'Add to portfolio'}</button></form>
      <form action={toggleWatch}><input type="hidden" name="molecule_id" value={id} /><input type="hidden" name="return" value={back} />
        <button className="btn btn-ghost btn-sm" type="submit">{m.watched ? 'Watching ✓' : 'Watch'}</button></form>
    </>
  );
  return (
    <Shell user={u} title={m.inn} crumb={<><Link href="/search">Search</Link> / {m.inn}</>}
      sub={`${[m.category, m.forms].filter(Boolean).join(' · ') || 'Molecule'} · Tanzania`} actions={actions}>
      <Flash sp={sp} />
      <div className="split">
        <section className="card stack" style={{ alignItems: 'flex-start' }}>
          <Badges m={{ ...m, in_portfolio: m.in_portfolio, watched: m.watched, request_stage: m.request && m.request.stage !== 'Closed' ? m.request.stage : null }} full />
          {m.request && m.request.stage !== 'Closed' ? (<>
            <h2>Your request is at &quot;{m.request.stage}&quot;</h2>
            <p className="muted">{m.request.verdict ? `Our evaluation: ${({ go: 'Go', maybe: 'Worth a look', no: 'Skip' } as Record<string, string>)[m.request.verdict]}. Open the request for the details.`
              : 'We are evaluating it for you: who already sells it, supply, a price range and the registration route.'}</p>
            <Link className="btn btn-blue" href={`/requests/${m.request.id}`}>Open your request</Link>
          </>) : (<>
            <h2>Want to bring {m.inn} in?</h2>
            <p className="muted">Send a sourcing request. We evaluate it for you first (who already sells it, supply, a price range and the
              registration route), then find suppliers and send anonymous quotes.</p>
            <Link className="btn btn-blue" href={`/requests/new?molecule=${id}`}>Source {m.inn}</Link>
          </>)}
        </section>
        <section className="card stack" style={{ gap: 10 }}>
          <span className="lbl">Registered in Tanzania</span>
          <span className="score"><b className="num">{m.registrants ?? 0}</b><span>{Number(m.registrants) === 1 ? 'company' : 'companies'}</span></span>
          <span className="note">{registeredLine(m.registrants, m.registrations)}</span>
          <table className="tbl"><tbody>
            <tr><td>Official list</td><td className="r">{m.on_national_list ? levelLabel(m.facility_level) : 'No'}</td></tr>
            <tr><td>{GLOBAL_LIST}</td><td className="r">{m.on_who_eml ? 'Yes' : 'No'}</td></tr>
          </tbody></table>
        </section>
      </div>

      {!d.open ? (
        <section className="card stack" style={{ alignItems: 'flex-start' }}>
          <h2>Enrich to open the full page</h2>
          <p className="muted">Competitors by name, use case, alternatives and statuses. Costs 1 credit, once. You have {u.credits} left this month.</p>
          <EnrichButton id={id} enriched={false} free primary />
        </section>
      ) : (
        <>
          <Tabs items={tabs} current={tab} />
          {tab === 'overview' && (
            <div className="split">
              <div className="stack">
                <section className="card">
                  <h2 style={{ marginBottom: 10 }}>Use case</h2>
                  <p>{m.use_case || (m.category ? `${m.category}. ${m.on_national_list ? `Stocked at ${levelLabel(m.facility_level).toLowerCase()}.` : ''}` : 'No use case written yet.')}</p>
                  {channelLabel(m.channel_flag) && <p className="note" style={{ marginTop: 10 }}>{channelLabel(m.channel_flag)}</p>}
                  {m.note && <p className="note" style={{ marginTop: 10 }}>{m.note}. Not counted as a sourcing gap.</p>}
                  {d.forms && d.forms.length > 0 && <p className="note" style={{ marginTop: 10 }}>Registered as: {d.forms.map((f) => [f.dosage_form, f.strength].filter(Boolean).join(' ')).join('; ')}</p>}
                </section>
              </div>
              <section className="card">
                <div className="card-h"><h2>Competitors in Tanzania</h2></div>
                {d.competitors!.length === 0 && <Empty>Nobody holds a registration. This is an open gap.</Empty>}
                <div className="stack" style={{ gap: 10 }}>
                  {d.competitors!.slice(0, 5).map((c) => (
                    <Link key={c.id} href={`/company/${c.id}`} className="between"><span className="nm">{title(c.display_name)}</span>
                      <span className="tiny muted nowrap">{c.since ? `since ${c.since}` : ''}</span></Link>))}
                </div>
                {d.competitors!.length > 5 && <Link className="btn-link" style={{ display: 'inline-block', marginTop: 12 }} href={`/molecule/${id}?tab=competitors`}>See all {d.competitors!.length} competitors</Link>}
              </section>
            </div>
          )}
          {tab === 'competitors' && (
            <section className="card">
              <div className="card-h"><h2>Everyone registered for {m.inn}</h2><span className="note">{COVERAGE_NOTE}</span></div>
              {d.competitors!.length === 0 ? <Empty>No registrations yet.</Empty> : (
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>Company</th><th>Products</th><th>Registered since</th><th>Made in</th></tr></thead>
                  <tbody>{d.competitors!.map((c) => (
                    <tr key={c.id}><td><Link href={`/company/${c.id}`}><span className="nm">{title(c.display_name)}</span></Link></td>
                      <td className="num">{c.products}</td><td className="num">{c.since ?? '—'}</td><td className="small">{c.made_in}</td></tr>))}
                  </tbody></table></div>)}
            </section>
          )}
          {tab === 'alternatives' && (
            <div className="grid g2">
              <section className="card">
                <div className="card-h"><h2>Same class</h2><span className="note">{m.category ?? 'No class'}</span></div>
                {d.alternatives!.length === 0 && <Empty>No class on record for this molecule.</Empty>}
                <div className="stack" style={{ gap: 10 }}>{d.alternatives!.map((a) => (
                  <Link key={a.id} href={`/molecule/${a.id}`} className="between"><span>{a.inn}</span>
                    <span className="small muted num">{registeredLine(a.registrants, a.registrations)}</span></Link>))}</div>
              </section>
              <section className="card">
                <div className="card-h"><h2>In combinations</h2></div>
                {d.combos!.length === 0 && <Empty>Not part of any registered combination.</Empty>}
                <div className="stack" style={{ gap: 10 }}>{d.combos!.map((a) => (
                  <Link key={a.id} href={`/molecule/${a.id}`} className="between"><span>{a.inn}</span><span className="small muted num">{a.registrations} products</span></Link>))}</div>
              </section>
            </div>
          )}
          {tab === 'price' && (free ? <Locked title="Price band and price history">Market price bands for Tanzania, updated by our team.</Locked> : (
            <section className="card">
              <h2 style={{ marginBottom: 10 }}>Price band</h2>
              {d.prices!.length === 0 ? <Empty>No market price data for this molecule yet. Send a request and we will quote.</Empty> : (
                <table className="tbl"><thead><tr><th>Observed</th><th>Band</th><th>Unit</th></tr></thead><tbody>
                  {d.prices!.map((p, i) => <tr key={i}><td>{String(p.observed_at).slice(0, 10)}</td>
                    <td className="num">{p.currency} {Number(p.price_low).toFixed(2)} – {Number(p.price_high).toFixed(2)}</td><td>{p.unit}</td></tr>)}
                </tbody></table>)}
            </section>))}
          {tab === 'suppliers' && (free ? <Locked title="Supplier availability">See whether Nazryx holds confirmed supply. Names are released through a request.</Locked> : (
            <section className="card stack" style={{ alignItems: 'flex-start' }}>
              <h2>{d.supply ? 'Confirmed supply exists' : 'No confirmed supply yet'}</h2>
              <p className="muted">{d.supply ? 'Nazryx holds at least one confirmed supplier offer. Names are released through a request, when you accept a quote.'
                : 'Send a request and our team will look for suppliers.'}</p>
              <Link className="btn btn-blue btn-sm" href={`/requests/new?molecule=${id}`}>Source it</Link>
            </section>))}
        </>
      )}
      <p className="note">{COVERAGE_NOTE}</p>
    </Shell>
  );
}
