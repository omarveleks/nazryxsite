'use server';
import { redirect } from 'next/navigation';
import { requireTeam, requireUser } from '@/lib/auth';
import { dbMessage, one, rows, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { CALL_TOPICS, freeSlots, validZone, type CallHours, type CallSettings } from '@/lib/calls';

// Book a call with the team: customers book and cancel their own calls; the team sets its hours and runs the calls.
const ADMIN = '/admin?tab=calls';

async function note(db: any, userId: string | null, subject: string, body: string, both = false) {
  await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'email', $2, $3)`, [userId, subject, body]);
  if (both && userId) await db.query(`insert into notifications (user_id, channel, subject, body) values ($1, 'whatsapp', $2, $3)`, [userId, subject, body]);
}

const whenText = (at: Date, tz: string) => new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
}).format(at);

export async function bookCall(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const at = new Date(str(f, 'starts_at', 40));
  const topic = str(f, 'topic', 30), text = str(f, 'note', 600);
  const to = '/m/call';
  if (Number.isNaN(at.getTime())) back(to, { error: 'Pick a time.' });
  if (!CALL_TOPICS.some(([k]) => k === topic)) back(to, { error: 'Say what the call is about.' });
  let tz = 'UTC';
  try {
    await withUser(u.id, async (db) => {
      const s = await one(db, 'select timezone, slot_minutes, days_ahead, min_notice_hours from call_settings where id = 1') as CallSettings;
      const hours = await rows(db, 'select weekday, start_min, end_min from call_hours') as CallHours[];
      const taken = (await rows(db, `select t from taken_call_slots(now(), now() + interval '61 days') t`)).map((r) => new Date(r.t));
      tz = s.timezone;
      // only a time the calendar offers: inside the hours, after the notice period, still free
      const ok = freeSlots(s, hours, taken).some((dd) => dd.slots.some((x) => x.getTime() === at.getTime()));
      if (!ok) throw new Error('That time is no longer free. Pick another.');
      await db.query(`insert into call_bookings (user_id, starts_at, minutes, topic, note) values ($1, $2, $3, $4, $5)`,
        [u.id, at.toISOString(), s.slot_minutes, topic, text || null]);
      const label = CALL_TOPICS.find(([k]) => k === topic)![1];
      await note(db, null, `Call booked: ${whenText(at, tz)}`, `${u.email}: ${label}${text ? `. ${text}` : ''}`);
      await note(db, u.id, 'Your call with Nazryx is booked', `${whenText(at, tz)} (${label}). We send the meeting link before the call.`, true);
    });
  } catch (e) {
    const m = e instanceof Error && !('code' in e) ? e.message : (e as { code?: string })?.code === '23505' ? 'That time was just taken. Pick another.' : dbMessage(e);
    back(to, { error: m });
  }
  redirect('/m/call?booked=1');
}

export async function cancelCall(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'id');
  await withUser(u.id, async (db) => {
    const b = await one(db, `update call_bookings set status = 'cancelled' where id = $1 and user_id = $2 and status = 'booked' returning starts_at`, [id, u.id]);
    if (b) await note(db, null, 'Call cancelled', `${u.email} cancelled the call of ${new Date(b.starts_at).toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  });
  redirect('/m/call?cancelled=1');
}

// ---------------------------------------------------------------- team
export async function saveCallSettings(f: FormData) {
  const u = await requireTeam('manufacturers');
  const tz = str(f, 'timezone', 60);
  if (!validZone(tz)) back(ADMIN, { error: 'Use a time zone name like Asia/Karachi, Africa/Nairobi or Europe/London.' });
  try {
    await withUser(u.id, (db) => db.query(`update call_settings set timezone = $1, slot_minutes = $2, days_ahead = $3, min_notice_hours = $4,
                                            updated_at = now() where id = 1`,
      [tz, int(f, 'slot_minutes') ?? 30, int(f, 'days_ahead') ?? 14, int(f, 'min_notice_hours') ?? 12]));
  } catch (e) {
    back(ADMIN, { error: dbMessage(e) });
  }
  back(ADMIN, { saved: '1' });
}

const minutesOf = (v: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export async function addCallHours(f: FormData) {
  const u = await requireTeam('manufacturers');
  const from = minutesOf(str(f, 'from', 5)), until = minutesOf(str(f, 'until', 5));
  const days = [...new Set(f.getAll('weekday').map(Number))].filter((d) => d >= 0 && d <= 6);
  if (from == null || until == null || until <= from || !days.length) back(ADMIN, { error: 'Pick days and a time range, like 10:00 to 17:00.' });
  await withUser(u.id, async (db) => {
    for (const d of days) await db.query('insert into call_hours (weekday, start_min, end_min) values ($1, $2, $3)', [d, from, until]);
  });
  back(ADMIN, { saved: '1' });
}

export async function deleteCallHours(f: FormData) {
  const u = await requireTeam('manufacturers');
  await withUser(u.id, (db) => db.query('delete from call_hours where id = $1', [int(f, 'id')]));
  back(ADMIN, { saved: '1' });
}

/** Add the meeting link (the customer is told), mark a call done, or cancel it. */
export async function updateCall(f: FormData) {
  const u = await requireTeam('manufacturers');
  const id = int(f, 'id'), status = str(f, 'status', 12), link = str(f, 'meeting_link', 300);
  if (link && !/^https:\/\//.test(link)) back(ADMIN, { error: 'Meeting links start with https://' });
  try {
    await withUser(u.id, async (db) => {
      const b = await one(db, `update call_bookings set meeting_link = coalesce(nullif($2, ''), meeting_link),
                                 status = case when $3 in ('booked', 'done', 'cancelled') then $3 else status end
                               where id = $1 returning user_id, starts_at, meeting_link, status`, [id, link, status]);
      if (b && link) await note(db, b.user_id, 'Your call: the meeting link', `Join here at the time you booked: ${link}`, true);
      if (b && status === 'cancelled') await note(db, b.user_id, 'Your call was cancelled', 'Our team had to cancel. Please pick another time in the portal.', true);
    });
  } catch (e) {
    back(ADMIN, { error: dbMessage(e) });
  }
  back(ADMIN, { saved: '1' });
}
