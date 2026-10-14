import { getUser } from '@/lib/auth';
import { rows, withUser } from '@/lib/db';
import { COUNTRY } from '@/lib/queries';

// CSV downloads for paid plans. Excel opens them directly (UTF-8 with BOM). Free plans are sent to the plans page.
const KINDS = ['open', 'search', 'gaps', 'list', 'company'] as const;

const MOLECULE_COLS = `m.inn as molecule, m.category as class, cm.registrants as companies_registered, cm.registrations as products_registered,
  case when cm.on_national_list then 'yes' else 'no' end as official_tmda_list, cm.facility_level as eml_level,
  case when cm.on_who_eml then 'yes' else 'no' end as who_essential_list, cm.forms as registered_forms`;

function csv(data: Record<string, unknown>[]) {
  if (!data.length) return '﻿no rows\n';
  const cols = Object.keys(data[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;   // no formulas when opened in Excel
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [cols.join(','), ...data.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const u = await getUser();
  if (!u) return new Response(null, { status: 303, headers: { Location: '/signup?mode=signin' } });
  if (!KINDS.includes(kind as any)) return new Response('Not found', { status: 404 });
  if (u.plan !== 'paid' && u.role !== 'team') return new Response(null, { status: 303, headers: { Location: '/settings?export=1#plan' } });
  const q = new URL(req.url).searchParams;
  const data = await withUser(u.id, async (db) => {
    if (kind === 'open') {
      return rows(db, `select ${MOLECULE_COLS} from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                       left join visible_gap_scores g on g.molecule_id = m.id and g.country = cm.country
                       where cm.rankable and cm.on_national_list and g.score > 0 and ($2 = '' or m.category = $2) and ($3 = '' or cm.facility_level = $3)
                       order by g.score desc, cm.registrants, m.inn`, [COUNTRY, q.get('class') ?? '', q.get('level') ?? '']);
    }
    if (kind === 'search') {
      return rows(db, `select ${MOLECULE_COLS} from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                       where ($2 = '' or m.inn ilike '%' || $2 || '%' or m.category ilike '%' || $2 || '%')
                         and ($3 = '' or m.category = $3) and ($4 = '' or (cm.on_national_list and cm.facility_level = $4))
                       order by m.inn limit 2000`, [COUNTRY, (q.get('q') ?? '').slice(0, 80), q.get('class') ?? '', q.get('level') ?? '']);
    }
    if (kind === 'gaps') {
      return rows(db, `select ${MOLECULE_COLS} from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                       where cm.on_national_list and cm.rankable
                         and m.category in (select distinct m2.category from portfolio_items p join molecules m2 on m2.id = p.molecule_id where p.user_id = $2)
                         and m.id not in (select molecule_id from portfolio_items where user_id = $2)
                       order by m.category, cm.registrants, m.inn`, [COUNTRY, u.id]);
    }
    if (kind === 'list') {
      return rows(db, `select ${MOLECULE_COLS} from sourcing_list l join molecules m on m.id = l.molecule_id
                       left join country_molecules cm on cm.molecule_id = m.id and cm.country = $1 where l.user_id = $2 order by l.added_at`, [COUNTRY, u.id]);
    }
    return rows(db, `select coalesce(m.inn, r.generic_name) as molecule, r.brand, r.dosage_form, r.strength, r.reg_year as registered_year,
                            r.manufacturing_country, r.status
                     from registrations r left join molecules m on m.id = r.molecule_id
                     where r.active and (r.ltr_id = $1 or r.manufacturer_id = $1) order by molecule, r.brand`, [Number(q.get('id')) || 0]);
  });
  const name = `nazryx-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv(data), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });
}
