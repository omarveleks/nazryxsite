import { teamCan, type TeamPermission } from './team';
import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { LANG_COOKIE, isLang } from './i18n';
import { pool, withUser, one } from './db';
import { setViewing } from './viewing';

export const SESSION_COOKIE = 'nzx_session';
export const CHALLENGE_COOKIE = 'nzx_2step';
export const VIEW_COOKIE = 'nzx_view';     // the team viewing a customer's portal (read-only, an hour)
const SESSION_DAYS = 30;

export type User = {
  id: string; email: string; name: string; role: 'customer' | 'team'; plan: 'free' | 'paid';
  country: string; company_id: number | null; credits: number; onboarded: boolean; owner_id: string | null;
  language: string; whatsapp: string | null; notify_email: boolean; notify_whatsapp: boolean;
  company_name: string | null; claim_status: string | null; list_count: number; account_type: 'distributor' | 'manufacturer';
  mfr_plan: string | null; mfr_plan_chosen: boolean; mfr_active: string | null; mfr_tier: number;
  team_owner: boolean; team_permissions: string[]; tour_step: number | null; mfr_verified: boolean;
  mfr_markets: string[]; mfr_interval: string;
  mfr_trial: boolean; mfr_trial_until: string | null;   // 14 days of Basic Market Data on one market, before any plan
  seat_role: string | null;       // owner, regulatory, sales or viewer on a manufacturer account
  dist_company: string | null; dist_verified: boolean;   // the distributor side
  inbox_unread: number;
  viewed_by?: string | null;      // the team member viewing this account, when it is a view
  view_ended?: boolean;           // a view that has ended is still in the browser: changes wait for its exit link
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
  // the interface follows the account's language from the first page after sign-in; a language picked while signed out
  // (the cookie) becomes the account's language when the account still has the default
  const picked = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = await withUser(userId, async (db) => {
    const cur = (await db.query('select language from users where id = $1', [userId])).rows[0]?.language;
    if (isLang(picked) && picked !== cur && (cur === 'en' || !isLang(cur))) {
      await db.query('update users set language = $2 where id = $1', [userId, picked]);
      return picked;
    }
    return cur;
  }).catch(() => null);
  if (isLang(lang)) (await cookies()).set(LANG_COOKIE, lang, { path: '/', maxAge: 365 * 86400, sameSite: 'lax' });
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
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const r = await pool.query('select auth_session_user($1) as id', [sha(token)]);
  const id: string | null = r.rows[0]?.id ?? null;
  if (!id) return null;
  // the page this request opens (Admin > Usage); never holds the page up or fails it
  const path = (await headers()).get('x-nzx-path');
  if (path) pool.query('select auth_record_view($1, $2)', [sha(token), path]).catch(() => {});
  const view = jar.get(VIEW_COOKIE)?.value;
  if (view) {
    // the team viewing a customer: their portal, read-only, while the team member's own session and permission last
    const v: string | null = (await pool.query('select auth_view_user($1, $2) as id', [sha(view), sha(token)])).rows[0]?.id ?? null;
    if (v) {
      const admin = await withUser(id, (db) => one<{ email: string }>(db, 'select email from users where id = $1', [id]));
      setViewing(v);
      const u = await loadUser(v);
      return u ? { ...u, viewed_by: admin?.email ?? 'the team' } : null;
    }
    const u = await loadUser(id);
    return u ? { ...u, view_ended: true } : null;
  }
  return loadUser(id);
});

function loadUser(id: string) {
  return withUser(id, (db) => one<User>(db, `
    select u.id, u.email, u.name, u.role, u.team_owner, u.team_permissions, app_plan() as plan, u.country, u.company_id, u.credits, u.onboarded,
           u.owner_id, u.language, u.whatsapp, u.notify_email, u.notify_whatsapp, u.seat_role, dp.company_name as dist_company, dp.verified_at is not null as dist_verified,
           coalesce(c.display_name, cl.company_name) as company_name, cl.status as claim_status,
           (select count(*)::int from sourcing_list l where l.user_id = u.id) as list_count, u.account_type,
           mp.chosen_plan is not null as mfr_plan_chosen, coalesce(mp.chosen_plan, mp.suggested_plan) as mfr_plan,
           coalesce(mp.active_plan, case when mp.trial_until > now() then 'data' end) as mfr_active, mp.tour_step, mp.verified_at is not null as mfr_verified,
           case when mp.active_plan is null and mp.trial_until > now() then array[mp.trial_market] else coalesce(mp.paid_markets, '{}') end as mfr_markets,
           coalesce(mp.billing_interval, 'month') as mfr_interval,
           mp.active_plan is null and mp.trial_until > now() as mfr_trial, mp.trial_until as mfr_trial_until,
           (select count(*)::int from inbox_items i where i.user_id = u.id and i.read_at is null) as inbox_unread,
           case when u.role = 'team' then 3 when mp.active_plan = 'data' then 1 when mp.active_plan = 'access' then 2 when mp.active_plan = 'entry' then 3
                when mp.active_plan is null and mp.trial_until > now() then 1 else 0 end as mfr_tier
    from users u
    left join companies c on c.id = u.company_id
    left join lateral (select * from company_claims k where k.user_id = coalesce(u.owner_id, u.id)
                       order by k.created_at desc limit 1) cl on true
    left join manufacturer_profiles mp on mp.user_id = u.id
    left join distributor_profiles dp on dp.user_id = u.id
    where u.id = $1`, [id]));
}

/** Signed-in customer pages: the manufacturer area (`manufacturer`) and `shared` pages (settings, help). Distributor
 *  accounts only reach the shared pages while the marketplace is paused; the team can open everything. */
export async function requireUser(opts: { allowOnboarding?: boolean; manufacturer?: boolean; distributor?: boolean; shared?: boolean } = {}): Promise<User> {
  const u = await getUser();
  if (!u) redirect('/signup?mode=signin');
  if (u.role === 'team') return u;
  const mfr = u.account_type === 'manufacturer';
  if (!mfr && !opts.shared) redirect('/help');          // the distributor side is paused until the marketplace reopens
  if (mfr && !u.onboarded && !opts.allowOnboarding) redirect('/m/onboarding');
  if (opts.shared) return u;
  if (opts.distributor) redirect('/m');
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
