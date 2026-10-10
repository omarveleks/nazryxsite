import Link from 'next/link';
import Shell from '@/components/Shell';
import EnrichButton from '@/components/EnrichButton';
import { Empty, SourceLink } from '@/components/ui';
import { MoleculeRow } from '@/components/MoleculeRow';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { categories, MOLECULE_LIST_SQL } from '@/lib/queries';

export const metadata = { title: 'Search' };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; class?: string; status?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const q = (sp.q ?? '').trim().slice(0, 80), cls = sp.class ?? '', status = sp.status ?? '';
  const searching = Boolean(q || cls || status);
  const free = u.plan !== 'paid' && u.role !== 'team';
  const d = await withUser(u.id, async (db) => {
    const cats = await categories(db);
    let list;
    if (searching) {
      list = await rows(db, `${MOLECULE_LIST_SQL}
        where ($1 = '' or m.inn ilike '%' || $1 || '%' or m.category ilike '%' || $1 || '%'
               or exists (select 1 from molecule_aliases a where a.molecule_id = m.id and a.alias like '%' || lower($1) || '%')
               or exists (select 1 from registrations r where r.molecule_id = m.id and r.active and r.brand ilike '%' || $1 || '%'))
          and ($2 = '' or m.category = $2)
          and ($3 = '' or ($3 = 'official' and cm.on_national_list) or ($3 = 'global' and cm.on_who_eml)
               or ($3 = 'unregistered' and cm.registrations = 0))
        order by (case when $1 <> '' and m.inn ilike $1 || '%' then 0 else 1 end), g.score desc nulls last, cm.registrations desc
        limit 40`, [q, cls, status]);
    } else {
      // "Picked for you": a few open molecules in the classes you already carry (never the whole open list)
      list = await rows(db, `${MOLECULE_LIST_SQL}
        where cm.rankable and g.score > 0 and m.category in (
            select distinct m2.category from portfolio_items p join molecules m2 on m2.id = p.molecule_id where p.user_id = $1)
          and m.id not in (select molecule_id from portfolio_items where user_id = $1)
          and m.id not in (select molecule_id from hidden_molecules where user_id = $1)
        order by g.score desc, cm.registrants, m.inn limit $2`, [u.id, free ? 3 : 8]);
    }
    const recent = await rows(db, `select m.id, m.inn from enrichments e join molecules m on m.id = e.molecule_id
                                   where e.user_id = $1 order by e.created_at desc limit 5`, [u.id]);
    const hasPortfolio = (await rows(db, 'select 1 from portfolio_items where user_id = $1 limit 1', [u.id])).length > 0;
    return { cats, list, recent, hasPortfolio };
  });
  return (
    <Shell user={u} title="Search" sub="Find a molecule, then ask us to source it">
      {sp.welcome && <div className="ok">Search for molecules and add them to your portfolio from the molecule page.</div>}
      <form method="get" className="card tight row">
        <label className="sr" htmlFor="q">Search</label>
        <input className="input" id="q" name="q" defaultValue={q} placeholder="Search by molecule, brand or therapeutic class" style={{ flex: '1 1 280px' }} />
        <select className="input" name="class" defaultValue={cls} aria-label="Class" style={{ flex: '0 1 240px' }}>
          <option value="">Any class</option>
          {d.cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" name="status" defaultValue={status} aria-label="Status" style={{ flex: '0 1 200px' }}>
          <option value="">Any status</option>
          <option value="official">On the official list</option>
          <option value="global">On the global essential list</option>
          <option value="unregistered">Not registered yet</option>
        </select>
        <button className="btn btn-blue" type="submit">Search</button>
      </form>
      {d.recent.length > 0 && (
        <div className="row small muted">Recent: {d.recent.map((r, i) => <span key={r.id}><Link href={`/molecule/${r.id}`}>{r.inn}</Link>{i < d.recent.length - 1 ? ',' : ''}</span>)}</div>
      )}
      <section className="card">
        <div className="card-h">
          <div><h2>{searching ? 'Results' : 'Picked for you'}</h2>
            {!searching && <p className="note">Open molecules in the classes you already carry. Source one and we evaluate it for you.</p>}</div>
          {free && <span className="note">Enrich costs 1 credit. Credits: <b className="num">{u.credits}</b> left this month.</span>}
        </div>
        {d.list.length === 0 ? (
          searching ? <Empty>No molecules match. Try a shorter name or another class.</Empty> : (
            <div className="stack" style={{ alignItems: 'flex-start' }}>
              <Empty>{d.hasPortfolio ? 'No open molecules in your classes right now.' : 'No portfolio yet. Without one, this list is empty and only search works.'}</Empty>
              {!d.hasPortfolio && <Link className="btn btn-ghost btn-sm" href="/portfolio">Add your portfolio</Link>}
            </div>)
        ) : (
          <div>{d.list.map((m, i) => (
            <MoleculeRow key={m.id} m={m} first={i === 0}
              actions={<><EnrichButton id={m.id} enriched={m.enriched} free={free} /><SourceLink id={m.id} stage={m.request_stage} /></>} />))}
          </div>
        )}
      </section>
    </Shell>
  );
}
