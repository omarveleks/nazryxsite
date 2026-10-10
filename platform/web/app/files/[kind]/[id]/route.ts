import { getUser } from '@/lib/auth';
import { one, withUser } from '@/lib/db';

// Files are served only through this route. RLS decides whether the signed-in user may see the referencing row
// and, again, the stored file itself.
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
  const notFound = () => new Response('Not found', { status: 404 });
  if (!u || !sql || !/^\d+$/.test(id)) return notFound();
  const file = await withUser(u.id, async (db) => {
    const row = await one(db, sql, [Number(id)]);
    const m = /^db:([0-9a-f-]{36})$/.exec(row?.path ?? '');
    if (!m) return null;
    const f = await one(db, 'select data from stored_files where id = $1', [m[1]]);
    return f ? { name: String(row!.name), data: f.data as Buffer } : null;
  });
  if (!file) return notFound();
  return new Response(new Uint8Array(file.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file.name.replace(/["\r\n]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
