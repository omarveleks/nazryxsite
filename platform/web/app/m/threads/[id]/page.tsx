import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { loadThread, ThreadView } from '@/components/Threads';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { withUser } from '@/lib/db';

export default async function MfrThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, (db) => loadThread(db, id));
  if (!d.head) notFound();
  return (
    <Shell user={u} title={d.head.subject} crumb={<Link href="/m/threads">{t('Messages')}</Link>}
      actions={d.head.need_id ? <Link className="btn btn-ghost btn-sm" href={`/m/rfq#need-${d.head.need_id}`}>{t('The request')}</Link> : null}>
      <Flash sp={sp} />
      {sp.saved && <div className="ok" role="status">{t('Sent. The distributor sees your message and your company name; the Nazryx team reads along.')}</div>}
      <ThreadView head={d.head} msgs={d.msgs} canWrite={u.seat_role !== 'viewer'} />
    </Shell>
  );
}
