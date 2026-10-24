import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { pool } from '@/lib/db';
import { VIEW_COOKIE, sha } from '@/lib/auth';

/** Ends a view of a customer's portal and goes back to their account in Admin. */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const v = jar.get(VIEW_COOKIE)?.value;
  const id: string | null = v ? (await pool.query('select auth_end_view($1) as id', [sha(v)])).rows[0]?.id ?? null : null;
  jar.delete(VIEW_COOKIE);
  return NextResponse.redirect(new URL(id ? `/admin/accounts/${id}` : '/admin', req.url));
}
