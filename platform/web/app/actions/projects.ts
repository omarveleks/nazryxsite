'use server';
import { createHash, randomBytes } from 'crypto';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { dbMessage, one, withUser } from '@/lib/db';
import { back, int, str } from '@/lib/forms';
import { MFR_COUNTRIES, canUse, tierIn } from '@/lib/mfr';
import { PROJECT_STAGES, STAGE_TASKS } from '@/lib/projects';

const codes = MFR_COUNTRIES.map((c) => c.code);
const owner = (u: { id: string; owner_id: string | null }) => u.owner_id ?? u.id;   // seats work on the account's projects
const err = (e: unknown) => (e instanceof Error && !('code' in e) ? e.message : dbMessage(e));

/** Start a project for a product in a market (or open the one that exists). Projects are free to keep; the tools inside
 *  them follow the plan. */
export async function createProject(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const product = int(f, 'product_id'), country = str(f, 'country', 2);
  const to = str(f, 'return', 200).startsWith('/') ? str(f, 'return', 200) : '/m/projects';
  if (!product || !codes.includes(country)) back(to, { error: 'Pick a product and a market.' });
  let id = 0;
  try {
    id = await withUser(u.id, async (db) => {
      const r = await one(db, `insert into projects (user_id, product_id, country, owner_id) values ($1, $2, $3, $4)
                               on conflict (product_id, country) do update set updated_at = now() returning id, (xmax = 0) as created`, [owner(u), product, country, u.id]);
      if (r?.created) await seedTasks(db, r.id, 'assess');
      return r!.id as number;
    });
  } catch (e) {
    back(to, { error: err(e) });
  }
  redirect(`/m/projects/${id}`);
}

async function seedTasks(db: any, project: number, stage: string) {
  for (const title of STAGE_TASKS[stage] ?? []) {
    await db.query(`insert into project_tasks (project_id, title, stage, source) select $1, $2, $3, 'nazryx'
                    where not exists (select 1 from project_tasks where project_id = $1 and title = $2)`, [project, title, stage]);
  }
}

/** Move a project to a stage: the stage's usual tasks are added once. */
export async function moveProject(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'id'), stage = str(f, 'stage', 12);
  if (!id || !(PROJECT_STAGES.some(([k]) => k === stage) || stage === 'parked')) back('/m/projects', { error: 'Pick a stage.' });
  await withUser(u.id, async (db) => {
    await db.query('update projects set stage = $2, updated_at = now() where id = $1', [id, stage]);
    if (stage !== 'parked') await seedTasks(db, id!, stage);
  });
  back(str(f, 'return', 200).startsWith('/') ? str(f, 'return', 200) : `/m/projects/${id}`, { saved: '1' });
}

export async function updateProject(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'id');
  const target = str(f, 'target_date', 10) || null, note = str(f, 'note', 1000) || null, ownerId = str(f, 'owner_id', 40) || null;
  await withUser(u.id, (db) => db.query(`update projects set target_date = $2::date, note = $3, owner_id = coalesce($4::uuid, owner_id), updated_at = now() where id = $1`, [id, target, note, ownerId]));
  back(`/m/projects/${id}`, { saved: '1' });
}

export async function deleteProject(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from projects where id = $1', [int(f, 'id')]));
  back('/m/projects', { saved: '1' });
}

export async function addTask(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'project_id'), title = str(f, 'title', 160);
  if (!title) back(`/m/projects/${id}`, { error: 'Write the task.' });
  await withUser(u.id, (db) => db.query('insert into project_tasks (project_id, title, due_date, assignee_id) values ($1, $2, $3::date, $4::uuid)',
    [id, title, str(f, 'due_date', 10) || null, str(f, 'assignee_id', 40) || null]));
  back(`/m/projects/${id}`, { saved: '1' });
}

export async function toggleTask(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const id = int(f, 'task_id'), project = int(f, 'project_id');
  await withUser(u.id, (db) => db.query('update project_tasks set done_at = case when done_at is null then now() end where id = $1', [id]));
  back(str(f, 'return', 200).startsWith('/') ? str(f, 'return', 200) : `/m/projects/${project}`, {});
}

export async function deleteTask(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const project = int(f, 'project_id');
  await withUser(u.id, (db) => db.query('delete from project_tasks where id = $1', [int(f, 'task_id')]));
  back(`/m/projects/${project}`, {});
}

/** A date of the manufacturer's own on the calendar: a GMP expiry, a meeting, a registration expiry. */
export async function addCalendarEntry(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  const title = str(f, 'title', 120), on = str(f, 'on_date', 10), kind = str(f, 'kind', 24);
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(on)) back('/m/calendar', { error: 'Give the entry a title and a date.' });
  const country = str(f, 'country', 2);
  await withUser(u.id, (db) => db.query(`insert into calendar_entries (user_id, title, on_date, kind, country, product_id, project_id) values ($1, $2, $3::date, $4, $5, $6, $7)`,
    [owner(u), title, on, ['own', 'gmp_expiry', 'registration_expiry', 'meeting'].includes(kind) ? kind : 'own', codes.includes(country) ? country : null, int(f, 'product_id'), int(f, 'project_id')]));
  back(str(f, 'return', 200).startsWith('/') ? str(f, 'return', 200) : '/m/calendar', { saved: '1' });
}

export async function removeCalendarEntry(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('delete from calendar_entries where id = $1', [int(f, 'id')]));
  back('/m/calendar', { saved: '1' });
}

/** A key for the read API (Complete Market Access). Shown once; stored hashed. */
export async function createApiKey(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  if (!canUse(u.mfr_tier, 'distributors')) redirect('/m/plan?want=access');
  const name = str(f, 'name', 60) || 'Key';
  const key = 'nzx_' + randomBytes(24).toString('base64url');
  try {
    await withUser(u.id, async (db) => {
      const n = await one(db, 'select count(*)::int as n from api_keys where user_id = $1 and revoked_at is null', [u.id]);
      if ((n?.n ?? 0) >= 5) throw new Error('Five active keys is the most; revoke one first.');
      await db.query('insert into api_keys (user_id, name, key_hash, prefix) values ($1, $2, $3, $4)', [u.id, name, createHash('sha256').update(key).digest('hex'), key.slice(0, 12)]);
    });
  } catch (e) {
    back('/settings/api', { error: err(e) });
  }
  back('/settings/api', { created: key });
}

export async function revokeApiKey(f: FormData) {
  const u = await requireUser({ manufacturer: true });
  await withUser(u.id, (db) => db.query('update api_keys set revoked_at = now() where id = $1 and user_id = $2', [int(f, 'id'), u.id]));
  back('/settings/api', { saved: '1' });
}

export { tierIn };
