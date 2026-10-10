import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { addSeat, changePassword, requestUpgrade, updateSettings } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, title } from '@/lib/format';
import { activeRequestCount } from '@/lib/queries';

export const metadata = { title: 'Settings' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; upgrade?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const paid = u.plan === 'paid';
  const d = await withUser(u.id, async (db) => ({
    active: await activeRequestCount(db, u.id),
    seats: await rows(db, 'select email, name from users where owner_id = $1 order by created_at', [u.id]),
    open: await rows(db, "select wanted, created_at from plan_requests where user_id = $1 and status = 'open'", [u.id]),
    claim: (await rows(db, `select k.status, k.licence_name, coalesce(c.display_name, k.company_name) as company, k.review_note
                            from company_claims k left join companies c on c.id = k.company_id where k.user_id = coalesce($2::uuid, $1::uuid)
                            order by k.created_at desc limit 1`, [u.id, u.owner_id]))[0],
  }));
  const channel = u.notify_email && u.notify_whatsapp ? 'both' : u.notify_whatsapp ? 'whatsapp' : u.notify_email ? 'email' : 'inapp';
  return (
    <Shell user={u} title="Settings and plan" sub="Account and usage">
      <Flash sp={sp} />
      {sp.upgrade && <div className="ok">Thanks. Our team will contact you to set up the paid plan.</div>}
      <div className="grid g2">
        <section className="card stack" id="plan">
          <div className="between"><h2>Plan and usage</h2><span className={`pill ${paid ? 'solid' : ''}`}>{paid ? 'Paid' : 'Free'}</span></div>
          <table className="tbl"><tbody>
            <tr><td>Enrich credits</td><td className="r num">{paid ? 'Unlimited' : `${u.credits} of ${FREE.credits} left this month`}</td></tr>
            <tr><td>Countries</td><td className="r num">1 of {paid ? 'all live markets' : 1}</td></tr>
            <tr><td>Active requests</td><td className="r num">{d.active}{paid ? '' : ` of ${FREE.requests}`}</td></tr>
          </tbody></table>
          {!paid && u.role !== 'team' && (
            d.open.length ? <p className="note">Upgrade requested. Our team will be in touch.</p> : (
              <form action={requestUpgrade} className="stack">
                <input type="hidden" name="wanted" value="paid" />
                <p className="note">Paid adds prices, supplier availability, the full whitespace list, more countries, alerts and team seats.</p>
                <textarea className="input" name="note" placeholder="Anything we should know (optional)" />
                <button className="btn btn-blue" type="submit">Upgrade</button>
              </form>))}
        </section>
        <section className="card stack" id="team">
          <h2>Team seats</h2>
          {paid && !u.owner_id ? (<>
            {d.seats.map((s) => <div key={s.email} className="between"><span>{s.name || s.email}</span><span className="small muted">{s.email}</span></div>)}
            <form action={addSeat} className="stack">
              <div className="form-grid">
                <input className="input" name="name" placeholder="Name" aria-label="Teammate name" />
                <input className="input" name="email" type="email" placeholder="Work email" aria-label="Teammate email" required />
                <input className="input full" name="password" type="password" placeholder="First password (10+ characters)" aria-label="First password" required minLength={10} />
              </div>
              <button className="btn btn-ghost btn-sm" type="submit">Add teammate</button>
            </form></>) : <p className="note">{u.owner_id ? 'You are on a teammate seat.' : '1 seat on free. Add teammates on the paid plan.'}</p>}
        </section>
        <section className="card stack">
          <h2>Notifications and language</h2>
          <form action={updateSettings} className="stack">
            <div className="field"><label htmlFor="name">Name</label><input className="input" id="name" name="name" defaultValue={u.name} /></div>
            <div className="field"><label htmlFor="whatsapp">WhatsApp number</label><input className="input" id="whatsapp" name="whatsapp" defaultValue={u.whatsapp ?? ''} placeholder="+255 ..." /></div>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
              <legend className="lbl">Send updates by</legend>
              {[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Email and WhatsApp'], ['inapp', 'In-app only']].map(([v, l]) => (
                <label key={v} className="row small" style={{ gap: 8 }}><input type="radio" name="channel" value={v} defaultChecked={channel === v} />{l}</label>))}
            </fieldset>
            <div className="field"><label htmlFor="language">Language</label>
              <select className="input" id="language" name="language" defaultValue="en"><option value="en">English</option>
                <option value="fr" disabled>Français (soon)</option><option value="ru" disabled>Русский (soon)</option></select></div>
            <button className="btn btn-blue btn-sm" type="submit">Save</button>
          </form>
        </section>
        <section className="card stack">
          <h2>Profile and verification</h2>
          {d.claim ? (
            <p>{title(d.claim.company)}. Licence: <b>{d.claim.status === 'approved' ? 'verified' : d.claim.status === 'rejected' ? 'not verified' : 'pending'}</b>
              {d.claim.review_note ? <span className="note"> · {d.claim.review_note}</span> : null}</p>
          ) : <p className="note">No company claimed yet. <a href="/onboarding">Claim your company</a>.</p>}
          <hr className="divider" />
          <form action={changePassword} className="row">
            <input className="input" name="password" type="password" minLength={10} placeholder="New password" aria-label="New password" style={{ flex: '1 1 200px' }} required />
            <button className="btn btn-ghost btn-sm" type="submit">Change password</button>
          </form>
        </section>
      </div>
    </Shell>
  );
}
