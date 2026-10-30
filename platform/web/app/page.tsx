import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';

// Each side has its home: manufacturers at /m, distributors at /d.
export default async function Index() {
  const u = await getUser();
  redirect(!u ? '/signup' : u.role === 'team' || u.account_type === 'manufacturer' ? '/m' : '/help');
}
