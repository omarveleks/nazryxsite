'use server';
import { randomBytes } from 'crypto';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, rows, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { targetMarkets } from '@/components/MarketPicker';
import { ask, askReady } from '@/lib/ask';
import { langOf } from '@/lib/i18n';

const err = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));
const safe = (v: string, fb: string) => (v.startsWith('/') && !v.startsWith('//') ? v : fb);

export async function setSeatRole(f: FormData) {
  const u = await requireUser({ shared: true });
  try {
    await withUser(u.id, (db) => db.query('select set_seat_role($1::uuid, $2)', [str(f, 'seat', 40), str(f, 'role', 12)]));
  } catch (e) { back('/settings', { error: err(e) }); }
  redirect('/settings?saved=1#team');
}

export async function removeSeat(f: FormData) {
  const u = await requireUser({ shared: true });
  try {
    await withUser(u.id, (db) => db.query('select remove_seat($1::uuid)', [str(f, 'seat', 40)]));
  } catch (e) { back('/settings', { error: err(e) }); }
  redirect('/settings?saved=1#team');
}

/** A comment on a project, product, molecule, tender or company; @name mentions a seat and lands in their inbox. */
export async function addComment(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const kind = str(f, 'kind', 12), target = str(f, 'target', 40), body = str(f, 'body', 2000);
  const to = safe(str(f, 'return', 200), '/m');
  if (!['project', 'product', 'molecule', 'tender', 'company'].includes(kind) || !target || !body) back(to, { error: 'Write the comment.' });
  if (u.seat_role === 'viewer') back(to, { error: 'Viewers read; ask the account owner for a writing role.' });
  try {
    await withUser(u.id, async (db) => {
      const acct = u.owner_id ?? u.id;
      const seats = await rows(db, 'select id, name, email from users where (id = $1 or owner_id = $1) and not disabled', [acct]);
      const mentioned = seats.filter((s) => s.id !== u.id && s.name && new RegExp(`@${s.name.split(/\\s+/)[0].replace(/[^\\w]/g, '')}\\b`, 'i').test(body));
      await db.query('insert into comments (account_id, author_id, target_kind, target_id, body, mentions) values ($1, $2, $3, $4, $5, $6)', [acct, u.id, kind, target, body, mentioned.map((s) => s.id)]);
      for (const s of mentioned) {
        await db.query(`insert into inbox_items (user_id, kind, title, body, link, key) values ($1, 'mention', $2, $3, $4, $5) on conflict (user_id, key) do nothing`,
          [s.id, `${u.name || u.email} mentioned you`, body.slice(0, 300), to.split('?')[0] + '#comments', `mention:${Date.now()}:${s.id}`]);
      }
    });
  } catch (e) { back(to, { error: err(e) }); }
  redirect(to.includes('#') ? to : `${to}#comments`);
}

export async function deleteComment(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from comments where id = $1 and (author_id = $2 or account_id = $2)', [int(f, 'id'), u.id]));
  redirect(safe(str(f, 'return', 200), '/m'));
}

/** A read-only link to a project for someone outside the portal, valid 30 days. */
export async function createShareLink(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const project = int(f, 'project_id');
  if (!project) back('/m/projects', { error: 'Pick a project.' });
  const token = randomBytes(18).toString('base64url');
  try {
    await withUser(u.id, (db) => db.query(`insert into share_links (token, account_id, kind, target_id, created_by) values ($1, $2, 'project', $3, $4)`, [token, u.owner_id ?? u.id, String(project), u.id]));
  } catch (e) { back(`/m/projects/${project}`, { error: err(e) }); }
  back(`/m/projects/${project}`, { shared: token });
}

export async function revokeShareLink(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const project = int(f, 'project_id');
  await withUser(u.id, (db) => db.query('update share_links set revoked_at = now() where token = $1', [str(f, 'token', 40)]));
  back(`/m/projects/${project}`, { saved: '1' });
}

/** Ask Nazryx: one question, answered over the account's data with citations, kept in the log. */
export async function askQuestion(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const q = str(f, 'q', 2000);
  if (!q) back('/m/ask', { error: 'Ask something.' });
  if (!askReady()) back('/m/ask', { error: 'Ask Nazryx is not switched on here yet.' });
  const started = Date.now();
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const prof = await one(db, 'select target_countries from manufacturer_profiles where user_id = $1', [u.owner_id ?? u.id]);
      const markets = targetMarkets(prof?.target_countries, u.mfr_markets);
      const history = (await rows(db, 'select question, answer from ask_log where user_id = $1 and answer is not null order by id desc limit 3', [u.id])).reverse()
        .flatMap((h) => [{ role: 'user' as const, content: h.question }, { role: 'assistant' as const, content: h.answer }]);
      const a = await ask(db, u.id, { markets, lang: langOf(u) }, q, history);
      const r = await one(db, 'insert into ask_log (user_id, question, answer, cites, tools, ms) values ($1, $2, $3, $4, $5, $6) returning id',
        [u.id, q, a.text, JSON.stringify(a.cites), a.toolCalls, Date.now() - started]);
      return r!.id as number;
    });
  } catch (e) { back('/m/ask', { error: err(e), q }); }
  redirect(`/m/ask?a=${id}`);
}
