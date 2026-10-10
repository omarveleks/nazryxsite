'use server';
import { redirect } from 'next/navigation';
import { pool } from '@/lib/db';
import { createSession, destroySession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/password';
import { back, isEmail, str } from '@/lib/forms';

export async function signUp(f: FormData) {
  const name = str(f, 'name', 120), email = str(f, 'email', 200).toLowerCase(), pw = String(f.get('password') ?? '');
  if (!name || !isEmail(email)) back('/signup', { error: 'Enter your name and a work email.' });
  if (pw.length < 10) back('/signup', { error: 'Use a password of at least 10 characters.' });
  const exists = await pool.query('select id from auth_find_user($1)', [email]);
  if (exists.rowCount) back('/signup', { mode: 'signin', error: 'That email already has an account. Sign in.' });
  const r = await pool.query('select auth_create_user($1, $2, $3) as id', [email, name, hashPassword(pw)]);
  await createSession(r.rows[0].id);
  redirect('/onboarding');
}

export async function signIn(f: FormData) {
  const email = str(f, 'email', 200).toLowerCase(), pw = String(f.get('password') ?? '');
  const r = await pool.query('select id, password_hash from auth_find_user($1)', [email]);
  const u = r.rows[0];
  // same message either way, so the form does not reveal which emails have accounts
  if (!u || !verifyPassword(pw, u.password_hash)) back('/signup', { mode: 'signin', error: 'Email or password is wrong.' });
  await createSession(u.id);
  redirect('/home');
}

export async function signOut() {
  await destroySession();
  redirect('/signup?mode=signin');
}
