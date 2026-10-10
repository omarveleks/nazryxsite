import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Shell from '@/components/Shell';
import FollowButton from '@/components/FollowButton';
import { Bar, Flash, Locked } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { COVERAGE_NOTE, title } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export default async function Company({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser();
  const paid = u.plan === 'paid' || u.role === 'team';
  const d = await withUser(u.id, async (db) => {
    let c = await one(db, `select c.*, s.registrations, s.molecules, s.categories, s.new_recent, s.manufacturers,
                           exists (select 1 from follows f where f.company_id = c.id and f.user_id = $2) as following
                           from companies c left join company_stats s on s.company_id = c.id and s.country = $3 where c.id = $1`, [id, u.id, COUNTRY]);
    if (!c) return null;
    if (c.merged_into) return { redirectTo: c.merged_into };
    const scope = `r.country = $2 and r.active and (r.ltr_id = $1 or r.registrant_id = $1 or r.manufacturer_id = $1)`;
    const byCat = await rows(db, `select coalesce(m.category, 'Not on the official list') as category, count(distinct r.molecule_id)::int as n
                                  from registrations r left join molecules m on m.id = r.molecule_id where ${scope}
                                  group by 1 order by n desc limit 12`, [id, COUNTRY]);
    const makers = await rows(db, `select mc.id, mc.display_name, initcap(lower(r.manufacturing_country)) as country, count(*)::int as n
                                   from registrations r join companies mc on mc.id = r.manufacturer_id
                                   where r.country = $2 and r.active and r.ltr_id = $1 and r.manufacturer_id <> $1
                                   group by mc.id, r.manufacturing_country order by n desc limit 40`, [id, COUNTRY]);
    const recent = await rows(db, `select r.molecule_id, coalesce(m.inn, r.generic_name) as inn, r.brand, r.reg_year from registrations r
                                   left join molecules m on m.id = r.molecule_id where ${scope}
                                   order by r.reg_year desc nulls last, r.certificate_no desc limit 8`, [id, COUNTRY]);
    return { c, byCat, makers, recent };
  });
  if (!d) notFound();
  if ('redirectTo' in d) redirect(`/company/${d.redirectTo}`);
  const { c } = d as any;
  const type = [c.is_ltr && 'Distributor', c.is_manufacturer && 'Manufacturer'].filter(Boolean).join(' and ') || 'Registrant';
  const year = new Date().getFullYear();
  const maxCat = Math.max(1, ...d.byCat!.map((r) => r.n));
  const shownMakers = paid ? d.makers! : d.makers!.slice(0, 2);
  return (
    <Shell user={u} title={title(c.display_name)} crumb={<><Link href="/competitors">Competitors</Link> / {title(c.display_name)}</>}
      sub={`${type}, ${c.is_ltr ? 'Tanzania' : title(c.country) || 'Tanzania'}${c.verified ? ' · verified on Nazryx' : ''}`}
      actions={<FollowButton id={id} following={c.following} back={`/company/${id}`} />}>
      <Flash sp={sp} />
      <div className="grid g4">
        <div className="tile t-blue"><span className="k">Registered products</span><span className="v num">{c.registrations ?? 0}</span></div>
        <div className="tile t-mint"><span className="k">Classes</span><span className="v num">{c.categories ?? 0}</span></div>
        <div className="tile t-peach"><span className="k">New since {year - 1}</span><span className="v num">{c.new_recent ?? 0}</span></div>
        <div className="tile t-lav"><span className="k">Manufacturers behind them</span><span className="v num">{c.manufacturers ?? 0}</span></div>
      </div>
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>Portfolio by class</h2><span className="note">molecules</span></div>
          <div className="bars">{d.byCat!.map((r) => <Bar key={r.category} label={r.category} value={r.n} max={maxCat} right={r.n} />)}</div>
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Manufacturers behind their products</h2></div>
            <div className="stack" style={{ gap: 8 }}>
              {shownMakers.map((m) => <div key={m.id + m.country} className="between"><span>{title(m.display_name)}</span><span className="small muted">{m.country} · {m.n}</span></div>)}
              {shownMakers.length === 0 && <span className="note">None on record.</span>}
            </div>
            {!paid && d.makers!.length > 2 && <div style={{ marginTop: 12 }}><Locked title={`${d.makers!.length - 2} more manufacturers`} /></div>}
          </section>
          <section className="card">
            <div className="card-h"><h2>Recent registrations</h2></div>
            <div className="stack" style={{ gap: 8 }}>{d.recent!.map((r, i) => (
              <Link key={i} href={r.molecule_id ? `/molecule/${r.molecule_id}` : '#'} className="between">
                <span>{r.inn} <span className="small muted">{r.brand}</span></span><span className="small muted">{r.reg_year}</span></Link>))}</div>
          </section>
        </div>
      </div>
      <p className="note">Public registration data only. {COVERAGE_NOTE}</p>
    </Shell>
  );
}
