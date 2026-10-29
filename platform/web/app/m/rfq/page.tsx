import Link from 'next/link';
import Shell from '@/components/Shell';
import { VerifiedIcon } from '@/components/Icons';
import { Empty, Flash } from '@/components/ui';
import { raiseHand } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';
import { targetMarkets } from '@/components/MarketPicker';

export const metadata = { title: 'Requests' };

// The request board: what distributors on Nazryx are looking for, and open tenders read as requests, on your markets.
// Needs on your own molecules come first. Raise a hand and a conversation opens with the distributor.
export default async function Rfq({ searchParams }: { searchParams: Promise<{ market?: string; mine?: string; error?: string; saved?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => {
    const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
    const targets = targetMarkets(prof?.target_countries, u.mfr_markets);
    const mols = new Set((await rows(db, 'select distinct molecule_id from mfr_products where user_id = $1 and molecule_id is not null', [u.owner_id ?? u.id])).map((r) => r.molecule_id as number));
    const board = await rows(db, 'select * from rfq_board($1)', [u.role === 'team' ? null : targets.length ? targets : null]);
    return { targets, mols, board };
  });
  const market = MFR_COUNTRIES.some((c) => c.code === sp.market) ? sp.market! : null;
  let list = market ? d.board.filter((n) => n.country === market) : d.board;
  if (sp.mine) list = list.filter((n) => n.molecule_id && d.mols.has(n.molecule_id));
  list = [...list].sort((a, b) => Number(Boolean(b.molecule_id && d.mols.has(b.molecule_id))) - Number(Boolean(a.molecule_id && d.mols.has(a.molecule_id))));
  const here = `/m/rfq${market ? `?market=${market}` : ''}`;
  return (
    <Shell user={u} title={t('Requests')} sub={t('What distributors are looking for on your markets, and open tenders read as requests')}
      actions={<Link className="btn btn-ghost btn-sm" href="/m/threads">{t('Messages')}</Link>}>
      <Flash sp={sp} />
      <div className="row" style={{ gap: 6 }}>
        <Link className={`pill ${!market && !sp.mine ? 'solid' : ''}`} href="/m/rfq">{t('All')} · {d.board.length}</Link>
        <Link className={`pill ${sp.mine ? 'solid' : ''}`} href="/m/rfq?mine=1">{t('On my molecules')} · {d.board.filter((n) => n.molecule_id && d.mols.has(n.molecule_id)).length}</Link>
        {MFR_COUNTRIES.filter((c) => d.board.some((n) => n.country === c.code)).map((c) => <Link key={c.code} className={`pill ${market === c.code ? 'solid' : ''}`} href={`/m/rfq?market=${c.code}`}>{t(c.name)} · {d.board.filter((n) => n.country === c.code).length}</Link>)}
      </div>
      {list.length === 0 ? <section className="card"><Empty>{t('Nothing open here right now. Needs posted by distributors and tenders still open show up as they come in; watch your molecules to hear first.')}</Empty></section> : (
        <div className="grid g2">{list.map((n) => {
          const mine = Boolean(n.molecule_id && d.mols.has(n.molecule_id));
          return (
            <section key={n.id} id={`need-${n.id}`} className="card stack" style={{ gap: 8 }}>
              <div className="between" style={{ alignItems: 'flex-start' }}>
                <div><div className="row" style={{ gap: 6 }}><b>{n.molecule ?? t('Request')}</b>{mine && <span className="pill mint" style={{ fontSize: 11 }}>{t('Your molecule')}</span>}
                  {n.source === 'tender' ? <span className="pill lav" style={{ fontSize: 11 }}>{t('Tender')}</span> : n.verified ? <span className="pill blue" style={{ fontSize: 11 }}><VerifiedIcon /> {t('Verified distributor')}</span> : <span className="pill" style={{ fontSize: 11 }}>{t('Distributor')}</span>}</div>
                  <span className="sub2">{t(countryName(n.country))}{n.dosage_form ? ` · ${n.dosage_form}` : ''} · {ago(n.created_at)}</span></div>
                <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{n.leads ? t('{n} hands up', { n: n.leads }) : ''}</span>
              </div>
              <dl className="facts small">
                {n.quantity && <><dt>{t('Quantity')}</dt><dd>{n.quantity}</dd></>}
                {n.target_price && <><dt>{t('Price in mind')}</dt><dd>{n.target_price}</dd></>}
                {n.deliver_by && <><dt>{n.source === 'tender' ? t('Closes') : t('Needed by')}</dt><dd>{fmtDate(n.deliver_by)}</dd></>}
              </dl>
              {n.note && <p className="small muted" style={{ margin: 0 }}>{String(n.note).slice(0, 240)}</p>}
              {n.source === 'tender' ? (
                <div className="row" style={{ gap: 8 }}><Link className="btn btn-ghost btn-sm" href={`/m/tenders/${n.tender_id}`}>{t('Open the tender')}</Link>
                  {n.molecule_id && <Link className="btn-link small" href={`/m/molecules/${n.molecule_id}?market=${n.country}`}>{t('The molecule in {market}', { market: t(countryName(n.country)) })}</Link>}</div>
              ) : n.thread_id ? (
                <Link className="btn btn-ghost btn-sm" href={`/m/threads/${n.thread_id}`} style={{ alignSelf: 'flex-start' }}>{t('Open the conversation')}</Link>
              ) : (
                <form action={raiseHand} className="stack" style={{ gap: 6 }}>
                  <input type="hidden" name="need_id" value={n.id} /><input type="hidden" name="return" value={here} />
                  <textarea className="input" name="body" rows={2} maxLength={2000} required placeholder={t('What you can supply: product, strength, pack, registration status, lead time.')} aria-label={t('Your answer')} disabled={u.seat_role === 'viewer'} />
                  <button className="btn btn-blue btn-sm" type="submit" style={{ alignSelf: 'flex-start' }} disabled={u.seat_role === 'viewer'}>{t('Raise a hand')}</button>
                </form>)}
            </section>);
        })}</div>)}
      <p className="note">{t('Distributors see your company name, not your email. Nazryx reads every conversation and steps in with samples, documents or a call when it helps.')}</p>
    </Shell>
  );
}
