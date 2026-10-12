import { teamCan, type TeamPermission } from './team';
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { pool, withUser, one } from './db';

export const SESSION_COOKIE = 'nzx_session';
export const CHALLENGE_COOKIE = 'nzx_2step';
const SESSION_DAYS = 30;

export type User = {
  id: string; email: string; name: string; role: 'customer' | 'team'; plan: 'free' | 'paid';
  country: string; company_id: number | null; credits: number; onboarded: boolean; owner_id: string | null;
  language: string; whatsapp: string | null; notify_email: boolean; notify_whatsapp: boolean;
  company_name: string | null; claim_status: string | null; list_count: number; account_type: 'distributor' | 'manufacturer';
  mfr_plan: string | null; mfr_plan_chosen: boolean; mfr_active: string | null; mfr_tier: number;
  team_owner: boolean; team_permissions: string[]; tour_step: number | null; mfr_verified: boolean;
  mfr_markets: string[]; mfr_interval: string;
};

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await pool.query('select auth_create_session($1, $2, $3)', [sha(token), userId, expires]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', expires,
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  });
}

/** After a correct password on an account with two-step sign-in: a 10-minute challenge, not a session. */
export async function createChallenge(userId: string) {
  const token = randomBytes(32).toString('base64url');
  await pool.query('select auth_create_challenge($1, $2)', [sha(token), userId]);
  (await cookies()).set(CHALLENGE_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600,
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
    select u.id, u.email, u.name, u.role, u.team_owner, u.team_permissions, app_plan() as plan, u.country, u.company_id, u.credits, u.onboarded,
           u.owner_id, u.language, u.whatsapp, u.notify_email, u.notify_whatsapp,
           coalesce(c.display_name, cl.company_name) as company_name, cl.status as claim_status,
           (select count(*)::int from sourcing_list l where l.user_id = u.id) as list_count, u.account_type,
           mp.chosen_plan is not null as mfr_plan_chosen, coalesce(mp.chosen_plan, mp.suggested_plan) as mfr_plan, mp.active_plan as mfr_active, mp.tour_step, mp.verified_at is not null as mfr_verified, coalesce(mp.paid_markets, '{}') as mfr_markets, coalesce(mp.billing_interval, 'month') as mfr_interval,
           case when u.role = 'team' then 3 else coalesce(case mp.active_plan when 'data' then 1 when 'access' then 2 when 'entry' then 3 end, 0) end as mfr_tier
    from users u
    left join companies c on c.id = u.company_id
    left join lateral (select * from company_claims k where k.user_id = coalesce(u.owner_id, u.id)
                       order by k.created_at desc limit 1) cl on true
    left join manufacturer_profiles mp on mp.user_id = u.id
    where u.id = $1`, [id]));
});

/** Signed-in customer pages. Distributor and manufacturer accounts each have their own area; `shared` pages
 *  (settings, help) serve both. The team can open everything. */
export async function requireUser(opts: { allowOnboarding?: boolean; manufacturer?: boolean; shared?: boolean } = {}): Promise<User> {
  const u = await getUser();
  if (!u) redirect('/signup?mode=signin');
  const mfr = u.account_type === 'manufacturer';
  if (!u.onboarded && !opts.allowOnboarding && u.role !== 'team') redirect(mfr ? '/m/onboarding' : '/onboarding');
  if (u.role !== 'team' && !opts.shared) {
    if (opts.manufacturer && !mfr) redirect('/home');
    if (!opts.manufacturer && mfr) redirect('/m');
  }
  return u;
}

/** Two-step sign-in is optional for team accounts unless TEAM_2FA_REQUIRED=1 is set on the host. */
export const teamTwoStepRequired = () => process.env.TEAM_2FA_REQUIRED === '1';

export async function twoStepEnabled(userId: string): Promise<boolean> {
  return withUser(userId, async (db) => Boolean((await one(db, 'select enabled from user_totp where user_id = $1', [userId]))?.enabled));
}

/** Team-only pages answer 404 to everyone else, so customers cannot tell they exist.
 *  Two-step sign-in is optional (see teamTwoStepRequired). */
export async function requireTeam(perm?: TeamPermission | 'team'): Promise<User> {
  const u = await getUser();
  if (!u || u.role !== 'team') notFound();
  if (perm && !teamCan(u, perm)) notFound();
  if (teamTwoStepRequired() && !(await twoStepEnabled(u.id))) redirect('/settings/security?required=1');
  return u;
}
