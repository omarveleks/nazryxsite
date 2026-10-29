import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { LANG_COOKIE, isLang } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/** /lang/fr?next=/m switches the interface language: a cookie for every page, and the account's setting when signed in. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code;
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  const to = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (isLang(code)) {
    (await cookies()).set(LANG_COOKIE, code, { path: '/', maxAge: 365 * 86400, sameSite: 'lax', httpOnly: false });
    const u = await getUser();
    if (u) await withUser(u.id, (db) => db.query('update users set language = $2 where id = $1', [u.id, code]));
  }
  return NextResponse.redirect(new URL(to, req.url));
}
