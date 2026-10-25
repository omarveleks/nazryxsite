import { Empty } from '@/components/ui';
import { one, rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { SESSION_GAP_MINUTES, SIGNS_SQL, VISITS_SQL, dayIn, minutesText, pageLabel, topPages, type Sign, type Visit } from '@/lib/usage';

const DAYS = 60;

// One account's use of the portal, day by day: when it was there (first and last time), how long, which pages and what
// it did; then everything it did lately, newest first. Times in the team's zone (Admin > Calls).
export default async function UsageSection({ teamId, accountId }: { teamId: string; accountId: string }) {
  const d = await withUser(teamId, async (db) => ({
    tz: (await one<{ timezone: string }>(db, 'select timezone from call_settings where id = 1'))?.timezone ?? 'UTC',
    who: await one(db, 'select created_at, last_login_at, last_seen_at from users where id = $1', [accountId]),
    signs: await rows<Sign>(db, SIGNS_SQL, [DAYS, accountId]),
    visits: await rows<Visit>(db, VISITS_SQL, [DAYS, accountId]),
  }));
  const day = dayIn(d.tz);
  const fmt = (o: Intl.DateTimeFormatOptions) => { const f = new Intl.DateTimeFormat('en-GB', { ...o, timeZone: d.tz }); return (v: string | Date) => f.format(new Date(v)); };
  const time = fmt({ hour: '2-digit', minute: '2-digit' });
  const when = fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const date = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  // day by day, newest first
  const days = new Map<string, { first: string; last: string; signIns: number; views: number; paths: string[]; did: Map<string, number>; visits: number; minutes: number }>();
  const get = (k: string, at: string) => {
    const x = days.get(k) ?? days.set(k, { first: at, last: at, signIns: 0, views: 0, paths: [], did: new Map(), visits: 0, minutes: 0 }).get(k)!;
    if (at < x.first) x.first = at;
    if (at > x.last) x.last = at;
    return x;
  };
  const signs = d.signs.map((s) => ({ ...s, at: new Date(s.at).toISOString() }));
  for (const s of signs) {
    const x = get(day(s.at), s.at);
    if (s.kind === 'view') { x.views += 1; x.paths.push(s.path ?? ''); }
    else if (s.kind === 'sign_in') x.signIns += 1;
    else x.did.set(s.what ?? '', (x.did.get(s.what ?? '') ?? 0) + 1);
  }
  for (const v of d.visits) { const x = get(day(v.started), new Date(v.started).toISOString()); x.visits += 1; x.minutes += Number(v.minutes); }
  const list = [...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const total = { days: list.length, minutes: d.visits.reduce((t, v) => t + Number(v.minutes), 0), visits: d.visits.length, views: signs.filter((s) => s.kind === 'view').length };
  const did = (m: Map<string, number>) => [...m.entries()].map(([w, n]) => (n > 1 ? `${w} (${n})` : w)).join(', ');

  return (
    <section className="card stack" id="usage">
      <div className="card-h"><h2>Usage</h2><span className="note">Last {DAYS} days, {d.tz} time</span></div>
      <div className="grid g4">
        <div className="tile t-blue"><span className="k">Last here</span><span className="v" style={{ fontSize: 18 }}>{d.who?.last_seen_at ? ago(d.who.last_seen_at) : 'Never'}</span>
          <span className="small">{d.who?.last_seen_at ? when(d.who.last_seen_at) : 'Not signed in yet'}</span></div>
        <div className="tile t-mint"><span className="k">Days here</span><span className="v num">{total.days}</span><span className="small">in {DAYS} days</span></div>
        <div className="tile t-peach"><span className="k">Time on the portal</span><span className="v" style={{ fontSize: 18 }}>{minutesText(total.minutes)}</span>
          <span className="small">{total.visits} {total.visits === 1 ? 'visit' : 'visits'}</span></div>
        <div className="tile t-lav"><span className="k">Pages opened</span><span className="v num">{total.views}</span>
          <span className="small">{total.views ? topPages(signs.filter((s) => s.kind === 'view').map((s) => s.path), 2) : 'recorded from now on'}</span></div>
      </div>
      {list.length === 0 ? <Empty>Nothing in the last {DAYS} days.</Empty> : (<>
        <h3>Day by day</h3>
        <div className="tbl-wrap"><table className="tbl small"><thead><tr><th>Day</th><th>From – to</th><th className="r">Time</th><th className="r">Visits</th>
          <th className="r">Pages</th><th>Pages used</th><th>Did</th></tr></thead>
          <tbody>{list.map(([k, x]) => (
            <tr key={k}><td><b>{date(k)}</b></td><td className="num">{time(x.first)}{x.last !== x.first ? ` – ${time(x.last)}` : ''}</td>
              <td className="r num">{minutesText(x.minutes)}</td><td className="r num">{x.visits || (x.signIns ? '' : '—')}</td><td className="r num">{x.views || '—'}</td>
              <td>{x.paths.length ? topPages(x.paths, 4) : x.signIns ? 'Signed in' : '—'}</td><td>{did(x.did) || '—'}</td></tr>))}
          </tbody></table></div>
        <details>
          <summary className="btn-link small" style={{ cursor: 'pointer' }}>Everything, newest first</summary>
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table className="tbl small"><thead><tr><th>When</th><th>What</th></tr></thead>
            <tbody>{signs.slice(0, 300).map((s, i) => (
              <tr key={i}><td className="num">{when(s.at)}</td>
                <td>{s.kind === 'view' ? `Opened ${pageLabel(s.path)}` : s.kind === 'sign_in' ? 'Signed in' : s.what}
                  {s.kind === 'view' && <span className="sub2"> {s.path}</span>}</td></tr>))}
            </tbody></table></div>
        </details>
        <p className="note">A visit is pages opened less than {SESSION_GAP_MINUTES} minutes apart; its time runs from the first page to the last,
          plus a minute. Days before pages were recorded show sign-ins still on record and what the account created.</p>
      </>)}
    </section>
  );
}
