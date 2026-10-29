import Shell from '@/components/Shell';
import { loadThreads, ThreadList } from '@/components/Threads';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { withUser } from '@/lib/db';

export const metadata = { title: 'Messages' };

export default async function DistThreads() {
  const u = await requireUser({ distributor: true });
  const t = setLang(langOf(u));
  const list = await withUser(u.id, loadThreads);
  return (
    <Shell user={u} title={t('Messages')} sub={t('Your conversations with manufacturers. Nazryx reads along and steps in when it helps.')}>
      <ThreadList list={list} base="/d/threads" />
    </Shell>
  );
}
