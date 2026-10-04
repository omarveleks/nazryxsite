import markets from '../../content/markets/index.js';
import { renderIndex } from '../_lib/market.js';
export const onRequestGet = () => new Response(renderIndex(markets), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
