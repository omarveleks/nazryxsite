import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';

// The portal is the manufacturer side (the distributor side is paused: see distributor/README.md).
export default async function Index() {
  const u = await getUser();
  redirect(!u ? '/signup' : u.role === 'team' || u.account_type === 'manufacturer' ? '/m' : '/help?paused=1');
}
