// Server-side gate for everything under /analytics. Only /analytics/login is public.
import { isAuthed } from '../_lib/auth.js';
import { SEC_HEADERS } from '../_lib/util.js';

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  let res;
  if (path === '/analytics/login' || path === '/analytics/logout' || path === '/analytics/dash.css') res = await next();
  else if (!(await isAuthed(request, env))) res = Response.redirect(new URL('/analytics/login', request.url).toString(), 302);
  else res = await next();
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.headers.set(k, v);
  return res;
}
