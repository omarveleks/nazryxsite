import { hmac, safeEqual } from './util.js';
export const COOKIE = 'nzx_an';
const TTL = 12 * 3600 * 1000;

export async function makeCookie(env) {
  const exp = Date.now() + TTL;
  const sig = await hmac(env.ANALYTICS_SESSION_KEY, 'v1.' + exp);
  return `${COOKIE}=v1.${exp}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL / 1000}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function isAuthed(request, env) {
  if (!env.ANALYTICS_SESSION_KEY) return false;
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=v1\\.(\\d{10,16})\\.([A-Za-z0-9_-]{20,})'));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > Date.now()) || exp > Date.now() + TTL + 60000) return false;
  const good = await hmac(env.ANALYTICS_SESSION_KEY, 'v1.' + exp);
  return safeEqual(good, m[2], env.ANALYTICS_SESSION_KEY);
}
