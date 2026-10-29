import Link from 'next/link';
import Shell from '@/components/Shell';
import { VerifiedIcon } from '@/components/Icons';
import { Empty } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { rows, withUser } from '@/lib/db';
import { MFR_COUNTRIES, countryName } from '@/lib/mfr';

export const metadata = { title: 'Manufacturers' };

// Manufacturers with a public page, audited and verified ones first; filter by the market they are registered in.
export default async function Makers({ searchParams }: { searchParams: Promise<{ market?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const all = await withUser(u.id, (db) => rows(db, 'select * from public_profiles()'));
  const market = MFR_COUNTRIES.some((c) => c.code === sp.market) ? sp.market! : null;
  const list = market ? all.filter((p) => (p.markets ?? []).includes(market)) : all;
  return (
    <Shell user={u} title={t('Manufacturers')} sub={t('Who makes what, where they are registered, and how far Nazryx has checked them')}>
      <div className="row" style={{ gap: 6 }}>
        <Link className={`pill ${!market ? 'solid' : ''}`} href="/d/makers">{t('All markets')}</Link>
        {MFR_COUNTRIES.filter((c) => all.some((p) => (p.markets ?? []).includes(c.code))).map((c) => <Link key={c.code} className={`pill ${market === c.code ? 'solid' : ''}`} href={`/d/makers?market=${c.code}`}>{t(c.name)}</Link>)}
      </div>
      {list.length === 0 ? <section className="card"><Empty>{t('No public manufacturer page yet for this market. Post a need instead; manufacturers answer there.')}</Empty></section> : (
        <div className="grid g3">{list.map((p) => (
          <Link key={p.slug} href={`/d/makers/${p.slug}`} className="rcard stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
            <div className="row" style={{ gap: 6 }}><b>{p.company_name}</b>
              {p.audited ? <span className="pill lav" style={{ fontSize: 11 }}>{t('Audited')}</span> : p.verified ? <span className="pill blue" style={{ fontSize: 11 }}><VerifiedIcon /> {t('Verified')}</span> : null}</div>
            <span className="sub2">{p.hq_country ? t(countryName(p.hq_country)) || p.hq_country : ''}</span>
            <span className="small">{p.registrations ? t('{n} registrations', { n: p.registrations }) : t('No registration read yet')}{(p.markets ?? []).length ? ` · ${(p.markets as string[]).map((c) => t(countryName(c))).join(', ')}` : ''}</span>
            {(p.forms ?? []).length > 0 && <span className="sub2">{(p.forms as string[]).slice(0, 4).map((f) => t(f)).join(' · ')}</span>}
          </Link>))}</div>)}
      <p className="note">{t('Verified: company, licence and GMP certificate checked by Nazryx. Audited: Nazryx or a partner has been to the plant.')}</p>
    </Shell>
  );
}
