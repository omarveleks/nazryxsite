import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { pool, withUser, one } from './db';

export const SESSION_COOKIE = 'nzx_session';
const SESSION_DAYS = 30;

export type User = {
  id: string; email: string; name: string; role: 'customer' | 'team'; plan: 'free' | 'paid';
  country: string; company_id: number | null; credits: number; onboarded: boolean; owner_id: string | null;
  language: string; whatsapp: string | null; notify_email: boolean; notify_whatsapp: boolean;
  company_name: string | null; claim_status: string | null;
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await pool.query('select auth_create_session($1, $2, $3)', [sha(token), userId, expires]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', expires,
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await pool.query('select auth_delete_session($1)', [sha(token)]);
  jar.delete(SESSION_COOKIE);
}

export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const r = await pool.query('select auth_session_user($1) as id', [sha(token)]);
  const id: string | null = r.rows[0]?.id ?? null;
  if (!id) return null;
  return withUser(id, (db) => one<User>(db, `
    select u.id, u.email, u.name, u.role, app_plan() as plan, u.country, u.company_id, u.credits, u.onboarded,
           u.owner_id, u.language, u.whatsapp, u.notify_email, u.notify_whatsapp,
           coalesce(c.display_name, cl.company_name) as company_name, cl.status as claim_status
    from users u
    left join companies c on c.id = u.company_id
    left join lateral (select * from company_claims k where k.user_id = coalesce(u.owner_id, u.id)
                       order by k.created_at desc limit 1) cl on true
    where u.id = $1`, [id]));
});

export async function requireUser(opts: { allowOnboarding?: boolean } = {}): Promise<User> {
  const u = await getUser();
  if (!u) redirect('/signup?mode=signin');
  if (!u.onboarded && !opts.allowOnboarding && u.role !== 'team') redirect('/onboarding');
  return u;
}

/** Team-only pages answer 404 to everyone else, so customers cannot tell they exist. */
export async function requireTeam(): Promise<User> {
  const u = await getUser();
  if (!u || u.role !== 'team') notFound();
  return u;
}
