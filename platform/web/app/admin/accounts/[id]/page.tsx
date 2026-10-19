import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Empty, Flash, StagePill } from '@/components/ui';
import { deleteAccountDoc, setMfrPlan, setVerified, uploadAccountDoc } from '@/app/actions/docs';
import { deleteAccount, setAccountSuspended, uploadPortfolioFor } from '@/app/actions/admin';
import { requireTeam } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { ACCOUNT_DOC_KINDS } from '@/lib/docs';
import { fmtDate } from '@/lib/format';
import { APPROACHES, GOALS, LAUNCH_SCOPES, MFR_COUNTRIES, MFR_FILE_KINDS, MFR_PLANS, NEEDS, PLAN_ORDER, SERVICES, TIMELINES, countryName, suggestPlan } from '@/lib/mfr';

export const metadata = { title: 'Account' };

// One customer account for the team: who they are, everything they told us at onboarding, their work with us,
// and their documents (upload here).
export default async function AdminAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const id = (await params).id;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requireTeam('accounts');
  const d = await withUser(u.id, async (db) => {
    const a = await one(db, 'select id, email, name, role, plan, whatsapp, account_type, onboarded, created_at, disabled, owner_id from users where id = $1', [id]);
    if (!a) return null;
    return {
      a,
      p: await one(db, 'select * from manufacturer_profiles where user_id = $1', [id]),
      focus: await one(db, 'select * from user_focus where user_id = $1', [id]),
      claim: await one(db, `select k.*, coalesce(c.display_name, k.company_name) as company from company_claims k left join companies c on c.id = k.company_id
                            where k.user_id = $1 order by k.created_at desc limit 1`, [id]),
      products: await rows(db, `select p.name, m.inn from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by p.created_at limit 200`, [id]),
      requests: await rows(db, `select r.id, r.stage, r.updated_at, coalesce(m.inn, r.molecule_text) as molecule from requests r
                                left join molecules m on m.id = r.molecule_id where r.user_id = $1 order by r.updated_at desc limit 30`, [id]),
      engagements: await rows(db, 'select id, kind, country, stage, status, updated_at from engagements where user_id = $1 order by updated_at desc limit 30', [id]),
      wants: await rows(db, 'select wanted, note, status, created_at from plan_requests where user_id = $1 order by created_at desc limit 10', [id]),
      docs: await rows(db, 'select * from account_documents where user_id = $1 order by created_at desc', [id]),
      mfiles: await rows(db, 'select id, kind, file_name, created_at, status, added, matched, error from mfr_files where user_id = $1 order by created_at desc', [id]),
      portfolio: await one(db, `select count(*)::int as n, count(molecule_id)::int as matched, count(*) filter (where kind = 'device')::int as devices
                               from mfr_products where user_id = $1`, [id]),
    };
  });
  if (!d) notFound();
  const { a, p } = d;
  const label = (list: [string, string][], v?: string | null) => list.find(([k]) => k === v)?.[1] ?? v ?? '—';
  const back = `/admin/accounts/${id}`;
  const s = p ? suggestPlan(p) : null;
  return (
    <Shell user={u} title={p?.company_name || a.name || a.email} crumb={<><Link href="/admin?tab=accounts">Admin / Accounts</Link> / {a.email}</>}
      sub={`${a.account_type} · ${a.plan} plan · joined ${fmtDate(a.created_at)}${a.whatsapp ? ` · WhatsApp ${a.whatsapp}` : ''}${a.disabled ? ' · suspended' : ''}`}>
      <Flash sp={sp} />
      {a.disabled && <div className="ok" role="status">This account is suspended: it cannot sign in. Everything it holds is kept.</div>}
      <div className="split">
        <div className="stack">
          {p && (
            <section className="card stack">
              <div className="card-h"><h2>Manufacturer profile</h2><span className={`pill ${p.status === 'approved' ? 'mint' : ''}`}>{p.status}</span></div>
              <table className="tbl"><tbody>
                <tr><td>Company</td><td>{p.company_name} · {p.hq_country || '—'} · {p.company_size || 'size not given'}{p.website ? <> · <a href={p.website} rel="noopener noreferrer" target="_blank">{p.website}</a></> : null}</td></tr>
                <tr><td>Contact</td><td>{a.name || '—'}, {p.contact_role || 'role not given'}</td></tr>
                <tr><td>Certifications</td><td>{p.certifications?.join(', ') || '—'}</td></tr>
                <tr><td>Dosage forms</td><td>{p.dosage_forms?.join(', ') || '—'}</td></tr>
                <tr><td>Therapeutic areas</td><td>{p.therapeutic_areas?.join(', ') || '—'}</td></tr>
                <tr><td>Plants</td><td>{p.plant_countries || '—'}</td></tr>
                <tr><td>Sells today in</td><td>{p.export_markets || '—'}</td></tr>
                <tr><td>Target markets</td><td>{p.target_countries?.map(countryName).join(', ') || '—'}</td></tr>
                <tr><td>Already registered in</td><td>{p.registered_in?.map(countryName).join(', ') || 'none'}</td></tr>
                <tr><td>Timeline</td><td>{label(TIMELINES, p.timeline)}</td></tr>
                <tr><td>Approach</td><td>{label(APPROACHES, p.approach)}</td></tr>
                <tr><td>Wants help with</td><td>{p.services?.map((x: string) => label(NEEDS, x)).join('; ') || '—'}</td></tr>
                <tr><td>Goals</td><td>{p.goals?.map((x: string) => label(GOALS, x)).join('; ') || '—'}</td></tr>
                <tr><td>Products that could launch</td><td>{label(LAUNCH_SCOPES, p.launch_scope)}</td></tr>
                <tr><td>Plan</td><td>Suggested {s ? MFR_PLANS[s.plan].name : '—'}{p.chosen_plan ? <>, <b>chose {MFR_PLANS[p.chosen_plan as keyof typeof MFR_PLANS]?.name}</b></> : ''}
                  {s?.why.length ? <div className="sub2">Because {s.why.join(', ')}</div> : null}</td></tr>
                <tr><td>Onboarding</td><td>{p.completed_at ? `Finished ${fmtDate(p.completed_at)}` : `At sign-up screen ${Math.min(p.step, 8)} of 8`}</td></tr>
              </tbody></table>
            </section>)}
          {p && (
            <section className="card stack">
              <div className="card-h"><h2>Catalogue ({d.products.length})</h2>
                {p.catalogue_path && <a href={`/files/mcatalogue/${id}`}>Uploaded file: {p.catalogue_name}</a>}</div>
              {d.products.length === 0 ? <Empty>No products yet.</Empty> : (
                <div className="small" style={{ columns: '2 220px' }}>{d.products.map((x, i) => (
                  <div key={i}>{x.name}{x.inn ? '' : <span className="sub2"> · not matched</span>}</div>))}</div>)}
            </section>)}
          {d.focus && (
            <section className="card stack"><h2>Distributor focus</h2>
              <p className="small">Classes: {d.focus.classes?.join(', ') || '—'}<br />Goals: {d.focus.goals?.join(', ').replaceAll('_', ' ') || '—'}<br />
                Supplier countries: {d.focus.supplier_countries?.join(', ') || '—'}<br />Levels: {d.focus.levels?.join(', ') || '—'}</p></section>)}
          {d.claim && (
            <section className="card stack"><h2>Company claim</h2>
              <p className="small">{d.claim.company} · <span className="pill">{d.claim.status}</span>
                {d.claim.licence_path && <> · <a href={`/files/licence/${d.claim.id}`}>Licence</a></>}{d.claim.catalogue_path && <> · <a href={`/files/catalogue/${d.claim.id}`}>Catalogue</a></>}</p></section>)}
          <section className="card stack">
            <h2>Work with us</h2>
            {d.requests.length === 0 && d.engagements.length === 0 && <Empty>No requests or engagements yet.</Empty>}
            {d.requests.map((r) => <Link key={`r${r.id}`} href={`/admin/requests/${r.id}`} className="between"><span>Request #{r.id} · {r.molecule}</span><StagePill stage={r.stage} /></Link>)}
            {d.engagements.map((e) => <Link key={`e${e.id}`} href={`/admin/engagements/${e.id}`} className="between">
              <span>#{e.id} {SERVICES[e.kind].label}{e.country ? ` · ${countryName(e.country)}` : ''}</span><span className="pill">{e.status === 'open' ? e.stage : e.status}</span></Link>)}
            {d.wants.map((w, i) => <div key={i} className="small">Asked for {w.wanted.replace('mfr:', '')} ({w.status}, {fmtDate(w.created_at)}){w.note ? `: ${w.note}` : ''}</div>)}
          </section>
        </div>
        <div className="stack">
          {p && (
            <section className="card stack" id="plan">
              <h2>Active plan</h2>
              <p className="note">Turn a plan on once it is agreed and invoiced. It unlocks the matching screens and services at once.</p>
              <form action={setMfrPlan} className="row">
                <input type="hidden" name="user_id" value={id} />
                <select className="input" name="plan" defaultValue={p.active_plan ?? ''} aria-label="Active plan" style={{ flex: '1 1 200px' }}>
                  <option value="">No plan</option>{PLAN_ORDER.map((k) => <option key={k} value={k}>{MFR_PLANS[k].name}</option>)}</select>
                <input className="input" name="amount_usd" inputMode="numeric" placeholder="USD per period" aria-label="Price in US dollars per billing period" style={{ flex: '0 1 140px' }} />
                <select className="input" name="interval" defaultValue={p.billing_interval ?? 'month'} aria-label="Billing" style={{ flex: '0 1 130px' }}>
                  <option value="month">Monthly</option><option value="year">Yearly</option></select>
                <button className="btn btn-blue btn-sm" type="submit">Save</button>
                <fieldset className="row small" style={{ gap: 10, flexBasis: '100%', border: 0, padding: 0, margin: 0 }}>
                  <legend className="lbl" style={{ marginBottom: 4 }}>Markets in the plan (Complete Market Entry covers all)</legend>
                  {MFR_COUNTRIES.map((c) => <label key={c.code} className="row" style={{ gap: 4 }}>
                    <input type="checkbox" name="markets" value={c.code} defaultChecked={(p.paid_markets ?? []).includes(c.code)
                      || (!(p.paid_markets ?? []).length && (p.target_countries ?? []).includes(c.code))} /> {c.name}</label>)}
                </fieldset>
                <label className="row small" style={{ gap: 6, flexBasis: '100%' }}><input type="checkbox" name="documents" defaultChecked /> Issue the order confirmation and invoice</label>
              </form>
              <p className="note">Card subscriptions switch on by themselves. Use this for invoiced plans and Complete Market Entry. Leave the price
                empty to use the list price.</p>
              {p.active_since && <span className="note">Active since {fmtDate(p.active_since)}{p.stripe_subscription ? ', paid by card' : ''}.</span>}
              <form action={setVerified} className="row">
                <input type="hidden" name="user_id" value={id} /><input type="hidden" name="on" value={p.verified_at ? '' : '1'} />
                <span className="small" style={{ flex: 1 }}>{p.verified_at ? `Verified manufacturer since ${fmtDate(p.verified_at)}` : 'Not verified yet'}</span>
                <button className="btn btn-ghost btn-sm" type="submit">{p.verified_at ? 'Remove badge' : 'Mark verified (GMP checked)'}</button>
              </form>
            </section>)}
          {p && (
            <section className="card stack" id="mfiles">
              <h2>Products and files</h2>
              <p className="note">Load a product list into this portfolio (Excel or CSV with a generic-name column; a <b>type</b> column with Drug, MD or DS and a <b>use_group</b> column are honoured). Products appear within a minute. Below: what the manufacturer uploaded.</p>
              <form action={uploadPortfolioFor} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input type="hidden" name="user_id" value={id} />
                <input type="file" name="file" accept=".xlsx,.xls,.csv" required aria-label="Product list" />
                <button className="btn btn-blue btn-sm" type="submit">Load products</button>
              </form>
              {d.portfolio && <p className="small">{d.portfolio.n} products in the portfolio, {d.portfolio.matched} matched to a molecule, {d.portfolio.devices} devices.</p>}
              {d.mfiles.map((x) => (
                <div key={x.id} className="between"><a href={`/files/mfile/${x.id}`}>{x.file_name}</a>
                  <span className="sub2">{MFR_FILE_KINDS[x.kind]} · {fmtDate(x.created_at)}{x.status === 'queued' ? ' · being read' : x.status === 'done' && x.added != null ? ` · ${x.added} added, ${x.matched} matched` : x.error ? ` · ${x.error}` : ''}</span></div>))}
            </section>)}
          <section className="card stack" id="documents">
            <h2>Account documents</h2>
            {d.docs.length === 0 && <Empty>None yet.</Empty>}
            {d.docs.map((x) => (
              <div key={x.id} className="between" style={{ alignItems: 'flex-start' }}>
                <span><a href={`/files/account/${x.id}`}>{x.title || x.file_name}</a><span className="sub2"> · {ACCOUNT_DOC_KINDS[x.kind]} · {fmtDate(x.created_at)}</span></span>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{x.internal && <span className="pill peach">Internal</span>}
                  <form action={deleteAccountDoc}><input type="hidden" name="doc_id" value={x.id} /><input type="hidden" name="return" value={back} />
                    <button className="btn btn-ghost btn-sm" type="submit">Remove</button></form></span>
              </div>))}
            <form action={uploadAccountDoc} className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <input type="hidden" name="user_id" value={id} /><input type="hidden" name="return" value={back} />
              <span className="lbl">Upload</span>
              <select className="input" name="kind" aria-label="Document type" defaultValue="agreement">
                {Object.entries(ACCOUNT_DOC_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="input" name="title" placeholder="Title (optional)" aria-label="Title" />
              <input name="file" type="file" required aria-label="File" />
              <label className="row small" style={{ gap: 6 }}><input type="checkbox" name="internal" /> Internal: team only</label>
              <button className="btn btn-blue btn-sm" type="submit">Upload</button>
            </form>
            <p className="note">For a request or engagement, upload on its own page so the document sits next to its step.</p>
          </section>
          {a.role !== 'team' && !a.owner_id && (
            <section className="card stack" id="access">
              <h2>Access</h2>
              <p className="note">Suspend blocks sign-in for this account and its teammate seats and signs them out. Nothing is deleted;
                restore lets them back in.</p>
              <form action={setAccountSuspended}><input type="hidden" name="user_id" value={id} /><input type="hidden" name="suspend" value={a.disabled ? '0' : '1'} />
                <button className="btn btn-ghost btn-sm" type="submit">{a.disabled ? 'Restore access' : 'Suspend account'}</button></form>
              {u.team_owner && (
                <details>
                  <summary className="btn-link small" style={{ cursor: 'pointer' }}>Delete account</summary>
                  <form action={deleteAccount} className="stack small" style={{ gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="user_id" value={id} />
                    <span>This deletes the account, its teammate seats, its products, requests, services, documents and every file
                      uploaded for it. It cannot be undone. Invoices are kept as records.</span>
                    <label className="lbl" htmlFor="confirm_email">Type <b>{a.email}</b> to confirm</label>
                    <input className="input" id="confirm_email" name="confirm_email" autoComplete="off" required style={{ maxWidth: 320 }} />
                    <button className="btn btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>Delete for good</button>
                  </form>
                </details>)}
            </section>)}
        </div>
      </div>
    </Shell>
  );
}
