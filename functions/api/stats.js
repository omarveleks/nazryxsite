// Dashboard data. Auth-checked server-side; never cached; never indexed.
import { isAuthed } from '../_lib/auth.js';
import { SEC_HEADERS } from '../_lib/util.js';

const CONV = "(target LIKE 'whatsapp%' OR target LIKE 'phone%' OR target LIKE 'email%')";
const CTA = "(target LIKE 'cta:%' OR target LIKE 'whatsapp%' OR target LIKE 'phone%' OR target LIKE 'email%' OR target LIKE 'calendly%')";
const json = (o, s = 200, extra = {}) => new Response(typeof o === 'string' ? o : JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...SEC_HEADERS, ...extra } });
const DAY = 86400000;

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) return json({ error: 'unauthorised' }, 401);
  const DB = env.DB;
  if (!DB) return json({ error: 'no database' }, 500);
  const u = new URL(request.url);
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const today = new Date().toISOString().slice(0, 10);
  const to = isDay(u.searchParams.get('to')) ? u.searchParams.get('to') : today;
  const from = isDay(u.searchParams.get('from')) ? u.searchParams.get('from') : new Date(Date.parse(to) - 6 * DAY).toISOString().slice(0, 10);
  const a = Date.parse(from), b = Date.parse(to) + DAY;
  if (!(b > a) || b - a > 400 * DAY) return json({ error: 'bad range' }, 400);
  const pa = a - (b - a), pb = a;

  if (u.searchParams.get('format') === 'csv') {
    const { results } = await DB.prepare('SELECT ts,type,path,target,value,source,ref_host,utm_source,utm_medium,utm_campaign,lead_ref,country,city,device,browser,os,lang,is_new,sid FROM events WHERE ts>=? AND ts<? ORDER BY ts LIMIT 50000').bind(a, b).all();
    const cols = ['time', 'type', 'path', 'target', 'value', 'source', 'ref_host', 'utm_source', 'utm_medium', 'utm_campaign', 'ref', 'country', 'city', 'device', 'browser', 'os', 'lang', 'is_new', 'session'];
    const q = (v) => { v = v == null ? '' : String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [cols.join(',')].concat(results.map((r) => [new Date(r.ts).toISOString(), r.type, r.path, r.target, r.value, r.source, r.ref_host, r.utm_source, r.utm_medium, r.utm_campaign, r.lead_ref, r.country, r.city, r.device, r.browser, r.os, r.lang, r.is_new, r.sid].map(q).join(',')));
    return new Response(lines.join('\n'), { headers: { ...SEC_HEADERS, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="nazryx-analytics-${from}-to-${to}.csv"` } });
  }

  const all = (sql, ...p) => DB.prepare(sql).bind(...p).all().then((r) => r.results);
  const kpi = (x, y) => DB.prepare(`
    WITH e AS (SELECT * FROM events WHERE ts>=?1 AND ts<?2),
    pvt AS (SELECT sid, pv, MAX(CASE WHEN type='time' THEN value END) t FROM e GROUP BY sid, pv),
    s AS (SELECT sid, SUM(type='pageview') pages, SUM(type='click') clicks FROM e GROUP BY sid),
    st AS (SELECT sid, SUM(IFNULL(t,0)) tt FROM pvt GROUP BY sid)
    SELECT (SELECT COUNT(DISTINCT vkey) FROM e WHERE type='pageview') visitors,
      (SELECT COUNT(*) FROM s WHERE pages>0) sessions,
      (SELECT COUNT(*) FROM e WHERE type='pageview') pageviews,
      (SELECT ROUND(AVG(t),1) FROM pvt WHERE t IS NOT NULL) avg_time,
      (SELECT ROUND(100.0*SUM(s.pages>=2 OR st.tt>30 OR s.clicks>0)/MAX(COUNT(*),1),1) FROM s JOIN st USING(sid) WHERE s.pages>0) engaged,
      (SELECT COUNT(*) FROM e WHERE type='click' AND ${CONV}) conversions`).bind(x, y).first();

  const [cur, prev, series, prevSeries, funnel, prevFunnel, pages, sources, referrers, utms, leads, countries, cities, devices, browsers, oses, langs, newret, actions, recent] = await Promise.all([
    kpi(a, b), kpi(pa, pb),
    all(`SELECT day, COUNT(DISTINCT vkey) visitors, COUNT(*) pageviews FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY day ORDER BY day`, a, b),
    all(`SELECT day, COUNT(DISTINCT vkey) visitors, COUNT(*) pageviews FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY day ORDER BY day`, pa, pb),
    funnelQ(DB, a, b), funnelQ(DB, pa, pb),
    all(`WITH e AS (SELECT * FROM events WHERE ts>=?1 AND ts<?2),
      pvx AS (SELECT pv, path, vkey, sid, MIN(ts) ts, MAX(CASE WHEN type='time' THEN value END) t, MAX(CASE WHEN type='scroll' THEN value END) sc FROM e WHERE pv IS NOT NULL GROUP BY pv),
      lastpv AS (SELECT sid, pv FROM (SELECT sid, pv, ROW_NUMBER() OVER (PARTITION BY sid ORDER BY ts DESC) rn FROM pvx) WHERE rn=1)
      SELECT path, COUNT(*) views, COUNT(DISTINCT vkey) uniques, ROUND(AVG(t),1) avg_time, ROUND(AVG(IFNULL(sc,0)),0) avg_scroll,
        ROUND(100.0*SUM(pv IN (SELECT pv FROM lastpv))/COUNT(*),1) exit_rate
      FROM pvx GROUP BY path ORDER BY views DESC LIMIT 50`, a, b),
    all(`SELECT IFNULL(source,'direct') k, COUNT(DISTINCT sid) sessions, COUNT(*) pageviews FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY sessions DESC`, a, b),
    all(`SELECT ref_host k, COUNT(DISTINCT sid) sessions FROM events WHERE ts>=? AND ts<? AND type='pageview' AND ref_host IS NOT NULL GROUP BY k ORDER BY sessions DESC LIMIT 20`, a, b),
    all(`SELECT utm_source s, IFNULL(utm_medium,'') m, IFNULL(utm_campaign,'') c, COUNT(DISTINCT sid) sessions, COUNT(*) pageviews FROM events WHERE ts>=? AND ts<? AND type='pageview' AND utm_source IS NOT NULL GROUP BY s,m,c ORDER BY sessions DESC LIMIT 50`, a, b),
    all(`SELECT lead_ref ref, MIN(ts) first, MAX(ts) last, SUM(type='pageview') pages,
        (SELECT IFNULL(SUM(t),0) FROM (SELECT MAX(value) t FROM events x WHERE x.lead_ref=e.lead_ref AND x.type='time' AND x.ts>=?1 AND x.ts<?2 GROUP BY x.pv)) secs,
        MAX(path LIKE '/markets/kazakhstan%') kz, MAX(type='click' AND ${CTA}) cta, MAX(country) country
      FROM events e WHERE ts>=?1 AND ts<?2 AND lead_ref IS NOT NULL GROUP BY lead_ref ORDER BY last DESC LIMIT 200`, a, b),
    all(`SELECT IFNULL(country,'??') k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC LIMIT 20`, a, b),
    all(`SELECT IFNULL(city,'Unknown')||', '||IFNULL(country,'??') k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC LIMIT 20`, a, b),
    all(`SELECT device k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC`, a, b),
    all(`SELECT browser k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC`, a, b),
    all(`SELECT os k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC`, a, b),
    all(`SELECT IFNULL(NULLIF(lang,''),'?') k, COUNT(DISTINCT vkey) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k ORDER BY n DESC LIMIT 15`, a, b),
    all(`SELECT CASE WHEN is_new=1 THEN 'New' ELSE 'Returning' END k, COUNT(*) n FROM events WHERE ts>=? AND ts<? AND type='pageview' GROUP BY k`, a, b),
    all(`SELECT target, path, COUNT(*) n FROM events WHERE ts>=? AND ts<? AND type IN ('click','submit') GROUP BY target, path ORDER BY n DESC LIMIT 100`, a, b),
    all(`SELECT ts, type, path, target, IFNULL(source,'direct') source, country FROM events WHERE ts>=? AND ts<? ORDER BY ts DESC LIMIT 50`, a, b)
  ]);
  return json({ from, to, cur, prev, series, prevSeries, funnel, prevFunnel, pages, sources, referrers, utms, leads, audience: { countries, cities, devices, browsers, oses, langs, newret }, actions, recent });
}

async function funnelQ(DB, a, b) {
  return DB.prepare(`WITH s AS (SELECT sid,
      MAX(type='pageview' AND path='/manufacturers') m, MAX(type='pageview' AND path='/markets') k,
      MAX(type='pageview' AND path='/markets/kazakhstan') z, MAX(type='click' AND ${CTA}) c FROM events WHERE ts>=? AND ts<? GROUP BY sid)
    SELECT SUM(m) s1, SUM(m AND k) s2, SUM(m AND k AND z) s3, SUM(m AND k AND z AND c) s4, SUM(z) kz_any, SUM(z AND c) kz_cta FROM s`).bind(a, b).first();
}
