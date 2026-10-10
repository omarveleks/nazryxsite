import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';

export default async function Index() {
  redirect((await getUser()) ? '/home' : '/signup');
}
