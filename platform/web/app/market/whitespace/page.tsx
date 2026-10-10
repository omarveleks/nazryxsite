import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketTabs from '@/components/MarketTabs';
import EnrichButton from '@/components/EnrichButton';
import { Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, channelLabel, demandLabel, fitLabel, score } from '@/lib/format';
import { categories, COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Whitespace' };

export default async function Whitespace({ searchParams }: { searchParams: Promise<{ q?: string; class?: string; fit?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const q = (sp.q ?? '').trim().slice(0, 80), cls = sp.class ?? '', fitOnly = sp.fit === '1';
  const d = await withUser(u.id, async (db) => {
    const cats = await categories(db);
    const list = await rows(db, `
      with mine as (select m.category, count(*)::int as n from portfolio_items p join molecules m on m.id = p.molecule_id
                    where p.user_id = $1 group by m.category)
      select m.id, m.inn, m.category, cm.registrants, cm.channel_flag, g.score, g.demand, coalesce(mine.n, 0) as same_cat,
             exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = $1) as enriched
      from gap_scores g join molecules m on m.id = g.molecule_id
      join country_molecules cm on cm.molecule_id = g.molecule_id and cm.country = g.country
      left join mine on mine.category = m.category
      where g.country = $2 and cm.rankable and cm.on_national_list and g.score > 0
        and m.id not in (select molecule_id from portfolio_items where user_id = $1)
        and ($3 = '' or m.inn ilike '%' || $3 || '%') and ($4 = '' or m.category = $4) and (not $5 or mine.n > 0)
      order by g.score desc, g.demand desc, m.inn limit $6`, [u.id, COUNTRY, q, cls, fitOnly, free ? FREE.whitespace : 200]);
    const total = (await rows(db, `select count(*)::int as n from gap_scores g join country_molecules cm on cm.molecule_id = g.molecule_id
                                   and cm.country = g.country where g.country = $1 and cm.rankable and cm.on_national_list and g.score > 0`, [COUNTRY]))[0].n;
    return { cats, list, total };
  });
  return (
    <Shell user={u} title="Market" sub="Tanzania, whitespace ranked by gap score">
      <MarketTabs current="whitespace" />
      <form method="get" className="card tight row">
        <input className="input" name="q" defaultValue={q} placeholder="Search molecule" aria-label="Search molecule" style={{ flex: '1 1 220px' }} />
        <select className="input" name="class" defaultValue={cls} aria-label="Class" style={{ flex: '0 1 260px' }}>
          <option value="">Any class</option>{d.cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="fit" value="1" defaultChecked={fitOnly} /> Fits my portfolio</label>
        <button className="btn btn-blue" type="submit">Apply</button>
        {free && <span className="pill lav">Free: top {FREE.whitespace} gaps</span>}
      </form>
      <section className="card">
        {d.list.length === 0 ? <Empty>No gaps match these filters.</Empty> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>#</th><th>Molecule</th><th>Gap score</th><th>Demand</th><th className="r">Registrants</th><th>Fit</th><th className="r"></th></tr></thead>
            <tbody>
              {d.list.map((m, i) => (
                <tr key={m.id}>
                  <td className="num muted">{i + 1}</td>
                  <td><span className="nm">{m.inn}</span><div className="sub2">{m.category}{channelLabel(m.channel_flag) ? ' · programme channel' : ''}</div></td>
                  <td className="num"><b>{score(m.score)}</b></td>
                  <td>{demandLabel(m.demand)}</td>
                  <td className="r num">{m.registrants}</td>
                  <td><span className={`pill ${fitLabel(m.same_cat) === 'Strong' ? 'solid' : fitLabel(m.same_cat) === 'Good' ? 'blue' : ''}`}>{fitLabel(m.same_cat)}</span></td>
                  <td className="r"><EnrichButton id={m.id} enriched={m.enriched} free={free} /></td>
                </tr>))}
              {free && [4, 5].map((n) => (
                <tr key={n} className="locked-row"><td className="num">{n}</td><td colSpan={5}>Paid</td><td /></tr>))}
            </tbody>
          </table></div>
        )}
        {free && (
          <div className="locked" style={{ marginTop: 16 }}>
            <b>See the full ranked list: {d.total} open molecules in Tanzania.</b>
            <Link className="btn btn-blue btn-sm" href="/settings#plan">Upgrade</Link>
          </div>
        )}
      </section>
      <p className="note">Fit compares each molecule with your own portfolio: strong means you already carry 3 or more products in the same class.
        Programme-channel molecules are mostly bought through public and donor programmes, so check before pitching.</p>
    </Shell>
  );
}
