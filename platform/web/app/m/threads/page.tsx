import Link from 'next/link';
import Shell from '@/components/Shell';
import { loadThreads, ThreadList } from '@/components/Threads';
import { requireUser } from '@/lib/auth';
import { langOf, setLang } from '@/lib/i18n';
import { withUser } from '@/lib/db';

export const metadata = { title: 'Messages' };

// Conversations with distributors: from a hand raised on the board, or a distributor who wrote to your public page.
// The team sees every conversation on the platform here.
export default async function MfrThreads() {
  const u = await requireUser({ manufacturer: true });
  const t = setLang(langOf(u));
  const list = await withUser(u.id, loadThreads);
  return (
    <Shell user={u} title={t('Messages')} sub={u.role === 'team' ? t('Every conversation on the platform. Step in where it helps.') : t('Your conversations with distributors. Nazryx reads along and steps in when it helps.')}
      actions={<Link className="btn btn-ghost btn-sm" href="/m/rfq">{t('Requests')}</Link>}>
      <ThreadList list={list} base="/m/threads" />
    </Shell>
  );
}
