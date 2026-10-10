import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, Tabs } from '@/components/ui';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { STAGES, ago, fmtDate, title } from '@/lib/format';
import { grantCredits, keepSeparate, matchMolecule, mergeCompanies, postRegulatory, addPrice, editUseCase, queueRecompute,
  rejectSuggestion, resetPassword, resetTwoStep, reviewClaim, setPlan } from '@/app/actions/admin';
import { StagePill } from '@/components/ui';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';
const H48 = 48 * 3600e3;

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string; queued?: string }> }) {
  const sp = await searchParams;
  const u = await requireTeam();
  const tab = sp.tab ?? 'data';
  const d = await withUser(u.id, async (db) => {
    const out: Record<string, any> = {};
    out.last = await one(db, `select finished_at, diff from registry_uploads where status = 'applied' and country = 'TZ' and kind <> 'recompute'
                              order by finished_at desc limit 1`);
    out.lastAny = await one(db, `select diff, kind, finished_at from registry_uploads where status = 'applied' order by finished_at desc limit 1`);
    out.counts = await one(db, `select
      (select count(*)::int from country_molecules where country = 'TZ' and on_national_list and registrations = 0) as unmatched,
      (select count(*)::int from molecule_suggestions where status = 'open') as suggestions,
      (select count(*)::int from company_review_queue where status = 'open') as dups,
      (select count(*)::int from company_claims where status = 'pending') as claims,
      (select count(*)::int from requests where stage <> 'Closed') as open_requests,
      (select count(*)::int from plan_requests where status = 'open') as plan_requests,
      (select count(*)::int from registry_uploads where status in ('queued', 'running')) as running`);
    if (tab === 'data') {
      out.history = await rows(db, `select r.id, r.kind, r.uploaded_at, r.finished_at, r.file_name, r.rows, r.status, r.error, u.email
                                    from registry_uploads r left join users u on u.id = r.uploaded_by order by r.id desc limit 15`);
      out.reminders = await rows(db, 'select sent_at from reminders_log order by sent_at desc limit 3');
      out.refs = await rows(db, 'select kind, name, uploaded_at from reference_files');
    }
    if (tab === 'review') {
      out.sugg = await rows(db, `select s.molecule_id, m.inn, m.category, t.id as to_id, t.inn as to_inn, s.confidence, s.reason
                                 from molecule_suggestions s join molecules m on m.id = s.molecule_id left join molecules t on t.id = s.suggested_molecule_id
                                 where s.status = 'open' order by s.confidence desc`);
      out.unmatched = await rows(db, `select m.id, m.inn, m.category, cm.in_combinations from country_molecules cm join molecules m on m.id = cm.molecule_id
                                      where cm.country = 'TZ' and cm.on_national_list and cm.registrations = 0
                                        and not exists (select 1 from molecule_suggestions s where s.molecule_id = m.id and s.status = 'open')
                                      order by m.category, m.inn limit 300`);
      out.dups = await rows(db, `select q.a_key, q.b_key, q.similarity, a.display_name as a_name, b.display_name as b_name,
                                 sa.registrations as a_n, sb.registrations as b_n
                                 from company_review_queue q left join companies a on a.cluster_key = q.a_key left join companies b on b.cluster_key = q.b_key
                                 left join company_stats sa on sa.company_id = a.id left join company_stats sb on sb.company_id = b.id
                                 where q.status = 'open' order by q.similarity desc`);
    }
    if (tab === 'claims') {
      out.claims = await rows(db, `select k.*, u.email, u.name, coalesce(c.display_name, k.company_name) as company, c.id as cid
                                   from company_claims k join users u on u.id = k.user_id left join companies c on c.id = k.company_id
                                   order by (k.status = 'pending') desc, k.created_at desc limit 60`);
    }
    if (tab === 'requests') {
      out.requests = await rows(db, `select r.id, r.stage, r.quantity, r.updated_at, u.email, coalesce(m.inn, r.molecule_text) as molecule,
                                     (select count(*)::int from request_messages x where x.request_id = r.id and not x.from_team) as msgs
                                     from requests r join users u on u.id = r.user_id left join molecules m on m.id = r.molecule_id
                                     order by (r.stage = 'Closed'), r.updated_at desc limit 100`);
    }
    if (tab === 'accounts') {
      out.users = await rows(db, `select u.id, u.email, u.name, u.role, u.plan, u.credits, u.created_at, u.owner_id,
                                  (select string_agg(p.wanted, ', ') from plan_requests p where p.user_id = u.id and p.status = 'open') as wants,
                                  auth_totp_enabled(u.id) as two_step
                                  from users u order by (select count(*) from plan_requests p where p.user_id = u.id and p.status = 'open') desc, u.created_at desc limit 200`);
    }
    if (tab === 'activity') {
      out.log = await rows(db, `select a.at, a.action, a.table_name, a.row_id, a.changes, u.email
                                from audit_log a left join users u on u.id = a.actor order by a.at desc limit 200`);
    }
    if (tab === 'content') {
      out.feed = await rows(db, `select title, created_at from feed_items where kind = 'regulatory' order by created_at desc limit 8`);
      out.notifs = await rows(db, `select channel, subject, body, status, created_at from notifications order by id desc limit 12`);
    }
    return out;
  });
  const last = d.last?.finished_at ? new Date(d.last.finished_at) : null;
  const msLeft = last ? last.getTime() + H48 - Date.now() : -1;
  const overdue = msLeft <= 0;
  const diff = d.lastAny?.diff ?? {};
  const c = d.counts;
  const tabs = [
    { key: 'data', label: 'Data updates', href: '/admin' },
    { key: 'review', label: `Review queue (${c.suggestions + c.dups})`, href: '/admin?tab=review' },
    { key: 'claims', label: `Claims (${c.claims})`, href: '/admin?tab=claims' },
    { key: 'requests', label: `Requests (${c.open_requests})`, href: '/admin?tab=requests' },
    { key: 'accounts', label: `Accounts${c.plan_requests ? ` (${c.plan_requests})` : ''}`, href: '/admin?tab=accounts' },
    { key: 'content', label: 'Content', href: '/admin?tab=content' },
    { key: 'activity', label: 'Activity', href: '/admin?tab=activity' },
  ];
  return (
    <Shell user={u} title="Admin" sub="Nazryx team only. Not visible to customers.">
      <Tabs items={tabs} current={tab} />
      <Flash sp={sp} />
      {sp.queued && <div className="ok" role="status">Queued. The ingest job runs in the background; refresh to see the result.</div>}
      {tab === 'data' && (<>
        <section className={`tile ${overdue ? 't-alert' : 't-blue'}`} role={overdue ? 'alert' : undefined}>
          <span className="v" style={{ fontSize: 24 }}>{overdue
            ? `Registration list update overdue${last ? ` by ${Math.round(-msLeft / 36e5)} hours` : ''}`
            : `Registration list is due for an update in ${Math.max(1, Math.round(msLeft / 36e5))} hours`}</span>
          <span className="k">Last uploaded {last ? ago(last) : 'never'}. Reminder every 48 hours: turns red when overdue, plus email and WhatsApp to the team.
            {d.reminders?.[0] && ` Last reminder sent ${ago(d.reminders[0].sent_at)}.`}</span>
        </section>
        <div className="grid g2">
          <section className="card stack">
            <h2>Upload new list</h2>
            {d.refs.length < 2 && <div className="err" role="alert">Upload the two reference lists below first. The registry upload needs them.</div>}
            <form action="/api/admin/upload" method="post" encType="multipart/form-data" className="stack">
              <div className="drop"><label className="lbl" htmlFor="file">Registration list (.xls export)</label>
                <input id="file" name="file" type="file" accept=".xls,.xlsx,.html,.htm" required disabled={d.refs.length < 2} /></div>
              <button className="btn btn-blue" type="submit" disabled={d.refs.length < 2}>Upload registration list</button>
            </form>
            <p className="note">After upload: validate, compare with the last list, update the database, recalculate gap scores, merge duplicate distributors. A failed upload never changes live data.</p>
            {c.running > 0 && <span className="pill blue">{c.running} job running or queued</span>}
            <form action={queueRecompute}><button className="btn btn-ghost btn-sm" type="submit">Recompute now (apply review decisions and new supplier offers)</button></form>
          </section>
          <section className="card stack">
            <h2>What changed (last run)</h2>
            <table className="tbl"><tbody>
              <tr><td>New registrations</td><td className="r num">{diff.new_registrations ?? 0}</td></tr>
              <tr><td>Removed or cancelled</td><td className="r num">{diff.removed_or_cancelled ?? 0}</td></tr>
              <tr><td>New distributors</td><td className="r num">{diff.new_distributors ?? 0}</td></tr>
              <tr><td>Gap scores that moved</td><td className="r num">{diff.gap_scores_moved ?? 0}</td></tr>
              <tr><td>Duplicate spellings merged</td><td className="r num">{diff.duplicate_spellings_merged ?? 0}</td></tr>
            </tbody></table>
            <h3>Review queue</h3>
            <p className="small">Essential molecules with no registry match: <b>{c.unmatched}</b> ({c.suggestions} with a suggested match) · Possible duplicate distributors: <b>{c.dups}</b></p>
            <Link className="btn btn-ghost btn-sm" href="/admin?tab=review" style={{ alignSelf: 'flex-start' }}>Open queue</Link>
          </section>
        </div>
        <section className="card stack">
          <div className="card-h"><h2>Reference lists</h2>
            <span className="note">Used by every update. Replace them when a new edition comes out.</span></div>
          <table className="tbl"><tbody>
            {[['national_list', 'Essential medicines list (OCR text)'], ['global_list', 'Global essential list (text)']].map(([k, label]) => {
              const r = d.refs.find((x: any) => x.kind === k);
              return <tr key={k}><td>{label}</td><td className="small">{r ? r.name : 'Missing'}</td>
                <td className="r">{r ? <span className="pill mint">Loaded {fmtDate(r.uploaded_at)}</span> : <span className="pill alert">Upload before the first list</span>}</td></tr>;
            })}
          </tbody></table>
          <form action="/api/admin/reference" method="post" encType="multipart/form-data" className="form-grid">
            <div className="field"><label htmlFor="national_list">Essential medicines list (.txt)</label><input id="national_list" name="national_list" type="file" accept=".txt" /></div>
            <div className="field"><label htmlFor="global_list">Global essential list (.txt)</label><input id="global_list" name="global_list" type="file" accept=".txt" /></div>
            <div className="full"><button className="btn btn-ghost btn-sm" type="submit">Save reference lists</button></div>
          </form>
        </section>
        <section className="card">
          <div className="card-h"><h2>Upload history</h2></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Date</th><th>By</th><th>File</th><th className="r">Rows</th><th>Status</th></tr></thead>
            <tbody>{d.history.map((h: any) => (
              <tr key={h.id}><td>{fmtDate(h.uploaded_at)} <span className="tiny muted">{new Date(h.uploaded_at).toISOString().slice(11, 16)} UTC</span></td>
                <td className="small">{h.email ?? (h.kind === 'initial' ? 'Initial load' : 'System')}</td>
                <td className="small">{h.kind === 'recompute' ? 'Recompute' : <a href={`/files/registry/${h.id}`}>{h.file_name}</a>}</td>
                <td className="r num">{h.rows ?? '—'}</td>
                <td>{h.status === 'applied' ? <span className="pill mint">Applied</span> : h.status === 'failed'
                  ? <span className="pill alert" title={h.error}>Failed, rolled back</span> : <span className="pill blue">{h.status}</span>}
                  {h.status === 'failed' && <div className="tiny muted">{h.error}</div>}</td></tr>))}
            </tbody></table></div>
        </section>
      </>)}
      {tab === 'review' && (<>
        <section className="card">
          <div className="card-h"><h2>Suggested matches</h2><span className="note">Essential molecules with no exact registry match. Accept to merge them.</span></div>
          {d.sugg.length === 0 ? <Empty>No open suggestions.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Official list</th><th>Registry molecule</th><th>Similarity</th><th className="r"></th></tr></thead>
              <tbody>{d.sugg.map((s: any) => (
                <tr key={s.molecule_id}><td><b>{s.inn}</b><div className="sub2">{s.category}</div></td><td>{s.to_inn}</td><td className="num">{Math.round(s.confidence)}%</td>
                  <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}>
                    <form action={matchMolecule}><input type="hidden" name="from" value={s.molecule_id} /><input type="hidden" name="to" value={s.to_id} /><button className="btn btn-blue btn-sm">Same molecule</button></form>
                    <form action={rejectSuggestion}><input type="hidden" name="from" value={s.molecule_id} /><button className="btn btn-ghost btn-sm">Different</button></form></div></td></tr>))}
              </tbody></table></div>)}
        </section>
        <section className="card">
          <div className="card-h"><h2>Possible duplicate distributors</h2></div>
          {d.dups.length === 0 ? <Empty>No open pairs.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Company A</th><th>Company B</th><th>Similarity</th><th className="r"></th></tr></thead>
              <tbody>{d.dups.map((p: any) => (
                <tr key={p.a_key + p.b_key}><td>{title(p.a_name ?? p.a_key)} <span className="tiny muted">({p.a_n ?? 0})</span></td>
                  <td>{title(p.b_name ?? p.b_key)} <span className="tiny muted">({p.b_n ?? 0})</span></td><td className="num">{Math.round(p.similarity)}%</td>
                  <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}>
                    <form action={mergeCompanies}><input type="hidden" name="keep" value={(p.a_n ?? 0) >= (p.b_n ?? 0) ? p.a_key : p.b_key} />
                      <input type="hidden" name="merge" value={(p.a_n ?? 0) >= (p.b_n ?? 0) ? p.b_key : p.a_key} /><button className="btn btn-blue btn-sm">Merge</button></form>
                    <form action={keepSeparate}><input type="hidden" name="a" value={p.a_key} /><input type="hidden" name="b" value={p.b_key} /><button className="btn btn-ghost btn-sm">Keep separate</button></form></div></td></tr>))}
              </tbody></table></div>)}
        </section>
        <section className="card">
          <div className="card-h"><h2>Essential molecules with no registration</h2><span className="note">Map one by hand if the registry uses another name</span></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Molecule</th><th>Class</th><th>In combinations</th><th className="r">Map to registry molecule</th></tr></thead>
            <tbody>{d.unmatched.map((m: any) => (
              <tr key={m.id}><td>{m.inn}</td><td className="small">{m.category}</td><td className="num">{m.in_combinations}</td>
                <td className="r"><form action={matchMolecule} className="row" style={{ justifyContent: 'flex-end' }}><input type="hidden" name="from" value={m.id} />
                  <input className="input" name="to_name" placeholder="Exact molecule name" style={{ minHeight: 34, width: 200 }} aria-label={`Map ${m.inn} to`} />
                  <button className="btn btn-ghost btn-sm">Map</button></form></td></tr>))}
            </tbody></table></div>
        </section>
        <div className="note row">Decisions apply on the next recompute or upload. <form action={queueRecompute}><button className="btn-link">Recompute now</button></form></div>
      </>)}
      {tab === 'claims' && (
        <section className="card">
          <div className="card-h"><h2>Company claims</h2><span className="note">Check the licence and the email domain, then approve. Approval pre-fills the portfolio when asked.</span></div>
          {d.claims.length === 0 ? <Empty>No claims yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Who</th><th>Company</th><th>Evidence</th><th>Portfolio</th><th className="r">Decision</th></tr></thead>
              <tbody>{d.claims.map((k: any) => (
                <tr key={k.id}><td><b>{k.name || k.email}</b><div className="sub2">{k.email} · {fmtDate(k.created_at)}</div></td>
                  <td>{k.cid ? <Link href={`/company/${k.cid}`}>{title(k.company)}</Link> : <>{k.company} <span className="pill">not in list</span></>}</td>
                  <td><span className={`pill ${k.domain_match ? 'mint' : 'peach'}`}>{k.domain_match ? 'Domain matches' : 'Domain does not match'}</span>
                    <div className="small"><a href={`/files/licence/${k.id}`}>Licence</a>{k.catalogue_path && <> · <a href={`/files/catalogue/${k.id}`}>Catalogue</a></>}</div></td>
                  <td className="small">{k.portfolio_source}</td>
                  <td className="r">{k.status === 'pending' ? (
                    <form action={reviewClaim} className="stack" style={{ alignItems: 'flex-end', gap: 6 }}><input type="hidden" name="claim_id" value={k.id} />
                      <input className="input" name="note" placeholder="Note to customer (optional)" style={{ minHeight: 34 }} />
                      <div className="row"><button className="btn btn-blue btn-sm" name="decision" value="approve">Approve</button>
                        <button className="btn btn-ghost btn-sm" name="decision" value="reject">Reject</button></div></form>
                  ) : <span className={`pill ${k.status === 'approved' ? 'mint' : 'peach'}`}>{k.status}</span>}</td></tr>))}
              </tbody></table></div>)}
        </section>
      )}
      {tab === 'requests' && (
        <section className="card">
          <div className="card-h"><h2>Requests</h2><span className="note">Handled by hand. Move the stage as you work; the customer sees it and gets an update.</span></div>
          <div className="row small" style={{ marginBottom: 10 }}>{STAGES.map((s) => <span key={s} className="pill">{s}: {d.requests.filter((r: any) => r.stage === s).length}</span>)}</div>
          {d.requests.length === 0 ? <Empty>No requests yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>#</th><th>Molecule</th><th>Customer</th><th>Stage</th><th>Updated</th></tr></thead>
              <tbody>{d.requests.map((r: any) => (
                <tr key={r.id}><td><Link href={`/admin/requests/${r.id}`}>#{r.id}</Link></td><td><Link href={`/admin/requests/${r.id}`}><span className="nm">{r.molecule}</span></Link>
                  <div className="sub2">{r.quantity}</div></td><td className="small">{r.email}</td><td><StagePill stage={r.stage} /></td><td className="small">{ago(r.updated_at)}</td></tr>))}
              </tbody></table></div>)}
        </section>
      )}
      {tab === 'accounts' && (
        <section className="card">
          <div className="card-h"><h2>Accounts</h2><span className="note">Billing is manual for now: invoice, then switch the plan here.</span></div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Role</th><th>Plan</th><th className="r">Credits</th><th className="r">Actions</th></tr></thead>
            <tbody>{d.users.map((x: any) => (
              <tr key={x.id}><td><b>{x.name || x.email}</b><div className="sub2">{x.email}{x.owner_id ? ' · teammate seat' : ''}</div>
                {x.wants && <span className="pill solid">Asked for: {x.wants}</span>}</td>
                <td>{x.role}</td><td>{x.plan}</td><td className="r num">{x.credits}</td>
                <td className="r">{x.role === 'customer' && !x.owner_id && (<div className="row" style={{ justifyContent: 'flex-end' }}>
                  <form action={setPlan}><input type="hidden" name="user_id" value={x.id} /><input type="hidden" name="plan" value={x.plan === 'paid' ? 'free' : 'paid'} />
                    <button className="btn btn-ghost btn-sm">{x.plan === 'paid' ? 'Set free' : 'Set paid'}</button></form>
                  <form action={grantCredits}><input type="hidden" name="user_id" value={x.id} /><input type="hidden" name="credits" value="20" />
                    <button className="btn btn-ghost btn-sm">+20 credits</button></form></div>)}
                  <details className="dd" style={{ display: 'inline-block', marginTop: 6 }}>
                    <summary className="btn-link small">Reset password</summary>
                    <form action={resetPassword} className="menu" style={{ gap: 8, textAlign: 'left' }}><input type="hidden" name="user_id" value={x.id} />
                      <input className="input" name="password" type="text" minLength={10} required placeholder="Temporary password" aria-label="Temporary password" autoComplete="off" />
                      <button className="btn btn-blue btn-sm">Set and sign them out</button>
                      <span className="note">Send it to them directly; they can change it in Settings.</span></form>
                  </details>
                  {x.two_step && <form action={resetTwoStep} style={{ display: 'inline-block', marginLeft: 10 }}><input type="hidden" name="user_id" value={x.id} />
                    <button className="btn-link small" title="For someone who lost their phone">Reset two-step</button></form>}</td></tr>))}
            </tbody></table></div>
        </section>
      )}
      {tab === 'activity' && (
        <section className="card">
          <div className="card-h"><h2>Team activity</h2><span className="note">Every change a team account makes, recorded by the database. Latest 200.</span></div>
          {d.log.length === 0 ? <Empty>No team actions yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
              <tbody>{d.log.map((a: any, i: number) => (
                <tr key={i}><td className="small nowrap">{ago(a.at)}</td><td className="small">{a.email ?? 'system'}</td>
                  <td className="small">{a.action === 'insert' ? 'Added' : 'Changed'} {a.table_name.replace(/_/g, ' ')} <span className="muted">#{a.row_id}</span></td>
                  <td className="small" style={{ maxWidth: 420 }}>{a.action === 'update'
                    ? Object.entries(a.changes ?? {}).map(([k, v]: [string, any]) => Array.isArray(v) ? `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : `${k}: ${String(v)}`).join('; ')
                    : Object.entries(a.changes ?? {}).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ')}</td></tr>))}
              </tbody></table></div>)}
        </section>
      )}
      {tab === 'content' && (
        <div className="grid g2">
          <section className="card stack">
            <h2>Regulatory note for the feed</h2>
            <form action={postRegulatory} className="stack">
              <input className="input" name="title" placeholder="Headline" aria-label="Headline" required />
              <textarea className="input" name="body" placeholder="Short summary (optional)" aria-label="Summary" />
              <input className="input" name="link" placeholder="Link inside the app, e.g. /molecule/12 (optional)" aria-label="Link" />
              <button className="btn btn-blue btn-sm" type="submit">Post</button>
            </form>
            {d.feed.map((f: any, i: number) => <div key={i} className="between small"><span>{f.title}</span><span className="muted">{fmtDate(f.created_at)}</span></div>)}
          </section>
          <section className="card stack">
            <h2>Market price point (paid customers)</h2>
            <form action={addPrice} className="form-grid">
              <input className="input full" name="molecule" placeholder="Molecule name (exact)" aria-label="Molecule" required />
              <input className="input" name="low" placeholder="Low" aria-label="Low" required /><input className="input" name="high" placeholder="High" aria-label="High" required />
              <input className="input" name="currency" defaultValue="USD" aria-label="Currency" /><input className="input" name="unit" defaultValue="pack" aria-label="Unit" />
              <button className="btn btn-blue btn-sm full" type="submit">Add price point</button>
            </form>
            <p className="note">Market prices only (public or customer-reported). Never enter supplier prices here.</p>
            <h2>Molecule use case</h2>
            <form action={editUseCase} className="stack">
              <input className="input" name="molecule" placeholder="Molecule name (exact)" aria-label="Molecule" required />
              <textarea className="input" name="use_case" placeholder="Indication, class and typical use" aria-label="Use case" required />
              <button className="btn btn-ghost btn-sm" type="submit">Save use case</button>
            </form>
          </section>
          <section className="card stack" style={{ gridColumn: '1 / -1' }}>
            <h2>Notification outbox</h2>
            <p className="note">Email and WhatsApp delivery are stubbed: messages are recorded here and logged by the worker.</p>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Channel</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>{d.notifs.map((n: any, i: number) => <tr key={i}><td className="small">{ago(n.created_at)}</td><td>{n.channel}</td>
                <td className="small">{n.subject ?? n.body.slice(0, 80)}</td><td><span className="pill">{n.status}</span></td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}
    </Shell>
  );
}
