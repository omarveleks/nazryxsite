import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, SourceLink } from '@/components/ui';
import { MoleculeRow } from '@/components/MoleculeRow';
import { hideMolecule } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { rows, one, withUser } from '@/lib/db';
import { FREE, STAGES, fmtDate, title } from '@/lib/format';
import { COUNTRY, MOLECULE_LIST_SQL } from '@/lib/queries';

export const metadata = { title: 'Home' };

const VERDICT: Record<string, string> = { go: 'Go', maybe: 'Worth a look', no: 'Skip' };

// Two thirds of the page is what the customer can act on; one third is background.
export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const d = await withUser(u.id, async (db) => {
    const portfolio = Number((await one(db, 'select count(*)::int as n from portfolio_items where user_id = $1', [u.id]))?.n ?? 0);
    // waiting on you: quotes to review, evaluations back, questions from our team, orders moving
    const todo = await rows(db, `
      select 'quotes' as kind, r.id, coalesce(m.inn, r.molecule_text) as molecule, count(q.id)::int as n, null as extra, r.updated_at as at
        from requests r join quotes q on q.request_id = r.id left join molecules m on m.id = r.molecule_id
        where r.user_id = $1 and r.stage = 'Quote ready' and not exists (select 1 from quotes a where a.request_id = r.id and a.accepted)
        group by r.id, m.inn
      union all
      select 'evaluation', r.id, coalesce(m.inn, r.molecule_text), 0, e.verdict, e.evaluated_at
        from requests r join request_evaluations e on e.request_id = r.id left join molecules m on m.id = r.molecule_id
        where r.user_id = $1 and r.stage in ('Submitted', 'Reviewing') and e.evaluated_at > now() - interval '30 days'
      union all
      select 'message', r.id, coalesce(m.inn, r.molecule_text), 0, null, x.created_at
        from requests r left join molecules m on m.id = r.molecule_id
        join lateral (select from_team, created_at from request_messages where request_id = r.id order by created_at desc limit 1) x on x.from_team
        where r.user_id = $1 and r.stage <> 'Closed'
      union all
      select 'order', o.id, coalesce(m.inn, r.molecule_text), 0, o.status, o.updated_at
        from orders o join requests r on r.id = o.request_id left join molecules m on m.id = r.molecule_id
        where r.user_id = $1 and o.status not in ('Delivered', 'Cancelled')
      order by at desc limit 8`, [u.id]);
    // picked for you: a few open molecules in classes the customer already carries. Never the whole open list.
    const picks = portfolio === 0 ? [] : await rows(db, `${MOLECULE_LIST_SQL}
        where cm.rankable and g.score > 0
          and m.category in (select distinct m2.category from portfolio_items p join molecules m2 on m2.id = p.molecule_id where p.user_id = $1)
          and m.id not in (select molecule_id from portfolio_items where user_id = $1)
          and m.id not in (select molecule_id from hidden_molecules where user_id = $1)
          and m.id not in (select molecule_id from requests where user_id = $1 and molecule_id is not null)
        order by g.score desc, cm.registrants, m.inn limit $2`, [u.id, free ? 3 : 5]);
    const moves = portfolio === 0 ? [] : await rows(db, 'select * from my_market_moves(60) limit 6');
    const pipeline = await rows(db, `select stage, count(*)::int as n from requests where user_id = $1 and stage <> 'Closed' group by stage`, [u.id]);
    const counts = await one(db, `select
        (select count(*)::int from registrations where country = $1 and active and reg_year >= extract(year from now())::int) as new_regs,
        (select count(distinct molecule_id)::int from registrations where country = $1 and active) as molecules`, [COUNTRY]);
    // background: regulatory notes, your request updates, and registrations on molecules you carry, watch or follow
    const feed = await rows(db, `select kind, title, link, created_at from feed_items f
        where country = $1 and (kind <> 'registration' or f.molecule_id in (
              select molecule_id from portfolio_items where user_id = $2 union select molecule_id from watches where user_id = $2)
          or f.company_id in (select company_id from follows where user_id = $2))
        order by created_at desc limit 5`, [COUNTRY, u.id]);
    const watch = await rows(db, `select 'm' as t, m.id, m.inn as name from watches w join molecules m on m.id = w.molecule_id where w.user_id = $1
                                  union all select 'c', c.id, c.display_name from follows f join companies c on c.id = f.company_id where f.user_id = $1
                                  limit 8`, [u.id]);
    return { portfolio, todo, picks, moves, pipeline, counts, feed, watch };
  });
  const active = d.pipeline.reduce((a, p) => a + p.n, 0);
  const year = new Date().getFullYear();
  const todoLine = (t: any) => {
    if (t.kind === 'quotes') return { text: `${t.n} ${t.n === 1 ? 'quote' : 'quotes'} for ${t.molecule}`, href: `/requests/${t.id}`, cta: 'Review' };
    if (t.kind === 'evaluation') return { text: `Evaluation back for ${t.molecule}: ${VERDICT[t.extra] ?? ''}`, href: `/requests/${t.id}`, cta: 'Open' };
    if (t.kind === 'message') return { text: `Nazryx asked you about ${t.molecule}`, href: `/requests/${t.id}`, cta: 'Reply' };
    return { text: `Order ${t.id} for ${t.molecule}: ${t.extra}`, href: '/requests', cta: 'Track' };
  };
  return (
    <Shell user={u} title="Home" sub="What to do next" actions={<Link className="btn btn-blue btn-sm" href="/requests/new">Source a molecule</Link>}>
      <Flash sp={sp} />
      {sp.welcome && <div className="ok">Welcome. {u.claim_status === 'pending' ? 'Your company claim is with our team. We will email you when it is approved.' : 'Add your portfolio and we will pick molecules for you.'}</div>}
      {u.claim_status === 'pending' && !sp.welcome && <div className="note">Company claim pending review. Your profile unlocks after approval.</div>}
      <div className="split">
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Waiting on you</h2>{d.todo.length > 0 && <span className="pill solid">{d.todo.length}</span>}</div>
            {d.portfolio === 0 && (
              <div className="between" style={{ padding: '10px 0' }}><span>Add the molecules you carry so we can pick open ones for you.</span>
                <Link className="btn btn-blue btn-sm" href="/portfolio">Add portfolio</Link></div>)}
            {d.todo.length === 0 && d.portfolio > 0 && <Empty>Nothing waiting on you. Pick a molecule below and we will evaluate it.</Empty>}
            <div className="stack" style={{ gap: 10 }}>{d.todo.map((t, i) => {
              const l = todoLine(t);
              return (<div key={i} className="between"><span>{l.text}<span className="sub2"> · {fmtDate(t.at)}</span></span>
                <Link className="btn btn-ghost btn-sm" href={l.href}>{l.cta}</Link></div>);
            })}</div>
          </section>

          <section className="card">
            <div className="card-h"><div><h2>Picked for you</h2>
              <p className="note">Open molecules in the classes you carry. Source one and we evaluate it for you.</p></div></div>
            {d.portfolio === 0 ? <Empty>We pick from the classes in your portfolio. Add it first.</Empty>
              : d.picks.length === 0 ? <Empty>No open molecules left in your classes. Search for others.</Empty> : (
              <div>{d.picks.map((m, i) => (
                <MoleculeRow key={m.id} m={m} first={i === 0} actions={<>
                  <form action={hideMolecule}><input type="hidden" name="molecule_id" value={m.id} /><input type="hidden" name="return" value="/home" />
                    <button className="btn btn-ghost btn-sm" type="submit" aria-label={`Hide ${m.inn}`}>Hide</button></form>
                  <SourceLink id={m.id} stage={m.request_stage} /></>} />))}</div>)}
            {free && d.picks.length > 0 && <p className="note" style={{ marginTop: 12 }}>Free plan: {d.picks.length} picks. <Link href="/settings#plan">Upgrade</Link> for more.</p>}
          </section>

          <section className="card">
            <div className="card-h"><div><h2>Moves on your molecules</h2><p className="note">Last 60 days</p></div></div>
            {d.portfolio === 0 ? <Empty>Add your portfolio to see who registers or drops the molecules you carry.</Empty>
              : d.moves.length === 0 ? <Empty>No changes on your molecules in the last 60 days.</Empty> : (
              <div className="stack" style={{ gap: 10 }}>{d.moves.map((mv, i) => (
                <div key={i} className="between">
                  <span>{mv.change === 'added' ? <><b>{title(mv.company) || 'A company'}</b> registered {mv.molecule}</>
                    : <>{mv.molecule}: <b>{title(mv.company) || 'a company'}</b> dropped a registration</>}
                    <span className="sub2"> · {fmtDate(mv.at)}</span></span>
                  {mv.change === 'added' && mv.company_id
                    ? <Link className="btn btn-ghost btn-sm" href={`/company/${mv.company_id}`}>See their range</Link>
                    : <Link className="btn btn-ghost btn-sm" href={`/molecule/${mv.molecule_id}`}>Check the gap</Link>}
                </div>))}</div>)}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Your requests</h2><Link className="btn-link" href="/requests">All</Link></div>
            {active === 0 ? <Empty>No open requests.</Empty> : (
              <div className="stack" style={{ gap: 8 }}>{STAGES.filter((s) => s !== 'Closed').map((s) => {
                const n = d.pipeline.find((p) => p.stage === s)?.n ?? 0;
                return <div key={s} className="between"><span className={n ? '' : 'muted'}>{s}</span><b className="num">{n}</b></div>;
              })}</div>)}
            {u.plan !== 'paid' && <p className="note" style={{ marginTop: 10 }}>{active} of {FREE.requests} active (free)</p>}
          </section>
          <section className="card">
            <div className="card-h"><h2>Tanzania</h2><Link className="btn-link" href="/market">Market</Link></div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="between"><span>New registrations in {year}</span><b className="num">{d.counts?.new_regs}</b></div>
              <div className="between"><span>Molecules on the market</span><b className="num">{d.counts?.molecules}</b></div>
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Updates</h2></div>
            {d.feed.length === 0 && <Empty>Regulatory notes, your request updates and registrations on your molecules show here.</Empty>}
            <div className="stack" style={{ gap: 10 }}>{d.feed.map((f, i) => (
              <Link key={i} href={f.link || '#'} className="stack" style={{ gap: 2 }}>
                <span className="small">{f.title}</span><span className="tiny muted">{fmtDate(f.created_at)}</span></Link>))}</div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Watchlist</h2></div>
            {d.watch.length === 0 && <Empty>Watch molecules and follow companies to see them here.</Empty>}
            <div className="stack" style={{ gap: 8 }}>
              {d.watch.map((w) => <Link key={w.t + w.id} href={w.t === 'm' ? `/molecule/${w.id}` : `/company/${w.id}`}>{title(w.name)}</Link>)}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
