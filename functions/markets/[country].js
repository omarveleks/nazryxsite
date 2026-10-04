import markets from '../../content/markets/index.js';
import { renderMarket } from '../_lib/market.js';
export const onRequestGet = ({ params, next }) => {
  const m = markets.find((x) => x.slug === String(params.country).toLowerCase());
  if (!m) return next();
  return new Response(renderMarket(m), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
