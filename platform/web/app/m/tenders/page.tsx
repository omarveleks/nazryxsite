import Link from 'next/link';
import Shell from '@/components/Shell';
import MarketPicker, { AgencyMarket, hasData, loadLive, pickMarket, targetMarkets } from '@/components/MarketPicker';
import { Empty, PlanLock } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { canUse, countryName, tierIn } from '@/lib/mfr';
import { bidScore, suggestBid, type Stats } from '@/lib/tenders';

export const metadata = { title: 'Tenders' };

const SHOW: [string, string][] = [['desk', 'Tender desk'], ['mine', 'Your molecules'], ['open', 'Open now'], ['all', 'All medicine tenders']];

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
    const show = SHOW.some(([k]) => k === sp.show) ? sp.show! : counts?.mine ? 'desk' : 'all';
    const where = show === 'mine' ? `and ${mine}` : show === 'open' ? "and t.stage = 'open'" : show === 'desk' ? `and t.stage = 'open' and ${mine}` : '';
    const list = await rows(db, `select t.id, coalesce(t.title_en, t.title) as title, coalesce(t.buyer_en, t.buyer) as buyer, t.stage, coalesce(t.awarded, t.closing, t.published) as at, t.quantity, t.unit_price,
        t.value, t.currency, t.bidders, ${mine} as mine from tenders t where t.country = $1 ${where}
        order by (t.stage = 'open') desc, coalesce(t.awarded, t.closing, t.published) desc nulls last limit 100`, [market, u.id]);
    // the desk: every open tender on your molecules with what past awards say about it
    const desk = show === 'desk' ? await Promise.all(list.map(async (x) => ({ ...x, s: (await one(db, 'select * from tender_stats($1)', [x.id])) as Stats | null }))) : [];
    return { targets, market, counts, show, list, desk };
  });
  const m = d.market;
  const full = canUse(tierIn(u, m), 'market');
  return (
    <Shell user={u} help={t('Public tenders on your molecules in your markets, closing dates first. Open one for the buyer, quantities and past prices. Watch a keyword in the inbox to widen the net.')} title={t('Tenders')} sub={`Public medicine tenders in ${countryName(m)}, collected daily from the official portals`}
      actions={full && hasData(m) ? <a className="btn btn-ghost btn-sm" href={`/m/export?what=tenders&market=${m}`}>{t('Excel (CSV)')}</a> : undefined}>
      <MarketPicker u={u} targets={d.targets} current={m} path="/m/tenders" />
      {!hasData(m) ? <AgencyMarket code={m} /> : (<>
        <div className="row" style={{ gap: 6 }} aria-label={t('Show')}>
          {SHOW.map(([k, l]) => <Link key={k} className={`pill ${d.show === k ? 'solid' : ''}`} href={`/m/tenders?market=${m}&show=${k}`}>
            {t(l)}{k === 'desk' ? '' : ` · ${d.counts?.[k] ?? 0}`}</Link>)}
        </div>
        {!full ? (<>
          <section className="card">
            {d.list.slice(0, 10).map((x, i) => (
              <div key={x.id} className="between small" style={{ borderTop: i ? '1px solid var(--line)' : undefined, padding: '10px 0', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 0, flex: '1 1 260px' }}><b>{x.title}</b>{x.mine && <span className="pill blue" style={{ marginLeft: 6 }}>{t('Your molecule')}</span>}
                  <div className="sub2">{x.at ? fmtDate(x.at) : ''}</div></span>
                <span className={`pill ${x.stage === 'open' ? 'mint' : ''}`}>{x.stage === 'open' ? t('Open') : x.stage === 'awarded' ? t('Awarded') : t('Closed')}</span>
              </div>))}
          </section>
          <PlanLock need="data" title={t('Buyer, quantity, price and result')} u={u} market={m}>
            {t('{n} medicine tenders in {market}, {mine} for your molecules: who buys, how much, at what price, who won, with a link to each notice.', { n: d.counts?.all ?? 0, market: t(countryName(m)), mine: d.counts?.mine ?? 0 })}
          </PlanLock>
        </>) : d.show === 'desk' ? (
          <section className="card stack">
            <div className="card-h"><div><h2>{t('Open tenders on your molecules, closing first')}</h2><p className="note">{t('Bid, consider or pass: past awards on the same molecules, how often the buyer awards, how crowded the field is. Open one for the documents and a price suggestion.')}</p></div></div>
            {d.desk.length === 0 ? <Empty>{t('No open tender on your molecules in {market} right now. New ones arrive daily; watch a keyword in the inbox to widen the net.', { market: t(countryName(m)) })}</Empty>
              : [...d.desk].sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime()).map((x, i) => { const sc = bidScore(x.s, null, true, true); const bid = suggestBid(x.s); return (
                <Link key={x.id} href={`/m/tenders/${x.id}`} className="between" style={{ borderTop: i ? '1px solid var(--line)' : undefined, padding: '10px 0', gap: 12, flexWrap: 'wrap', textDecoration: 'none', color: 'inherit', alignItems: 'flex-start' }}>
                  <span style={{ minWidth: 0, flex: '1 1 300px' }}><b>{x.title}</b><div className="sub2">{x.buyer ?? ''}{x.at ? ` · ${t('closes')} ${fmtDate(x.at)}` : ''}{x.quantity ? ` · ${fmtMoney(x.quantity)} ${t('units')}` : ''}</div>
                    <div className="sub2">{sc.reasons.slice(0, 2).join(' ')}</div></span>
                  <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span className={`pill ${sc.verdict === 'bid' ? 'mint' : sc.verdict === 'consider' ? 'blue' : ''}`}>{t({ bid: 'Bid', consider: 'Consider', pass: 'Pass', closed: 'Closed' }[sc.verdict] ?? sc.verdict)}</span>
                    {bid && <span className="small num">{t('suggest')} {bid.currency} {bid.price.toFixed(2)}/{t('unit')}</span>}
                  </span>
                </Link>); })}
          </section>
        ) : d.list.length === 0 ? <Empty action={{ href: '/m/inbox#watches', label: t('Watch a keyword') }}>{t('No tenders here yet. New ones arrive every day.')}</Empty> : (
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
