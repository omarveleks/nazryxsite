// Book a call: the team's weekly hours, in the team's time zone, turned into free slots for the days ahead.

export type CallSettings = { timezone: string; slot_minutes: number; days_ahead: number; min_notice_hours: number };
export type CallHours = { weekday: number; start_min: number; end_min: number };

export const CALL_TOPICS: [string, string][] = [
  ['market_entry', 'Entering a market'], ['dossier_review', 'Dossier and regulatory review'], ['post_registration', 'Renewals and compliance'],
  ['plan', 'Plans and pricing'], ['other', 'Something else'],
];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Minutes the time zone is ahead of UTC at this instant. */
function offsetMinutes(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The instant of a wall-clock time (date + minutes after midnight) in a time zone. */
export function zonedTime(y: number, m: number, d: number, minutes: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;          // once more across a daylight-saving change
  return new Date(t);
}

/** The calendar date (year, month, day) in a time zone. */
export function zonedDate(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

export const validZone = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

/** Free slots per day (team calendar date, YYYY-MM-DD), from now plus the notice period to the days ahead. */
export function freeSlots(settings: CallSettings, hours: CallHours[], taken: Date[], now = new Date()) {
  const tz = validZone(settings.timezone) ? settings.timezone : 'UTC';
  const busy = new Set(taken.map((t) => t.getTime()));
  const earliest = now.getTime() + settings.min_notice_hours * 3600e3;
  const start = zonedDate(now, tz);
  const days: { day: string; slots: Date[] }[] = [];
  for (let i = 0; i <= settings.days_ahead; i++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, d = base.getUTCDate(), wd = base.getUTCDay();
    const slots: Date[] = [];
    for (const h of hours.filter((x) => x.weekday === wd).sort((a, b) => a.start_min - b.start_min)) {
      for (let t = h.start_min; t + settings.slot_minutes <= h.end_min; t += settings.slot_minutes) {
        const at = zonedTime(y, m, d, t, tz);
        if (at.getTime() >= earliest && !busy.has(at.getTime())) slots.push(at);
      }
    }
    if (slots.length) days.push({ day: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, slots });
  }
  return days;
}
