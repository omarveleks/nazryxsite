import Link from 'next/link';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { bookService } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { countryName } from '@/lib/mfr';
import { PROJECT_STAGES, stageLabel } from '@/lib/projects';

export const metadata = { title: 'Marketplace' };

// The service marketplace: Nazryx and vetted partners, bookable at fixed prices, each attached to a project stage.
// Opened from a project, booking lands on that project.
export default async function Marketplace({ searchParams }: { searchParams: Promise<{ project?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const project = Number(sp.project) || 0;
  const d = await withUser(u.id, async (db) => ({
    services: await rows(db, 'select * from service_catalog where active order by sort'),
    pr: project ? await one(db, `select pr.id, pr.country, pr.stage, coalesce(m.inn, p.name) as name from projects pr join mfr_products p on p.id = pr.product_id left join molecules m on m.id = p.molecule_id where pr.id = $1`, [project]) : null,
    open: await rows(db, `select e.id, e.kind, e.detail, e.stage, e.project_id from engagements e where e.user_id = $1 and e.status = 'open' order by e.updated_at desc limit 20`, [u.owner_id ?? u.id]),
  }));
  const here = `/m/marketplace${project ? `?project=${project}` : ''}`;
  const price = (s: any) => s.price_usd ? `$${Number(s.price_usd).toLocaleString('en')}` : t('Quoted');
  return (
    <Shell user={u} title={t('Marketplace')} sub={d.pr ? t('Services for {name} in {market}, booked onto the project', { name: d.pr.name, market: t(countryName(d.pr.country)) }) : t('Nazryx and vetted partners, at fixed prices, one per stage of a market entry')}
      crumb={d.pr ? <Link href={`/m/projects/${d.pr.id}`}>{d.pr.name} · {t(countryName(d.pr.country))}</Link> : <Link href="/m/services">{t('Services')}</Link>}>
      <Flash sp={sp} />
      {PROJECT_STAGES.filter(([k]) => d.services.some((s) => s.stage === k)).map(([k, label]) => (
        <section key={k} className="stack" style={{ gap: 8 }}>
          <div className="card-h"><h2>{t(label)}</h2>{d.pr?.stage === k && <span className="pill solid" style={{ fontSize: 11 }}>{t('Current stage')}</span>}</div>
          <div className="grid g3">{d.services.filter((s) => s.stage === k).map((s) => {
            const booked = d.open.find((e) => e.kind === s.engagement_kind && (!project || e.project_id === project) && String(e.detail ?? '').startsWith(s.title));
            return (
              <section key={s.code} className="card stack" style={{ gap: 8 }}>
                <div className="between" style={{ alignItems: 'flex-start' }}><b>{t(s.title)}</b><span className="pill" style={{ fontSize: 11 }}>{s.provider === 'Nazryx' ? 'Nazryx' : t('Vetted partner')}</span></div>
                <p className="small muted" style={{ margin: 0, flex: 1 }}>{t(s.what)}</p>
                <div className="between"><span><b className="num">{price(s)}</b>{s.days ? <span className="sub2"> · {t('{n} days', { n: s.days })}</span> : ''}</span>
                  {booked ? <Link className="btn btn-ghost btn-sm" href={`/m/engagements/${booked.id}`}>{t('Booked')} · {booked.stage}</Link> : (
                    <form action={bookService}><input type="hidden" name="code" value={s.code} /><input type="hidden" name="project_id" value={project || ''} /><input type="hidden" name="return" value={here} />
                      <button className="btn btn-blue btn-sm" type="submit" disabled={u.seat_role === 'viewer'}>{s.price_usd ? t('Book') : t('Ask for a quote')}</button></form>)}</div>
              </section>);
          })}</div>
        </section>))}
      <p className="note">{t('A booking opens a job with the Nazryx team on your project; you follow it under Services. Fixed prices are per product and market; quoted ones depend on the dossier.')}</p>
    </Shell>
  );
}
