import { makeCookie, isAuthed } from '../_lib/auth.js';
import { sha256, safeEqual } from '../_lib/util.js';

const MAX = 5, LOCK = 15 * 60 * 1000;

function form(error) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Analytics · Nazryx</title><link rel="stylesheet" href="/assets/nzx.css"><link rel="stylesheet" href="/analytics/dash.css"></head>
<body class="an-login"><main class="wrap"><form class="an-card" method="post" action="/analytics/login">
<b class="an-brand">Nazryx analytics</b><h1>Sign in</h1>
${error ? '<p class="an-err" role="alert">Sign-in failed. Try again later.</p>' : ''}
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button class="btn btn-blue" type="submit">Sign in</button></form></main></body></html>`, { status: error ? 401 : 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function onRequestGet({ request, env }) {
  if (await isAuthed(request, env)) return Response.redirect(new URL('/analytics', request.url).toString(), 302);
  return form(false);
}

export async function onRequestPost({ request, env }) {
  const { ANALYTICS_PASSWORD: pw, ANALYTICS_SESSION_KEY: key, DB } = env;
  if (!pw || !key) return form(true);
  const url = new URL(request.url);
  if (request.headers.get('origin') && request.headers.get('origin') !== url.origin) return form(true);
  const ip = request.headers.get('cf-connecting-ip') || '0';
  const iph = await sha256(key + '|login|' + ip);
  const now = Date.now();
  const row = DB ? await DB.prepare('SELECT fails, locked_until FROM login_attempts WHERE iph=?').bind(iph).first() : null;
  if (row && row.locked_until > now) { await sleep(900); return form(true); }

  let given = '';
  try { const f = await request.formData(); given = String(f.get('password') || '').slice(0, 256); } catch {}
  if (await safeEqual(given, pw, key)) {
    if (DB) await DB.prepare('DELETE FROM login_attempts WHERE iph=?').bind(iph).run();
    return new Response(null, { status: 303, headers: { Location: '/analytics', 'Set-Cookie': await makeCookie(env) } });
  }
  const fails = (row && row.locked_until <= now && row.fails >= MAX ? 0 : row?.fails || 0) + 1;
  if (DB) await DB.prepare('INSERT INTO login_attempts (iph,fails,locked_until,updated) VALUES (?1,?2,?3,?4) ON CONFLICT(iph) DO UPDATE SET fails=?2, locked_until=?3, updated=?4')
    .bind(iph, fails, fails >= MAX ? now + LOCK : 0, now).run();
  await sleep(900);
  return form(true);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
