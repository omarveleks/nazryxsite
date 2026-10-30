import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash, Tabs } from '@/components/ui';
import { createProject } from '@/app/actions/projects';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { countryName } from '@/lib/mfr';
import { targetMarkets } from '@/components/MarketPicker';
import { one } from '@/lib/db';
import { PROJECT_STAGES, STAGE_TONE, readiness, stageLabel } from '@/lib/projects';

export const metadata = { title: 'Projects' };

// Every market entry project on a board by stage, or as a list. One project per product and market; the work lives inside.
export default async function Projects({ searchParams }: { searchParams: Promise<{ view?: string; saved?: string; error?: string; market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const list = await rows(db, `select pr.id, pr.country, pr.stage, pr.target_date, pr.updated_at, pr.owner_id, coalesce(m.inn, p.name) as name, p.id as product_id,
        (select count(*)::int from project_tasks k where k.project_id = pr.id) as tasks,
        (select count(*)::int from project_tasks k where k.project_id = pr.id and k.done_at is not null) as done,
        (select min(k.due_date) from project_tasks k where k.project_id = pr.id and k.done_at is null and k.due_date is not null) as next_due,
        (select count(*)::int from engagements e where e.project_id = pr.id and e.status = 'open') as services,
        o.name as owner
        from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id left join users o on o.id = pr.owner_id
        where pr.user_id = $1 order by pr.updated_at desc`, [u.owner_id ?? u.id]);
    const products = await rows(db, `select p.id, coalesce(m.inn, p.name) as name from mfr_products p left join molecules m on m.id = p.molecule_id where p.user_id = $1 order by 2 limit 300`, [u.owner_id ?? u.id]);
    return { targets, list, products };
  });
  const view = sp.view === 'list' ? 'list' : 'board';
  const shown = sp.market && d.targets.includes(sp.market) ? d.list.filter((p) => p.country === sp.market) : d.list;
  const Card = ({ p }: { p: any }) => (
    <Link href={`/m/projects/${p.id}`} className="rcard stack" style={{ gap: 4, textDecoration: 'none', color: 'inherit' }}>
      <b>{p.name}</b>
      <span className="sub2">{t(countryName(p.country))}{p.owner ? ` · ${p.owner}` : ''}</span>
      <div className="meter" title={`${p.done} of ${p.tasks} tasks done`}><i style={{ width: `${Math.round(readiness(p.stage, Array.from({ length: p.tasks }, (_, i) => ({ done_at: i < p.done ? 'x' : null }))) * 100)}%` }} /></div>
      <span className="sub2">{p.tasks ? `${p.done}/${p.tasks} ${t('tasks')}` : t('no tasks yet')}{p.next_due ? ` · ${t('next')} ${fmtDate(p.next_due)}` : ''}{p.services ? ` · ${p.services} ${t('with Nazryx')}` : ''}</span>
    </Link>);
  return (
    <Shell user={u} title={t('Projects')} sub={t('One project per product and market, from assessment to the shelf')}
      actions={<><Link className="btn btn-ghost btn-sm" href="/m/activity">{t('Activity')}</Link><Link className="btn btn-ghost btn-sm" href="/m/calendar">{t('Calendar')}</Link></>}>
      <Flash sp={sp} />
      <div className="between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <Tabs current={view} items={[{ key: 'board', label: t('Board'), href: '/m/projects' }, { key: 'list', label: t('List'), href: '/m/projects?view=list' }]} />
        <form action={createProject} className="row inline-form">
          <select className="input" name="product_id" aria-label={t('Product')} style={{ minHeight: 38, fontSize: 13.5 }} required>
            <option value="">{t('Start a project: product')}</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <select className="input" name="country" aria-label={t('Market')} style={{ minHeight: 38, fontSize: 13.5 }}>
            {d.targets.map((c) => <option key={c} value={c}>{t(countryName(c))}</option>)}</select>
          <button className="btn btn-blue btn-sm" type="submit">{t('Start')}</button>
        </form>
      </div>
      {d.targets.length > 1 && <div className="row" style={{ gap: 6 }}>
        <Link className={`pill ${!sp.market ? 'solid' : ''}`} href={`/m/projects${view === 'list' ? '?view=list' : ''}`}>{t('All markets')}</Link>
        {d.targets.map((c) => <Link key={c} className={`pill ${sp.market === c ? 'solid' : ''}`} href={`/m/projects?${view === 'list' ? 'view=list&' : ''}market=${c}`}>{t(countryName(c))} · {d.list.filter((p) => p.country === c).length}</Link>)}
      </div>}
      {d.list.length === 0 ? (
        <section className="card"><Empty>{t('No project yet. Pick a product and a market above, or press “Start a project” on any product page. We add the usual tasks for each stage; you tick them off, and ask us when you want a stage done for you.')}</Empty></section>
      ) : view === 'board' ? (
        <div className="board">{PROJECT_STAGES.map(([k, label]) => (
          <div key={k} className="col"><div className="between small"><b>{t(label)}</b><span className="muted num">{shown.filter((p) => p.stage === k).length}</span></div>
            {shown.filter((p) => p.stage === k).map((p) => <Card key={p.id} p={p} />)}</div>))}</div>
      ) : (
        <section className="card">
          <div className="tbl-wrap" tabIndex={0}><table className="tbl">
            <thead><tr><th>{t('Product')}</th><th>{t('Market')}</th><th>{t('Stage')}</th><th className="hide-m">{t('Tasks')}</th><th className="hide-m">{t('Next due')}</th><th className="hide-m">{t('Owner')}</th><th className="r">{t('Updated')}</th></tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.id}><td><Link href={`/m/projects/${p.id}`}><b>{p.name}</b></Link></td><td>{t(countryName(p.country))}</td>
                <td><span className={`pill ${STAGE_TONE[p.stage] ?? ''}`}>{t(stageLabel(p.stage))}</span></td>
                <td className="hide-m num">{p.done}/{p.tasks}</td><td className="hide-m small">{p.next_due ? fmtDate(p.next_due) : ''}</td><td className="hide-m small">{p.owner ?? ''}</td>
                <td className="r small muted">{ago(p.updated_at)}</td></tr>))}
              {shown.some((p) => p.stage === 'parked') ? null : null}
            </tbody></table></div>
        </section>)}
      {shown.some((p) => p.stage === 'parked') && view === 'board' && (
        <section className="card stack"><h2>{t('Parked')}</h2><div className="row">{shown.filter((p) => p.stage === 'parked').map((p) => <Link key={p.id} className="pill" href={`/m/projects/${p.id}`}>{p.name} · {t(countryName(p.country))}</Link>)}</div></section>)}
    </Shell>
  );
}
