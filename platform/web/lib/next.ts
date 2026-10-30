import { one, rows } from '@/lib/db';

/** One thing to do, with the English label the component translates: what, where it leads, when, and how pressing. */
export type Action = { key: string; vars?: Record<string, string | number>; href: string; when?: string | null; urgency: 0 | 1 | 2; kind: string };

const days = (d: string | Date) => Math.round((new Date(d).getTime() - Date.now()) / 86400000);
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s;

/** What the manufacturer should do next, read from what is already in the account: dates coming up, tasks due,
 *  projects standing still, tenders closing on their molecules, products without a match, the inbox, and a dossier
 *  that is far from ready. Most pressing first; a handful at most. */
export async function loadNextActions(db: any, uid: string, markets: string[], countryName: (c: string) => string): Promise<Action[]> {
  const [due, tasks, stalled, tenders, unmatched, inbox, watch, dossiers] = await Promise.all([
    rows(db, `select o.kind, o.due_date, o.country, coalesce(m.inn, p.name) as product from obligations o left join mfr_products p on p.id = o.product_id
              left join molecules m on m.id = p.molecule_id where o.user_id = $1 and not o.done and o.due_date <= current_date + 30 order by o.due_date limit 4`, [uid]),
    rows(db, `select k.title, k.due_date, pr.id, pr.country, coalesce(m.inn, p.name) as product from project_tasks k join projects pr on pr.id = k.project_id
              join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id
              where pr.user_id = $1 and k.done_at is null and k.due_date is not null and k.due_date <= current_date + 14 order by k.due_date limit 4`, [uid]),
    rows(db, `select pr.id, pr.country, pr.updated_at, coalesce(m.inn, p.name) as product from projects pr join mfr_products p on p.id = pr.product_id
              left join molecules m on m.id = p.molecule_id where pr.user_id = $1 and pr.stage not in ('launched', 'parked')
              and pr.updated_at < now() - interval '14 days' order by pr.updated_at limit 3`, [uid]),
    markets.length ? rows(db, `select t.id, coalesce(t.title_en, t.title) as title, t.country, t.closing from tenders t
              where t.stage = 'open' and t.closing between current_date and current_date + 14 and t.country = any($2)
              and exists (select 1 from mfr_products p where p.user_id = $1 and p.molecule_id = any(t.molecule_ids)) order by t.closing limit 3`, [uid, markets]) : [],
    one(db, 'select count(*)::int as n from mfr_products where user_id = $1 and molecule_id is null', [uid]),
    rows(db, 'select kind, count(*)::int as n from inbox_items where user_id = $1 and read_at is null group by kind order by n desc', [uid]),
    one(db, `select (select count(*)::int from watches where user_id = $1) as watched, (select count(*)::int from mfr_products where user_id = $1 and molecule_id is not null) as products`, [uid]),
    rows(db, `select pr.country, pr.product_id, coalesce(m.inn, p.name) as product,
              (select count(*)::int from reg_checklist c where c.country = pr.country and c.scope = 'medicine' and c.applies = 'all') as total,
              (select count(*)::int from product_checklist pc where pc.product_id = pr.product_id and pc.country = pr.country) as ready
              from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id
              where pr.user_id = $1 and pr.stage in ('assess', 'dossier') order by pr.updated_at desc limit 3`, [uid]),
  ]);
  const out: Action[] = [];
  for (const o of due) out.push({ kind: 'due', key: '{what} due: {product} · {market}', vars: { what: cap(o.kind), product: o.product ?? '', market: countryName(o.country) },
    href: '/m/calendar', when: o.due_date, urgency: days(o.due_date) <= 7 ? 2 : 1 });
  for (const k of tasks) out.push({ kind: 'task', key: '{task}: {product} · {market}', vars: { task: k.title, product: k.product, market: countryName(k.country) },
    href: `/m/projects/${k.id}`, when: k.due_date, urgency: days(k.due_date) < 0 ? 2 : days(k.due_date) <= 7 ? 1 : 0 });
  for (const s of stalled) out.push({ kind: 'stalled', key: 'No movement for {n} days: {product} · {market}', vars: { n: -days(s.updated_at), product: s.product, market: countryName(s.country) },
    href: `/m/projects/${s.id}`, when: null, urgency: 1 });
  for (const x of tenders) out.push({ kind: 'tender', key: 'Tender closes in {n} days: {title} · {market}', vars: { n: Math.max(0, days(x.closing)), title: String(x.title).slice(0, 70), market: countryName(x.country) },
    href: `/m/tenders/${x.id}`, when: x.closing, urgency: days(x.closing) <= 7 ? 2 : 1 });
  for (const d of dossiers) if (d.total > 0 && d.ready < d.total) out.push({ kind: 'dossier', key: 'Dossier for {product} · {market}: {ready} of {total} documents ready',
    vars: { product: d.product, market: countryName(d.country), ready: d.ready, total: d.total }, href: `/m/products/${d.product_id}/dossier?market=${d.country}`, when: null, urgency: 0 });
  if (Number(unmatched?.n) > 0) out.push({ kind: 'match', key: '{n} products need their generic name before we can match them', vars: { n: unmatched.n }, href: '/m/products', when: null, urgency: 0 });
  const unread = inbox.reduce((s, r) => s + r.n, 0);
  if (unread > 0) out.push({ kind: 'inbox', key: '{n} unread in your inbox: {kinds}', vars: { n: unread, kinds: inbox.slice(0, 3).map((r) => `${r.n} ${r.kind}`).join(', ') },
    href: '/m/inbox', when: null, urgency: inbox.some((r) => r.kind === 'deadline') ? 1 : 0 });
  if (watch && Number(watch.products) > 0 && Number(watch.watched) === 0) out.push({ kind: 'watch', key: 'Watch your molecules to hear when a competitor is registered', href: '/m/products?tab=watch', when: null, urgency: 0 });
  return out.sort((a, b) => b.urgency - a.urgency || (a.when && b.when ? String(a.when).localeCompare(String(b.when)) : a.when ? -1 : b.when ? 1 : 0)).slice(0, 7);
}
