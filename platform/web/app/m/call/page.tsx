import Link from 'next/link';
import Shell from '@/components/Shell';
import LocalTime from '@/components/LocalTime';
import { Empty, Flash } from '@/components/ui';
import { bookCall, cancelCall } from '@/app/actions/calls';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { CALL_TOPICS, freeSlots, type CallHours, type CallSettings } from '@/lib/calls';

export const metadata = { title: 'Book a call' };

// Book a call with the team: pick a day, pick a time (shown in your own time zone), say what it is about.
export default async function BookCall({ searchParams }: { searchParams: Promise<{ day?: string; topic?: string; booked?: string; cancelled?: string; error?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const d = await withUser(u.id, async (db) => {
    const s = await one(db, 'select timezone, slot_minutes, days_ahead, min_notice_hours from call_settings where id = 1') as CallSettings;
    const hours = await rows(db, 'select weekday, start_min, end_min from call_hours') as CallHours[];
    const taken = (await rows(db, `select t from taken_call_slots(now(), now() + interval '61 days') t`)).map((r) => new Date(r.t));
    const mine = await rows(db, `select id, starts_at, minutes, topic, note, meeting_link from call_bookings
                                 where user_id = $1 and status = 'booked' and starts_at > now() - interval '1 hour' order by starts_at`, [u.id]);
    return { s, days: freeSlots(s, hours, taken), mine };
  });
  const day = d.days.find((x) => x.day === sp.day) ?? d.days[0];
  const topic = CALL_TOPICS.some(([k]) => k === sp.topic) ? sp.topic! : 'market_entry';
  const zone = d.s.timezone;
  const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`));
  return (
    <Shell user={u} title="Book a call" sub={`${d.s.slot_minutes} minutes with our team, at a time that suits you`}>
      <Flash sp={sp} />
      {sp.booked && <div className="ok" role="status">Booked. You get a confirmation now and the meeting link before the call.</div>}
      {sp.cancelled && <div className="ok" role="status">Cancelled. Book another time whenever you like.</div>}

      {d.mine.length > 0 && (
        <section className="card stack">
          <h2>Your calls</h2>
          {d.mine.map((c) => (
            <div key={c.id} className="between" style={{ flexWrap: 'wrap', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <span><b><LocalTime iso={new Date(c.starts_at).toISOString()} zone={zone} /></b>
                <span className="muted"> · {CALL_TOPICS.find(([k]) => k === c.topic)?.[1] ?? 'Call'}</span>
                {c.meeting_link ? <> · <a href={c.meeting_link} target="_blank" rel="noopener noreferrer">Join the call</a></> : <span className="note"> · link to follow</span>}</span>
              <form action={cancelCall}><input type="hidden" name="id" value={c.id} /><button className="btn-link small" type="submit">Cancel</button></form>
            </div>))}
        </section>)}

      <section className="card stack">
        <h2>Pick a time</h2>
        {d.days.length === 0 ? <Empty>No free times in the next {d.s.days_ahead} days. Write to us from <Link href="/help">Help and contact</Link> and we find one.</Empty> : (<>
          <div className="row" style={{ gap: 6 }} aria-label="Day">
            {d.days.map((x) => <Link key={x.day} className={`pill ${x.day === day!.day ? 'solid' : ''}`} href={`/m/call?day=${x.day}&topic=${topic}`}>{dayLabel(x.day)}</Link>)}
          </div>
          <form action={bookCall} className="stack" style={{ gap: 10 }}>
            <div className="form-grid">
              <div className="field"><label htmlFor="topic">About</label>
                <select className="input" id="topic" name="topic" defaultValue={topic}>{CALL_TOPICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="note">Anything we should prepare? (optional)</label>
                <input className="input" id="note" name="note" maxLength={600} placeholder="Products, markets, questions" /></div>
            </div>
            <span className="lbl">Times shown in your own time zone</span>
            <div className="row" style={{ gap: 6 }}>
              {day!.slots.map((t) => (
                <button key={t.toISOString()} className="pill" type="submit" name="starts_at" value={t.toISOString()} style={{ cursor: 'pointer', font: 'inherit', fontSize: 13 }}>
                  <LocalTime iso={t.toISOString()} zone={zone} withDate={false} /></button>))}
            </div>
            <span className="note">One click books it. You get a confirmation by email{u.whatsapp ? ' and WhatsApp' : ''}.</span>
          </form>
        </>)}
      </section>
    </Shell>
  );
}
