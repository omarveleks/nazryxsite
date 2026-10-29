import Link from 'next/link';
import Shell from '@/components/Shell';
import { Empty, Flash } from '@/components/ui';
import { postNeed } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, rows, withUser } from '@/lib/db';
import { ago, fmtDate } from '@/lib/format';
import { DOSAGE_FORMS, MFR_COUNTRIES, countryName } from '@/lib/mfr';

export const metadata = { title: 'My needs' };

// The needs a distributor posted, and the form for a new one. A need is a request for quotation in plain words:
// the molecule, the form, the quantity, the price you have in mind and when you need it.
export default async function Needs({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, async (db) => ({
    p: await one(db, 'select markets, country from distributor_profiles where user_id = $1', [u.id]),
    list: await rows(db, `select n.*, coalesce(m.inn, n.molecule_text) as name, (select count(*)::int from leads l where l.need_id = n.id) as leads
        from needs n left join molecules m on m.id = n.molecule_id where n.user_id = $1 order by n.created_at desc limit 200`, [u.id]),
  }));
  const markets: string[] = d.p?.markets?.length ? d.p.markets : MFR_COUNTRIES.map((c) => c.code);
  return (
    <Shell user={u} title={t('My needs')} sub={t('What you are looking for. Manufacturers who can supply it raise a hand.')}>
      <Flash sp={sp} />
      {sp.welcome && <div className="ok" role="status">{t('Welcome. Post your first need below; it takes a minute. Manufacturers see your company and markets, never your email.')}</div>}
      <div className="split">
        <section className="card stack">
          {d.list.length === 0 ? <Empty>{t('No need yet.')}</Empty> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>{t('Product')}</th><th>{t('Market')}</th><th className="hide-m">{t('Quantity')}</th><th className="hide-m">{t('Needed by')}</th><th>{t('Status')}</th><th className="r">{t('Hands up')}</th></tr></thead>
              <tbody>{d.list.map((n) => (
                <tr key={n.id}><td><Link href={`/d/needs/${n.id}`}><b>{n.name}</b></Link>{n.dosage_form && <span className="sub2" style={{ display: 'block' }}>{n.dosage_form}</span>}</td>
                  <td>{t(countryName(n.country))}</td><td className="hide-m small">{n.quantity ?? ''}</td><td className="hide-m small">{n.deliver_by ? fmtDate(n.deliver_by) : ''}</td>
                  <td><span className={`pill ${n.status === 'open' ? 'mint' : n.status === 'matched' ? 'blue' : ''}`}>{t(n.status)}</span></td>
                  <td className="r num">{n.leads}</td></tr>))}</tbody></table></div>)}
        </section>
        <section className="card stack" id="new">
          <h2>{t('Post a need')}</h2>
          <form action={postNeed} className="stack" style={{ gap: 8 }}>
            <div className="field"><label htmlFor="molecule_text">{t('Molecule or product')}</label>
              <input className="input" id="molecule_text" name="molecule_text" maxLength={200} required placeholder={t('e.g. Amoxicillin 500 mg')} /></div>
            <div className="grid g2">
              <div className="field"><label htmlFor="country">{t('Market')}</label>
                <select className="input" id="country" name="country" defaultValue={d.p?.country ?? markets[0]} required>{markets.map((c) => <option key={c} value={c}>{t(countryName(c))}</option>)}</select></div>
              <div className="field"><label htmlFor="dosage_form">{t('Form')}</label>
                <select className="input" id="dosage_form" name="dosage_form"><option value="">{t('Any')}</option>{DOSAGE_FORMS.map((f) => <option key={f} value={f}>{t(f)}</option>)}</select></div>
            </div>
            <div className="grid g2">
              <div className="field"><label htmlFor="quantity">{t('Quantity')}</label><input className="input" id="quantity" name="quantity" maxLength={120} placeholder={t('e.g. 200,000 tablets a quarter')} /></div>
              <div className="field"><label htmlFor="target_price">{t('Price you have in mind')}</label><input className="input" id="target_price" name="target_price" maxLength={120} placeholder={t('optional')} /></div>
            </div>
            <div className="field"><label htmlFor="deliver_by">{t('Needed by')}</label><input className="input" id="deliver_by" name="deliver_by" type="date" /></div>
            <div className="field"><label htmlFor="note">{t('Anything else')}</label><textarea className="input" id="note" name="note" rows={3} maxLength={2000} placeholder={t('Registration status, packaging, certificates you need')} /></div>
            <div className="between"><span className="note">{t('Free. The Nazryx team sees every need and brings the right manufacturers in.')}</span><button className="btn btn-blue btn-sm" type="submit">{t('Post')}</button></div>
          </form>
        </section>
      </div>
    </Shell>
  );
}
