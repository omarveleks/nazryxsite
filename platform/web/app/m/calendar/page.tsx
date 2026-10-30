import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash } from '@/components/ui';
import { addCalendarEntry, removeCalendarEntry } from '@/app/actions/projects';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { countryName } from '@/lib/mfr';
import { targetMarkets } from '@/components/MarketPicker';

export const metadata = { title: 'Calendar' };

const KINDS: Record<string, [string, string]> = {
  renewal: ['Renewal', 'peach'], variation: ['Variation', 'lav'], safety_report: ['Safety report', 'lav'], other: ['Obligation', ''],
  tender: ['Tender closes', 'blue'], task: ['Task due', ''], target: ['Target launch', 'mint'], trial: ['Trial ends', 'peach'], call: ['Call with Nazryx', 'blue'],
  own: ['Your entry', ''], gmp_expiry: ['GMP expires', 'peach'], registration_expiry: ['Registration expires', 'peach'], meeting: ['Meeting', ''],
};

// Everything with a date, in one list: renewals and obligations, tenders closing on your molecules, task due dates,
// target launch dates, your trial, booked calls, and your own entries. Reminders go to the inbox a week before.
export default async function Calendar({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; past?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const acct = u.owner_id ?? u.id;
  const d = await withUser(u.id, async (db) => {
    const prof = await one(db, 'select target_countries, trial_until, active_plan from manufacturer_profiles where user_id = $1', [acct]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const items = await rows(db, `
      select 'ob' || o.id as id, o.kind, o.due_date as on, coalesce(m.inn, p.name) as title, o.country, '/m/projects' as href, o.project_id from obligations o
        left join mfr_products p on p.id = o.product_id left join molecules m on m.id = p.molecule_id where o.user_id = $1 and not o.done
      union all
      select 'tk' || k.id, 'task', k.due_date, k.title || ' · ' || coalesce(m.inn, p.name), pr.country, '/m/projects/' || pr.id, pr.id from project_tasks k
        join projects pr on pr.id = k.project_id join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id
        where pr.user_id = $1 and k.done_at is null and k.due_date is not null
      union all
      select 'tg' || pr.id, 'target', pr.target_date, coalesce(m.inn, p.name), pr.country, '/m/projects/' || pr.id, pr.id from projects pr
        join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = $1 and pr.target_date is not null and pr.stage <> 'launched'
      union all
      select 'td' || t.id, 'tender', t.closing, coalesce(t.title_en, t.title), t.country, '/m/tenders/' || t.id, null from tenders t
        where t.stage = 'open' and t.closing is not null and t.country = any($2)
          and exists (select 1 from mfr_products p where p.user_id = $1 and p.molecule_id = any(t.molecule_ids))
      union all
      select 'cl' || c.id, 'call', c.starts_at::date, coalesce(c.topic, 'Call'), null, '/m/call', null from call_bookings c where c.user_id = $1 and c.status = 'booked'
      union all
      select 'ce' || e.id, e.kind, e.on_date, e.title, e.country, case when e.project_id is not null then '/m/projects/' || e.project_id else '/m/calendar' end, e.project_id from calendar_entries e where e.user_id = $1
      order by 3`, [acct, targets]);
    if (prof?.trial_until && !prof.active_plan) items.push({ id: 'trial', kind: 'trial', on: prof.trial_until, title: t('Basic Market Data trial'), country: null, href: '/m/plan', project_id: null });
    items.sort((a, b) => new Date(a.on).getTime() - new Date(b.on).getTime());
    const projects = await rows(db, `select pr.id, coalesce(m.inn, p.name) || ' · ' || pr.country as label from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.user_id = $1 order by 2`, [acct]);
    return { targets, items, projects };
  });
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = d.items.filter((x) => String(x.on).slice(0, 10) >= today), past = d.items.filter((x) => String(x.on).slice(0, 10) < today);
  const shown = sp.past ? past.reverse() : upcoming;
  const days = (v: string) => Math.round((new Date(v).getTime() - new Date(today).getTime()) / 864e5);
  const byMonth = shown.reduce<Record<string, typeof shown>>((acc, x) => { const k = new Date(x.on).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); (acc[k] ??= []).push(x); return acc; }, {});
  return (
    <Shell user={u} help={t('Dates from your projects, renewals, tenders closing on your molecules and calls with us, in one list. Add your own dates for anything else.')} title={t('Calendar')} sub={t('Renewals, tenders closing, task due dates, launches and your own dates, in one list')}
      actions={<a className="btn btn-ghost btn-sm" href="/m/calendar/ics">{t('Subscribe (.ics)')}</a>}>
      <Flash sp={sp} />
      <div className="row" style={{ gap: 6 }}>
        <Link className={`pill ${!sp.past ? 'solid' : ''}`} href="/m/calendar">{t('Upcoming')} · {upcoming.length}</Link>
        <Link className={`pill ${sp.past ? 'solid' : ''}`} href="/m/calendar?past=1">{t('Past')} · {past.length}</Link>
      </div>
      <div className="split">
        <section className="card stack">
          {shown.length === 0 ? <Empty action={sp.past ? undefined : { href: '/m/projects', label: t('Start a project') }}>{sp.past ? t('Nothing in the past.') : t('Nothing coming up. Dates arrive from your projects, renewals, tenders on your molecules and the entries you add here.')}</Empty>
            : Object.entries(byMonth).map(([month, xs]) => (
              <div key={month} className="stack" style={{ gap: 4 }}><span className="lbl">{month}</span>
                {xs.map((x) => { const k = KINDS[x.kind] ?? [x.kind, '']; const dd = days(x.on); return (
                  <div key={x.id} className="between" style={{ gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                    <span style={{ minWidth: 0 }}><span className={`pill ${k[1]}`} style={{ fontSize: 11, marginRight: 8 }}>{t(k[0])}</span>
                      <Link href={x.href}>{x.title}</Link>{x.country && <span className="sub2"> · {t(countryName(x.country))}</span>}</span>
                    <span className="small num" style={{ whiteSpace: 'nowrap' }} title={fmtDate(x.on)}>{fmtDate(x.on)}{!sp.past && <span className={`sub2 ${dd <= 7 ? 'peach' : ''}`}> · {dd === 0 ? t('today') : dd === 1 ? t('tomorrow') : t('in {n} days', { n: dd })}</span>}
                      {String(x.id).startsWith('ce') && <form action={removeCalendarEntry} style={{ display: 'inline' }}><input type="hidden" name="id" value={String(x.id).slice(2)} /><button className="btn-link x" type="submit" aria-label={t('Remove')} style={{ marginLeft: 6 }}>×</button></form>}</span>
                  </div>); })}
              </div>))}
        </section>
        <div className="stack">
          <section className="card stack">
            <h2>{t('Add a date')}</h2>
            <form action={addCalendarEntry} className="stack" style={{ gap: 8 }}>
              <input className="input" name="title" placeholder={t('What happens')} aria-label={t('Title')} maxLength={120} required />
              <div className="row">
                <input className="input" name="on_date" type="date" aria-label={t('Date')} required style={{ flex: '1 1 140px' }} />
                <select className="input" name="kind" aria-label={t('Kind')} style={{ flex: '1 1 140px' }}>
                  {['own', 'gmp_expiry', 'registration_expiry', 'meeting'].map((k) => <option key={k} value={k}>{t(KINDS[k][0])}</option>)}</select>
              </div>
              <div className="row">
                <select className="input" name="country" aria-label={t('Market')} style={{ flex: '1 1 140px' }}><option value="">{t('Any market')}</option>{d.targets.map((c) => <option key={c} value={c}>{t(countryName(c))}</option>)}</select>
                <select className="input" name="project_id" aria-label={t('Project')} style={{ flex: '1 1 160px' }}><option value="">{t('No project')}</option>{d.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
              </div>
              <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }}>{t('Add')}</button>
            </form>
            <p className="note">{t('A week before each date, a reminder lands in your inbox and, if turned on, by email. GMP and registration expiries are the ones that hurt when missed.')}</p>
          </section>
        </div>
      </div>
    </Shell>
  );
}
