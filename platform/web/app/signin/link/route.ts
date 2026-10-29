import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { createChallenge, createSession, sha } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The link from the sign-in email: one use, 15 minutes. Accounts with two-step sign-in still type their code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const home = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return home('/signup?mode=signin&error=' + encodeURIComponent('That link is not valid. Ask for a new one.'));
  const uid = (await pool.query('select auth_consume_login_link($1) as id', [sha(token)])).rows[0]?.id as string | null;
  if (!uid) return home('/signup?mode=signin&error=' + encodeURIComponent('That link has expired or was already used. Ask for a new one.'));
  if ((await pool.query('select auth_totp_enabled($1) as on', [uid])).rows[0].on) {
    await createChallenge(uid);
    return home('/signin/verify');
  }
  await createSession(uid);
  return home('/');
}
