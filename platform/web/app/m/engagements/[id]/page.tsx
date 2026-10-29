import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { EngagementBody, loadEngagement } from '@/components/EngagementView';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { withUser } from '@/lib/db';
import { SERVICES, countryName } from '@/lib/mfr';

export const metadata = { title: 'Engagement' };

export default async function Engagement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; uploaded?: string; error?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  if (!Number.isInteger(id)) notFound();
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, (db) => loadEngagement(db, id));   // RLS: only the owner (or the team) gets it back
  if (!d) notFound();
  const { e } = d;
  return (
    <Shell user={u} title={SERVICES[e.kind].label} crumb={<><Link href="/m/services">{t('Services')}</Link> / #{id}</>}
      sub={[e.product, countryName(e.country)].filter(Boolean).join(' · ')}>
      <Flash sp={sp} />
      {sp.new && <div className="ok" role="status">{e.kind === 'report' ? 'Report ordered. It will be here within 24 hours.' : 'Request received. Our team will be in touch here and by email, usually within a working day.'}</div>}
      {sp.uploaded && <div className="ok" role="status">{t('Uploaded. Our team will review it.')}</div>}
      <EngagementBody e={e} files={d.files} messages={d.messages} obligations={d.obligations} />
    </Shell>
  );
}
