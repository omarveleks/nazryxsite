import { getUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { targetMarkets } from '@/components/MarketPicker';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';

// The calendar as an .ics file for Outlook, Google or Apple Calendar: the same dates the Calendar page lists.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const day = (v: string | Date) => new Date(v).toISOString().slice(0, 10).replace(/-/g, '');

export async function GET() {
  const u = await getUser();
  if (!u) return new Response('Sign in', { status: 401 });
  const acct = u.owner_id ?? u.id;
  const items = await withUser(u.id, async (db) => {
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [acct]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    return rows(db, `
      select 'ob' || o.id as id, o.kind || ': ' || coalesce(m.inn, p.name) as title, o.due_date as on from obligations o
        left join mfr_products p on p.id = o.product_id left join molecules m on m.id = p.molecule_id where o.user_id = $1 and not o.done
      union all
      select 'tk' || k.id, k.title || ' · ' || coalesce(m.inn, p.name), k.due_date from project_tasks k join projects pr on pr.id = k.project_id
        join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = $1 and k.done_at is null and k.due_date is not null
      union all
      select 'tg' || pr.id, 'Target launch: ' || coalesce(m.inn, p.name) || ' (' || pr.country || ')', pr.target_date from projects pr
        join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = $1 and pr.target_date is not null
      union all
      select 'td' || t.id, 'Tender closes: ' || coalesce(t.title_en, t.title), t.closing from tenders t where t.stage = 'open' and t.closing is not null and t.country = any($2)
        and exists (select 1 from mfr_products p where p.user_id = $1 and p.molecule_id = any(t.molecule_ids))
      union all
      select 'ce' || e.id, e.title, e.on_date from calendar_entries e where e.user_id = $1`, [acct, targets]);
  });
  const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nazryx//Calendar//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Nazryx'];
  for (const x of items) {
    lines.push('BEGIN:VEVENT', `UID:${x.id}@nazryx`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${day(x.on)}`, `SUMMARY:${esc(String(x.title).slice(0, 200))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="nazryx.ics"' } });
}
