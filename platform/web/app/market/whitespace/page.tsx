import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketTabs from '@/components/MarketTabs';
import { Empty, Flash, SourceLink } from '@/components/ui';
import ExportLink from '@/components/ExportLink';
import { MoleculeRow } from '@/components/MoleculeRow';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, LEVEL_FILTERS } from '@/lib/format';
import { categories, COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Open molecules' };

export default async function Whitespace({ searchParams }: { searchParams: Promise<{ q?: string; class?: string; fit?: string; level?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const q = (sp.q ?? '').trim().slice(0, 80), cls = sp.class ?? '', fitOnly = sp.fit === '1';
  const level = 'ABCDS'.includes(sp.level ?? '-') && sp.level ? sp.level : '';
  const back = `/market/whitespace?${new URLSearchParams({ q, class: cls, level, ...(fitOnly ? { fit: '1' } : {}) })}`;
  const d = await withUser(u.id, async (db) => {
    const cats = await categories(db);
    const list = await rows(db, `
      with mine as (select m.category, count(*)::int as n from portfolio_items p join molecules m on m.id = p.molecule_id
                    where p.user_id = $1 group by m.category)
      select m.id, m.inn, m.category, cm.registrants, cm.registrations, cm.channel_flag, cm.on_national_list, cm.on_who_eml,
             cm.in_combinations, cm.facility_level, coalesce(mine.n, 0) as same_cat,
             exists (select 1 from sourcing_list l where l.molecule_id = m.id and l.user_id = $1) as in_list,
             exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = $1) as enriched,
             (select r.stage from requests r where r.molecule_id = m.id and r.user_id = $1 and r.stage <> 'Closed' limit 1) as request_stage
      from visible_gap_scores g join molecules m on m.id = g.molecule_id
      join country_molecules cm on cm.molecule_id = g.molecule_id and cm.country = g.country
      left join mine on mine.category = m.category
      where g.country = $2 and cm.rankable and cm.on_national_list and g.score > 0
        and m.id not in (select molecule_id from portfolio_items where user_id = $1)
        and ($3 = '' or m.inn ilike '%' || $3 || '%') and ($4 = '' or m.category = $4) and (not $5 or mine.n > 0)
        and ($7 = '' or cm.facility_level = $7)
      order by g.score desc, cm.registrants, m.inn limit $6`, [u.id, COUNTRY, q, cls, fitOnly, free ? FREE.whitespace : 200, level]);
    const total = (await rows(db, `select count(*)::int as n from visible_gap_scores g join country_molecules cm on cm.molecule_id = g.molecule_id
                                   and cm.country = g.country where g.country = $1 and cm.rankable and cm.on_national_list and g.score > 0`, [COUNTRY]))[0].n;
    return { cats, list, total };
  });
  return (
    <Shell user={u} title="Market" sub="Tanzania, official TMDA list molecules few companies have registered">
      <MarketTabs current="whitespace" />
      <Flash sp={sp} />
      <form method="get" className="card tight row">
        <input className="input" name="q" defaultValue={q} placeholder="Search molecule" aria-label="Search molecule" style={{ flex: '1 1 220px' }} />
        <select className="input" name="class" defaultValue={cls} aria-label="Class" style={{ flex: '0 1 260px' }}>
          <option value="">Any class</option>{d.cats.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input" name="level" defaultValue={level} aria-label="EML level" style={{ flex: '0 1 220px' }}>
          <option value="">Any EML level</option>
          {LEVEL_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="fit" value="1" defaultChecked={fitOnly} /> Only my classes</label>
        <button className="btn btn-blue" type="submit">Apply</button>
        {free && <span className="pill lav">Free: top {FREE.whitespace}</span>}
        <ExportLink href={`/export/open?${new URLSearchParams({ class: cls, level })}`} paid={!free} />
      </form>
      <section className="card">
        {d.list.length === 0 ? <Empty>No open molecules match these filters.</Empty> : (
          <div>
            {d.list.map((m, i) => (
              <MoleculeRow key={m.id} m={m} n={i + 1} first={i === 0}
                extra={m.same_cat > 0 ? <span className="pill solid">In your classes</span> : null}
                actions={<SourceLink id={m.id} stage={m.request_stage} inList={m.in_list} back={back} />} />))}
            {free && [FREE.whitespace + 1, FREE.whitespace + 2].map((n) => (
              <div key={n} className="muted" style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}><span className="num">{n}</span> Paid</div>))}
          </div>
        )}
        {free && (
          <div className="locked" style={{ marginTop: 16 }}>
            <b>See the full list: {d.total} open molecules in Tanzania.</b>
            <Link className="btn btn-blue btn-sm" href="/settings#plan">Upgrade</Link>
          </div>
        )}
      </section>
      <p className="note">EML level is where the official TMDA list allows a medicine to be stocked: A dispensaries and up, B health centres,
        C district hospitals, D regional hospitals, S specialist hospitals. Programme-channel molecules are mostly bought through public and
        donor programmes, so check before pitching.</p>
    </Shell>
  );
}
