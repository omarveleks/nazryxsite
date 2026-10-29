import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, Tabs } from '@/components/ui';
import { requireTeam } from '@/lib/auth';
import { TAB_PERMISSION, TEAM_PERMISSIONS, teamCan } from '@/lib/team';
import { addTeamMember, removeTeamMember, updateTeamMember } from '@/app/actions/team';
import { one, rows, withUser } from '@/lib/db';
import { STAGES, ago, fmtDate, title } from '@/lib/format';
import { MFR_PLANS, PLAN_MARKETS, SERVICES, countryName } from '@/lib/mfr';
import { createInvoice, deleteInvoice, markInvoicePaid, saveInvoiceSettings, saveMarketCosts } from '@/app/actions/admin';
import { answerQuestion, reviewManufacturer, grantCredits, keepSeparate, saveRoutes, setMoleculeRoute, matchMolecule, mergeCompanies, postRegulatory, addPrice, editUseCase, queueRecompute,
  rejectSuggestion, resetPassword, resetTwoStep, reviewClaim, setPlan, updateSource } from '@/app/actions/admin';
import { StagePill } from '@/components/ui';
import { deleteAccountDoc, deleteSupplierDoc, savePlanPrices, uploadAccountDoc, uploadSupplierDoc } from '@/app/actions/docs';
import RegulatoryTab from './RegulatoryTab';
import CallsTab from './CallsTab';
import UsageTab from './UsageTab';
import ChecksSection from './ChecksSection';
import { ACCOUNT_DOC_KINDS, SUPPLIER_DOC_KINDS, daysLeft } from '@/lib/docs';

export const metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';
const H48 = 48 * 3600e3;

