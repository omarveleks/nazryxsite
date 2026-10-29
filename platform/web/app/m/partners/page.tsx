import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, Flash, PlanLock, Tabs } from '@/components/ui';
import { addToPipeline, movePipeline, removeFromPipeline } from '@/app/actions/finder';
import { PIPELINE_STAGES, PIPELINE_TONE } from '@/lib/finder';
import { ago } from '@/lib/format';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { categories } from '@/lib/queries';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { GROUP_LABEL } from '@/lib/segments';

export const metadata = { title: 'Partners' };

const SIZES: [string, string][] = [['0', 'Any size'], ['20', '20+ products'], ['100', '100+ products'], ['300', '300+ products']];
const SORTS: [string, string][] = [['open', 'Sort: most open to you'], ['size', 'Sort: largest'], ['class', 'Sort: strongest in class']];

// Every distributor in a market, without names, filterable. Each profile has a code; Nazryx makes the introduction.
export default async function Partners({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const prof = await one(db, 'select target_countries, status, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, prof?.primary_market);
    const cats = await categories(db, market);
    const mine = await rows(db, `select distinct m.id, m.inn from mfr_products p join molecules m on m.id = p.molecule_id where p.user_id = $1 order by m.inn`, [u.id]);
    const cls = sp.class && cats.includes(sp.class) ? sp.class : null;
    const molecule = mine.find((x) => x.id === Number(sp.molecule)) ?? null;
    const sort = SORTS.some(([k]) => k === sp.sort) ? sp.sort! : cls ? 'class' : 'open';
    // where the registry names no local distributor (Kazakhstan, Kyrgyzstan) the list is the companies holding registrations
    const byHolder = hasData(market) && !(await one(db, 'select 1 as x from registrations where country = $1 and active and ltr_id is not null limit 1', [market]));
    // a product group (eye lubricants, viscoelastics, joint injections, nasal saline): importers of devices and medicines together
    const group = sp.group && GROUP_LABEL[sp.group] ? sp.group : null;
    const list = !hasData(market) ? [] : group ? await rows(db, 'select * from group_partners($1, $2)', [market, group])
      : await rows(db, 'select * from partner_search($1, $2, $3, $4, $5, $6)', [market, cls, molecule?.id ?? null, false, Number(sp.min) || 0, sort]);
    const products = await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id
                                     where p.user_id = $1 order by 2 limit 300`, [u.id]);
    // names open on Complete Market Access in this market (the database checks the plan); the team sees them on request
    const named = u.role === 'team' ? sp.names === '1' : tierIn(u, market) >= 2;
    const names: Record<string, string> = named
      ? Object.fromEntries((await rows(db, 'select code, name from partner_names($1)', [market])).map((r) => [r.code, r.name])) : {};
    // the distributors they are courting in this market, and where each stands
    const pipeline = hasData(market) ? await rows(db, 'select * from my_pipeline($1)', [market]) : [];
    return { targets, market, cats, mine, cls, molecule, sort, list, products, byHolder, names, status: prof?.status, group, pipeline };
  });
  const tab = sp.tab === 'pipeline' ? 'pipeline' : 'list';
  const t = tierIn(u, d.market);
  const lists = canUse(t, 'distributors'), matching = canUse(t, 'matching'), intro = canUse(t, 'partner_intro');
  const shown = d.molecule && sp.gap === '1' ? d.list.filter((p) => !p.carries) : d.list;
  const total = d.list[0]?.total ?? 0, mineN = d.list[0]?.mine ?? d.mine.length;
  const filtered = Boolean(d.cls || d.molecule || Number(sp.min) || d.group);
  const noun = d.byHolder ? 'companies' : 'distributors';
  const inPipe = new Set(d.pipeline.map((x) => x.code));
  const pipelineOpen = canUse(t, 'portfolio');
  const here = `/m/partners?market=${d.market}${d.cls ? `&class=${encodeURIComponent(d.cls)}` : ''}${d.molecule ? `&molecule=${d.molecule.id}` : ''}${d.group ? `&group=${d.group}` : ''}`;
  return (
    <Shell user={u} title="Partners" sub={`Who could carry your products in ${countryName(d.market)}`}
      actions={u.role === 'team'
        ? <Link className="btn btn-blue btn-sm" href={`/m/partners?market=${d.market}${sp.names === '1' ? '' : '&names=1'}`}>{sp.names === '1' ? 'Hide names' : 'Show names'}</Link>
        : <>{lists && <a className="btn btn-ghost btn-sm" href={`/m/export?what=partners&market=${d.market}`}>Excel (CSV)</a>}
            {intro && <Link className="btn btn-blue btn-sm" href="/m/partners/intro">Ask us to find distributors</Link>}</>}>
      <Flash sp={sp} />
      <MarketPicker u={u} targets={d.targets} current={d.market} path="/m/partners" />
      {hasData(d.market) && <Tabs current={tab} items={[{ key: 'list', label: `All ${noun}`, href: `/m/partners?market=${d.market}` },
        { key: 'pipeline', label: `Your pipeline${d.pipeline.length ? ` (${d.pipeline.length})` : ''}`, href: `/m/partners?market=${d.market}&tab=pipeline` }]} />}
      {!hasData(d.market) ? <AgencyMarket code={d.market} /> : tab === 'pipeline' ? (
        <section className="card stack">
          <div className="card-h"><div><h2>Your distributor pipeline in {countryName(d.market)}</h2>
            <p className="note">Shortlist from the list, compare them side by side, move each one along as talks progress. Asking us for an introduction moves it for you.</p></div></div>
          {!pipelineOpen ? <PlanLock need="data" title="A pipeline of distributors" u={u} market={d.market}>Shortlist distributors, compare them, and track every conversation to a signed agreement.</PlanLock>
            : d.pipeline.length === 0 ? <Empty>Nobody shortlisted yet. Open <Link href={`/m/partners?market=${d.market}`}>the list</Link> and press Shortlist on the distributors worth a conversation.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Distributor</th><th>Stage</th><th className="r hide-m">Products</th><th className="r hide-m">Molecules</th><th className="hide-m">Strongest in</th><th className="r">Open to yours</th><th></th></tr></thead>
              <tbody>{d.pipeline.map((x) => (
                <tr key={x.id}>
                  <td><span className="nm">{x.name ?? `Distributor ${x.code}`}</span>{x.name && <span className="sub2"> · {x.code}</span>}
                    {x.note && <div className="sub2">{x.note}</div>}<div className="sub2">moved {ago(x.updated_at)}</div></td>
                  <td>
                    <form action={movePipeline} className="stack" style={{ gap: 4 }}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="market" value={d.market} />
                      <span className={`pill ${PIPELINE_TONE[x.stage] ?? ''}`} style={{ alignSelf: 'flex-start' }}>{PIPELINE_STAGES.find(([k]) => k === x.stage)?.[1] ?? x.stage}</span>
                      <div className="row" style={{ gap: 4 }}>
                        <select className="input" name="stage" defaultValue={x.stage} aria-label={`Stage for ${x.name ?? x.code}`} style={{ minHeight: 32, fontSize: 13 }}>
                          {PIPELINE_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        <input className="input" name="note" defaultValue={x.note ?? ''} placeholder="Note" aria-label={`Note for ${x.name ?? x.code}`} maxLength={600} style={{ minHeight: 32, fontSize: 13, width: 140 }} />
                        <button className="btn btn-ghost btn-sm" type="submit">Move</button>
                      </div>
                    </form>
                  </td>
                  <td className="r hide-m num">{x.products ?? 0}</td><td className="r hide-m num">{x.molecules ?? 0}</td>
                  <td className="hide-m small">{x.top_classes ?? ''}</td>
                  <td className="r">{matching ? <span className={`pill ${x.open_to > 0 ? 'mint' : ''}`}>{x.open_to} of {mineN}</span> : <PlanLock compact need="access" title="Open to" u={u} market={d.market} />}</td>
                  <td className="r"><div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    {intro && x.stage === 'shortlisted' && <Link className="btn btn-blue btn-sm" href={`/m/partners/intro?code=${x.code}`}>Introduce</Link>}
                    <form action={removeFromPipeline}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="market" value={d.market} />
                      <button className="btn-link small" type="submit" aria-label={`Remove ${x.name ?? x.code}`}>Remove</button></form></div></td>
                </tr>))}</tbody>
            </table></div>)}
        </section>
      ) : (<>
        <form method="get" className="card tight stack" style={{ gap: 10 }}>
          <input type="hidden" name="market" value={d.market} />
          {sp.names === '1' && <input type="hidden" name="names" value="1" />}
          <div className="row">
            <select className="input" name="class" defaultValue={d.cls ?? ''} aria-label="Therapeutic class" style={{ flex: '2 1 220px' }}>
              <option value="">All therapeutic classes</option>{d.cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select className="input" name="molecule" defaultValue={d.molecule?.id ?? ''} aria-label="One of your molecules" style={{ flex: '2 1 200px' }}>
              <option value="">Any of your molecules</option>{d.mine.map((m) => <option key={m.id} value={m.id}>{m.inn}</option>)}</select>
            <select className="input" name="group" defaultValue={d.group ?? ''} aria-label="Product group" style={{ flex: '2 1 220px' }}>
              <option value="">Any product group</option>{Object.entries(GROUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l} (devices and medicines)</option>)}</select>
            <select className="input" name="min" defaultValue={sp.min ?? '0'} aria-label="Portfolio size" style={{ flex: '1 1 140px' }}>
              {SIZES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="input" name="sort" defaultValue={d.sort} aria-label="Sort" style={{ flex: '1 1 200px' }}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="gap" value="1" defaultChecked={sp.gap === '1'} /> Only those who do not carry the molecule</label>
            </div>
            <div className="row">{filtered && <Link className="btn btn-ghost btn-sm" href={`/m/partners?market=${d.market}`}>Clear</Link>}
              <button className="btn btn-blue btn-sm" type="submit">Apply</button></div>
          </div>
        </form>
        <section className="card" data-tour="distributors">
          <div className="card-h"><div><h2>{total} {d.group ? 'importers' : d.byHolder ? 'companies holding registrations' : 'distributors'}{d.group ? ` of ${GROUP_LABEL[d.group].toLowerCase()}` : d.cls ? ` in ${d.cls}` : ''}</h2>
            {d.byHolder && <p className="note">{countryName(d.market)}&rsquo;s register names the company holding each product. Local companies come first.</p>}</div></div>
          {shown.length === 0 ? <Empty>No {d.byHolder ? 'company' : 'distributor'} matches these filters.</Empty> : (
            <div>{shown.map((p, i) => (
              <div key={p.code} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                  <span className="nm">{d.names[p.code] ?? `${d.byHolder ? 'Company' : 'Distributor'} ${p.code}`}</span>
                  {d.names[p.code] && <span className="sub2"> · {p.code}</span>}
                  {!d.names[p.code] && u.role !== 'team' && i === 0 && <span className="sub2"> · names open on Complete Market Access</span>}
                  {d.byHolder && p.local_maker && <span className="pill mint" style={{ marginLeft: 8, fontSize: 12 }}>Local</span>}
                  {d.group ? (<>
                    {p.local_maker && <span className="pill mint" style={{ marginLeft: 8, fontSize: 12 }}>Local</span>}
                    <div className="sub2">{p.in_group} products in this group ({p.group_devices} devices, {p.in_group - p.group_devices} medicines) · {p.products} registered products in all{p.devices ? `, ${p.devices} of them devices` : ''}</div>
                    {p.origins && <div className="sub2">Brings in products made in {p.origins}</div>}</>) : (<>
                  <div className="sub2">{p.products} registered products · {p.molecules} molecules · {p.classes} classes{d.cls ? ` · ${p.in_class} in ${d.cls}` : ''}</div>
                  {p.top_classes && <div className="sub2">Strongest in {p.top_classes}</div>}</>)}
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {!d.group && mineN > 0 && (matching ? <span className={`pill ${p.open_to > 0 ? 'mint' : ''}`}>Open to {p.open_to} of your {mineN} molecules</span>
                      : <PlanLock compact need="access" title="Open to how many of your molecules" u={u} market={d.market} />)}
                    {d.molecule && <span className={`pill ${p.carries ? '' : 'blue'}`}>{p.carries ? `Already carries ${d.molecule.inn}` : `Does not carry ${d.molecule.inn}`}</span>}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {pipelineOpen && (inPipe.has(p.code) ? <Link className="pill mint" href={`/m/partners?market=${d.market}&tab=pipeline`}>In your pipeline</Link>
                    : <form action={addToPipeline}><input type="hidden" name="market" value={d.market} /><input type="hidden" name="code" value={p.code} /><input type="hidden" name="return" value={here} />
                        <button className="btn btn-ghost btn-sm" type="submit">Shortlist</button></form>)}
                  {!intro ? <PlanLock compact need="entry" title="Introduction" />
                    : <Link className="btn btn-blue btn-sm" href={`/m/partners/intro?code=${p.code}`}>Request introduction</Link>}
                </div>
              </div>))}</div>)}
          {!lists && total > shown.length && (
            <div style={{ marginTop: 12 }}><PlanLock need="access" title={`${total - shown.length} more ${noun}`} u={u} market={d.market}>
              Every {d.byHolder ? 'company holding registrations' : 'distributor'} in {countryName(d.market)}, with how many of your molecules each does not carry yet.</PlanLock></div>)}
        </section>
        <p className="note">Introductions are part of market entry: we contact the {d.byHolder ? 'company' : 'distributor'}, present your product and help agree terms.</p>
      </>)}
    </Shell>
  );
}
