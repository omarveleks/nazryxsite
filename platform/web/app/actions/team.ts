'use server';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { dbMessage, withUser } from '@/lib/db';
import { back, isEmail, str } from '@/lib/forms';
import { hashPassword } from '@/lib/password';
import { TEAM_PERMISSIONS } from '@/lib/team';

// The owner adds team members, chooses what each can open, and removes them. The database checks ownership again.
const TO = '/admin?tab=team';
const perms = (f: FormData) => [...new Set(f.getAll('perm').map(String))].filter((p) => TEAM_PERMISSIONS.some(([k]) => k === p));

export async function addTeamMember(f: FormData) {
  const u = await requireTeam('team');
  const name = str(f, 'name', 120), email = str(f, 'email', 200).toLowerCase(), pw = String(f.get('password') ?? '');
  if (!name || !isEmail(email)) back(TO, { error: 'Enter a name and an email.' });
  if (pw.length < 10) back(TO, { error: 'Use a temporary password of at least 10 characters.' });
  try {
    await withUser(u.id, (db) => db.query('select team_add_member($1, $2, $3, $4, $5)', [email, name, hashPassword(pw), perms(f), false]));
  } catch (e) {
    back(TO, { error: dbMessage(e) });
  }
  redirect(`${TO}&saved=1`);
}

export async function updateTeamMember(f: FormData) {
  const u = await requireTeam('team');
  try {
    await withUser(u.id, (db) => db.query('select team_set_member($1, $2, $3)', [str(f, 'user_id', 40), perms(f), false]));
  } catch (e) {
    back(TO, { error: dbMessage(e) });
  }
  redirect(`${TO}&saved=1`);
}

export async function removeTeamMember(f: FormData) {
  const u = await requireTeam('team');
  try {
    await withUser(u.id, (db) => db.query('select team_remove_member($1, $2)', [str(f, 'user_id', 40), f.get('restore') !== '1']));
  } catch (e) {
    back(TO, { error: dbMessage(e) });
  }
  redirect(`${TO}&saved=1`);
}
