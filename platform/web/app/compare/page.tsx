import type React from 'react';
import Link from 'next/link';
import Shell from '@/components/Shell';
import { Badges, Locked, SourceLink } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, rows, withUser } from '@/lib/db';
import { BE_STATUS, GLOBAL_LIST, beSuggestion, levelLabel, registeredLine, title } from '@/lib/format';
import { COUNTRY } from '@/lib/queries';

export const metadata = { title: 'Compare molecules' };

// Two molecules side by side. Names of holders follow the same rule as the molecule page (paid, or enriched).
export default async function Compare({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; an?: string; bn?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  const paid = u.plan === 'paid' || u.role === 'team';
  const d = await withUser(u.id, async (db) => {
    const resolve = async (id?: string, name?: string) => {
      if (id && Number(id)) return Number(id);
      if (!name) return null;
      const m = await one(db, `select id from molecules where lower(inn) = lower($1)
                               union all select molecule_id from molecule_aliases where alias = lower($1) limit 1`, [name.slice(0, 200)]);
      return m?.id ?? null;
    };
    const ids = [await resolve(sp.a, sp.an), await resolve(sp.b, sp.bn)];
    const load = async (id: number | null) => {
      if (!id) return null;
      const m = await one(db, `select m.id, m.inn, m.category, cm.*,
            exists (select 1 from enrichments e where e.molecule_id = m.id and e.user_id = $2) as enriched,
            exists (select 1 from sourcing_list l where l.molecule_id = m.id and l.user_id = $2) as in_list,
            (select r.stage from requests r where r.molecule_id = m.id and r.user_id = $2 and r.stage <> 'Closed' limit 1) as request_stage
          from molecules m left join country_molecules cm on cm.molecule_id = m.id and cm.country = $3 where m.id = $1`, [id, u.id, COUNTRY]);
      if (!m) return null;
      const open = paid || m.enriched;
      m.holders = open ? await rows(db, `select c.id, c.display_name, count(*)::int as n from registrations r join companies c on c.id = r.ltr_id
                                         where r.molecule_id = $1 and r.active group by c.id order by n desc limit 5`, [id]) : null;
      m.suggested = paid ? await one(db, `select price_low, price_high, currency, unit from market_prices where molecule_id = $1 and kind = 'suggested'
                                           order by observed_at desc limit 1`, [id]) : null;
      m.route = paid ? await one(db, `select r.label, r.months_low, r.months_high from registration_routes r
                                       where r.key = coalesce((select route_key from molecule_routes where molecule_id = $1), 'full')`, [id]) : null;
      return m;
    };
    return { a: await load(ids[0]), b: await load(ids[1]),
             names: await rows(db, `select m.inn from molecules m join country_molecules cm on cm.molecule_id = m.id and cm.country = $1
                                    order by cm.on_national_list desc, m.inn limit 2000`, [COUNTRY]) };
  });
  const cols = [d.a, d.b];
  const back = `/compare?${new URLSearchParams({ ...(d.a ? { a: String(d.a.id) } : {}), ...(d.b ? { b: String(d.b.id) } : {}) })}`;
  const row = (label: string, f: (m: any) => React.ReactNode) => (
    <tr><td className="muted">{label}</td>{cols.map((m, i) => <td key={i}>{m ? f(m) : '—'}</td>)}</tr>);
  return (
    <Shell user={u} title="Compare molecules" sub="Two molecules side by side">
      <form method="get" className="card tight row">
        <label className="sr" htmlFor="an">First molecule</label>
        <input className="input" id="an" name="an" list="cmp-mols" defaultValue={d.a?.inn ?? ''} placeholder="First molecule" autoComplete="off" style={{ flex: '1 1 220px' }} />
        <label className="sr" htmlFor="bn">Second molecule</label>
        <input className="input" id="bn" name="bn" list="cmp-mols" defaultValue={d.b?.inn ?? ''} placeholder="Second molecule" autoComplete="off" style={{ flex: '1 1 220px' }} />
        <datalist id="cmp-mols">{d.names.map((n) => <option key={n.inn} value={n.inn} />)}</datalist>
        <button className="btn btn-blue" type="submit">Compare</button>
      </form>
      <section className="card">
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th style={{ width: '22%' }}></th>{cols.map((m, i) => <th key={i}>{m ? <Link href={`/molecule/${m.id}`}><span className="nm">{m.inn}</span></Link> : 'Pick a molecule'}</th>)}</tr></thead>
          <tbody>
            {row('Class', (m) => m.category || '—')}
            {row('Status', (m) => <Badges m={m} full />)}
            {row('Registered', (m) => registeredLine(m.registrants, m.registrations))}
            {row('Official TMDA list', (m) => (m.on_national_list ? (m.facility_level ? `Level ${m.facility_level}: ${levelLabel(m.facility_level)}` : 'Yes') : 'No'))}
            {row(GLOBAL_LIST, (m) => (m.on_who_eml ? 'Yes' : 'No'))}
            {row('Registered forms', (m) => m.forms || '—')}
            {row('Bioequivalence', (m) => (beSuggestion(m.forms) ? BE_STATUS[beSuggestion(m.forms)!] : '—'))}
            {row('Main holders', (m) => (m.holders ? (m.holders.length ? m.holders.map((h: any) => <div key={h.id}><Link href={`/company/${h.id}`}>{title(h.display_name)}</Link> <span className="sub2">{h.n}</span></div>) : 'Nobody')
              : <span className="note">Open the molecule (1 credit) or upgrade to see names.</span>))}
            {row('Suggested price', (m) => (!paid ? <Locked title="Paid" /> : m.suggested ? `${m.suggested.currency} ${Number(m.suggested.price_low).toFixed(2)}–${Number(m.suggested.price_high).toFixed(2)} per ${m.suggested.unit}` : 'Not set yet'))}
            {row('Likely route', (m) => (!paid ? <Locked title="Paid" /> : m.route ? `${m.route.label}${m.route.months_low != null ? `, about ${m.route.months_low}–${m.route.months_high ?? m.route.months_low} months` : ''}` : '—'))}
            <tr><td></td>{cols.map((m, i) => <td key={i}>{m && <div className="row" style={{ gap: 6 }}><SourceLink id={m.id} stage={m.request_stage} inList={m.in_list} back={back} /></div>}</td>)}</tr>
          </tbody>
        </table></div>
      </section>
    </Shell>
  );
}
