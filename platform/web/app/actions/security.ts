'use server';
import { redirect } from 'next/navigation';
import { requireUser, teamTwoStepRequired } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { back } from '@/lib/forms';
import { newSecret, verifyCode } from '@/lib/totp';

/** Start (or restart) set-up: a fresh secret, not active until a code confirms it. */
export async function startTwoStep() {
  const u = await requireUser({ allowOnboarding: true });
  await withUser(u.id, async (db) => {
    const row = await one(db, 'select enabled from user_totp where user_id = $1', [u.id]);
    if (row?.enabled) return;
    await db.query(`insert into user_totp (user_id, secret) values ($1, $2)
                    on conflict (user_id) do update set secret = excluded.secret, created_at = now()`, [u.id, newSecret()]);
  });
  redirect('/settings/security');
}

export async function confirmTwoStep(f: FormData) {
  const u = await requireUser({ allowOnboarding: true });
  const ok = await withUser(u.id, async (db) => {
    const row = await one(db, 'select secret, enabled from user_totp where user_id = $1', [u.id]);
    if (!row || row.enabled) return Boolean(row?.enabled);
    if (!verifyCode(row.secret, String(f.get('code') ?? ''))) return false;
    await db.query('update user_totp set enabled = true, enabled_at = now() where user_id = $1', [u.id]);
    return true;
  });
  if (!ok) back('/settings/security', { error: 'That code is wrong or expired. Use the newest code in your app.' });
  redirect('/settings/security?on=1');
}

export async function disableTwoStep(f: FormData) {
  const u = await requireUser({ allowOnboarding: true });
  if (u.role === 'team' && teamTwoStepRequired()) back('/settings/security', { error: 'Team accounts must keep two-step sign-in on.' });
  const ok = await withUser(u.id, async (db) => {
    const row = await one(db, 'select secret from user_totp where user_id = $1 and enabled', [u.id]);
    if (!row || !verifyCode(row.secret, String(f.get('code') ?? ''))) return false;
    await db.query('delete from user_totp where user_id = $1', [u.id]);
    return true;
  });
  if (!ok) back('/settings/security', { error: 'Enter a current code from your app to turn it off.' });
  redirect('/settings/security?off=1');
}
