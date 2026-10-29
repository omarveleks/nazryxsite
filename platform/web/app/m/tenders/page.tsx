import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';

export const metadata = { title: 'Tenders' };

const SHOW: [string, string][] = [['mine', 'Your molecules'], ['open', 'Open now'], ['all', 'All medicine tenders']];

// Public medicine tenders in a market, collected daily from the official procurement portals. Each opens its own page.
export default async function Tenders({ searchParams }: { searchParams: Promise<{ market?: string; show?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    await loadLive(db);
    const p = await one(db, 'select target_countries, primary_market from manufacturer_profiles where user_id = $1', [u.id]);
    const targets = targetMarkets(p?.target_countries, u.mfr_markets);
    const market = pickMarket(sp.market, targets, p?.primary_market);
    const mine = `exists (select 1 from mfr_products p where p.user_id = $2 and p.molecule_id = any(t.molecule_ids))`;
    const counts = await one(db, `select count(*) filter (where ${mine})::int as mine, count(*) filter (where t.stage = 'open')::int as open,
        count(*)::int as all from tenders t where t.country = $1`, [market, u.id]);
    const show = SHOW.some(([k]) => k === sp.show) ? sp.show! : counts?.mine ? 'mine' : 'all';
    const where = show === 'mine' ? `and ${mine}` : show === 'open' ? "and t.stage = 'open'" : '';
    const list = await rows(db, `select t.id, coalesce(t.title_en, t.title) as title, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, coalesce(t.awarded, t.closing, t.published) as at, t.quantity, t.unit_price,
        t.value, t.currency, t.bidders, ${mine} as mine from tenders t where t.country = $1 ${where}
        order by (t.stage = 'open') desc, coalesce(t.awarded, t.closing, t.published) desc nulls last limit 100`, [market, u.id]);
    return { targets, market, counts, show, list };
  });
  const m = d.market;
  const full = canUse(tierIn(u, m), 'market');
  return (
    <Shell user={u} title={t('Tenders')} sub={`Public medicine tenders in ${countryName(m)}, collected daily from the official portals`}
      actions={full && hasData(m) ? <a className="btn btn-ghost btn-sm" href={`/m/export?what=tenders&market=${m}`}>{t('Excel (CSV)')}</a> : undefined}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/tenders" />
      {!hasData(m) ? <AgencyMarket code={m} /> : (<>
        <div className="row" style={{ gap: 6 }} aria-label={t('Show')}>
          {SHOW.map(([k, l]) => <Link key={k} className={`pill ${d.show === k ? 'solid' : ''}`} href={`/m/tenders?market=${m}&show=${k}`}>
            {l} · {d.counts?.[k] ?? 0}</Link>)}
        </div>
        {!full ? (
          <PlanLock need="data" title={`Tenders in ${countryName(m)}`} u={u} market={m}>
            {d.counts?.all ?? 0} medicine tenders, {d.counts?.mine ?? 0} for your molecules: buyer, quantity, price and result, with a link to each notice.
          </PlanLock>
        ) : d.list.length === 0 ? <Empty>{t('No tenders here yet. New ones arrive every day.')}</Empty> : (
          <section className="card">
            {d.list.map((x, i) => (
              <Link key={x.id} href={`/m/tenders/${x.id}`} className="between small"
                style={{ borderTop: i ? '1px solid var(--line)' : undefined, padding: '10px 0', gap: 12, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit' }}>
                <span style={{ minWidth: 0, flex: '1 1 260px' }}><b>{x.title}</b>{x.mine && <span className="pill blue" style={{ marginLeft: 6 }}>{t('Your molecule')}</span>}
                  <div className="sub2">{x.buyer ?? ''}{x.at ? ` · ${fmtDate(x.at)}` : ''}</div></span>
                <span className="r">{x.quantity ? `${fmtMoney(x.quantity)} units` : ''}{x.unit_price ? ` at ${x.currency ?? ''} ${fmtMoney(x.unit_price)}` : x.value ? `${x.currency ?? ''} ${fmtMoney(x.value)}` : ''}
                  <div><span className={`pill ${x.stage === 'open' ? 'mint' : ''}`}>{x.stage === 'open' ? 'Open' : x.stage === 'awarded' ? 'Awarded' : 'Closed'}</span> <span className="muted">{t('Open →')}</span></div></span>
              </Link>))}
          </section>)}
      </>)}
    </Shell>
  );
}
