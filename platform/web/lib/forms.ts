import { redirect } from 'next/navigation';

export const str = (f: FormData, k: string, max = 500) => String(f.get(k) ?? '').trim().slice(0, max);
export const int = (f: FormData, k: string) => {
  const n = parseInt(String(f.get(k) ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};
/** Redirect back to a page with a message in the query string (works without client JavaScript). */
export function back(path: string, params: Record<string, string>): never {
  const u = new URL(path, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  redirect(u.pathname + u.search);
}
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
