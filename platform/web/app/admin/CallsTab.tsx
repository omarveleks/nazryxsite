import { Empty } from '@/components/ui';
import { rows, one, withUser } from '@/lib/db';
import { CALL_TOPICS, WEEKDAYS, hhmm } from '@/lib/calls';
import { addCallHours, deleteCallHours, saveCallSettings, updateCall } from '@/app/actions/calls';

// Admin > Calls: the team's weekly hours and time zone, and every booked call with its meeting link.
export default async function CallsTab({ userId }: { userId: string }) {
  const d = await withUser(userId, async (db) => ({
    s: await one(db, 'select timezone, slot_minutes, days_ahead, min_notice_hours from call_settings where id = 1'),
    hours: await rows(db, 'select id, weekday, start_min, end_min from call_hours order by weekday, start_min'),
    calls: await rows(db, `select b.id, b.starts_at, b.minutes, b.topic, b.note, b.status, b.meeting_link, u.email,
                                  coalesce(p.company_name, u.name, u.email) as company
                           from call_bookings b join users u on u.id = b.user_id left join manufacturer_profiles p on p.user_id = b.user_id
                           where b.starts_at > now() - interval '7 days' order by (b.status = 'booked') desc, b.starts_at limit 100`),
  }));
  const tz = d.s?.timezone ?? 'UTC';
  const at = (v: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz })
    .format(new Date(v));
  return (<>
    <p className="note">Customers book from the portal (Book a call) in the hours below; times are your team&rsquo;s ({tz}) here and their own on their side.
      One booking per slot. They get a confirmation and a reminder the day before; add the meeting link and they are told.</p>
    <section className="card stack">
      <h2>Booked calls</h2>
      {d.calls.length === 0 ? <Empty>No calls booked yet.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><tbody>{d.calls.map((c) => (
          <tr key={c.id}>
            <td><b>{at(c.starts_at)}</b><div className="sub2">{c.minutes} min · {c.status}</div></td>
            <td><b>{c.company}</b><div className="sub2">{c.email}</div></td>
            <td className="small">{CALL_TOPICS.find(([k]) => k === c.topic)?.[1] ?? c.topic}{c.note && <div className="sub2">{c.note}</div>}</td>
            <td><form action={updateCall} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={c.id} />
              <input className="input" name="meeting_link" defaultValue={c.meeting_link ?? ''} placeholder="https:// meeting link" aria-label="Meeting link" style={{ minWidth: 180 }} />
              <select className="input" name="status" defaultValue={c.status} aria-label="Status">
                <option value="booked">Booked</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select>
              <button className="btn btn-ghost btn-sm" type="submit">Save</button></form></td>
          </tr>))}</tbody></table></div>)}
    </section>
    <div className="grid g2">
      <section className="card stack">
        <h2>Weekly hours</h2>
        {d.hours.length === 0 ? <Empty>No hours yet: customers cannot book.</Empty> : d.hours.map((h) => (
          <div key={h.id} className="between small" style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            <span><b>{WEEKDAYS[h.weekday]}</b> {hhmm(h.start_min)} to {hhmm(h.end_min)}</span>
            <form action={deleteCallHours}><input type="hidden" name="id" value={h.id} /><button className="btn-link small" type="submit">Remove</button></form>
          </div>))}
        <form action={addCallHours} className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>{WEEKDAYS.map((w, i) => (
            <label key={w} className="row small" style={{ gap: 4 }}><input type="checkbox" name="weekday" value={i} /> {w.slice(0, 3)}</label>))}</div>
          <div className="row">
            <input className="input" type="time" name="from" defaultValue="10:00" aria-label="From" required />
            <input className="input" type="time" name="until" defaultValue="17:00" aria-label="Until" required />
            <button className="btn btn-ghost btn-sm" type="submit">Add hours</button>
          </div>
        </form>
      </section>
      <section className="card stack">
        <h2>Calendar settings</h2>
        <form action={saveCallSettings} className="form-grid">
          <div className="field full"><label htmlFor="timezone">Your time zone</label>
            <input className="input" id="timezone" name="timezone" defaultValue={tz} placeholder="Asia/Karachi" required /></div>
          <div className="field"><label htmlFor="slot_minutes">Call length (minutes)</label>
            <select className="input" id="slot_minutes" name="slot_minutes" defaultValue={d.s?.slot_minutes ?? 30}>{[15, 20, 30, 45, 60].map((m) => <option key={m}>{m}</option>)}</select></div>
          <div className="field"><label htmlFor="days_ahead">Days bookable ahead</label>
            <input className="input" id="days_ahead" name="days_ahead" type="number" min={1} max={60} defaultValue={d.s?.days_ahead ?? 14} /></div>
          <div className="field"><label htmlFor="min_notice_hours">Minimum notice (hours)</label>
            <input className="input" id="min_notice_hours" name="min_notice_hours" type="number" min={0} max={168} defaultValue={d.s?.min_notice_hours ?? 12} /></div>
          <div className="full"><button className="btn btn-blue btn-sm" type="submit">Save settings</button></div>
        </form>
      </section>
    </div>
  </>);
}
