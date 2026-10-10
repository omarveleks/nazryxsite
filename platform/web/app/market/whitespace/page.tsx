import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketTabs from '@/components/MarketTabs';
import EnrichButton from '@/components/EnrichButton';
import { Empty, SourceLink } from '@/components/ui';
import { MoleculeRow } from '@/components/MoleculeRow';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, fitLabel } from '@/lib/format';
import { categories, COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Open molecules' };

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
      select m.id, m.inn, m.category, cm.registrants, cm.registrations, cm.channel_flag, cm.on_national_list, cm.on_who_eml,
             cm.in_combinations, coalesce(mine.n, 0) as same_cat,
             exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = $1) as enriched,
             (select r.stage from requests r where r.molecule_id = m.id and r.user_id = $1 and r.stage <> 'Closed' limit 1) as request_stage
      from visible_gap_scores g join molecules m on m.id = g.molecule_id
      join country_molecules cm on cm.molecule_id = g.molecule_id and cm.country = g.country
      left join mine on mine.category = m.category
      where g.country = $2 and cm.rankable and cm.on_national_list and g.score > 0
        and m.id not in (select molecule_id from portfolio_items where user_id = $1)
        and ($3 = '' or m.inn ilike '%' || $3 || '%') and ($4 = '' or m.category = $4) and (not $5 or mine.n > 0)
      order by g.score desc, cm.registrants, m.inn limit $6`, [u.id, COUNTRY, q, cls, fitOnly, free ? FREE.whitespace : 200]);
    const total = (await rows(db, `select count(*)::int as n from visible_gap_scores g join country_molecules cm on cm.molecule_id = g.molecule_id
                                   and cm.country = g.country where g.country = $1 and cm.rankable and cm.on_national_list and g.score > 0`, [COUNTRY]))[0].n;
    return { cats, list, total };
  });
  return (
    <Shell user={u} title="Market" sub="Tanzania, official-list molecules few companies have registered">
      <MarketTabs current="whitespace" />
      <form method="get" className="card tight row">
        <input className="input" name="q" defaultValue={q} placeholder="Search molecule" aria-label="Search molecule" style={{ flex: '1 1 220px' }} />
        <select className="input" name="class" defaultValue={cls} aria-label="Class" style={{ flex: '0 1 260px' }}>
          <option value="">Any class</option>{d.cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="fit" value="1" defaultChecked={fitOnly} /> Fits my portfolio</label>
        <button className="btn btn-blue" type="submit">Apply</button>
        {free && <span className="pill lav">Free: top {FREE.whitespace}</span>}
      </form>
      <section className="card">
        {d.list.length === 0 ? <Empty>No open molecules match these filters.</Empty> : (
          <div>
            {d.list.map((m, i) => {
              const fit = fitLabel(m.same_cat);
              return (
                <MoleculeRow key={m.id} m={m} n={i + 1} first={i === 0}
                  extra={<span className={`pill ${fit === 'Strong' ? 'solid' : fit === 'Good' ? 'blue' : ''}`}>Fit: {fit}</span>}
                  actions={<><EnrichButton id={m.id} enriched={m.enriched} free={free} /><SourceLink id={m.id} stage={m.request_stage} /></>} />);
            })}
            {free && [FREE.whitespace + 1, FREE.whitespace + 2].map((n) => (
              <div key={n} className="muted" style={{ padding: '14px 0', borderTop: '1px solid var(--line)' }}><span className="num">{n}</span> Paid</div>))}
          </div>
        )}
        {free && (
          <div className="locked" style={{ marginTop: 16 }}>
            <b>See the full list: {d.total} open molecules in Tanzania.</b>
            <Link className="btn btn-blue btn-sm" href="/settings#plan">Upgrade</Link>
          </div>
        )}
      </section>
      <p className="note">Fit compares each molecule with your own portfolio: strong means you already carry 3 or more products in the same class.
        Programme-channel molecules are mostly bought through public and donor programmes, so check before pitching.</p>
    </Shell>
  );
}
