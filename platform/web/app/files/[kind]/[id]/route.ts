import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';
import { UPLOAD_DIR } from '@/lib/uploads';

// Files are served only through this route. RLS decides whether the signed-in user may see the row.
const QUERIES: Record<string, string> = {
  request: 'select path, file_name as name from request_files where id = $1',
  licence: 'select licence_path as path, licence_name as name from company_claims where id = $1',
  catalogue: 'select catalogue_path as path, catalogue_name as name from company_claims where id = $1',
  registry: 'select file_path as path, file_name as name from registry_uploads where id = $1',
};

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const u = await getUser();
  const sql = QUERIES[kind];
  if (!u || !sql || !/^\d+$/.test(id)) return new Response('Not found', { status: 404 });
  const row = await withUser(u.id, (db) => one(db, sql, [Number(id)]));
  if (!row?.path) return new Response('Not found', { status: 404 });
  const full = path.resolve(row.path);
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const buf = await readFile(full);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${String(row.name).replace(/["\r\n]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
