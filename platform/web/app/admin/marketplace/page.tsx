import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, Tabs } from '@/components/ui';
import { loadThreads, ThreadList } from '@/components/Threads';
import { saveService, setDistributorVerified } from '@/app/actions/market';
import { requireTeam } from '@/lib/auth';
import { teamCan } from '@/lib/team';
import { rows, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { countryName } from '@/lib/mfr';
import { stageLabel } from '@/lib/projects';

export const metadata = { title: 'Marketplace' };
export const dynamic = 'force-dynamic';

// The marketplace for the team: distributors to verify, every open need, the conversations to step into, and the
// service catalogue with its prices.
export default async function AdminMarketplace({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const u = await requireTeam('manufacturers');
  const d = await withUser(u.id, async (db) => ({
    dists: await rows(db, `select d.*, u.email, u.last_seen_at, (select count(*)::int from needs n where n.user_id = d.user_id) as needs from distributor_profiles d join users u on u.id = d.user_id order by d.created_at desc limit 200`),
    needs: await rows(db, `select n.id, n.source, n.country, coalesce(m.inn, n.molecule_text) as name, n.quantity, n.deliver_by, n.created_at, n.status, d.company_name,
        (select count(*)::int from leads l where l.need_id = n.id) as leads from needs n left join molecules m on m.id = n.molecule_id left join distributor_profiles d on d.user_id = n.user_id
        where n.status = 'open' order by (n.source = 'distributor') desc, n.created_at desc limit 100`),
    threads: await loadThreads(db),
    services: await rows(db, 'select * from service_catalog order by sort'),
  }));
  const canContent = teamCan(u, 'content');
  return (
    <Shell user={u} title="Marketplace" sub="Distributors, needs, conversations and the service catalogue" crumb={<Link href="/admin">Admin</Link>}>
      <Tabs items={[{ key: 'dists', label: `Distributors (${d.dists.length})`, href: '#dists' }, { key: 'needs', label: `Open needs (${d.needs.length})`, href: '#needs' }, { key: 'threads', label: `Conversations (${d.threads.filter((x) => x.unread).length} new)`, href: '#threads' }, { key: 'services', label: 'Services', href: '#services' }]} current="" />
      <Flash sp={sp} />
      <section className="card stack" id="dists">
        <h2>Distributors</h2>
        {d.dists.length === 0 ? <Empty>No distributor signed up yet.</Empty> : (
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>Company</th><th>Home</th><th className="hide-m">Markets</th><th className="hide-m">Contact</th><th className="r">Needs</th><th className="hide-m">Last seen</th><th className="r">Verified</th></tr></thead>
            <tbody>{d.dists.map((x) => (
              <tr key={x.user_id}><td><b>{x.company_name}</b>{x.about && <span className="sub2" style={{ display: 'block' }}>{String(x.about).slice(0, 80)}</span>}</td><td>{countryName(x.country)}</td>
                <td className="hide-m small">{(x.markets ?? []).map((c: string) => countryName(c)).join(', ')}</td><td className="hide-m small">{x.email}</td><td className="r num">{x.needs}</td>
                <td className="hide-m small muted">{x.last_seen_at ? ago(x.last_seen_at) : 'never'}</td>
                <td className="r"><form action={setDistributorVerified}><input type="hidden" name="user_id" value={x.user_id} /><input type="hidden" name="on" value={x.verified_at ? '0' : '1'} />
                  <button className={`btn btn-sm ${x.verified_at ? 'btn-ghost' : 'btn-blue'}`} type="submit">{x.verified_at ? 'Unverify' : 'Verify'}</button></form></td></tr>))}</tbody></table></div>)}
        <p className="note">Verify after reading the wholesale licence. Verified distributors are marked on the board and listed first.</p>
      </section>
      <section className="card stack" id="needs">
        <h2>Open needs</h2>
        {d.needs.length === 0 ? <Empty>Nothing open.</Empty> : (
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>Product</th><th>Market</th><th className="hide-m">From</th><th className="hide-m">Quantity</th><th className="hide-m">By</th><th className="r">Hands up</th><th className="r">Posted</th></tr></thead>
            <tbody>{d.needs.map((n) => (
              <tr key={n.id}><td><b>{n.name}</b> {n.source === 'tender' && <span className="pill lav" style={{ fontSize: 11 }}>tender</span>}</td><td>{countryName(n.country)}</td>
                <td className="hide-m small">{n.company_name ?? (n.source === 'tender' ? 'Tender' : '')}</td><td className="hide-m small">{n.quantity ?? ''}</td><td className="hide-m small">{n.deliver_by ? fmtDate(n.deliver_by) : ''}</td>
                <td className="r num">{n.leads}</td><td className="r small muted">{ago(n.created_at)}</td></tr>))}</tbody></table></div>)}
      </section>
      <div className="card-h" id="threads"><h2>Conversations</h2><Link className="btn-link" href="/m/threads">Open all</Link></div>
      <ThreadList list={d.threads.slice(0, 30)} base="/m/threads" />
      <section className="card stack" id="services">
        <h2>Service catalogue</h2>
        <div className="tbl-wrap" tabIndex={0}><table className="tbl">
          <thead><tr><th>Service</th><th>Stage</th><th>Provider</th><th>Price USD</th><th>Days</th><th>Live</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.services.map((s) => (
            <tr key={s.code}><td colSpan={7} style={{ padding: 0 }}>
              <form action={saveService} className="row" style={{ gap: 6, padding: '8px 0', flexWrap: 'wrap' }}>
                <input type="hidden" name="code" value={s.code} />
                <input className="input" name="title" defaultValue={s.title} aria-label="Title" style={{ minHeight: 32, fontSize: 13, width: 180 }} disabled={!canContent} />
                <span className="pill" style={{ fontSize: 11 }}>{stageLabel(s.stage)}</span>
                <input className="input" name="provider" defaultValue={s.provider} aria-label="Provider" style={{ minHeight: 32, fontSize: 13, width: 130 }} disabled={!canContent} />
                <input className="input num" name="price_usd" defaultValue={s.price_usd ?? ''} placeholder="quoted" aria-label="Price USD" inputMode="decimal" style={{ minHeight: 32, fontSize: 13, width: 100 }} disabled={!canContent} />
                <input className="input num" name="days" defaultValue={s.days ?? ''} placeholder="days" aria-label="Days" inputMode="numeric" style={{ minHeight: 32, fontSize: 13, width: 70 }} disabled={!canContent} />
                <label className="check small"><input type="checkbox" name="active" value="1" defaultChecked={s.active} disabled={!canContent} /> live</label>
                <input className="input" name="what" defaultValue={s.what} aria-label="What" style={{ minHeight: 32, fontSize: 13, flex: 1, minWidth: 240 }} disabled={!canContent} />
                {canContent && <button className="btn btn-ghost btn-sm" type="submit">Save</button>}
              </form></td></tr>))}</tbody></table></div>
        <p className="note">A blank price means “quoted”: the customer asks and the team answers. Prices are per product and market.</p>
      </section>
    </Shell>
  );
}