export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; saved?: string; queued?: string; dq?: string; rc?: string; who?: string; deleted?: string }> }) {
  const sp = await searchParams;
  const u = await requireTeam();
  // each team member sees only the tabs their permissions open; owners see all of them and the Team tab
  const allowedTabs = Object.keys(TAB_PERMISSION).filter((k) => teamCan(u, TAB_PERMISSION[k]));
  const tab = sp.tab && allowedTabs.includes(sp.tab) ? sp.tab : allowedTabs[0] ?? 'none';
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
      out.history = await rows(db, `select r.id, r.kind, r.country, r.uploaded_at, r.finished_at, r.file_name, r.rows, r.status, r.error, u.email
                                    from registry_uploads r left join users u on u.id = r.uploaded_by order by r.id desc limit 15`);
      out.reminders = await rows(db, 'select sent_at from reminders_log order by sent_at desc limit 3');
      out.refs = await rows(db, 'select kind, name, uploaded_at from reference_files');
      out.sources = await rows(db, `select key, country, kind, label, url, every_hours, enabled, run_now, last_run, last_ok, last_rows, last_error,
                                    held_rows, release_held, to_jsonb(data_sources) ->> 'running_since' as running_since from data_sources order by kind, country`);
      // how many molecules on each market's register have a price, and from which tier
      out.coverage = await rows(db, `with reg as (select distinct country, molecule_id from registrations where active and molecule_id is not null)
        select r.country, count(*)::int as total, count(p.molecule_id)::int as priced, count(*) filter (where p.basis = 'listings')::int as direct
        from reg r left join molecule_prices p using (country, molecule_id) group by 1 order by 1`);
      // the worker's price and class checks (price_checks.py): up to 40 of each kind, worst first
      out.checks = (await one(db, "select to_regclass('public.price_checks') is not null as ok"))?.ok ? await rows(db, `
        select * from (select c.kind, c.country, c.form_type, c.value, c.n, c.detail, m.inn, p.name as product, p.user_id, u.email,
                              count(*) over (partition by c.kind)::int as total,
                              row_number() over (partition by c.kind order by abs(ln(greatest(coalesce(c.value, 1), 1e-9))) desc, c.n desc nulls last) as rn
                       from price_checks c left join molecules m on m.id = c.molecule_id left join mfr_products p on p.id = c.product_id
                       left join users u on u.id = p.user_id) x
        where rn <= 40 or kind in ('accuracy', 'gap')`) : null;
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
          select 'Request #' || f.request_id as place, '/admin?tab=requests' as place_href, '/files/request/' || f.id as href,
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
          union all
          select 'Manufacturer files', '/admin/accounts/' || f.user_id || '#mfiles', '/files/mfile/' || f.id, f.file_name, f.kind, false, false, f.created_at, u.email
            from mfr_files f join users u on u.id = f.user_id
          union all
          select 'Regulatory: ' || d.country, '/admin?tab=regulatory&rc=' || d.country, '/files/regdoc/' || d.id, d.file_name, 'regulatory', true, true, d.created_at, null
            from reg_documents d
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
      out.users = await rows(db, `select u.id, u.email, u.name, u.role, u.plan, u.credits, u.created_at, u.owner_id, u.last_login_at, u.last_seen_at, u.disabled,
                                  (select string_agg(p.wanted, ', ') from plan_requests p where p.user_id = u.id and p.status = 'open') as wants,
                                  auth_totp_enabled(u.id) as two_step
                                  from users u order by (select count(*) from plan_requests p where p.user_id = u.id and p.status = 'open') desc, u.created_at desc limit 200`);
    }
    if (tab === 'team') {
      out.members = await rows(db, `select u.id, u.email, u.name, u.team_owner, u.team_permissions, u.disabled, u.created_at, auth_totp_enabled(u.id) as two_step,
                                    u.last_login_at, u.last_seen_at, a.last_change, a.week
                                    from users u left join lateral (select max(at) as last_change, count(*) filter (where at > now() - interval '7 days')::int as week
                                                                   from audit_log where actor = u.id) a on true
                                    where u.role = 'team' order by u.disabled, u.team_owner desc, u.created_at`);
    }
    if (tab === 'activity') {
      out.who = await rows(db, `select id, coalesce(name, email) as name from users where role = 'team' order by 2`);
      const who = out.who.find((m: any) => m.id === sp.who)?.id ?? null;
      out.log = await rows(db, `select a.at, a.action, a.table_name, a.row_id, a.changes, u.email
                                from audit_log a left join users u on u.id = a.actor where $1::uuid is null or a.actor = $1
                                order by a.at desc limit 200`, [who]);
    }
    if (tab === 'billing') {
      out.inv = await one(db, 'select * from invoice_settings where id = 1');
      out.invoices = await rows(db, `select i.number, i.amount_cents, i.currency, i.status, i.issued_at, i.due_at, i.document_id, i.plan, i.kind,
                                     i.html is not null as made, coalesce(u.email, i.data->'to'->>'email') as email,
                                     coalesce(i.bill_to, p.company_name, u.name, u.email) as company
                                     from invoices i left join users u on u.id = i.user_id left join manufacturer_profiles p on p.user_id = i.user_id
                                     order by i.issued_at desc limit 100`);
      out.pending = await rows(db, `select o.id, o.error, u.email from invoice_orders o join users u on u.id = o.user_id
                                    where o.processed_at is null order by o.id`);
    }
    if (tab === 'content') {
      out.costs = await rows(db, 'select country, freight, duty, distributor, pharmacy, vat from market_costs order by country');
      out.routes = await rows(db, 'select key, label, description, months_low, months_high from registration_routes order by sort');
      out.prices = await rows(db, 'select key, price, note, amount_usd from plan_prices');
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
  // Claims, sourcing requests and expert questions belong to the paused distributor side (distributor/README.md)
  // six areas on top; an area with several pages shows them as a second row
  const n = (x: number) => (x ? ` (${x})` : '');
  const pages: Record<string, string> = {
    data: 'Sources and uploads', review: `Review queue${n(c.suggestions + c.dups)}`, manufacturers: `Manufacturers${n(c.mfr_open)}`,
    accounts: `Accounts${n(c.plan_requests)}`, usage: 'Usage', calls: 'Calls', billing: 'Invoices', documents: 'Documents', regulatory: 'Regulatory',
    content: 'Content and prices', team: 'Team', activity: 'Activity', marketplace: 'Marketplace',
  };
  const areas = [
    { key: 'data', label: `Data${n(c.suggestions + c.dups)}`, pages: ['data', 'review'] },
    { key: 'customers', label: `Customers${n(c.mfr_open + c.plan_requests)}`, pages: ['manufacturers', 'accounts', 'usage', 'calls'] },
    { key: 'marketplace', label: 'Marketplace', pages: ['marketplace'] },
    { key: 'billing', label: 'Billing', pages: ['billing'] },
    { key: 'documents', label: `Documents${n(c.expiring)}`, pages: ['documents'] },
    { key: 'regulatory', label: 'Regulatory', pages: ['regulatory'] },
    { key: 'settings', label: 'Settings', pages: ['content', 'team', 'activity'] },
  ].map((a) => ({ ...a, pages: a.pages.filter((k) => allowedTabs.includes(k)) })).filter((a) => a.pages.length);
  const area = areas.find((a) => a.pages.includes(tab));
  const tabs = areas.map((a) => ({ key: a.key, label: a.label, href: a.key === 'marketplace' ? '/admin/marketplace' : `/admin?tab=${a.pages[0]}` }));
  const subTabs = (area?.pages ?? []).map((k) => ({ key: k, label: pages[k], href: `/admin?tab=${k}` }));
  return (
    <Shell user={u} title="Admin" sub="Nazryx team only. Not visible to customers."
      actions={<Link className="btn btn-blue btn-sm" href="/m/partners?names=1">Distributors with names</Link>}>
      <Tabs items={tabs} current={area?.key ?? tab} />
      {subTabs.length > 1 && <div className="sub-tabs"><Tabs items={subTabs} current={tab} label="Subsections" /></div>}
      <Flash sp={sp} />
      {sp.deleted && <div className="ok" role="status">Account deleted. Its invoices are kept as records.</div>}
      {sp.queued && <div className="ok" role="status">Queued. The ingest job runs in the background; refresh to see the result.</div>}
      {tab === 'data' && (<>
        <section className="card stack" id="sources">
          <div className="card-h"><div><h2>Sources</h2><p className="note">Collected by themselves: registers weekly, tenders daily, prices every three days.
            A register pull much smaller than what is loaded waits here instead of replacing good data.</p></div></div>
          {(d.coverage ?? []).length > 0 && <p className="small">Prices: {(d.coverage ?? []).map((c: any) =>
            `${c.country} ${Math.round((100 * c.priced) / Math.max(1, c.total))}% (${c.direct} direct)`).join(' · ')} of registered molecules.</p>}
          {(() => {
            const all = d.sources ?? [];
            const needs = (x: any) => x.kind === 'registry' || !x.enabled || x.held_rows || x.last_error;
            const ok = all.filter((x: any) => x.last_ok && !x.last_error && x.enabled).length;
            const table = (list: any[]) => (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Source</th><th>Last run</th><th className="r">Rows</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{list.map((x: any) => (
              <tr key={x.key}>
                <td><b>{x.label}</b><div className="sub2">{x.kind} · every {x.every_hours >= 24 ? `${Math.round(x.every_hours / 24)} days` : `${x.every_hours} h`} · <a href={x.url} target="_blank" rel="noopener noreferrer">{x.url.replace('https://', '')}</a></div></td>
                <td className="small">{x.last_run ? ago(x.last_run) : 'never'}{x.run_now && <div className="sub2">queued</div>}</td>
                <td className="r num">{x.last_rows?.toLocaleString('en') ?? '—'}</td>
                <td className="small">{!x.enabled ? <span className="pill">Off</span>
                  : x.running_since ? <span className="pill blue">Running</span>
                  : x.held_rows ? <span className="pill peach">Held</span>
                  : x.last_error ? <span className="pill peach">Error</span>
                  : x.last_ok ? <span className="pill mint">OK</span> : <span className="pill">Waiting</span>}
                  {x.running_since && <div className="sub2">started {ago(x.running_since)}</div>}
                  {x.last_error && <div className="sub2" style={{ maxWidth: 320 }}>{x.running_since ? 'Previous run: ' : ''}{x.last_error}</div>}</td>
                <td className="r"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  {[['run', 'Run now'], ...(x.held_rows && !x.release_held ? [['use_held', 'Use it anyway']] : []), [x.enabled ? 'off' : 'on', x.enabled ? 'Turn off' : 'Turn on']].map(([act, l]) => (
                    <form key={act} action={updateSource}><input type="hidden" name="key" value={x.key} /><input type="hidden" name="act" value={act} />
                      <button className="btn btn-ghost btn-sm" type="submit">{l}</button></form>))}</div></td>
              </tr>))}</tbody></table></div>);
            return (<>
              <p className="small"><b>{ok} of {all.length}</b> sources healthy{all.some((x: any) => x.last_error) ? ', problems listed first' : ''}.</p>
              {table(all.filter(needs).sort((x: any, y: any) => Number(!!y.last_error) - Number(!!x.last_error)))}
              <details><summary className="small">All {all.length} sources (tenders, prices, regulator news)</summary>{table(all.filter((x: any) => !needs(x)))}</details>
            </>);
          })()}
        </section>
        <ChecksSection checks={d.checks ?? null} />
        {overdue && <div className="err" role="alert">Tanzania list update overdue{last ? ` by ${Math.round(-msLeft / 36e5)} hours` : ''}: upload the latest export below.</div>}
        <div className="grid g2">
          <section className="card stack">
            <h2>Upload new list</h2>
            <p className="note">Tanzania last uploaded {last ? ago(last) : 'never'}{!overdue ? `; next due in ${Math.max(1, Math.round(msLeft / 36e5))} hours` : ''}. The other markets are collected by themselves (Sources above).</p>
            {d.refs.length < 2 && <div className="err" role="alert">Upload the two reference lists below first. The registry upload needs them.</div>}
            <form action="/api/admin/upload" method="post" encType="multipart/form-data" className="stack">
              <div className="field"><label htmlFor="country">Country</label>
                <select className="input" id="country" name="country" defaultValue="TZ">
                  {[['TZ', 'Tanzania (registered products .xls)'], ['KZ', 'Kazakhstan (state register .xlsx)'], ['KG', 'Kyrgyzstan (register .xlsx)'],
                    ['UZ', 'Uzbekistan (bulletin: registration certificates .xlsx)'], ['KE', 'Kenya (PPB register .xlsx)'], ['NG', 'Nigeria (NAFDAC Greenbook export .xlsx or .csv)']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="drop"><label className="lbl" htmlFor="file">Registration list (.xls or .xlsx export)</label>
                <input id="file" name="file" type="file" accept=".xls,.xlsx,.html,.htm" required disabled={d.refs.length < 2} /></div>
              <button className="btn btn-blue" type="submit" disabled={d.refs.length < 2}>Upload registration list</button>
            </form>
            <p className="note">After upload: validate, compare with the last list for that country, update the database, recalculate rankings, merge duplicate distributors. A failed upload never changes live data. Kazakhstan, Kyrgyzstan, Uzbekistan and Kenya use their essential lists built in, and Russian names are put into English.</p>
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
        <details className="card"><summary><b>Reference lists and upload history</b></summary><div className="stack" style={{ marginTop: 12 }}>
        <section className="stack">
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
        <section>
          <div className="card-h"><h2>Upload history</h2></div>
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>Date</th><th>Country</th><th>By</th><th>File</th><th className="r">Rows</th><th>Status</th></tr></thead>
            <tbody>{d.history.map((h: any) => (
              <tr key={h.id}><td>{fmtDate(h.uploaded_at)} <span className="tiny muted">{new Date(h.uploaded_at).toISOString().slice(11, 16)} UTC</span></td>
                <td className="small">{h.country}</td>
                <td className="small">{h.email ?? (h.kind === 'initial' ? 'Initial load' : 'System')}</td>
                <td className="small">{h.kind === 'recompute' ? 'Recompute' : <a href={`/files/registry/${h.id}`}>{h.file_name}</a>}</td>
                <td className="r num">{h.rows ?? '—'}</td>
                <td>{h.status === 'applied' ? <span className="pill mint">Applied</span> : h.status === 'failed'
                  ? <span className="pill alert" title={h.error}>Failed, rolled back</span> : <span className="pill blue">{h.status}</span>}
                  {h.status === 'failed' && <div className="tiny muted">{h.error}</div>}</td></tr>))}
            </tbody></table></div>
        </section>
        </div></details>
      </>)}
      {tab === 'review' && (<>
        <section className="card">
          <div className="card-h"><h2>Suggested matches</h2><span className="note">Possible spelling differences between the official list and the register. Accept only if it is the same medicine; nothing changes until you do.</span></div>
          {d.sugg.length === 0 ? <Empty>No open suggestions.</Empty> : (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Official list</th><th>Registry molecule</th><th>Similarity</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{d.sugg.map((s: any) => (
                <tr key={s.molecule_id}><td><b>{s.inn}</b><div className="sub2">{s.category}</div></td><td>{s.to_inn}</td><td className="num">{Math.round(s.confidence)}%</td>
                  <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}>
                    <form action={matchMolecule}><input type="hidden" name="from" value={s.molecule_id} /><input type="hidden" name="to" value={s.to_id} /><button className="btn btn-blue btn-sm">Same molecule</button></form>
                    <form action={rejectSuggestion}><input type="hidden" name="from" value={s.molecule_id} /><button className="btn btn-ghost btn-sm">Different</button></form></div></td></tr>))}
              </tbody></table></div>)}
        </section>
        <section className="card">
          <div className="card-h"><h2>Possible duplicate distributors</h2><span className="note">Two spellings that may be one company. Merge only if they are; branches and units of one group can stay separate.</span></div>
          {d.dups.length === 0 ? <Empty>No open pairs.</Empty> : (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Company A</th><th>Company B</th><th>Similarity</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{d.dups.map((p: any) => (
                <tr key={p.a_key + p.b_key}><td>{title(p.a_name ?? p.a_key)} <span className="tiny muted">({p.a_n ?? 0})</span></td>
                  <td>{title(p.b_name ?? p.b_key)} <span className="tiny muted">({p.b_n ?? 0})</span></td><td className="num">{Math.round(p.similarity)}%</td>
                  <td className="r"><div className="row" style={{ justifyContent: 'flex-end' }}>
                    <form action={mergeCompanies}><input type="hidden" name="keep" value={(p.a_n ?? 0) >= (p.b_n ?? 0) ? p.a_key : p.b_key} />
                      <input type="hidden" name="merge" value={(p.a_n ?? 0) >= (p.b_n ?? 0) ? p.b_key : p.a_key} /><button className="btn btn-blue btn-sm">Merge</button></form>
                    <form action={keepSeparate}><input type="hidden" name="a" value={p.a_key} /><input type="hidden" name="b" value={p.b_key} /><button className="btn btn-ghost btn-sm">Keep separate</button></form></div></td></tr>))}
              </tbody></table></div>)}
        </section>
        <details className="card">
          <summary style={{ cursor: 'pointer' }}><b>Essential molecules nobody registered ({d.unmatched.length})</b>
            <span className="note"> · openings, nothing to do. Open only to map one the register calls by another name.</span></summary>
          <p className="note" style={{ marginTop: 8 }}>&ldquo;In combinations&rdquo; above 0 means it is sold only inside combination products.</p>
          <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Molecule</th><th>Class</th><th>In combinations</th><th className="r">Map to registry molecule</th></tr></thead>
            <tbody>{d.unmatched.map((m: any) => (
              <tr key={m.id}><td>{m.inn}</td><td className="small">{m.category}</td><td className="num">{m.in_combinations}</td>
                <td className="r"><form action={matchMolecule} className="row" style={{ justifyContent: 'flex-end' }}><input type="hidden" name="from" value={m.id} />
                  <input className="input" name="to_name" placeholder="Exact molecule name" style={{ minHeight: 34, width: 200 }} aria-label={`Map ${m.inn} to`} />
                  <button className="btn btn-ghost btn-sm">Map</button></form></td></tr>))}
            </tbody></table></div>
        </details>
        <div className="note row">Decisions apply on the next recompute or upload. <form action={queueRecompute}><button className="btn-link">Recompute now</button></form></div>
      </>)}
      {tab === 'claims' && (
        <section className="card">
          <div className="card-h"><h2>Company claims</h2><span className="note">Check the email domain and the company, then approve. Approval pre-fills the portfolio when asked.</span></div>
          {d.claims.length === 0 ? <Empty>No claims yet.</Empty> : (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Who</th><th>Company</th><th>Evidence</th><th>Portfolio</th><th className="r">Decision</th></tr></thead>
              <tbody>{d.claims.map((k: any) => (
                <tr key={k.id}><td><b>{k.name || k.email}</b><div className="sub2">{k.email} · {fmtDate(k.created_at)}</div></td>
                  <td>{k.cid ? title(k.company) : <>{k.company} <span className="pill">not in list</span></>}</td>
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
          <div className="tbl-wrap" tabIndex={0}><table className="tbl"><tbody>{d.mfrs.map((m: any) => (
            <tr key={m.user_id}><td><Link href={`/admin/accounts/${m.user_id}`}><b>{m.company_name}</b></Link>
              <div className="sub2">{m.email} · {m.hq_country || 'country not given'} · {m.products} products
                {m.completed_at ? '' : ` · sign-up screen ${Math.min(m.step, 8)} of 8`}
                {m.active_plan ? ` · active: ${MFR_PLANS[m.active_plan as keyof typeof MFR_PLANS]?.name}`
                  : m.chosen_plan ? ` · asked for ${MFR_PLANS[m.chosen_plan as keyof typeof MFR_PLANS]?.name}, not active yet`
                  : m.suggested_plan ? ` · suggested ${MFR_PLANS[m.suggested_plan as keyof typeof MFR_PLANS]?.name}` : ''}</div>
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
          <div className="tbl-wrap" tabIndex={0}><table className="tbl"><tbody>{d.engs.map((e: any) => {
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
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>#</th><th>Molecule</th><th>Customer</th><th>Stage</th><th>Updated</th></tr></thead>
              <tbody>{d.requests.map((r: any) => (
                <tr key={r.id}><td className="num">#{r.id}</td><td><span className="nm">{r.molecule}</span>
                  <div className="sub2">{r.quantity}</div></td><td className="small">{r.email}</td><td><StagePill stage={r.stage} /></td><td className="small">{ago(r.updated_at)}</td></tr>))}
              </tbody></table></div>)}
        </section>
      )}
      {tab === 'accounts' && (
        <section className="card">
          <div className="card-h"><h2>Accounts</h2><span className="note">Card plans run by themselves; invoices are in Billing.</span></div>
          <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Account</th><th>Role</th><th>Plan</th><th className="r">Credits</th><th className="r">Actions</th></tr></thead>
            <tbody>{d.users.map((x: any) => (
              <tr key={x.id}><td><Link href={`/admin/accounts/${x.id}`}><b>{x.name || x.email}</b></Link><div className="sub2">{x.email}{x.owner_id ? ' · teammate seat' : ''}</div>
                {x.disabled && x.role !== 'team' && <span className="pill">Suspended</span>}
                <div className="sub2">{x.last_login_at ? `Signed in ${ago(x.last_login_at)} · active ${ago(x.last_seen_at ?? x.last_login_at)}` : 'Not signed in yet'}</div>
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
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><tbody>{d.sdocs.map((x: any) => {
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
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>File</th><th>Where</th><th>From</th><th className="r">When</th></tr></thead>
              <tbody>{d.recent.map((x: any, i: number) => (
                <tr key={i}><td><a href={x.href}>{x.file_name}</a><div className="sub2">{x.what.replaceAll('_', ' ')}{x.internal ? ' · internal' : ''}</div></td>
                  <td><Link href={x.place_href}>{x.place}</Link>{x.email && <div className="sub2">{x.email}</div>}</td>
                  <td className="small">{x.from_team ? 'Nazryx' : 'Customer'}</td><td className="r small">{ago(x.created_at)}</td></tr>))}</tbody></table></div>)}
        </section>
      </>)}
      {tab === 'billing' && (<>
        <section className="tile t-blue row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span><b>Invoice maker</b><br /><span className="small">Any customer, in the portal or not. Every detail is yours to set; A4, print or save as PDF.</span></span>
          <Link className="btn btn-blue" href="/admin/invoice-maker">Make an invoice</Link>
        </section>
        {sp.queued && <div className="ok" role="status">Invoice queued. It is written and filed in the customer's documents within a minute.</div>}
        <div className="grid g2">
          <section className="card stack">
            <h2>New invoice</h2>
            <form action={createInvoice} className="stack">
              <div className="field"><label htmlFor="account">Customer email</label><input className="input" id="account" name="account" type="email" required /></div>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="row" style={{ gap: 6 }}>
                  <input className="input" name={`text_${i}`} placeholder={i ? 'Another line (optional)' : 'What it is for, e.g. Complete Market Access, May 2026'} required={i === 0} style={{ flex: 3 }} aria-label={`Line ${i + 1}`} />
                  <input className="input" name={`qty_${i}`} type="number" step="any" min="0" placeholder="Qty" style={{ width: 64 }} aria-label="Quantity" />
                  <input className="input" name={`unit_${i}`} type="number" step="0.01" min="0" placeholder="Price" style={{ width: 100 }} aria-label="Unit price" />
                </div>))}
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <label className="small">Currency<select className="input" name="currency" defaultValue="usd"><option value="usd">USD</option><option value="eur">EUR</option><option value="gbp">GBP</option></select></label>
                <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="paid" /> Already paid</label>
              </div>
              <div className="field"><label htmlFor="note">Note on the invoice (optional)</label><input className="input" id="note" name="note" /></div>
              <button className="btn btn-blue" type="submit">Create and send invoice</button>
              <p className="note">Numbered, filed in the customer's Settings, Documents, and emailed to them. Plan invoices are made by themselves: when a plan starts or a card payment comes in{d.inv?.recurring ? ', and every billing period for invoiced plans' : ''}.</p>
            </form>
            {(d.pending ?? []).length > 0 && <p className="small">{d.pending.map((o: any) => `${o.email}: ${o.error ? `failed (${o.error})` : 'being written'}`).join(' · ')}</p>}
          </section>
          <section className="card stack">
            <h2>Our details on invoices</h2>
            <form action={saveInvoiceSettings} className="stack">
              {([['issuer', 'Company name', true], ['address', 'Address', false], ['tax_id', 'Tax or registration number', false], ['email', 'Email', true], ['phone', 'Phone', false]] as const).map(([k, l, req]) => (
                <div key={k} className="field"><label htmlFor={k}>{l}</label><input className="input" id={k} name={k} defaultValue={d.inv?.[k] ?? ''} required={req} /></div>))}
              <div className="field"><label htmlFor="payment_details">How to pay (bank, account, SWIFT…)</label><textarea className="input" id="payment_details" name="payment_details" rows={4} defaultValue={d.inv?.payment_details ?? ''} /></div>
              <div className="field"><label htmlFor="footer">Footer note</label><textarea className="input" id="footer" name="footer" rows={2} defaultValue={d.inv?.footer ?? ''} /></div>
              <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="small" style={{ width: 120 }}>Days to pay<input className="input" name="terms_days" type="number" min="0" max="120" defaultValue={d.inv?.terms_days ?? 14} /></label>
                <label className="small" style={{ width: 120 }}>Number prefix<input className="input" name="prefix" defaultValue={d.inv?.prefix ?? 'NZX'} /></label>
                <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="recurring" defaultChecked={d.inv?.recurring ?? true} /> Invoice invoiced plans every period</label>
              </div>
              <button className="btn btn-ghost" type="submit">Save details</button>
            </form>
          </section>
        </div>
        <section className="card">
          <div className="card-h"><h2>Invoices</h2></div>
          {(d.invoices ?? []).length === 0 ? <Empty>No invoices yet.</Empty> : (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th className="r">Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{d.invoices.map((i: any) => (
                <tr key={i.number}>
                  <td>{i.made ? <a href={`/admin/invoice/${encodeURIComponent(i.number)}`} target="_blank" rel="noopener">{i.number}</a>
                    : i.document_id ? <a href={`/files/account/${i.document_id}`}>{i.number}</a> : i.number}{i.kind && i.kind !== 'Invoice' && <div className="sub2">{i.kind}</div>}</td>
                  <td><b>{i.company}</b><div className="sub2">{i.email}</div></td>
                  <td className="small">{fmtDate(i.issued_at)}</td>
                  <td className="r num">{i.amount_cents != null ? `${i.currency.toUpperCase()} ${(i.amount_cents / 100).toLocaleString('en', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td>{i.status === 'paid' ? <span className="pill mint">Paid</span>
                    : i.due_at && new Date(i.due_at) < new Date() ? <span className="pill peach">Overdue</span> : <span className="pill blue">Due {i.due_at ? fmtDate(i.due_at) : ''}</span>}</td>
                  <td className="r"><div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                    {i.made && <Link className="btn btn-ghost btn-sm" href={`/admin/invoice-maker?from=${encodeURIComponent(i.number)}`}>Copy</Link>}
                    {i.made && <form action={deleteInvoice}><input type="hidden" name="number" value={i.number} /><button className="btn btn-ghost btn-sm" type="submit">Delete</button></form>}
                    <form action={markInvoicePaid}><input type="hidden" name="number" value={i.number} /><input type="hidden" name="paid" value={i.status === 'paid' ? '0' : '1'} />
                    <button className="btn btn-ghost btn-sm" type="submit">{i.status === 'paid' ? 'Mark unpaid' : 'Mark paid'}</button></form></div></td>
                </tr>))}</tbody></table></div>)}
        </section>
      </>)}
      {tab === 'regulatory' && <RegulatoryTab userId={u.id} country={sp.rc} />}
      {tab === 'calls' && <CallsTab userId={u.id} />}
      {tab === 'usage' && <UsageTab userId={u.id} />}
      {tab === 'none' && <section className="card"><p className="muted">Your account has no Admin areas yet. Ask an owner to give you access.</p></section>}
      {tab === 'team' && (<>
        <section className="card stack">
          <h2>Add a team member</h2>
          <form action={addTeamMember} className="stack">
            <div className="form-grid">
              <input className="input" name="name" placeholder="Full name" aria-label="Full name" required />
              <input className="input" name="email" type="email" placeholder="Work email" aria-label="Work email" required />
              <input className="input full" name="password" type="text" minLength={10} required placeholder="Temporary password (at least 10 characters)"
                aria-label="Temporary password" autoComplete="off" />
            </div>
            <span className="lbl">What they can open</span>
            <div className="grid g3">{TEAM_PERMISSIONS.map(([k, l, what]) => (
              <label key={k} className="choice"><input type="checkbox" name="perm" value={k} /><span><b>{l}</b><br /><span className="note">{what}</span></span></label>))}</div>
            <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Add team member</button>
            <p className="note">Send them the email and temporary password yourself; they can change the password in Settings.</p>
          </form>
        </section>
        <section className="card stack">
          <h2>Team ({d.members.filter((m: any) => !m.disabled).length})</h2>
          {d.members.map((m: any) => (
            <div key={m.id} className="stack" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--line)', opacity: m.disabled ? 0.6 : 1 }}>
            <form action={updateTeamMember} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="user_id" value={m.id} />
              <div className="between"><span><b>{m.name || m.email}</b><span className="sub2"> · {m.email}{m.two_step ? ' · two-step on' : ''}</span>
                <div className="sub2">Last sign-in {m.last_login_at ? ago(m.last_login_at) : 'never'} · last active {m.last_seen_at ? ago(m.last_seen_at) : 'never'}
                  {' · '}<Link href={`/admin?tab=activity&who=${m.id}`}>{m.week} {m.week === 1 ? 'change' : 'changes'} this week{m.last_change ? `, latest ${ago(m.last_change)}` : ''}</Link></div></span>
                <span className="row" style={{ gap: 6 }}>{m.disabled ? <span className="pill">Removed</span> : m.team_owner ? <span className="pill solid">Owner</span> : null}
                  {m.id === u.id && <span className="pill blue">You</span>}</span></div>
              {!m.disabled && !m.team_owner && (<>
                <div className="row" style={{ gap: 6 }}>{TEAM_PERMISSIONS.map(([k, l]) => (
                  <label key={k} className="row small" style={{ gap: 4, marginRight: 8 }}><input type="checkbox" name="perm" value={k} defaultChecked={m.team_owner || m.team_permissions?.includes(k)} /> {l}</label>))}</div>
              </>)}
              {!m.disabled && !m.team_owner && <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save</button>}
            </form>
            {!m.team_owner && (
              <form action={removeTeamMember}><input type="hidden" name="user_id" value={m.id} /><input type="hidden" name="restore" value={m.disabled ? '1' : '0'} />
                <button className="btn btn-ghost btn-sm" type="submit">{m.disabled ? 'Give access back' : 'Remove access'}</button></form>)}
            </div>))}
          <p className="note">The owner opens everything and manages the team. Removing someone signs them out at once and stops them signing in;
            their past work stays in the activity log.</p>
        </section>
      </>)}
      {tab === 'activity' && (
        <section className="card">
          <div className="card-h"><h2>Team activity</h2><span className="note">Every change a team account makes, recorded by the database. Latest 200.</span></div>
          <div className="row" style={{ gap: 6, marginBottom: 10 }} aria-label="Who">
            <Link className={`pill ${!sp.who ? 'solid' : ''}`} href="/admin?tab=activity">Everyone</Link>
            {d.who.map((m: any) => <Link key={m.id} className={`pill ${sp.who === m.id ? 'solid' : ''}`} href={`/admin?tab=activity&who=${m.id}`}>{m.name}</Link>)}</div>
          {d.log.length === 0 ? <Empty>No team actions yet.</Empty> : (
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
              <tbody>{d.log.map((a: any, i: number) => (
                <tr key={i}><td className="small nowrap">{ago(a.at)}</td><td className="small">{a.email ?? 'system'}</td>
                  <td className="small">{({ insert: 'Added', update: 'Changed', delete: 'Deleted' } as Record<string, string>)[a.action] ?? ({
                    'view as': 'Viewed the portal of', suspend: 'Suspended', restore: 'Restored', 'delete account': 'Deleted account',
                  } as Record<string, string>)[a.action] ?? a.action} {['view as', 'suspend', 'restore'].includes(a.action) ? 'account'
                    : a.table_name.replace(/_/g, ' ')} {a.table_name === 'users' && a.row_id ? <Link href={`/admin/accounts/${a.row_id}`} className="muted">#{a.row_id}</Link>
                    : <span className="muted">#{a.row_id}</span>}</td>
                  <td className="small" style={{ maxWidth: 420 }}>{a.action === 'update'
                    ? Object.entries(a.changes ?? {}).map(([k, v]: [string, any]) => Array.isArray(v) ? `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : `${k}: ${String(v)}`).join('; ')
                    : Object.entries(a.changes ?? {}).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k)).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ')}</td></tr>))}
              </tbody></table></div>)}
        </section>
      )}
      {tab === 'content' && (
        <div className="grid g2">
        <section className="card stack" id="costs" style={{ gridColumn: '1 / -1' }}>
          <div className="card-h"><div><h2>Margin check assumptions</h2><p className="note">What is added on the way from ex-works to the shelf in each market, in %.</p></div></div>
          {(d.costs ?? []).map((c: any) => (
            <form key={c.country} action={saveMarketCosts} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <input type="hidden" name="country" value={c.country} /><b style={{ width: 100 }}>{countryName(c.country)}</b>
              {(['freight', 'duty', 'distributor', 'pharmacy', 'vat'] as const).map((k) => (
                <label key={k} className="small" style={{ width: 90 }}>{k === 'duty' ? 'Duty, fees' : k === 'vat' ? 'VAT' : title(k)}
                  <input className="input" name={k} type="number" step="any" min="0" defaultValue={Math.round(Number(c[k]) * 1000) / 10} /></label>))}
              <button className="btn btn-ghost btn-sm" type="submit">Save</button>
            </form>))}
        </section>
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
            <p className="note">Monthly price in US dollars. Basic Market Data and Complete Market Access are paid by card at this price;
              Complete Market Entry always shows &ldquo;Get in touch&rdquo;.</p>
            <form action={savePlanPrices} className="stack" style={{ gap: 8 }}>
              {Object.entries(MFR_PLANS).map(([k, v]) => [`mfr_${k}`, v.name]).map(([k, label]) => {
                const cur = d.prices.find((x: any) => x.key === k);
                return (
                  <div key={k} className="row">
                    <b style={{ flex: '0 1 220px' }}>{label}</b>
                    {k === 'mfr_entry' ? <span className="note" style={{ flex: '0 1 220px' }}>Get in touch</span>
                      : <input className="input" name={`amount_${k}`} defaultValue={cur?.amount_usd ?? ''} placeholder="USD per month" inputMode="numeric" aria-label={`${label}: US dollars per month`} style={{ flex: '0 1 220px' }} />}
                    <input className="input" name={`note_${k}`} defaultValue={cur?.note ?? ''} placeholder="Note shown under the price (optional)" aria-label={`${label}: note`} style={{ flex: '1 1 220px' }} />
                  </div>);
              })}
              {(['data', 'access'] as const).map((k) => (
                <div key={k} className="row">
                  <b style={{ flex: '0 1 220px' }}>Each extra market, {MFR_PLANS[k].name}</b>
                  <input className="input" name={`amount_mfr_market_${k}`} defaultValue={d.prices.find((x: any) => x.key === `mfr_market_${k}`)?.amount_usd ?? ''} placeholder="USD per month"
                    inputMode="numeric" aria-label={`Each extra market on ${MFR_PLANS[k].name}: US dollars per month`} style={{ flex: '0 1 220px' }} />
                  <span className="note" style={{ flex: '1 1 220px' }}>{MFR_PLANS[k].name} includes {PLAN_MARKETS[k] === 1 ? 'one market' : `${PLAN_MARKETS[k]} markets`}.
                    Yearly billing is ten months for twelve.</span>
                </div>))}
              <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Save prices</button>
            </form>
          </section>
          <section className="card stack" style={{ gridColumn: '1 / -1' }}>
            <h2>Notification outbox</h2>
            <p className="note">Email and WhatsApp delivery are stubbed: messages are recorded here and logged by the worker.</p>
            <div className="tbl-wrap" tabIndex={0}><table className="tbl"><thead><tr><th>When</th><th>Channel</th><th>Subject</th><th>Status</th></tr></thead>
              <tbody>{d.notifs.map((n: any, i: number) => <tr key={i}><td className="small">{ago(n.created_at)}</td><td>{n.channel}</td>
                <td className="small">{n.subject ?? n.body.slice(0, 80)}</td><td><span className="pill">{n.status}</span></td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}
    </Shell>
  );
}
