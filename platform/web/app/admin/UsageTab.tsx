import Link from 'next/link';
import { Empty } from '@/components/ui';
import { one, rows, withUser } from '@/lib/db';
import { ago } from '@/lib/format';
import { SESSION_GAP_MINUTES, SIGNS_SQL, VISITS_SQL, dayIn, minutesText, topPages, type Sign, type Visit } from '@/lib/usage';

const DAYS = 30;

// Admin > Customers > Usage: who uses the portal, when and how much. Pages opened are recorded from the usage
// migration on; earlier days come from sign-ins still on record and what accounts created.
export default async function UsageTab({ userId }: { userId: string }) {
  const d = await withUser(userId, async (db) => ({
    tz: (await one<{ timezone: string }>(db, 'select timezone from call_settings where id = 1'))?.timezone ?? 'UTC',
    since: (await one<{ at: string | null }>(db, 'select min(at)::text as at from usage_events'))?.at ?? null,
    accounts: await rows(db, `select u.id, u.email, u.name, u.plan, u.account_type, u.created_at, u.last_login_at, u.last_seen_at, u.owner_id, u.disabled,
                                     coalesce(p.company_name, u.name, u.email) as company
                              from users u left join manufacturer_profiles p on p.user_id = u.id
                              where u.role = 'customer' order by u.last_seen_at desc nulls last, u.created_at desc`),
    signs: await rows<Sign>(db, SIGNS_SQL, [DAYS, null]),
    visits: await rows<Visit>(db, VISITS_SQL, [DAYS, null]),
  }));
  const day = dayIn(d.tz);
  const customers = new Set(d.accounts.map((a: any) => a.id));
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);     // the driver gives Dates
  const signs = d.signs.filter((s) => customers.has(s.user_id)).map((s) => ({ ...s, at: iso(s.at)! }));
  const visits = d.visits.filter((v) => customers.has(v.user_id));
  const at = (v: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: d.tz }).format(new Date(v));

  // per account: the days it was there, its visits and time, and the last thing it did
  const per = new Map<string, { days: Set<string>; visits: number; minutes: number; views: number; paths: string[]; last?: Sign }>();
  const get = (id: string) => per.get(id) ?? per.set(id, { days: new Set(), visits: 0, minutes: 0, views: 0, paths: [] }).get(id)!;
  for (const s of signs) {
    const p = get(s.user_id);
    p.days.add(day(s.at));
    if (s.kind === 'view') p.paths.push(s.path ?? '');
    if (!p.last || s.at > p.last.at) p.last = s;
  }
  for (const v of visits) { const p = get(v.user_id); p.visits += 1; p.minutes += Number(v.minutes); p.views += v.views; }

  // the last 30 days: customers there each day, and pages they opened
  const today = new Date();
  const series = Array.from({ length: DAYS }, (_, i) => day(new Date(today.getTime() - (DAYS - 1 - i) * 864e5)));
  const byDay = new Map(series.map((k) => [k, { who: new Set<string>(), views: 0 }]));
  for (const s of signs) { const b = byDay.get(day(s.at)); if (b) { b.who.add(s.user_id); if (s.kind === 'view') b.views += 1; } }
  const chart = series.map((k) => ({ day: k, n: byDay.get(k)!.who.size, views: byDay.get(k)!.views }));

  const lastSeen = (a: any): string | null => [iso(a.last_seen_at), per.get(a.id)?.last?.at ?? null].filter(Boolean).sort().pop() ?? null;
  const active = (days: number) => d.accounts.filter((a: any) => { const t = lastSeen(a); return t && Date.now() - new Date(t).getTime() < days * 864e5; }).length;
  const latest = [...d.accounts].filter((a: any) => lastSeen(a)).sort((a: any, b: any) => (lastSeen(b)! > lastSeen(a)! ? 1 : -1))[0];
  const what = (s?: Sign) => (!s ? '—' : s.kind === 'action' ? s.what : s.kind === 'sign_in' ? 'Signed in' : `Opened ${topPages([s.path], 1).replace(/ \(\d+\)$/, '')}`);

  return (<>
    <div className="grid g4">
      <div className="tile t-blue"><span className="k">Last customer here</span>
        <span className="v" style={{ fontSize: 18 }}>{latest ? latest.company : '—'}</span>
        <span className="small">{latest ? `${ago(lastSeen(latest))} · ${at(lastSeen(latest)!)}` : 'No one has signed in yet'}</span></div>
      <div className="tile t-mint"><span className="k">Here today</span><span className="v num">{active(1)}</span><span className="small">customers, last 24 hours</span></div>
      <div className="tile t-peach"><span className="k">This week</span><span className="v num">{active(7)}</span><span className="small">customers, last 7 days</span></div>
      <div className="tile t-lav"><span className="k">This month</span><span className="v num">{active(30)}</span><span className="small">of {d.accounts.length} customer accounts</span></div>
    </div>

    <section className="card">
      <div className="card-h"><h2>Customers here each day</h2><span className="note">Last {DAYS} days, {d.tz} time</span></div>
      <DayChart data={chart} />
      <p className="note">{d.since ? `Every page opened is recorded since ${at(d.since)}. ` : 'Pages opened are recorded from now on. '}
        Earlier days show sign-ins still on record and what customers created (products, files, requests, questions, bookings).</p>
    </section>

    <section className="card">
      <div className="card-h"><h2>Every customer</h2><span className="note">Last {DAYS} days. A visit ends after {SESSION_GAP_MINUTES} minutes without a page.</span></div>
      {d.accounts.length === 0 ? <Empty>No customer accounts yet.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Last here</th><th className="r">Days here</th><th className="r">Visits</th>
          <th className="r">Time</th><th className="r">Pages</th><th>Most used</th><th>Last thing done</th></tr></thead>
          <tbody>{d.accounts.map((a: any) => { const p = per.get(a.id); const t = lastSeen(a); return (
            <tr key={a.id}><td><Link href={`/admin/accounts/${a.id}#usage`}><b>{a.company}</b></Link>
              <div className="sub2">{a.email}{a.owner_id ? ' · teammate seat' : ''} · {a.plan}{a.disabled ? ' · suspended' : ''}</div></td>
              <td>{t ? <>{ago(t)}<div className="sub2">{at(t)}</div></> : <span className="muted">Never signed in</span>}</td>
              <td className="r num">{p?.days.size ?? 0}</td><td className="r num">{p?.visits ?? 0}</td>
              <td className="r num">{minutesText(p?.minutes ?? 0)}</td><td className="r num">{p?.views ?? 0}</td>
              <td className="small">{p?.paths.length ? topPages(p.paths) : '—'}</td>
              <td className="small">{what(p?.last)}{p?.last && <div className="sub2">{at(p.last.at)}</div>}</td></tr>); })}
          </tbody></table></div>)}
    </section>
  </>);
}

