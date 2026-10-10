import Link from 'next/link';
import Shell from '@/components/Shell';
import FollowButton from '@/components/FollowButton';
import { Bar, Empty, Flash, Locked, Tabs } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { COVERAGE_NOTE, FREE, title } from '@/lib/format';
import { categories, COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Competitors' };
const PAGE = 30;

export default async function Competitors({ searchParams }: {
  searchParams: Promise<{ tab?: string; q?: string; type?: string; category?: string; page?: string; c?: string; c2?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const u = await requireUser();
  const paid = u.plan === 'paid' || u.role === 'team';
  const tab = sp.tab ?? 'directory';
  const q = (sp.q ?? '').trim().slice(0, 80), type = sp.type ?? '', cat = sp.category ?? '';
  const page = Math.max(1, Number(sp.page) || 1);
  const d = await withUser(u.id, async (db) => {
    const cats = await categories(db);
    const follows = (await rows(db, 'select company_id from follows where user_id = $1', [u.id])).map((r) => r.company_id);
    const out: Record<string, any> = { cats, follows };
    if (tab === 'directory') {
      out.list = await rows(db, `
        with mine as (select molecule_id from portfolio_items where user_id = $1)
        select c.id, c.display_name, c.is_ltr, c.is_manufacturer, c.country, s.registrations, s.molecules,
               case when (select count(*) from mine) = 0 then null else round(100.0 * (
                 select count(distinct r.molecule_id) from registrations r
                 where r.active and (r.ltr_id = c.id or r.manufacturer_id = c.id) and r.molecule_id in (select molecule_id from mine))
                 / (select count(*) from mine)) end as overlap
        from companies c join company_stats s on s.company_id = c.id and s.country = $2
        where c.merged_into is null and s.registrations > 0
          and ($3 = '' or c.display_name ilike '%' || $3 || '%')
          and ($4 = '' or ($4 = 'distributor' and c.is_ltr) or ($4 = 'manufacturer' and c.is_manufacturer))
          and ($5 = '' or exists (select 1 from registrations r join molecules m on m.id = r.molecule_id
                                  where r.active and (r.ltr_id = c.id or r.manufacturer_id = c.id) and m.category = $5))
        order by s.registrations desc, c.id limit $6 offset $7`, [u.id, COUNTRY, q, type, cat, PAGE + 1, (page - 1) * PAGE]);
    }
    if (tab === 'compare') {
      out.options = await rows(db, `select c.id, c.display_name from companies c join company_stats s on s.company_id = c.id
                                    where c.is_ltr and c.merged_into is null and s.registrations > 0 order by s.registrations desc limit 80`);
      const ids = [Number(sp.c) || out.options[0]?.id, paid ? Number(sp.c2) || null : null].filter(Boolean);
      out.compare = await rows(db, `
        with mine as (select m.category, count(*)::int as n from portfolio_items p join molecules m on m.id = p.molecule_id
                      where p.user_id = $1 and m.category is not null group by m.category),
        theirs as (select r.ltr_id as cid, m.category, count(distinct r.molecule_id)::int as n from registrations r
                   join molecules m on m.id = r.molecule_id where r.active and r.ltr_id = any($2) and m.category is not null
                   group by r.ltr_id, m.category)
        select coalesce(mine.category, theirs.category) as category, coalesce(mine.n, 0) as mine, theirs.cid, coalesce(theirs.n, 0) as theirs
        from mine full join theirs on theirs.category = mine.category order by 1`, [u.id, ids]);
      out.ids = ids;
    }
    if (tab === 'tracker') {
      out.tracked = await rows(db, `
        select c.id, c.display_name, s.registrations,
               (select json_agg(x) from (select coalesce(m.inn, r.generic_name) as inn, r.molecule_id, r.reg_year, r.brand
                  from registrations r left join molecules m on m.id = r.molecule_id
                  where r.active and r.ltr_id = c.id order by r.reg_year desc nulls last, r.certificate_no desc limit 5) x) as latest
        from follows f join companies c on c.id = f.company_id left join company_stats s on s.company_id = c.id
        where f.user_id = $1 order by c.display_name`, [u.id]);
    }
    return out;
  });
  const tabs = [
    { key: 'directory', label: 'Directory', href: '/competitors' },
    { key: 'compare', label: 'Compare', href: '/competitors?tab=compare' },
    { key: 'tracker', label: 'Tracker', href: '/competitors?tab=tracker' },
  ];
  const back = `/competitors?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== 'error') as [string, string][])}`;
  const name = (id: number) => title(d.options?.find((o: any) => o.id === id)?.display_name ?? '');
  return (
    <Shell user={u} title="Competitors" sub="Every registered company in Tanzania">
      <Tabs items={tabs} current={tab} />
      <Flash sp={sp} />
      {tab === 'directory' && (<>
        <form method="get" className="card tight row">
          <input className="input" name="q" defaultValue={q} placeholder="Search company" aria-label="Search company" style={{ flex: '1 1 220px' }} />
          <select className="input" name="type" defaultValue={type} aria-label="Type" style={{ flex: '0 1 180px' }}>
            <option value="">Any type</option><option value="distributor">Distributor</option><option value="manufacturer">Manufacturer</option>
          </select>
          <select className="input" name="category" defaultValue={cat} aria-label="Class" style={{ flex: '0 1 260px' }}>
            <option value="">Any class</option>{d.cats.map((c: string) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn btn-blue" type="submit">Apply</button>
        </form>
        <section className="card">
          {d.list.length === 0 ? <Empty>No companies match.</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Company</th><th>Type</th><th className="r">Registered products</th><th className="r">Overlap with you</th><th className="r"></th></tr></thead>
              <tbody>{d.list.slice(0, PAGE).map((c: any) => (
                <tr key={c.id}>
                  <td><Link href={`/company/${c.id}`}><span className="nm">{title(c.display_name)}</span></Link>
                    <div className="sub2">{c.is_ltr ? 'Tanzania' : title(c.country)}</div></td>
                  <td>{[c.is_ltr && 'Distributor', c.is_manufacturer && 'Manufacturer'].filter(Boolean).join(', ') || 'Registrant'}</td>
                  <td className="r num">{c.registrations}</td>
                  <td className="r num">{c.overlap === null ? '—' : `${c.overlap}%`}</td>
                  <td className="r"><FollowButton id={c.id} following={d.follows.includes(c.id)} back={back} /></td>
                </tr>))}
              </tbody></table></div>)}
          <div className="between" style={{ marginTop: 14 }}>
            {page > 1 ? <Link className="btn btn-ghost btn-sm" href={`/competitors?${new URLSearchParams({ q, type, category: cat, page: String(page - 1) })}`}>Previous</Link> : <span />}
            {d.list.length > PAGE && <Link className="btn btn-ghost btn-sm" href={`/competitors?${new URLSearchParams({ q, type, category: cat, page: String(page + 1) })}`}>Next</Link>}
          </div>
        </section>
        {!paid && <p className="note">Free: follow {FREE.follows} companies. Paid: unlimited, with alerts on every new registration. <Link href="/settings#plan">Upgrade</Link></p>}
      </>)}
      {tab === 'compare' && (
        <section className="card stack">
          <form method="get" className="row">
            <input type="hidden" name="tab" value="compare" />
            <label className="lbl" htmlFor="c">Compare with me</label>
            <select className="input" id="c" name="c" defaultValue={String(d.ids[0] ?? '')} style={{ flex: '1 1 240px' }}>
              {d.options.map((o: any) => <option key={o.id} value={o.id}>{title(o.display_name)}</option>)}
            </select>
            {paid && (
              <select className="input" name="c2" defaultValue={String(d.ids[1] ?? '')} aria-label="Second company" style={{ flex: '1 1 240px' }}>
                <option value="">Add a second company</option>
                {d.options.map((o: any) => <option key={o.id} value={o.id}>{title(o.display_name)}</option>)}
              </select>)}
            <button className="btn btn-blue btn-sm" type="submit">Compare</button>
          </form>
          {d.ids.map((cid: number) => {
            const rowsFor = d.compare.filter((r: any) => r.cid === cid || r.cid === null);
            const max = Math.max(1, ...rowsFor.map((r: any) => Math.max(r.mine, r.theirs)));
            return (
              <div key={cid} className="stack">
                <div className="legend"><span><i style={{ background: 'var(--blue)' }} />You</span><span><i style={{ background: 'var(--pastel-peach-ink)' }} />{name(cid)}</span></div>
                <div className="bars">{rowsFor.map((r: any) => (
                  <Bar key={r.category} label={r.category} value={r.mine} second={r.theirs} max={max} right={`${r.mine} vs ${r.theirs}`} />))}
                </div>
              </div>);
          })}
          {!paid && <Locked title="Add a second company">Compare yourself with two competitors at once.</Locked>}
          <p className="note">Molecules per class: your portfolio against their registrations. {COVERAGE_NOTE}</p>
        </section>
      )}
      {tab === 'tracker' && (
        <div className="stack">
          {d.tracked.length === 0 && <section className="card"><Empty>Follow companies from the directory to track their new registrations here.</Empty></section>}
          {d.tracked.map((c: any) => (
            <section key={c.id} className="card">
              <div className="card-h"><Link href={`/company/${c.id}`}><h2>{title(c.display_name)}</h2></Link>
                <FollowButton id={c.id} following back="/competitors?tab=tracker" /></div>
              <div className="stack" style={{ gap: 8 }}>{(c.latest ?? []).map((r: any, i: number) => (
                <Link key={i} href={r.molecule_id ? `/molecule/${r.molecule_id}` : '#'} className="between"><span>{r.inn} <span className="muted small">({r.brand})</span></span>
                  <span className="small muted">{r.reg_year}</span></Link>))}</div>
            </section>))}
          {!paid && <p className="note">Free: follow {FREE.follows} companies, weekly email. Paid: alerts on every new registration.</p>}
        </div>
      )}
      <p className="note">Confirmed Nazryx suppliers never appear here. Public registration data only.</p>
    </Shell>
  );
}
