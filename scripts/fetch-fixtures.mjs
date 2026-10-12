// Regenerates the BTC/USDT candle fixtures used by the indicator tests (KuCoin, ends 2026-10-12 00:00 UTC).
import ccxt from 'ccxt';
import fs from 'node:fs';

const out = process.argv[2] ?? 'src/shared/indicator/__fixtures__';
const e = new ccxt.kucoin({ enableRateLimit: true, httpsProxy: process.env.HTTPS_PROXY });
const end = Date.parse('2026-10-12T00:00:00Z');

async function get(tf, count, tfMs) {
  const all = new Map();
  let since = end - count * tfMs;
  while (since < end) {
    const batch = await e.fetchOHLCV('BTC/USDT', tf, since, 1500);
    if (!batch.length) break;
    for (const c of batch) if (c[0] < end) all.set(c[0], c.slice(0, 6));
    const last = batch[batch.length - 1][0];
    if (last + tfMs <= since) break;
    since = last + tfMs;
  }
  return [...all.values()].sort((a, b) => a[0] - b[0]);
}

const h1 = await get('1h', 2000, 3600e3);
const h4 = await get('4h', 600, 4 * 3600e3);
fs.writeFileSync(`${out}/btc-usdt-1h.json`, JSON.stringify(h1));
fs.writeFileSync(`${out}/btc-usdt-4h.json`, JSON.stringify(h4));
console.log(h1.length, h1.length && new Date(h1[0][0]).toISOString(), h4.length);
