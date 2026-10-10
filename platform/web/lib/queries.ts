import type { Db } from './db';
import { rows, one } from './db';

export const COUNTRY = 'TZ';

export async function portfolioIds(db: Db, uid: string): Promise<number[]> {
  return (await rows(db, 'select molecule_id from portfolio_items where user_id = $1', [uid])).map((r) => r.molecule_id);
}

export async function activeRequestCount(db: Db, uid: string): Promise<number> {
  return Number((await one(db, "select count(*)::int as n from requests where user_id = $1 and stage <> 'Closed'", [uid]))?.n ?? 0);
}

export async function categories(db: Db): Promise<string[]> {
  return (await rows(db, `select distinct m.category from molecules m join country_molecules cm on cm.molecule_id = m.id
                          where cm.country = $1 and m.category is not null order by 1`, [COUNTRY])).map((r) => r.category);
}

/** Molecule rows for lists (search, open molecules): registrations, badges, the caller's own status.
 *  `g.score` is joined for ordering only: it is never shown. */
export const MOLECULE_LIST_SQL = `
  select m.id, m.inn, m.category, cm.forms, cm.registrants, cm.registrations, cm.on_national_list, cm.on_who_eml,
         cm.facility_level, cm.rankable, cm.channel_flag, cm.in_combinations, cm.local_made,
         exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = app_uid()) as enriched,
         exists (select 1 from portfolio_items p where p.molecule_id = m.id and p.user_id = app_uid()) as in_portfolio,
         (select r.stage from requests r where r.molecule_id = m.id and r.user_id = app_uid() and r.stage <> 'Closed'
          order by r.updated_at desc limit 1) as request_stage
  from molecules m
  join country_molecules cm on cm.molecule_id = m.id and cm.country = '${COUNTRY}'
  left join visible_gap_scores g on g.molecule_id = m.id and g.country = cm.country`;
