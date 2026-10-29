import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Flash, StagePill } from '@/components/ui';
import { addTask, deleteProject, deleteTask, moveProject, toggleTask, updateProject } from '@/app/actions/projects';
import { toggleChecklist } from '@/app/actions/mfr';
import { createShareLink, revokeShareLink } from '@/app/actions/collab';
import Comments, { loadComments } from '@/components/Comments';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { NEEDS_PLAN, SERVICES, canUse, countryName, productClass, tierIn } from '@/lib/mfr';
import { REQ_SQL, appliesTo, type Requirement } from '@/lib/regulatory';
import { PROJECT_STAGES, STAGE_SERVICE, STAGE_TONE, STAGE_WHAT, readiness, stageIndex, stageLabel } from '@/lib/projects';

export const metadata = { title: 'Project' };

// One market entry project: where it stands, the tasks of this stage, the dossier checklist for this market, the deadlines
// we track, the Nazryx services attached, and the people on it.
export default async function Project({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; shared?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const pr = await one(db, `select pr.*, coalesce(m.inn, p.name) as name, p.name as product_name, p.dosage_form, p.molecule_id, p.atc, m.category, m.inn,
        o.name as owner_name, o.email as owner_email
        from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id left join users o on o.id = pr.owner_id where pr.id = $1`, [id]);
    if (!pr) return null;
    const tasks = await rows(db, `select k.*, a.name as assignee from project_tasks k left join users a on a.id = k.assignee_id where k.project_id = $1 order by k.done_at nulls first, k.due_date nulls last, k.id`, [id]);
    const seats = await rows(db, 'select id, name, email from users where id = $1 or owner_id = $1 order by created_at', [u.owner_id ?? u.id]);
    const obligations = await rows(db, 'select * from obligations where (project_id = $1 or (product_id = $2 and country = $3)) and not done order by due_date', [id, pr.product_id, pr.country]);
    const engagements = await rows(db, `select id, kind, stage, status, updated_at from engagements where project_id = $1 or (product_id = $2 and country = $3) order by updated_at desc`, [id, pr.product_id, pr.country]);
    const entries = await rows(db, 'select * from calendar_entries where project_id = $1 order by on_date', [id]);
    // the dossier checklist for this market, as it applies to this product
    const tier = tierIn(u, pr.country);
    const checklist = canUse(tier, 'requirements') ? (await rows(db, `select id, name, applies, match, note from reg_checklist where country = $1 and scope = 'medicine' order by sort`, [pr.country]))
      .filter((c) => c.applies === 'all' || appliesTo({ ...c, topic: '', title: c.name, body: '' } as Requirement, { ...pr, category: productClass(pr) })) : null;
    const ready = checklist ? (await rows(db, 'select item from product_checklist where product_id = $1 and country = $2', [pr.product_id, pr.country])).map((r) => r.item as string) : [];
    const facts = await one(db, `select cm.registrants, cm.on_national_list, g.demand from country_molecules cm left join visible_gap_scores g on g.molecule_id = cm.molecule_id and g.country = cm.country
        where cm.molecule_id = $1 and cm.country = $2`, [pr.molecule_id, pr.country]);
    const route = await one(db, `select label, months_low, months_high, fee_usd_low, fee_usd_high from country_routes where country = $1 and scope = 'medicine' order by sort limit 1`, [pr.country]);
    const comments = await loadComments(db, 'project', String(id));
    const links = await rows(db, 'select token, created_at, expires_at from share_links where kind = $1 and target_id = $2 and revoked_at is null and expires_at > now() order by created_at desc', ['project', String(id)]);
    return { pr, tasks, seats, obligations, engagements, entries, checklist, ready, facts, route, tier, comments, links };
  });
  if (!d) notFound();
  const { pr } = d, name = t(countryName(pr.country)), here = `/m/projects/${id}`;
  const idx = stageIndex(pr.stage), pct = Math.round(readiness(pr.stage, d.tasks) * 100);
  const stageTasks = d.tasks.filter((k) => !k.stage || k.stage === pr.stage), otherTasks = d.tasks.filter((k) => k.stage && k.stage !== pr.stage && !k.done_at);
  const service = STAGE_SERVICE[pr.stage];
  const checkedN = d.checklist ? d.checklist.filter((c) => d.ready.includes(c.name)).length : 0;
  const REQ_SQL_USED = REQ_SQL; void REQ_SQL_USED;
  return (
    <Shell user={u} title={pr.name} crumb={<><Link href="/m/projects">{t('Projects')}</Link> / {pr.name} · {name}</>}
      sub={`${t(countryName(pr.country))} · ${t(stageLabel(pr.stage))} · ${pct}% ${t('ready')}`}
      actions={<><Link className="btn btn-ghost btn-sm" href={`/m/products/${pr.product_id}?market=${pr.country}`}>{t('Product')}</Link>
        {pr.molecule_id && <Link className="btn btn-ghost btn-sm" href={`/m/molecules/${pr.molecule_id}?market=${pr.country}`}>{t('Molecule in {market}', { market: name })}</Link>}</>}>
      <Flash sp={sp} />
      <section className="card stack">
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {PROJECT_STAGES.map(([k, label], i) => (
            <form key={k} action={moveProject}><input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value={k} />
              <button type="submit" className={`pill ${k === pr.stage ? 'solid' : i < idx ? 'mint' : ''}`} style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }} aria-current={k === pr.stage ? 'step' : undefined}>
                {i < idx ? '✓ ' : ''}{t(label)}</button></form>))}
          <form action={moveProject}><input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value="parked" />
            <button type="submit" className={`pill ${pr.stage === 'parked' ? 'solid' : ''}`} style={{ cursor: 'pointer', font: 'inherit', fontSize: 12 }}>{t('Park')}</button></form>
        </div>
        <div className="meter"><i style={{ width: `${pct}%` }} /></div>
        <p className="muted">{t(STAGE_WHAT[pr.stage] ?? '')}</p>
      </section>
      <div className="split">
        <div className="stack">
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Tasks for this stage')}</h2><p className="note">{t('The usual steps, added when a stage opens. Add your own; tick them off as they are done.')}</p></div></div>
            {stageTasks.length === 0 && <Empty>{t('No task in this stage yet.')}</Empty>}
            {stageTasks.map((k) => (
              <div key={k.id} className="between" style={{ gap: 8, alignItems: 'flex-start' }}>
                <form action={toggleTask} className="row" style={{ gap: 8, alignItems: 'flex-start', flex: 1, flexWrap: 'nowrap' }}>
                  <input type="hidden" name="task_id" value={k.id} /><input type="hidden" name="project_id" value={id} />
                  <button type="submit" aria-label={k.done_at ? t('Mark as not done') : t('Mark as done')} className="btn-ghost"
                    style={{ flex: '0 0 20px', width: 20, height: 20, marginTop: 1, borderRadius: 6, cursor: 'pointer', padding: 0, lineHeight: '18px', border: '1px solid var(--line-2)', background: k.done_at ? 'var(--blue)' : 'var(--card)', color: '#fff', fontSize: 13 }}>{k.done_at ? '✓' : ''}</button>
                  <span style={{ flex: 1, minWidth: 0, textDecoration: k.done_at ? 'line-through' : undefined, color: k.done_at ? 'var(--ink-3)' : undefined }}>{t(k.title)}
                    <span className="sub2">{[k.due_date ? `${t('due')} ${fmtDate(k.due_date)}` : null, k.assignee, k.source === 'nazryx' ? t('suggested') : null].filter(Boolean).join(' · ')}</span></span>
                </form>
                <form action={deleteTask}><input type="hidden" name="task_id" value={k.id} /><input type="hidden" name="project_id" value={id} /><button className="btn-link small" type="submit" aria-label={t('Remove task')}>×</button></form>
              </div>))}
            <form action={addTask} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input type="hidden" name="project_id" value={id} />
              <input className="input" name="title" placeholder={t('Add a task')} aria-label={t('Task')} maxLength={160} required style={{ flex: '2 1 200px', minHeight: 34, fontSize: 13 }} />
              <input className="input" name="due_date" type="date" aria-label={t('Due date')} style={{ flex: '1 1 140px', minHeight: 34, fontSize: 13 }} />
              {d.seats.length > 1 && <select className="input" name="assignee_id" aria-label={t('Assign to')} style={{ flex: '1 1 140px', minHeight: 34, fontSize: 13 }}><option value="">{t('Anyone')}</option>{d.seats.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}</select>}
              <button className="btn btn-ghost btn-sm" type="submit">{t('Add')}</button>
            </form>
            {otherTasks.length > 0 && <p className="note">{t('{n} open tasks wait in other stages.', { n: otherTasks.length })}</p>}
          </section>
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Dossier for {market}', { market: name })}</h2>
              <p className="note">{d.checklist ? t('{n} of {total} documents ready. Tick what you have; our review checks the documents themselves.', { n: checkedN, total: d.checklist.length }) : t('The documents this market asks for, as they apply to this product.')}</p></div>
              <Link className="btn-link" href={`/m/products/${pr.product_id}/dossier?market=${pr.country}`}>{t('Dossier builder')}</Link></div>
            {d.checklist ? (<>
              <div className="meter"><i style={{ width: `${d.checklist.length ? Math.round((100 * checkedN) / d.checklist.length) : 0}%` }} /></div>
              <div className="stack" style={{ gap: 4 }}>{d.checklist.filter((c) => !d.ready.includes(c.name)).slice(0, 8).map((c) => (
                <form key={c.id} action={toggleChecklist} className="row small" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                  <input type="hidden" name="product_id" value={pr.product_id} /><input type="hidden" name="country" value={pr.country} /><input type="hidden" name="item" value={c.name} /><input type="hidden" name="return" value={here} />
                  <button type="submit" aria-label={t('Mark as ready')} style={{ flex: '0 0 18px', width: 18, height: 18, marginTop: 2, borderRadius: 5, cursor: 'pointer', padding: 0, border: '1px solid var(--line-2)', background: 'var(--card)' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{c.name}{c.note && <span className="sub2"> · {c.note}</span>}</span>
                </form>))}</div>
              {d.checklist.length - checkedN > 8 && <p className="note">{t('{n} more missing. The dossier builder has the whole list, with uploads and assignments.', { n: d.checklist.length - checkedN - 8 })}</p>}
              {d.checklist.length > 0 && checkedN === d.checklist.length && <p className="small">{t('Everything on the list is ticked. Ask us to review the documents before you file.')}</p>}
            </>) : <Link className="pill lav" href={`/m/plan?want=${NEEDS_PLAN.requirements}`}>{t('Checklist opens with Complete Market Access')}</Link>}
          </section>
          <section className="card stack">
            <div className="card-h"><h2>{t('Nazryx on this project')}</h2><Link className="btn-link" href={`/m/marketplace?project=${id}`}>{t('Book a service')}</Link></div>
            {d.engagements.length === 0 ? <p className="note">{t('Nothing asked of us yet.')}</p> : d.engagements.map((e) => (
              <Link key={e.id} href={`/m/engagements/${e.id}`} className="between small"><span>{t(SERVICES[e.kind]?.label ?? e.kind)}<span className="sub2"> · {ago(e.updated_at)}</span></span><StagePill stage={e.stage} /></Link>))}
            {service && (canUse(u.mfr_tier, service) || service === 'partner_intro') && (
              <Link className="btn btn-blue btn-sm" style={{ alignSelf: 'flex-start' }}
                href={service === 'partner_intro' ? `/m/partners?market=${pr.country}&molecule=${pr.molecule_id ?? ''}` : `/m/services/${service}?product=${pr.product_id}&country=${pr.country}&project=${id}`}>
                {t({ dossier_review: 'Ask us to review the dossier', market_entry: 'Ask us to file and follow it', post_registration: 'Ask us to keep it registered', partner_intro: 'Find the distributor' }[service] ?? 'Ask us')}</Link>)}
            {service && !canUse(u.mfr_tier, service) && service !== 'partner_intro' && <Link className="pill lav" href={`/m/plan?want=${NEEDS_PLAN[service]}`}>{t('{service} opens with {plan}', { service: t(SERVICES[service].label), plan: t({ data: 'Basic Market Data', access: 'Complete Market Access', entry: 'Complete Market Entry' }[NEEDS_PLAN[service]]) })}</Link>}
          </section>
          <Comments kind="project" target={String(id)} list={d.comments} here={here} me={u.id} seats={d.seats} canWrite={u.seat_role !== 'viewer'} />
        </div>
        <div className="stack">
          <section className="card stack">
            <h2>{t('At a glance')}</h2>
            {d.facts ? <p className="small">{d.facts.registrants === 0 ? t('Nobody has registered this molecule in {market}.', { market: name }) : t('{n} companies sell this molecule in {market}.', { n: d.facts.registrants, market: name })}
              {d.facts.on_national_list ? ` ${t('On the essential list.')}` : ''}{d.facts.demand != null ? ` ${t('Demand {d} of 1.', { d: Number(d.facts.demand).toFixed(2) })}` : ''}</p>
              : <p className="small muted">{t('Not matched to a molecule we track yet.')}</p>}
            {d.route && <p className="small">{t('Usual route')}: <b>{d.route.label}</b>, {d.route.months_low}–{d.route.months_high} {t('months')}{d.route.fee_usd_low != null ? `, $${Number(d.route.fee_usd_low).toLocaleString('en')}${d.route.fee_usd_high && d.route.fee_usd_high !== d.route.fee_usd_low ? `–${Number(d.route.fee_usd_high).toLocaleString('en')}` : ''} ${t('official fees')}` : ''}.</p>}
          </section>
          <section className="card stack">
            <h2>{t('Target and owner')}</h2>
            <form action={updateProject} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={id} />
              <label className="small">{t('On the shelf by')}<input className="input" name="target_date" type="date" defaultValue={pr.target_date ? String(pr.target_date).slice(0, 10) : ''} /></label>
              {d.seats.length > 1 && <label className="small">{t('Owner')}<select className="input" name="owner_id" defaultValue={pr.owner_id ?? ''}>{d.seats.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}</select></label>}
              <label className="small">{t('Notes')}<textarea className="input" name="note" rows={3} defaultValue={pr.note ?? ''} maxLength={1000} /></label>
              <button className="btn btn-ghost btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{t('Save')}</button>
            </form>
          </section>
          <section className="card stack">
            <div className="card-h"><h2>{t('Deadlines')}</h2><Link className="btn-link" href="/m/calendar">{t('Calendar')}</Link></div>
            {d.obligations.length + d.entries.length + d.tasks.filter((k) => k.due_date && !k.done_at).length === 0 ? <p className="note">{t('No date on this project yet. Tasks with a due date, renewals and your own entries show here.')}</p> : (<>
              {d.obligations.map((o) => <div key={`o${o.id}`} className="between small"><span>{t({ renewal: 'Renewal', variation: 'Variation', safety_report: 'Safety report', other: 'Other' }[o.kind as string] ?? o.kind)}</span><span className="num">{fmtDate(o.due_date)}</span></div>)}
              {d.tasks.filter((k) => k.due_date && !k.done_at).map((k) => <div key={`k${k.id}`} className="between small"><span>{k.title}</span><span className="num">{fmtDate(k.due_date)}</span></div>)}
              {d.entries.map((e) => <div key={`e${e.id}`} className="between small"><span>{e.title}</span><span className="num">{fmtDate(e.on_date)}</span></div>)}
            </>)}
          </section>
          <section className="card stack">
            <h2>{t('Share read-only')}</h2>
            <p className="note">{t('A link for the person who signs or the distributor: the stages, tasks and dossier state, nothing else, for 30 days.')}</p>
            {sp.shared && <div className="ok small"><code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/s/${sp.shared}`}</code></div>}
            {d.links.map((l) => <div key={l.token} className="between small"><a href={`/s/${l.token}`}>/s/{l.token.slice(0, 8)}…</a><span className="row" style={{ gap: 8 }}><span className="muted">{t('until')} {fmtDate(l.expires_at)}</span>
              <form action={revokeShareLink}><input type="hidden" name="token" value={l.token} /><input type="hidden" name="project_id" value={id} /><button className="btn-link small" type="submit">{t('Revoke')}</button></form></span></div>)}
            <form action={createShareLink}><input type="hidden" name="project_id" value={id} /><button className="btn btn-ghost btn-sm" type="submit">{t('Create a link')}</button></form>
          </section>
          <form action={deleteProject} className="small muted"><input type="hidden" name="id" value={id} />{t('Not pursuing it?')} <button className="btn-link small" type="submit">{t('Delete this project')}</button></form>
        </div>
      </div>
    </Shell>
  );
}