/** Customers here each day: one series, brand blue, hover titles, table view (as YearChart). */
function DayChart({ data }: { data: { day: string; n: number; views: number }[] }) {
  const W = 640, H = 180, padL = 28, padB = 22, padT = 10;
  const top = Math.max(4, Math.ceil(Math.max(...data.map((x) => x.n)) / 4) * 4);
  const bw = (W - padL) / data.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const label = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Customers here each day" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}><line x1={padL} x2={W} y1={y((i * top) / 4)} y2={y((i * top) / 4)} stroke="#ECEAE3" strokeWidth="1" />
            <text x={padL - 6} y={y((i * top) / 4) + 4} textAnchor="end" fontSize="10" fill="#5E5E58">{(i * top) / 4}</text></g>))}
        {data.map((x, i) => {
          const bx = padL + i * bw + 1, w = Math.max(2, bw - 2), h = y(0) - y(x.n);
          return (
            <g key={x.day}>
              <rect x={bx - 1} y={padT} width={bw} height={H - padT - padB} fill="transparent"><title>{`${label(x.day)}: ${x.n} customers, ${x.views} pages`}</title></rect>
              {x.n > 0 && <path d={`M${bx},${y(0)} v${-Math.max(0, h - 3)} q0,-3 3,-3 h${Math.max(0, w - 6)} q3,0 3,3 v${Math.max(0, h - 3)} z`} fill="#0066FF" pointerEvents="none" />}
              {(i % 5 === 0 || i === data.length - 1) && <text x={bx + w / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#5E5E58">{label(x.day)}</text>}
            </g>);
        })}
      </svg>
      <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: 'pointer' }}>Show as table</summary>
        <table className="tbl small"><thead><tr><th>Day</th><th className="r">Customers</th><th className="r">Pages</th></tr></thead>
          <tbody>{[...data].reverse().map((x) => <tr key={x.day}><td>{label(x.day)}</td><td className="r num">{x.n}</td><td className="r num">{x.views}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}
