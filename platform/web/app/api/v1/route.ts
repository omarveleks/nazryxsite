import { json } from '@/lib/api';
export const dynamic = 'force-dynamic';
/** GET /api/v1: what the read API offers. */
export async function GET() {
  return json({
    name: 'Nazryx read API', auth: 'Authorization: Bearer nzx_… (keys under Settings › API; Complete Market Access and up)', rate_limit: '120 calls a minute per key',
    endpoints: {
      '/api/v1/markets': 'the markets in the plan and what we hold on each',
      '/api/v1/molecules?market=TZ': 'every molecule in a market: competition, demand, essential list, median price; filters category, max, demand, essential, form, price, q',
      '/api/v1/prices?market=TZ&molecule=ID': 'median shelf prices with sources and confidence; daily history for one molecule',
      '/api/v1/registrations?market=TZ&molecule=ID': 'every registered product of a molecule, with holder',
      '/api/v1/tenders?market=TZ': 'public medicine tenders; filters stage, since, molecule',
      '/api/v1/imports?market=TZ': 'medicine imports by year, HS line and origin (UN Comtrade)',
      '/api/v1/products': 'your catalogue with its market facts',
    },
  });
}
