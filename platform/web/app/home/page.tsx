import Link from 'next/link';
import Shell from '@/components/Shell';
import { StagePill, Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { rows, one, withUser } from '@/lib/db';
import { FREE, fmtDate, title } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Home' };

export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const d = await withUser(u.id, async (db) => {
    const feed = await rows(db, `select kind, title, link, created_at from feed_items
                                 where country = $1 order by created_at desc limit 12`, [COUNTRY]);
    // latest certificates: the newest registrations in the current list
    const recent = await rows(db, `select r.molecule_id, coalesce(m.inn, r.generic_name) as inn, c.display_name as company, r.reg_year
        from registrations r left join molecules m on m.id = r.molecule_id left join companies c on c.id = r.ltr_id
        where r.country = $1 and r.active and r.reg_year is not null
        order by r.reg_year desc, r.certificate_no desc limit 8`, [COUNTRY]);
    const counts = await one(db, `select
        (select count(*)::int from registrations where country = $1 and active and reg_year >= extract(year from now())::int) as new_regs,
        (select count(*)::int from requests where user_id = $2 and updated_at > now() - interval '7 days') as req_updates,
        (select count(*)::int from visible_gap_scores g join country_molecules cm on cm.molecule_id = g.molecule_id and cm.country = g.country
           where g.country = $1 and cm.rankable and cm.registrants = 0 and cm.on_national_list) as open_gaps,
        (select count(*)::int from portfolio_items where user_id = $2) as portfolio`, [COUNTRY, u.id]);
    const watch = await rows(db, `select 'm' as t, m.id, m.inn as name from watches w join molecules m on m.id = w.molecule_id where w.user_id = $1
                                  union all select 'c', c.id, c.display_name from follows f join companies c on c.id = f.company_id where f.user_id = $1`, [u.id]);
    const reqs = await rows(db, `select r.id, r.stage, coalesce(m.inn, r.molecule_text) as molecule from requests r
                                 left join molecules m on m.id = r.molecule_id where r.user_id = $1 order by r.updated_at desc limit 5`, [u.id]);
    const active = reqs.filter((r) => r.stage !== 'Closed').length;
    return { feed, recent, counts, watch, reqs, active };
  });
  const year = new Date().getFullYear();
  return (
    <Shell user={u} title="Home" sub="This week in Tanzania">
      {sp.welcome && <div className="ok">Welcome. {u.claim_status === 'pending' ? 'Your company claim is with our team. We will email you when it is approved.' : 'Start with a search, or look at the market.'}</div>}
      {u.claim_status === 'pending' && !sp.welcome && <div className="note">Company claim pending review. Your profile unlocks after approval.</div>}
      <div className="grid g4">
        <Link className="tile t-blue" href="/market"><span className="k">New registrations in {year}</span><span className="v num">{d.counts?.new_regs}</span></Link>
        <Link className="tile t-mint" href="/requests"><span className="k">Request updates this week</span><span className="v num">{d.counts?.req_updates}</span></Link>
        <Link className="tile t-peach" href="/market/whitespace"><span className="k">Official-list molecules nobody registered</span><span className="v num">{d.counts?.open_gaps}</span></Link>
        <Link className="tile t-white" href="/portfolio"><span className="k">Molecules in your portfolio</span><span className="v num">{d.counts?.portfolio}</span></Link>
      </div>
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>Feed</h2><span className="note">Registrations, request updates and regulatory notes</span></div>
          <div className="feed">
            {d.feed.map((f, i) => (
              <Link key={i} className="feed-item" href={f.link || '#'}>
                <span><span className={`pill ${f.kind === 'request' ? 'solid' : f.kind === 'regulatory' ? 'lav' : 'blue'}`}>{f.kind === 'registration' ? 'Registration' : f.kind === 'request' ? 'Request' : 'Regulatory'}</span></span>
                <span>{f.title}</span><span className="tiny muted nowrap">{fmtDate(f.created_at)}</span>
              </Link>
            ))}
            {d.recent.map((r, i) => (
              <Link key={'r' + i} className="feed-item" href={r.molecule_id ? `/molecule/${r.molecule_id}` : '/search'}>
                <span><span className="pill blue">Registration</span></span>
                <span>{r.inn} registered by {title(r.company) || 'a company'}</span><span className="tiny muted">{r.reg_year}</span>
              </Link>
            ))}
          </div>
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Watchlist</h2></div>
            {d.watch.length === 0 && <Empty>Watch molecules and follow companies to see them here.</Empty>}
            <div className="stack" style={{ gap: 8 }}>
              {d.watch.map((w) => <Link key={w.t + w.id} href={w.t === 'm' ? `/molecule/${w.id}` : `/company/${w.id}`}>{title(w.name)}</Link>)}
            </div>
            {u.plan !== 'paid' && <p className="note" style={{ marginTop: 10 }}>Free: {FREE.watches} watches and {FREE.follows} follows, weekly email.</p>}
          </section>
          <section className="card">
            <div className="card-h"><h2>Your requests</h2><Link className="btn-link" href="/requests/new">New</Link></div>
            {d.reqs.length === 0 && <Empty>No requests yet. Tell us what you need sourced.</Empty>}
            <div className="stack" style={{ gap: 10 }}>
              {d.reqs.map((r) => <Link key={r.id} href={`/requests/${r.id}`} className="between"><span>{r.molecule}</span><StagePill stage={r.stage} /></Link>)}
            </div>
            {u.plan !== 'paid' && <p className="note" style={{ marginTop: 10 }}>{d.active} of {FREE.requests} active (free)</p>}
          </section>
        </div>
      </div>
    </Shell>
  );
}
