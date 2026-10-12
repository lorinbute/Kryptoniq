// End-to-end smoke test against the real internet without opening a port: fetches all sources, scores
// sentiment, refreshes calendar/market data and exercises the API through fastify.inject.
// Usage: KRYPTONIQ_DATA_DIR=/tmp/kq npm run smoke   (uses a separate data dir; never your real one by accident)
import path from 'node:path';
import { loadConfig } from '../src/server/config.ts';
import { createContext } from '../src/server/context.ts';
import { buildApp } from '../src/server/http/app.ts';
import { createLogger } from '../src/server/log.ts';
import { fetchDueSources } from '../src/server/news/fetcher.ts';
import { refreshContext } from '../src/server/market/context.ts';

if (!process.env.KRYPTONIQ_DATA_DIR) {
  console.error('Set KRYPTONIQ_DATA_DIR to a scratch directory (the smoke test must not touch your real data).');
  process.exit(1);
}
const config = loadConfig();
const log = createLogger(path.join(config.dataDir, 'logs'), true);
const ctx = createContext(config, log);
const app = await buildApp(ctx);
const H = { host: '127.0.0.1:4317' };
const t0 = Date.now();
const ctxRes = await refreshContext(ctx.db); ctx.coins.invalidate();
console.log('context', ctxRes, Date.now() - t0, 'ms');
const r = await fetchDueSources(ctx.db, ctx.coins, log);
console.log('fetch', r.length, 'sources', r.filter(x=>x.ok).length, 'ok', r.reduce((a,b)=>a+b.inserted,0), 'inserted', Date.now() - t0, 'ms');
for (const x of r.filter(x=>!x.ok)) console.log('  FAIL', x.sourceId, x.error);
ctx.nli.warmUp();
for (let i=0;i<120 && ctx.nli.status().state!=='ready' && ctx.nli.status().state!=='failed';i++) await new Promise(r=>setTimeout(r,1000));
console.log('model', ctx.nli.status());
let n=0; for (let i=0;i<40;i++){ const k = await ctx.sentiment.scorePending(undefined, 64); n+=k; if(!k) break; }
console.log('scored', n, 'pending', ctx.sentiment.pendingCount(), Date.now()-t0,'ms');
await ctx.calendar.refreshForexFactory().catch(e=>console.log('ff err', e.message));
await ctx.calendar.refreshTradingView().catch(e=>console.log('tv err', e.message));
const get = async (url: string) => { const res = await app.inject({ method: 'GET', url, headers: H }); return { status: res.statusCode, body: res.json() as any }; };
const today = await get('/api/sentiment/today');
console.log('today', today.status, { index: today.body.index, conf: today.body.confidence, counts: today.body.counts, breakdown: Object.fromEntries(Object.entries(today.body.breakdown).map(([k,v]:any)=>[k,v.index+' ('+v.count+')'])) });
console.log('drivers+', today.body.drivers.positive.map((d:any)=>d.sentiment.toFixed(2)+' '+d.title.slice(0,90)));
console.log('drivers-', today.body.drivers.negative.map((d:any)=>d.sentiment.toFixed(2)+' '+d.title.slice(0,90)));
const news = await get('/api/news?range=24h&limit=15');
console.log('news', news.status, news.body.items.length, news.body.nextCursor);
for (const it of news.body.items.slice(0,15)) console.log(' ', (it.sentiment?.score ?? NaN).toFixed(2).padStart(5), it.sentiment?.engine, '|', it.source.name, '|', it.coins.join(','), '|', it.title.slice(0,90), it.related.length?'+'+it.related.length:'');
const fav = await get('/api/news?range=24h&favorites=1&limit=5');
console.log('favorites', fav.status, fav.body.favorites, fav.body.items.map((i:any)=>i.coins.join(',')+' '+i.title.slice(0,60)));
const now = Date.now();
const cal = await get(`/api/calendar?from=${now-86400000}&to=${now+5*86400000}&impact=High`);
console.log('calendar', cal.status, cal.body.events.length, cal.body.events.slice(0,8).map((e:any)=>new Date(e.ts).toISOString().slice(5,16)+' '+e.currency+' '+e.title+' a='+e.actual+' f='+e.forecast+' m='+e.matched));
const candles = await get('/api/market/candles?symbol=BTC/USDT&tf=1h&limit=1500');
console.log('candles', candles.status, candles.body.candles?.length, candles.body.pricePrecision, candles.body.lastClosedIndex, candles.body.error);
const sym = await get('/api/market/symbols?q=SOL');
console.log('symbols', sym.status, sym.body.slice?.(0,5));
const bad = await get('/api/market/candles?symbol=NOPE/USDT&tf=1h');
console.log('bad symbol', bad.status, bad.body);
const scan = await ctx.scanner.run();
console.log('scanner', scan.rows.map(r=>[r.symbol, r.ok, r.uptrend, r.lastSignal?.outcome, r.error]));
const health = await get('/api/health');
console.log('health', health.status, health.body.sentiment, health.body.db);
const csrf = await app.inject({ method: 'PUT', url: '/api/settings', headers: H, payload: { timezone: 'UTC' } });
console.log('csrf', csrf.statusCode);
const rebinding = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.com' } });
console.log('rebinding', rebinding.statusCode);
await app.close(); ctx.db.close();
