import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { VerifiedIcon } from '@/components/Icons';
import { Flash } from '@/components/ui';
import { contactMaker } from '@/app/actions/market';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { one, withUser } from '@/lib/db';
import { countryName } from '@/lib/mfr';

// A manufacturer as a distributor sees it: the public page, plus a message box that opens a conversation.
export default async function Maker({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const slug = (await params).slug.toLowerCase().slice(0, 80);
  const sp = await searchParams;
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const p = await withUser(u.id, (db) => one(db, 'select * from public_profile($1)', [slug]));
  if (!p) notFound();
  const classes = (p.classes ?? []) as { category: string; n: number }[];
  return (
    <Shell user={u} title={<>{p.company_name} {p.audited ? <span className="pill lav" style={{ fontSize: 12, verticalAlign: 'middle' }}>{t('Audited')}</span> : p.verified ? <span className="pill blue" style={{ fontSize: 12, verticalAlign: 'middle' }}><VerifiedIcon /> {t('Verified')}</span> : null}</>}
      sub={p.hq_country ? t(countryName(p.hq_country)) || p.hq_country : ''} crumb={<Link href="/d/makers">{t('Manufacturers')}</Link>}>
      <Flash sp={sp} />
      <div className="split">
        <div className="stack">
          <section className="card stack">
            <h2>{t('What they make')}</h2>
            <dl className="facts">
              <dt>{t('Registrations')}</dt><dd>{p.registrations} {(p.markets ?? []).length ? `· ${(p.markets as string[]).map((c) => t(countryName(c))).join(', ')}` : ''}</dd>
              <dt>{t('Molecules')}</dt><dd>{p.molecules}</dd>
              {(p.dosage_forms ?? []).length > 0 && <><dt>{t('Forms')}</dt><dd>{(p.dosage_forms as string[]).map((f) => t(f)).join(', ')}</dd></>}
              {(p.certifications ?? []).length > 0 && <><dt>{t('Certifications')}</dt><dd>{(p.certifications as string[]).join(', ')}</dd></>}
              {p.website && <><dt>{t('Website')}</dt><dd><a href={p.website} rel="noopener nofollow" target="_blank">{String(p.website).replace(/^https?:\/\//, '')}</a></dd></>}
            </dl>
            {classes.length > 0 && <div className="row" style={{ gap: 6 }}>{classes.slice(0, 10).map((c) => <span key={c.category} className="pill">{t(c.category)} · {c.n}</span>)}</div>}
          </section>
        </div>
        <section className="card stack">
          <h2>{t('Write to them')}</h2>
          <form action={contactMaker} className="stack" style={{ gap: 6 }}>
            <input type="hidden" name="slug" value={slug} />
            <textarea className="input" name="body" rows={4} maxLength={2000} required placeholder={t('What you are looking for, the quantity and the market. They see your company name and markets.')} aria-label={t('Message')} />
            <div className="between"><span className="note">{t('Nazryx reads along and helps both sides.')}</span><button className="btn btn-blue btn-sm" type="submit">{t('Send')}</button></div>
          </form>
        </section>
      </div>
    </Shell>
  );
}
