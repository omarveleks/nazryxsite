'use server';
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { cookies, headers } from 'next/headers';
import { CHALLENGE_COOKIE, createChallenge, createSession, destroySession, sha } from '@/lib/auth';
import { verifyCode } from '@/lib/totp';
import { hashPassword, verifyPassword } from '@/lib/password';
import { back, isEmail, str } from '@/lib/forms';

export async function signUp(f: FormData) {
  const name = str(f, 'name', 120), email = str(f, 'email', 200).toLowerCase(), pw = String(f.get('password') ?? '');
  if (!name || !isEmail(email)) back('/signup', { error: 'Enter your name and a work email.' });
  if (pw.length < 10) back('/signup', { error: 'Use a password of at least 10 characters.' });
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  const allowed = (await pool.query(
    "select rate_allow('signup', $1, 5, interval '1 hour') and rate_allow('signup', 'all', 200, interval '1 hour') as ok", [ip])).rows[0].ok;
  if (!allowed) back('/signup', { error: 'Too many new accounts from here in the last hour. Try again later, or contact us.' });
  const exists = await pool.query('select id from auth_find_user($1)', [email]);
  if (exists.rowCount) back('/signup', { mode: 'signin', error: 'That email already has an account. Sign in.' });
  const r = await pool.query('select auth_create_user($1, $2, $3) as id', [email, name, hashPassword(pw)]);
  await createSession(r.rows[0].id);
  redirect('/onboarding');
}

export async function signIn(f: FormData) {
  const email = str(f, 'email', 200).toLowerCase(), pw = String(f.get('password') ?? '');
  const throttled = (await pool.query('select auth_throttled($1) as t', [email])).rows[0].t;
  if (throttled) back('/signup', { mode: 'signin', error: 'Too many attempts. Try again in 15 minutes, or ask us to reset your password.' });
  const r = await pool.query('select id, password_hash from auth_find_user($1)', [email]);
  const u = r.rows[0];
  // same message either way, so the form does not reveal which emails have accounts
  if (!u || !verifyPassword(pw, u.password_hash)) {
    await pool.query('select auth_record_failure($1)', [email]);
    back('/signup', { mode: 'signin', error: 'Email or password is wrong.' });
  }
  await pool.query('select auth_clear_failures($1)', [email]);
  if ((await pool.query('select auth_totp_enabled($1) as on', [u.id])).rows[0].on) {
    await createChallenge(u.id);
    redirect('/signin/verify');
  }
  await createSession(u.id);
  redirect('/home');
}

export async function verifyTwoStep(f: FormData) {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (!token) back('/signup', { mode: 'signin', error: 'Your sign-in timed out. Enter your password again.' });
  const ch = (await pool.query('select user_id, secret from auth_challenge($1)', [sha(token!)])).rows[0];
  if (!ch) back('/signup', { mode: 'signin', error: 'Too many wrong codes or the sign-in timed out. Start again.' });
  if (!verifyCode(ch.secret, String(f.get('code') ?? ''))) {
    await pool.query('select auth_challenge_failed($1)', [sha(token!)]);
    back('/signin/verify', { error: 'That code is wrong or expired. Use the newest code in your app.' });
  }
  await pool.query('select auth_challenge_done($1)', [sha(token!)]);
  jar.delete(CHALLENGE_COOKIE);
  await createSession(ch.user_id);
  redirect('/home');
}

export async function signOut() {
  await destroySession();
  redirect('/signup?mode=signin');
}
