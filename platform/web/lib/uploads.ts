import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), '..', 'uploads');
const MAX = 20 * 1024 * 1024;
const OK_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.xls', '.xlsx', '.csv', '.doc', '.docx', '.txt']);

export type Saved = { path: string; name: string };

/** Save an uploaded file outside the web root. Returns null for an empty input. Throws a readable error. */
export async function saveUpload(file: FormDataEntryValue | null, subdir: string, allowed = OK_EXT): Promise<Saved | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  if (file.size > MAX) throw new Error('Files must be 20 MB or smaller.');
  const ext = path.extname(file.name).toLowerCase();
  if (!allowed.has(ext)) throw new Error(`File type ${ext || '(none)'} is not accepted.`);
  const safe = path.basename(file.name).replace(/[^\w.\- ]+/g, '_').slice(-120);
  const dir = path.join(UPLOAD_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${randomUUID()}-${safe}`);
  await writeFile(dest, Buffer.from(await file.arrayBuffer()));
  return { path: dest, name: safe };
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com', 'aol.com',
  'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com', 'ymail.com']);

/** Does the work-email domain look like the company? Used as a hint for the team, never as proof. */
export function domainMatches(email: string, companyKey: string | null): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain || FREE_MAIL.has(domain) || !companyKey) return false;
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const key = companyKey.replace(/[^a-z0-9 ]/g, '');
  const squashed = key.replace(/ /g, '');
  if (label.length >= 3 && (squashed.includes(label) || label.includes(squashed))) return true;
  return key.split(' ').some((t) => t.length >= 4 && label.includes(t));
}
