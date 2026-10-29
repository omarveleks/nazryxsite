import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import { Flash } from '@/components/ui';
import { loadThread, ThreadView } from '@/components/Threads';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { withUser } from '@/lib/db';

export default async function DistThread({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const d = await withUser(u.id, (db) => loadThread(db, id));
  if (!d.head) notFound();
  return (
    <Shell user={u} title={d.head.subject} crumb={<Link href="/d/threads">{t('Messages')}</Link>}
      actions={d.head.need_id ? <Link className="btn btn-ghost btn-sm" href={`/d/needs/${d.head.need_id}`}>{t('The need')}</Link> : null}>
      <Flash sp={sp} />
      <ThreadView head={d.head} msgs={d.msgs} />
    </Shell>
  );
}
