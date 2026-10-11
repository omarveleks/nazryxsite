import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, Tabs } from '@/components/ui';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { STAGES, ago, fmtDate, title } from '@/lib/format';
import { MFR_PLANS, SERVICES, countryName } from '@/lib/mfr';
import { answerQuestion, reviewManufacturer, grantCredits, keepSeparate, saveRoutes, setMoleculeRoute, matchMolecule, mergeCompanies, postRegulatory, addPrice, editUseCase, queueRecompute,
  rejectSuggestion, resetPassword, resetTwoStep, reviewClaim, setPlan } from '@/app/actions/admin';
import { StagePill } from '@/components/ui';
import { deleteAccountDoc, deleteSupplierDoc, savePlanPrices, uploadAccountDoc, uploadSupplierDoc } from '@/app/actions/docs';
import { ACCOUNT_DOC_KINDS, SUPPLIER_DOC_KINDS, daysLeft } from '@/lib/docs';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';
const H48 = 48 * 3600e3;

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string; queued?: string; dq?: string }> }) {
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
      (select count(*)::int from expert_questions where answered_at is null) as open_questions,
      (select count(*)::int from manufacturer_profiles where status = 'pending')
        + (select count(*)::int from engagements where status = 'open') as mfr_open,
      (select count(*)::int from plan_requests where status = 'open') as plan_requests,
      (select count(*)::int from supplier_documents where expires_on < current_date + 60) as expiring,
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
    if (tab === 'manufacturers') {
      out.mfrs = await rows(db, `select p.*, u.email, u.plan, (select count(*)::int from mfr_products x where x.user_id = p.user_id) as products
                                 from manufacturer_profiles p join users u on u.id = p.user_id order by (p.status = 'pending') desc, p.created_at desc limit 100`);
      out.engs = await rows(db, `select e.id, e.kind, e.country, e.stage, e.status, e.due_at, e.updated_at, e.created_at, u.email, mp.company_name
                                 from engagements e join users u on u.id = e.user_id left join manufacturer_profiles mp on mp.user_id = e.user_id
                                 order by (e.status = 'open') desc, coalesce(e.due_at, e.updated_at) limit 150`);
    }
    if (tab === 'documents') {
      out.suppliers = await rows(db, 'select id, name, country from suppliers order by name');
      out.sdocs = await rows(db, `select d.*, s.name as supplier, s.country from supplier_documents d join suppliers s on s.id = d.supplier_id
                                  order by d.expires_on nulls last, s.name limit 200`);
      const q = (sp.dq ?? '').trim();
      out.recent = await rows(db, `select * from (
          select 'Request #' || f.request_id as place, '/admin/requests/' || f.request_id || '#documents' as place_href, '/files/request/' || f.id as href,
                 f.file_name, f.kind as what, f.internal, f.from_team, f.created_at, u.email
            from request_files f join requests r on r.id = f.request_id join users u on u.id = r.user_id
          union all
          select 'Engagement #' || f.engagement_id, '/admin/engagements/' || f.engagement_id, '/files/engagement/' || f.id,
                 f.file_name, coalesce(f.item, 'other'), f.internal, f.from_team, f.created_at, u.email
            from engagement_files f join engagements e on e.id = f.engagement_id join users u on u.id = e.user_id
          union all
          select 'Account', '/admin/accounts/' || d.user_id, '/files/account/' || d.id, d.file_name, d.kind, d.internal, true, d.created_at, u.email
            from account_documents d join users u on u.id = d.user_id
          union all
          select 'Supplier: ' || s.name, '/admin?tab=documents', '/files/supplier/' || d.id, d.file_name, d.kind, true, true, d.created_at, null
            from supplier_documents d join suppliers s on s.id = d.supplier_id
          union all
          select 'Company claim', '/admin?tab=claims', '/files/licence/' || k.id, k.licence_name, 'licence', false, false, k.created_at, u.email
            from company_claims k join users u on u.id = k.user_id where k.licence_path is not null
          union all
          select 'Company claim', '/admin?tab=claims', '/files/catalogue/' || k.id, k.catalogue_name, 'catalogue', false, false, k.created_at, u.email
            from company_claims k join users u on u.id = k.user_id where k.catalogue_path is not null
          union all
          select 'Manufacturer catalogue', '/admin/accounts/' || p.user_id, '/files/mcatalogue/' || p.user_id, p.catalogue_name, 'catalogue', false, false, p.created_at, u.email
            from manufacturer_profiles p join users u on u.id = p.user_id where p.catalogue_path is not null
        ) x where $1 = '' or x.file_name ilike '%' || $1 || '%' or x.email ilike '%' || $1 || '%' or x.place ilike '%' || $1 || '%'
        order by created_at desc limit 80`, [q]);
    }
    if (tab === 'questions') {
      out.questions = await rows(db, `select q.id, q.body, q.answer, q.created_at, q.answered_at, u.email, m.inn
                                      from expert_questions q join users u on u.id = q.user_id left join molecules m on m.id = q.molecule_id
                                      order by (q.answered_at is not null), q.created_at limit 100`);
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
      out.routes = await rows(db, 'select key, label, description, months_low, months_high from registration_routes order by sort');
      out.prices = await rows(db, 'select key, price, note from plan_prices');
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
    { key: 'questions', label: `Questions (${c.open_questions})`, href: '/admin?tab=questions' },
    { key: 'manufacturers', label: `Manufacturers (${c.mfr_open})`, href: '/admin?tab=manufacturers' },
    { key: 'documents', label: `Documents${c.expiring ? ` (${c.expiring})` : ''}`, href: '/admin?tab=documents' },
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
            <p className="note">After upload: validate, compare with the last list, update the database, recalculate rankings, merge duplicate distributors. A failed upload never changes live data.</p>
            {c.running > 0 && <span className="pill blue">{c.running} job running or queued</span>}
            <form action={queueRecompute}><button className="btn btn-ghost btn-sm" type="submit">Recompute now (apply review decisions and new supplier offers)</button></form>
          </section>
          <section className="card stack">
            <h2>What changed (last run)</h2>
            <table className="tbl"><tbody>
              <tr><td>New registrations</td><td className="r num">{diff.new_registrations ?? 0}</td></tr>
              <tr><td>Removed or cancelled</td><td className="r num">{diff.removed_or_cancelled ?? 0}</td></tr>
              <tr><td>New distributors</td><td className="r num">{diff.new_distributors ?? 0}</td></tr>
              <tr><td>Molecules whose ranking moved</td><td className="r num">{diff.gap_scores_moved ?? 0}</td></tr>
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
          <div className="card-h"><h2>Company claims</h2><span className="note">Check the email domain and the company, then approve. Approval pre-fills the portfolio when asked.</span></div>
          {d.claims.length === 0 ? <Empty>No claims yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Who</th><th>Company</th><th>Evidence</th><th>Portfolio</th><th className="r">Decision</th></tr></thead>
              <tbody>{d.claims.map((k: any) => (
                <tr key={k.id}><td><b>{k.name || k.email}</b><div className="sub2">{k.email} · {fmtDate(k.created_at)}</div></td>
                  <td>{k.cid ? <Link href={`/company/${k.cid}`}>{title(k.company)}</Link> : <>{k.company} <span className="pill">not in list</span></>}</td>
                  <td><span className={`pill ${k.domain_match ? 'mint' : 'peach'}`}>{k.domain_match ? 'Domain matches' : 'Domain does not match'}</span>
                    <div className="small">{k.licence_path && <><a href={`/files/licence/${k.id}`}>Licence</a> · </>}{k.catalogue_path && <a href={`/files/catalogue/${k.id}`}>Catalogue</a>}</div></td>
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
      {tab === 'manufacturers' && (<>
        <section className="card stack">
          <h2>Manufacturer accounts</h2>
          <p className="note">Check the company, its certifications and the work email, then approve. Approval opens partner introductions.</p>
          {d.mfrs.length === 0 && <p className="note">No manufacturers yet.</p>}
          <div className="tbl-wrap"><table className="tbl"><tbody>{d.mfrs.map((m: any) => (
            <tr key={m.user_id}><td><Link href={`/admin/accounts/${m.user_id}`}><b>{m.company_name}</b></Link>
              <div className="sub2">{m.email} · {m.hq_country || 'country not given'} · {m.products} products
                {m.completed_at ? '' : ` · onboarding step ${Math.min(m.step, 6)} of 6`}
                {m.chosen_plan ? ` · chose ${MFR_PLANS[m.chosen_plan as keyof typeof MFR_PLANS]?.name}` : m.suggested_plan ? ` · suggested ${MFR_PLANS[m.suggested_plan as keyof typeof MFR_PLANS]?.name}` : ''}</div>
              <div className="sub2">{(m.certifications ?? []).join(', ') || 'No certifications listed'} · targets {(m.target_countries ?? []).map(countryName).join(', ') || 'none'}</div></td>
              <td className="r">{m.status === 'pending' ? (
                <form action={reviewManufacturer} className="row" style={{ justifyContent: 'flex-end' }}><input type="hidden" name="user_id" value={m.user_id} />
                  <input className="input" name="note" placeholder="Note (optional)" aria-label="Note" style={{ width: 160 }} />
                  <button className="btn btn-blue btn-sm" name="decision" value="approve" type="submit">Approve</button>
                  <button className="btn btn-ghost btn-sm" name="decision" value="reject" type="submit">Reject</button></form>
              ) : <span className={`pill ${m.status === 'approved' ? 'mint' : ''}`}>{m.status}</span>}</td></tr>))}</tbody></table></div>
        </section>
        <section className="card stack">
          <h2>Engagements</h2>
          <p className="note">Reports are due 24 hours after ordering; other engagements turn red after 48 hours without an update.</p>
          <div className="tbl-wrap"><table className="tbl"><tbody>{d.engs.map((e: any) => {
            const late = e.status === 'open' && (e.kind === 'report' ? e.stage !== 'Delivered' && e.due_at && new Date(e.due_at).getTime() < Date.now()
              : Date.now() - new Date(e.updated_at).getTime() > H48);
            return (<tr key={e.id}><td><Link href={`/admin/engagements/${e.id}`}><b>#{e.id} {SERVICES[e.kind].label}</b></Link>
              <div className="sub2">{e.company_name || e.email}{e.country ? ` · ${countryName(e.country)}` : ''} · {ago(e.updated_at)}</div></td>
              <td className="r"><span className={`pill ${late ? 'alert' : e.status === 'open' ? 'blue' : ''}`}>{late ? 'Late · ' : ''}{e.status === 'open' ? e.stage : e.status}</span></td></tr>);
          })}</tbody></table></div>
        </section>
      </>)}
      {tab === 'questions' && (
        <section className="card stack">
          <h2>Expert questions</h2>
          <p className="note">Answer within 48 hours. Red means overdue.</p>
          {d.questions.length === 0 && <p className="note">No questions yet.</p>}
          {d.questions.map((q: any) => {
            const late = !q.answered_at && Date.now() - new Date(q.created_at).getTime() > H48;
            return (
              <div key={q.id} className="stack" style={{ gap: 6, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div className="between"><span className="small"><b>{q.email}</b>{q.inn ? ` · ${q.inn}` : ''} · {ago(q.created_at)}</span>
                  <span className={`pill ${q.answered_at ? 'mint' : late ? 'alert' : 'peach'}`}>{q.answered_at ? 'Answered' : late ? 'Overdue' : 'Open'}</span></div>
                <p style={{ whiteSpace: 'pre-wrap' }}>{q.body}</p>
                <form action={answerQuestion} className="stack" style={{ gap: 6 }}>
                  <input type="hidden" name="question_id" value={q.id} />
                  <textarea className="input" name="answer" defaultValue={q.answer ?? ''} aria-label="Answer" placeholder="Answer (sent to the customer)" required />
                  <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{q.answered_at ? 'Update answer' : 'Send answer'}</button>
                </form>
              </div>);
          })}
        </section>)}
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
              <tr key={x.id}><td><Link href={`/admin/accounts/${x.id}`}><b>{x.name || x.email}</b></Link><div className="sub2">{x.email}{x.owner_id ? ' · teammate seat' : ''}</div>
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
      {tab === 'documents' && (<>
        <p className="note">Upload documents where they belong: on a request (dossier items, shipment documents, assessments), on an engagement,
          on a customer account, or on a supplier. Market data files (registry, essential lists) go under Data updates.</p>
        <div className="grid g2">
          <section className="card stack">
            <h2>Supplier documents</h2>
            <p className="note">GMP certificates, CPPs, DMFs and agreements. Team only, never shown to customers. Expiring within 60 days turns peach, expired turns red.</p>
            <form action={uploadSupplierDoc} className="form-grid">
              <select className="input full" name="supplier_id" aria-label="Supplier" defaultValue=""><option value="">New supplier (fill below)</option>
                {d.suppliers.map((x: any) => <option key={x.id} value={x.id}>{x.name}{x.country ? ` (${x.country})` : ''}</option>)}</select>
              <input className="input" name="supplier_name" placeholder="New supplier name" aria-label="New supplier name" />
              <input className="input" name="supplier_country" placeholder="Country" aria-label="Supplier country" />
              <select className="input" name="kind" aria-label="Document type" defaultValue="gmp">
                {Object.entries(SUPPLIER_DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <label className="row small" style={{ gap: 6 }}>Expires <input className="input" type="date" name="expires_on" aria-label="Expiry date" /></label>
              <input className="input full" name="product" placeholder="Product or molecule it covers (optional)" aria-label="Product" />
              <input className="full" name="file" type="file" required aria-label="File" />
              <button className="btn btn-blue btn-sm full" type="submit">Upload supplier document</button>
            </form>
          </section>
          <section className="card stack">
            <h2>Document for a customer account</h2>
            <p className="note">Agreements, invoices, NDAs, certificates. The customer finds them in Settings, Documents, unless marked internal.
              For a request or engagement, upload on its page instead.</p>
            <form action={uploadAccountDoc} className="form-grid">
              <input className="input full" name="email" type="email" placeholder="Customer email" aria-label="Customer email" required />
              <select className="input" name="kind" aria-label="Document type" defaultValue="agreement">
                {Object.entries(ACCOUNT_DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="input" name="title" placeholder="Title (optional)" aria-label="Title" />
              <input className="full" name="file" type="file" required aria-label="File" />
              <label className="row small full" style={{ gap: 6 }}><input type="checkbox" name="internal" /> Internal: team only</label>
              <button className="btn btn-blue btn-sm full" type="submit">Upload to account</button>
            </form>
          </section>
        </div>
        <section className="card stack">
          <h2>Supplier files ({d.sdocs.length})</h2>
          {d.sdocs.length === 0 ? <Empty>No supplier documents yet.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><tbody>{d.sdocs.map((x: any) => {
              const left = daysLeft(x.expires_on);
              return (<tr key={x.id}><td><a href={`/files/supplier/${x.id}`}><b>{x.file_name}</b></a>
                <div className="sub2">{x.supplier}{x.country ? ` (${x.country})` : ''} · {SUPPLIER_DOC_KINDS[x.kind]}{x.product ? ` · ${x.product}` : ''}</div></td>
                <td className="r">{x.expires_on ? <span className={`pill ${left! < 0 ? 'alert' : left! < 60 ? 'peach' : 'mint'}`}>{left! < 0 ? 'Expired' : 'Expires'} {fmtDate(x.expires_on)}</span> : <span className="note">No expiry</span>}</td>
                <td className="r"><form action={deleteSupplierDoc}><input type="hidden" name="doc_id" value={x.id} />
                  <button className="btn btn-ghost btn-sm" type="submit">Remove</button></form></td></tr>);
            })}</tbody></table></div>)}
        </section>
        <section className="card stack">
          <div className="card-h"><h2>All documents</h2>
            <form className="row" action="/admin"><input type="hidden" name="tab" value="documents" />
              <input className="input" name="dq" defaultValue={sp.dq ?? ''} placeholder="File, email or place" aria-label="Search documents" style={{ width: 220 }} />
              <button className="btn btn-ghost btn-sm" type="submit">Search</button></form></div>
          {d.recent.length === 0 ? <Empty>No documents{sp.dq ? ' match' : ' yet'}.</Empty> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>File</th><th>Where</th><th>From</th><th className="r">When</th></tr></thead>
              <tbody>{d.recent.map((x: any, i: number) => (
                <tr key={i}><td><a href={x.href}>{x.file_name}</a><div className="sub2">{x.what.replaceAll('_', ' ')}{x.internal ? ' · internal' : ''}</div></td>
                  <td><Link href={x.place_href}>{x.place}</Link>{x.email && <div className="sub2">{x.email}</div>}</td>
                  <td className="small">{x.from_team ? 'Nazryx' : 'Customer'}</td><td className="r small">{ago(x.created_at)}</td></tr>))}</tbody></table></div>)}
        </section>
      </>)}
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
              <select className="input" name="kind" aria-label="Price type" defaultValue="observed">
                <option value="observed">Observed market price</option><option value="suggested">Suggested selling price</option></select>
              <input className="input" name="note" placeholder="Note, e.g. wholesale, per 100s" aria-label="Note" />
              <button className="btn btn-blue btn-sm full" type="submit">Add price</button>
            </form>
            <p className="note">Observed market prices, or the price we suggest customers sell at (shown on the molecule page, paid plans).
              Never enter supplier prices here.</p>
            <h2>Registration routes and timelines</h2>
            <form action={saveRoutes} className="stack" style={{ gap: 8 }}>
              {d.routes.map((r: any) => (
                <div key={r.key} className="row">
                  <b style={{ flex: '0 1 180px' }}>{r.label}</b>
                  <input className="input" name={`low_${r.key}`} defaultValue={r.months_low ?? ''} placeholder="Months from" aria-label={`${r.label}: months from`} inputMode="numeric" style={{ width: 110 }} />
                  <input className="input" name={`high_${r.key}`} defaultValue={r.months_high ?? ''} placeholder="to" aria-label={`${r.label}: months to`} inputMode="numeric" style={{ width: 90 }} />
                  <input className="input" name={`desc_${r.key}`} defaultValue={r.description ?? ''} aria-label={`${r.label}: description`} style={{ flex: '1 1 220px' }} />
                </div>))}
              <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save routes</button>
            </form>
            <form action={setMoleculeRoute} className="form-grid">
              <input className="input" name="molecule" placeholder="Molecule name (exact)" aria-label="Molecule" required />
              <select className="input" name="route" aria-label="Route" defaultValue="full"><option value="">Back to default (full dossier)</option>
                {d.routes.map((r: any) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
              <input className="input full" name="note" placeholder="Note shown to customers, e.g. WHO-prequalified reference product exists" aria-label="Note" />
              <button className="btn btn-ghost btn-sm full" type="submit">Set route for this molecule</button>
            </form>
            <p className="note">Paid plans see the route and months on each molecule page. Every molecule uses the full dossier unless set here.</p>
            <h2>Molecule use case</h2>
            <form action={editUseCase} className="stack">
              <input className="input" name="molecule" placeholder="Molecule name (exact)" aria-label="Molecule" required />
              <textarea className="input" name="use_case" placeholder="Indication, class and typical use" aria-label="Use case" required />
              <button className="btn btn-ghost btn-sm" type="submit">Save use case</button>
            </form>
          </section>
          <section className="card stack" style={{ gridColumn: '1 / -1' }}>
            <h2>Manufacturer plan prices</h2>
            <p className="note">Shown to manufacturers on their suggested plan. Leave empty to show &ldquo;Priced on your scope&rdquo;. Example: USD 1,500 / month per market.</p>
            <form action={savePlanPrices} className="stack" style={{ gap: 8 }}>
              {Object.entries(MFR_PLANS).map(([k, v]) => [`mfr_${k}`, v.name]).map(([k, label]) => {
                const cur = d.prices.find((x: any) => x.key === k);
                return (
                  <div key={k} className="row">
                    <b style={{ flex: '0 1 220px' }}>{label}</b>
                    <input className="input" name={`price_${k}`} defaultValue={cur?.price ?? ''} placeholder="Price" aria-label={`${label}: price`} style={{ flex: '0 1 220px' }} />
                    <input className="input" name={`note_${k}`} defaultValue={cur?.note ?? ''} placeholder="Note, e.g. 6-month minimum" aria-label={`${label}: note`} style={{ flex: '1 1 220px' }} />
                  </div>);
              })}
              <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save prices</button>
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
