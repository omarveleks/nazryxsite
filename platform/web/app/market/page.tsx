import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketTabs from '@/components/MarketTabs';
import YearChart from '@/components/YearChart';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { COVERAGE_NOTE, saturationLabel, title } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Market' };

export default async function Market() {
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => {
    const cats = await rows(db, `
      select m.category, count(*)::int as molecules, sum(cm.registrations)::int as products,
             avg(g.saturation)::float as sat, count(*) filter (where g.saturation <= 0.25 and cm.rankable)::int as open_gaps,
             (select count(distinct r.ltr_id)::int from registrations r join molecules m2 on m2.id = r.molecule_id
                where r.country = $1 and r.active and m2.category = m.category) as registrants
      from country_molecules cm join molecules m on m.id = cm.molecule_id
      left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
      where cm.country = $1 and cm.on_national_list and m.category is not null
      group by m.category order by products desc`, [COUNTRY]);
    const top = await rows(db, `select c.id, c.display_name, s.registrations from company_stats s join companies c on c.id = s.company_id
                                where s.country = $1 and c.is_ltr and c.merged_into is null order by s.registrations desc limit 10`, [COUNTRY]);
    const years = await rows(db, `select reg_year as year, count(*)::int as n from registrations
                                  where country = $1 and active and reg_year between 2000 and extract(year from now())::int
                                  group by reg_year order by reg_year`, [COUNTRY]);
    const totals = await rows(db, `select count(*)::int as products, count(distinct ltr_id)::int as distributors,
                                   count(distinct molecule_id)::int as molecules from registrations where country = $1 and active`, [COUNTRY]);
    return { cats, top, years, totals: totals[0] };
  });
  return (
    <Shell user={u} title="Market" sub="Tanzania, country snapshot">
      <MarketTabs current="snapshot" />
      <div className="grid g3">
        <div className="tile t-blue"><span className="k">Registered products</span><span className="v num">{d.totals.products.toLocaleString('en')}</span></div>
        <div className="tile t-mint"><span className="k">Local distributors</span><span className="v num">{d.totals.distributors}</span></div>
        <div className="tile t-lav"><span className="k">Molecules on the market</span><span className="v num">{d.totals.molecules}</span></div>
      </div>
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>By class</h2><span className="note">Classes of the official list</span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Class</th><th className="r">Registered products</th><th className="r">Registrants</th><th>Saturation</th><th className="r">Open gaps</th></tr></thead>
            <tbody>{d.cats.map((c) => (
              <tr key={c.category}><td>{c.category}</td><td className="r num">{c.products}</td><td className="r num">{c.registrants}</td>
                <td><span className={`pill ${saturationLabel(c.sat) === 'High' ? '' : saturationLabel(c.sat) === 'Medium' ? 'blue' : 'mint'}`}>{saturationLabel(c.sat)}</span></td>
                <td className="r num">{c.open_gaps}</td></tr>))}
            </tbody></table></div>
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Top registrants</h2></div>
            <ol className="steps">{d.top.map((c, i) => (
              <li key={c.id}><em>{String(i + 1).padStart(2, '0')}</em>
                <Link href={`/company/${c.id}`} className="between"><span>{title(c.display_name)}</span><span className="small muted num">{c.registrations}</span></Link></li>))}
            </ol>
            <Link className="btn-link" href="/competitors">See all competitors</Link>
          </section>
        </div>
      </div>
      <section className="card">
        <div className="card-h"><h2>Registered products by certificate year</h2><span className="note">Products still registered today</span></div>
        <YearChart data={d.years} />
      </section>
      <p className="note">Data only. Saturation compares registrants per molecule with a crowded market (8 or more). {COVERAGE_NOTE}</p>
    </Shell>
  );
}
