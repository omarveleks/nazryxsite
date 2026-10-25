// Customer usage for the team (Admin > Customers > Usage and each account's page), from usage_events (pages opened and
// sign-ins, recorded since the usage migration) and, for earlier days, what accounts created and their sign-ins still on
// record. Days are counted in the team's time zone (Admin > Calls).

/** What each page is, for people: the portal's areas. */
const PAGES: [RegExp, string][] = [
  [/^\/m\/products\/\d+/, 'A product'], [/^\/m\/products/, 'My products'], [/^\/m\/market/, 'Market'], [/^\/m\/partners/, 'Partners'],
  [/^\/m\/regulatory/, 'Regulatory'], [/^\/m\/tenders/, 'Tenders'], [/^\/m\/services/, 'Services'], [/^\/m\/engagements/, 'Projects'],
  [/^\/m\/report/, 'Market report'], [/^\/m\/call/, 'Book a call'], [/^\/m\/plan/, 'Plans'], [/^\/m\/add-market/, 'Add a market'],
  [/^\/m\/onboarding/, 'Onboarding'], [/^\/m\/?$/, 'Home'], [/^\/settings/, 'Settings'], [/^\/help/, 'Help'], [/^\/admin/, 'Admin'],
  [/^\/signup/, 'Sign-up'], [/^\/signin/, 'Sign-in'], [/^\/$/, 'Front page'],
];
export const pageLabel = (path: string | null) => PAGES.find(([rx]) => rx.test(path ?? ''))?.[1] ?? (path || 'Signed in');

export const SESSION_GAP_MINUTES = 30;    // pages further apart than this start a new visit

/** Every dated sign of accounts being there, $1 days back ($2 one account, or null) (database function usage_signs, team only): kind 'view' (a
 *  page), 'sign_in', or 'action' (something created: 'Added products', 'Uploaded a file', ...). */
export const SIGNS_SQL = `select user_id, at, kind, path, what from usage_signs($1::int) where $2::uuid is null or user_id = $2 order by at desc`;
export type Sign = { user_id: string; at: string; kind: 'view' | 'sign_in' | 'action'; path: string | null; what: string | null };

/** The calendar day of an instant in a time zone, as 2026-10-25. */
export const dayIn = (tz: string) => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return (v: string | Date) => f.format(new Date(v)); };

/** Visits ($1 days back; $2 one account, or null for all): page views grouped into visits, with start, end and pages. */
export const VISITS_SQL = `
  with v as (select user_id, at, path, lag(at) over (partition by user_id order by at) as prev
             from usage_events where kind = 'view' and at > now() - make_interval(days => $1::int) and ($2::uuid is null or user_id = $2)),
  s as (select user_id, at, path, sum(case when prev is null or at - prev > interval '${SESSION_GAP_MINUTES} minutes' then 1 else 0 end)
               over (partition by user_id order by at) as sid from v)
  select user_id, sid, min(at) as started, max(at) as ended, count(*)::int as views,
         extract(epoch from max(at) - min(at)) / 60 + 1 as minutes, array_agg(path order by at) as paths
  from s group by 1, 2`;

export type Visit = { user_id: string; started: string; ended: string; views: number; minutes: number; paths: string[] };

/** Most-opened pages first, as labels: 'Market (12), My products (5)'. */
export function topPages(paths: (string | null)[], n = 3) {
  const c = new Map<string, number>();
  for (const p of paths) { const l = pageLabel(p); c.set(l, (c.get(l) ?? 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([l, k]) => `${l} (${k})`).join(', ');
}

export const minutesText = (m: number) => (m < 1 ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
