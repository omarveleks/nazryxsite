import type React from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { MoleculeRow } from '@/components/MoleculeRow';
import { Bar, Empty, Flash, SourceLink, StagePill } from '@/components/ui';
import { addPortfolioList, createRequest, hideMolecule } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { rows, one, withUser } from '@/lib/db';
import { FREE, fmtDate, title } from '@/lib/format';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from '@/lib/support';
import { COUNTRY, MOLECULE_LIST_SQL, activeRequestCount } from '@/lib/queries';

export const metadata = { title: 'Home' };

const VERDICT: Record<string, string> = { go: 'Go', maybe: 'Worth a look', no: 'Skip' };

// Layout: personal numbers on top (each opens the place to act), then two thirds action (the three services:
// market intelligence, quick sourcing, portfolio analysis) and one third background. New accounts get a short
// getting-started checklist until the basics are done.
export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string; error?: string; added?: string; missed?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const d = await withUser(u.id, async (db) => {
    const me = await one(db, `select
        (select count(*)::int from portfolio_items where user_id = $1) as portfolio,
        (select count(*)::int from requests where user_id = $1) as requests_ever,
        (select count(*)::int from watches where user_id = $1) + (select count(*)::int from follows where user_id = $1) as tracking`, [u.id]);
    const portfolio = Number(me?.portfolio ?? 0);
    const focus = await one(db, 'select classes, goals, supplier_countries, levels from user_focus where user_id = $1', [u.id]);
    const fClasses: string[] = focus?.classes ?? [], fLevels: string[] = focus?.levels ?? [];
    const mine = portfolio > 0 || fClasses.length > 0;
    // open molecules: on the official list, ranked by how few companies registered them (in the customer's classes once known)
    // classes: the customer's focus if set, else the classes in their portfolio, else everything
    const OPEN = `cm.rankable and cm.on_national_list and g.score > 0
        and ($2 = false or (cardinality($4::text[]) > 0 and m.category = any($4::text[]))
             or (cardinality($4::text[]) = 0 and m.category in (select distinct m2.category from portfolio_items p join molecules m2 on m2.id = p.molecule_id where p.user_id = $1)))
        and (cardinality($5::text[]) = 0 or cm.facility_level = any($5::text[]))
        and m.id not in (select molecule_id from portfolio_items where user_id = $1)
        and m.id not in (select molecule_id from hidden_molecules where user_id = $1)`;
    const picks = await rows(db, `${MOLECULE_LIST_SQL} where ${OPEN}
        and m.id not in (select molecule_id from requests where user_id = $1 and molecule_id is not null)
        order by g.score desc, cm.registrants, m.inn limit $3`, [u.id, mine, free ? FREE.whitespace : 6, fClasses, fLevels]);
    const openCount = Number((await one(db, `select count(*)::int as n from molecules m
        join country_molecules cm on cm.molecule_id = m.id and cm.country = '${COUNTRY}'
        left join visible_gap_scores g on g.molecule_id = m.id and g.country = cm.country where ${OPEN} and $3::int is not null`,
        [u.id, mine, 0, fClasses, fLevels]))?.n ?? 0);
    // waiting on you: only things the customer has to act on (quotes, evaluations, questions from our team)
    const todo = await rows(db, `
      select 'quotes' as kind, r.id, coalesce(m.inn, r.molecule_text) as molecule, count(q.id)::int as n, null as extra, r.updated_at as at
        from requests r join quotes q on q.request_id = r.id left join molecules m on m.id = r.molecule_id
        where r.user_id = $1 and r.stage = 'Pricing and logistics' and not exists (select 1 from quotes a where a.request_id = r.id and a.accepted)
        group by r.id, m.inn
      union all
      select 'evaluation', r.id, coalesce(m.inn, r.molecule_text), 0, e.verdict, e.evaluated_at
        from requests r join request_evaluations e on e.request_id = r.id left join molecules m on m.id = r.molecule_id
        where r.user_id = $1 and r.stage in ('Product request', 'Regulatory check', 'Regulatory analysis') and e.evaluated_at > now() - interval '30 days'
      union all
      select 'message', r.id, coalesce(m.inn, r.molecule_text), 0, null, x.created_at
        from requests r left join molecules m on m.id = r.molecule_id
        join lateral (select from_team, created_at from request_messages where request_id = r.id order by created_at desc limit 1) x on x.from_team
        where r.user_id = $1 and r.stage <> 'Closed'
      order by at desc limit 8`, [u.id]);
    const moves = portfolio > 0 ? await rows(db, 'select * from my_market_moves(60) limit 5') : [];
    const coverage = portfolio > 0 ? await rows(db, `
        with ess as (select cm.molecule_id, m.category from country_molecules cm join molecules m on m.id = cm.molecule_id
                     where cm.country = $2 and cm.on_national_list and cm.rankable and m.category is not null)
        select e.category, count(*)::int as n, count(p.molecule_id)::int as covered
        from ess e left join portfolio_items p on p.molecule_id = e.molecule_id and p.user_id = $1
        where e.category in (select distinct m.category from portfolio_items pi join molecules m on m.id = pi.molecule_id where pi.user_id = $1)
        group by e.category order by count(*) - count(p.molecule_id) desc`, [u.id, COUNTRY]) : [];
    const open = await rows(db, `select r.id, r.stage, coalesce(m.inn, r.molecule_text) as molecule from requests r
        left join molecules m on m.id = r.molecule_id where r.user_id = $1 and r.stage <> 'Closed' order by r.updated_at desc limit 4`, [u.id]);
    const names = await rows(db, `select m.inn from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                                  order by cm.on_national_list desc, m.inn limit 2000`, [COUNTRY]);
    const counts = await one(db, `select
        (select count(*)::int from registrations where country = $1 and active and reg_year >= extract(year from now())::int) as new_regs,
        (select count(distinct molecule_id)::int from registrations where country = $1 and active) as molecules,
        (select count(*)::int from country_molecules where country = $1 and on_national_list and rankable and registrants = 0) as nobody`, [COUNTRY]);
    const feed = await rows(db, `select kind, title, link, created_at from feed_items f
        where country = $1 and (kind <> 'registration' or f.molecule_id in (
              select molecule_id from portfolio_items where user_id = $2 union select molecule_id from watches where user_id = $2)
          or f.company_id in (select company_id from follows where user_id = $2))
        order by created_at desc limit 5`, [COUNTRY, u.id]);
    const watch = await rows(db, `select 'm' as t, m.id, m.inn as name from watches w join molecules m on m.id = w.molecule_id where w.user_id = $1
                                  union all select 'c', c.id, c.display_name from follows f join companies c on c.id = f.company_id where f.user_id = $1
                                  limit 8`, [u.id]);
    return { me, portfolio, mine, focus, picks, openCount, todo, moves, coverage, open, names, counts, feed, watch,
             active: await activeRequestCount(db, u.id) };
  });

  const covN = d.coverage.reduce((a, c) => a + c.n, 0), covHave = d.coverage.reduce((a, c) => a + c.covered, 0);
  const covPct = covN ? Math.round((100 * covHave) / covN) : null;
  const quotes = d.todo.filter((t) => t.kind === 'quotes').reduce((a, t) => a + t.n, 0);
  const steps = [
    { done: d.portfolio > 0, label: 'Add your portfolio', why: 'Narrows open molecules to your classes and unlocks your coverage.', href: '#portfolio' },
    { done: Number(d.me?.requests_ever) > 0, label: 'Source your first molecule', why: 'We run the regulatory check for you, then quotes.', href: '#sourcing' },
    { done: Number(d.me?.tracking) > 0, label: 'Watch a molecule or follow a competitor', why: 'Get told when someone registers or drops it.', href: '/competitors' },
    { done: u.claim_status === 'approved' || u.claim_status === 'pending', label: 'Claim your company', why: 'Loads your registered products as your portfolio.', href: '/onboarding' },
  ];
  steps.unshift({ done: Boolean(d.focus), label: 'Set your focus', why: 'Classes, goals and supplier countries shape your picks.', href: '/onboarding/focus?next=/home' });
  const doneSteps = steps.filter((s) => s.done).length;
  const goals: string[] = d.focus?.goals ?? [];
  // the main goal decides which service leads the page
  const order = goals.includes('new_molecules') || goals.length === 0 ? ['intelligence', 'sourcing', 'portfolio']
    : goals.includes('expand_sales') ? ['portfolio', 'intelligence', 'sourcing'] : ['sourcing', 'portfolio', 'intelligence'];
  const support = SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP.replace(/[^\d]/g, '')}` : `mailto:${SUPPORT_EMAIL}`;
  const todoLine = (t: any) => {
    if (t.kind === 'quotes') return { text: `${t.n} ${t.n === 1 ? 'quote' : 'quotes'} for ${t.molecule}`, href: `/requests/${t.id}`, cta: 'Review' };
    if (t.kind === 'evaluation') return { text: `Assessment back for ${t.molecule}: ${VERDICT[t.extra] ?? ''}`, href: `/requests/${t.id}`, cta: 'Open' };
    return { text: `Nazryx asked you about ${t.molecule}`, href: `/requests/${t.id}`, cta: 'Reply' };
  };
  const year = new Date().getFullYear();
  const sections: Record<string, React.ReactNode> = {
    intelligence: (<>
          <section className="card" id="intelligence">
            <div className="card-h"><div><h2>Market intelligence</h2>
              <p className="note">{d.mine ? `Official TMDA list molecules in your ${d.focus?.classes?.length ? 'focus classes' : 'classes'} that few or no companies have registered.`
                : `Official TMDA list molecules few or no companies have registered. ${d.counts?.nobody} have no registration at all.`}</p></div>
              <Link className="btn-link" href="/market/whitespace">All open molecules</Link></div>
            {d.picks.length === 0 ? <Empty>No open molecules left {d.mine ? 'in your classes' : ''}. Search for others.</Empty> : (
              <div>{d.picks.map((m, i) => (
                <MoleculeRow key={m.id} m={m} first={i === 0} actions={<>
                  <form action={hideMolecule}><input type="hidden" name="molecule_id" value={m.id} /><input type="hidden" name="return" value="/home" />
                    <button className="btn btn-ghost btn-sm" type="submit" aria-label={`Hide ${m.inn}`}>Hide</button></form>
                  <SourceLink id={m.id} stage={m.request_stage} inList={m.in_list} back="/home" /></>} />))}</div>)}
            {free && d.openCount > d.picks.length && (
              <div className="locked" style={{ marginTop: 12 }}>
                <span className="pill lav">Paid</span>
                <b>{d.openCount - d.picks.length} more open {d.openCount - d.picks.length === 1 ? 'molecule' : 'molecules'} {d.mine ? 'in your classes' : 'in Tanzania'}</b>
                <span className="note">Paid plans see the full list, prices and supplier availability.</span>
                <Link className="btn btn-ghost btn-sm" href="/settings#plan">Upgrade</Link>
              </div>)}
            {d.moves.length > 0 && (
              <div id="moves" className="stack" style={{ gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                <span className="lbl">Competitor moves on your molecules, last 60 days</span>
                {d.moves.map((mv, i) => (
                  <Link key={i} className="between" href={mv.change === 'added' && mv.company_id ? `/company/${mv.company_id}` : `/molecule/${mv.molecule_id}`}>
                    <span className="small">{mv.change === 'added' ? <><b>{title(mv.company) || 'A company'}</b> registered {mv.molecule}</>
                      : <>{mv.molecule}: <b>{title(mv.company) || 'a company'}</b> dropped a registration</>}</span>
                    <span className="tiny muted nowrap">{fmtDate(mv.at)}</span></Link>))}
              </div>)}
          </section>

    </>),
    sourcing: (<>
          <section className="card" id="sourcing">
            <div className="card-h"><div><h2>Quick sourcing</h2><p className="note">Name a molecule. We run the regulatory check and analysis, then pricing and logistics with anonymous quotes.</p></div>
              <Link className="btn-link" href="/requests">All requests</Link></div>
            {!free || d.active < FREE.requests ? (
              <form action={createRequest} className="row">
                <label className="sr" htmlFor="qs-molecule">Molecule</label>
                <input className="input" id="qs-molecule" name="molecule" list="qs-mols" required placeholder="Molecule, e.g. Amoxicillin" autoComplete="off" style={{ flex: '2 1 200px' }} />
                <datalist id="qs-mols">{d.names.map((n) => <option key={n.inn} value={n.inn} />)}</datalist>
                <label className="sr" htmlFor="qs-quantity">Quantity</label>
                <input className="input" id="qs-quantity" name="quantity" placeholder="Quantity (optional)" style={{ flex: '1 1 140px' }} />
                <button className="btn btn-blue" type="submit">Source</button>
              </form>
            ) : <div className="note">{FREE.requests} of {FREE.requests} active requests on the free plan. Close one, or <Link href="/settings#plan">upgrade</Link>.</div>}
            {d.open.length > 0 && (
              <div className="stack" style={{ gap: 8, marginTop: 14 }}>{d.open.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`} className="between"><span>{r.molecule}</span><StagePill stage={r.stage} /></Link>))}</div>)}
            <p className="note" style={{ marginTop: 10 }}>Many at once? Collect them in your <Link href="/requests/list">sourcing list</Link>, or <Link href="/requests/new">upload a requirement list</Link>.
              {free ? ` ${d.active} of ${FREE.requests} active on the free plan.` : ''}</p>
          </section>

    </>),
    portfolio: (<>
          <section className="card" id="portfolio">
            <div className="card-h"><div><h2>Portfolio analysis</h2>
              <p className="note">Your coverage of the official TMDA list in the classes you carry, and the gaps worth filling.</p></div>
              {d.portfolio > 0 && <Link className="btn-link" href="/portfolio">Full analysis</Link>}</div>
            {d.portfolio === 0 ? (
              <form action={addPortfolioList} className="stack" style={{ gap: 10 }}>
                <input type="hidden" name="return" value="/home" />
                <label className="lbl" htmlFor="list">Paste your product list, one per line or comma separated</label>
                <textarea className="input" id="list" name="list" required rows={4} placeholder={'Amoxicillin 500mg capsules\nMetformin\nCeftriaxone injection'} />
                <div className="row"><button className="btn btn-blue btn-sm" type="submit">Analyse my portfolio</button>
                  <span className="note">Or <Link href="/search">add molecules one by one</Link>.</span></div>
              </form>
            ) : (<>
              <div className="between" style={{ marginBottom: 12 }}><span>{d.portfolio} molecules · coverage in your classes</span><b className="num">{covPct}%</b></div>
              <div className="bars">{d.coverage.slice(0, 4).map((c) => (
                <Bar key={c.category} label={c.category} value={c.covered} max={c.n} right={`${c.n - c.covered} missing`} />))}</div>
              <div className="row" style={{ marginTop: 14 }}>
                <Link className="btn btn-blue btn-sm" href={`/requests/new?missing=${encodeURIComponent(d.coverage.slice(0, 3).map((c) => c.category).join('|'))}`}>Source the gaps</Link>
                <Link className="btn btn-ghost btn-sm" href="/portfolio?tab=benchmark">Benchmark vs distributors</Link>
              </div>
              {goals.includes('more_from_suppliers') && <p className="note" style={{ marginTop: 10 }}>Want more from your current suppliers?
                <Link href="/portfolio?tab=suppliers"> List them</Link> and ask us what else they make.</p>}
            </>)}
          </section>
    </>),
  };

  return (
    <Shell user={u} title={`Welcome${u.name ? `, ${u.name.split(' ')[0]}` : ''}`} sub="Market intelligence, sourcing and your portfolio in Tanzania">
      <Flash sp={sp} />
      {sp.added && <div className="ok" role="status">Added {sp.added} {sp.added === '1' ? 'molecule' : 'molecules'} to your portfolio.
        {sp.missed ? ` Not recognised: ${sp.missed}. Search for them, or send us your catalogue.` : ''}</div>}
      {d.focus && (
        <div className="row small muted">Your focus:
          {[...(d.focus.classes ?? []).slice(0, 3), ...(d.focus.classes?.length > 3 ? [`+${d.focus.classes.length - 3} more`] : [])].map((c: string) => <span key={c} className="pill blue">{c}</span>)}
          {(d.focus.levels ?? []).length > 0 && <span className="pill">EML {d.focus.levels.join(', ')}</span>}
          <Link href="/onboarding/focus?next=/home">Edit</Link></div>)}
      {u.claim_status === 'pending' && <div className="note">Company claim pending review. Your registered products load as your portfolio once approved.</div>}

      <div className="grid g4">
        <Link className="tile t-peach" href="/market/whitespace"><span className="k">Open molecules {d.mine ? (d.focus?.classes?.length ? 'in your focus' : 'in your classes') : 'in Tanzania'}</span>
          <span className="v num">{d.openCount}</span></Link>
        <Link className="tile t-blue" href={d.portfolio > 0 ? '/portfolio' : '#portfolio'}><span className="k">Your TMDA list coverage</span>
          <span className="v num">{covPct === null ? 'Add portfolio' : `${covPct}%`}</span></Link>
        <Link className="tile t-mint" href="/requests"><span className="k">Active requests{quotes ? ` · ${quotes} quotes to review` : ''}</span>
          <span className="v num">{d.active}</span></Link>
        <Link className="tile t-white" href={d.portfolio > 0 ? '#moves' : '/competitors'}><span className="k">{d.portfolio > 0 ? 'Competitor moves, 60 days' : 'New registrations in ' + year}</span>
          <span className="v num">{d.portfolio > 0 ? d.moves.length : d.counts?.new_regs}</span></Link>
      </div>

      <div className="split">
        <div className="stack">
          {doneSteps < steps.length && (
            <section className="card">
              <div className="card-h"><h2>Get started</h2><span className="note num">{doneSteps} of {steps.length} done</span></div>
              <div className="meter" style={{ marginBottom: 14 }}><i style={{ width: `${(100 * doneSteps) / steps.length}%` }} /></div>
              <div className="stack" style={{ gap: 10 }}>{steps.map((s) => (
                <div key={s.label} className="between">
                  <span><span className={`pill ${s.done ? 'mint' : ''}`} style={{ marginRight: 8 }}>{s.done ? 'Done' : 'To do'}</span>
                    <b>{s.label}</b><span className="sub2"> · {s.why}</span></span>
                  {!s.done && <Link className="btn btn-ghost btn-sm" href={s.href}>Start</Link>}
                </div>))}</div>
            </section>)}

          {d.todo.length > 0 && (
            <section className="card">
              <div className="card-h"><h2>Waiting on you</h2><span className="pill solid">{d.todo.length}</span></div>
              <div className="stack" style={{ gap: 10 }}>{d.todo.map((t, i) => {
                const l = todoLine(t);
                return (<div key={i} className="between"><span>{l.text}<span className="sub2"> · {fmtDate(t.at)}</span></span>
                  <Link className="btn btn-blue btn-sm" href={l.href}>{l.cta}</Link></div>);
              })}</div>
            </section>)}

          {order.map((k) => <div key={k} className="stack">{sections[k]}</div>)}
        </div>

        <div className="stack">
          <section className="card">
            <div className="card-h"><h2>Talk to us</h2></div>
            <p className="muted">Regulatory, pricing or sourcing question? Our team answers, usually within two working days.</p>
            <div className="row" style={{ marginTop: 12 }}>
              <Link className="btn btn-blue btn-sm" href="/expert">Ask the expert</Link>
              <a className="btn btn-ghost btn-sm" href={support}>{SUPPORT_WHATSAPP ? 'WhatsApp us' : 'Email us'}</a>
              {free && <Link className="btn btn-ghost btn-sm" href="/settings#plan">See plans</Link>}
            </div>
          </section>
          <section className="card">
            <div className="card-h"><h2>Tanzania</h2><Link className="btn-link" href="/market">Market</Link></div>
            <div className="stack" style={{ gap: 8 }}>
              <div className="between"><span>New registrations in {year}</span><b className="num">{d.counts?.new_regs}</b></div>
              <div className="between"><span>Molecules on the market</span><b className="num">{d.counts?.molecules}</b></div>
              <div className="between"><span>Official TMDA list molecules nobody registered</span><b className="num">{d.counts?.nobody}</b></div>
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
            <div className="card-h"><h2>Watchlist</h2>{free && <span className="note">{FREE.watches} watches, {FREE.follows} follows</span>}</div>
            {d.watch.length === 0 && <Empty>Watch a molecule or follow a competitor to be told when anything changes.</Empty>}
            <div className="stack" style={{ gap: 8 }}>
              {d.watch.map((w) => <Link key={w.t + w.id} href={w.t === 'm' ? `/molecule/${w.id}` : `/company/${w.id}`}>{title(w.name)}</Link>)}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}
