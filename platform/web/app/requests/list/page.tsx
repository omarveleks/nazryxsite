import Link from 'next/link';
import Shell from '@/components/Shell';
import { Badges, Empty, Flash } from '@/components/ui';
import { sendList, toggleList } from '@/app/actions/app';
import { requireUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { FREE, PIPELINE, registeredLine } from '@/lib/format';
import { COUNTRY, activeRequestCount } from '@/lib/queries';

export const metadata = { title: 'Sourcing list' };

// Collect molecules from search, open molecules or a molecule page, then request them together.
export default async function SourcingList({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const free = u.plan !== 'paid' && u.role !== 'team';
  const d = await withUser(u.id, async (db) => ({
    items: await rows(db, `select m.id, m.inn, m.category, cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml,
                                  cm.facility_level, cm.channel_flag, cm.in_combinations, l.quantity
                           from sourcing_list l join molecules m on m.id = l.molecule_id
                           left join country_molecules cm on cm.molecule_id = m.id and cm.country = $2
                           where l.user_id = $1 order by l.added_at`, [u.id, COUNTRY]),
    active: await activeRequestCount(db, u.id),
  }));
  const room = free ? FREE.requests - d.active : Infinity;
  return (
    <Shell user={u} title="Sourcing list" sub="Collect molecules, then request them all at once"
      crumb={<><Link href="/requests">Requests</Link> / Sourcing list</>}>
      <Flash sp={sp} />
      <div className="split">
        <section className="card">
          <div className="card-h"><h2>{d.items.length} {d.items.length === 1 ? 'molecule' : 'molecules'}</h2>
            <Link className="btn-link" href="/market/whitespace">Add open molecules</Link></div>
          {d.items.length === 0 ? (
            <div className="stack" style={{ alignItems: 'flex-start' }}>
              <Empty>Your list is empty. Use &quot;+ List&quot; on any molecule in Search, Open molecules or a molecule page.</Empty>
              <div className="row"><Link className="btn btn-blue btn-sm" href="/market/whitespace">Browse open molecules</Link>
                <Link className="btn btn-ghost btn-sm" href="/search">Search</Link></div>
            </div>
          ) : (
            <form id="send" action={sendList}>
              {d.items.map((m, i) => (
                <div key={m.id} className="between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', padding: '14px 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                  <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                    <Link href={`/molecule/${m.id}`}><span className="nm">{m.inn}</span></Link>
                    <div className="sub2">{[m.category, Number(m.registrants) > 0 ? registeredLine(m.registrants, m.registrations) : null].filter(Boolean).join(' · ')}</div>
                    <div style={{ marginTop: 6 }}><Badges m={m} /></div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <label className="sr" htmlFor={`qty_${m.id}`}>Quantity for {m.inn}</label>
                    <input className="input" id={`qty_${m.id}`} name={`qty_${m.id}`} placeholder="Quantity (optional)" style={{ width: 170 }} />
                    <button className="btn btn-ghost btn-sm" type="submit" formAction={toggleList} name="molecule_id" value={m.id} formNoValidate>Remove</button>
                  </div>
                </div>))}
              <input type="hidden" name="return" value="/requests/list" />
            </form>
          )}
        </section>
        <div className="stack">
          <section className="card stack">
            <h2>Request all</h2>
            {d.items.length > 0 && (<>
              <div className="field"><label htmlFor="target_price">Target price (optional)</label>
                <input className="input" id="target_price" name="target_price" form="send" placeholder="e.g. USD 1.20 per pack" /></div>
              <div className="field"><label htmlFor="deliver_by">Needed by (optional)</label>
                <input className="input" id="deliver_by" name="deliver_by" type="date" form="send" /></div>
              <div className="field"><label htmlFor="notes">Notes for every request</label>
                <textarea className="input" id="notes" name="notes" form="send" placeholder="Forms, strengths, pack sizes, certificates you need" /></div>
              {d.items.length > room
                ? <div className="note">The free plan allows {FREE.requests} active requests; you have room for {Math.max(0, room)}. Remove some, or <Link href="/settings#plan">upgrade</Link>.</div>
                : <button className="btn btn-blue" type="submit" form="send">Request {d.items.length} {d.items.length === 1 ? 'molecule' : 'molecules'}</button>}
            </>)}
            <p className="note">Each molecule becomes its own request and goes through the same route:</p>
            <ol className="steps">{PIPELINE.map((s, i) => <li key={s}><em>{String(i + 1).padStart(2, '0')}</em><span>{s}</span></li>)}</ol>
          </section>
        </div>
      </div>
    </Shell>
  );
}
