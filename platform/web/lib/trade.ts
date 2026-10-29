import type { Db } from './db';
import { one, rows } from './db';

// Medicine imports a market reported to UN Comtrade (HS 3004, medicines in doses): the latest year's total and change,
// where they come from, and the HS6 split. Read monthly by the worker into trade_flows.
export type Imports = {
  years: { year: number; value: number; kg: number | null }[];
  latest: { year: number; value: number; kg: number | null } | null;
  change: number | null;                    // against the year before, as a fraction
  origins: { name: string; iso: string | null; value: number; share: number }[];
  lines: { hs: string; label: string; value: number; share: number }[];
  bulk: number | null;                      // HS 3003 in the latest year
  read_at: string | null;
};

export async function imports(db: Db, country: string): Promise<Imports | null> {
  const years = await rows(db, `select year, value_usd::float as value, kg::float as kg from trade_flows
      where country = $1 and hs = '3004' and partner = '0' and value_usd is not null order by year`, [country]);
  if (years.length === 0) return null;
  const latest = years[years.length - 1], prev = years.length > 1 ? years[years.length - 2] : null;
  const origins = await rows(db, `select coalesce(partner_name, 'Partner ' || partner) as name, partner_iso as iso, value_usd::float as value
      from trade_flows where country = $1 and hs = '3004' and year = $2 and partner <> '0' and value_usd is not null order by value_usd desc limit 10`, [country, latest.year]);
  const lines = await rows(db, `select t.hs, l.label, t.value_usd::float as value from trade_flows t join hs_labels l on l.hs = t.hs
      where t.country = $1 and t.year = $2 and t.partner = '0' and length(t.hs) = 6 and t.value_usd is not null order by t.value_usd desc`, [country, latest.year]);
  const bulk = await one(db, `select value_usd::float as value from trade_flows where country = $1 and hs = '3003' and partner = '0' and year = $2`, [country, latest.year]);
  const read = await one(db, 'select max(read_at)::text as read_at from trade_flows where country = $1', [country]);
  const linesTotal = lines.reduce((t, l) => t + l.value, 0) || latest.value;
  return {
    years, latest, change: prev && prev.value ? latest.value / prev.value - 1 : null,
    origins: origins.map((o) => ({ ...o, share: latest.value ? o.value / latest.value : 0 })),
    lines: lines.map((l) => ({ ...l, share: linesTotal ? l.value / linesTotal : 0 })),
    bulk: bulk?.value ?? null, read_at: read?.read_at ?? null,
  };
}

/** $365m, $29.9m, $820k */
export function musd(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}bn`;
  if (v >= 1e7) return `$${Math.round(v / 1e6)}m`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

/** The share of a country's medicine imports that a figure is: 'a fifth', '3%'. */
export const pct = (share: number) => `${share < 0.01 && share > 0 ? '<1' : Math.round(share * 100)}%`;
