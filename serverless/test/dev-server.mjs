// Mahalliy sinov serveri: public/ ni beradi va Telegram.WebApp.Serverless.call ni endpointlarga yo'naltiradi.
// Ishga tushirish: node --no-warnings --import ./test/register.mjs test/dev-server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setFetch, sent } from 'sdk';
import { ADMIN_IDS } from '../tgcloud/lib/config.js';
import app from '../tgcloud/endpoints/app.js';
import admin from '../tgcloud/endpoints/admin.js';
import message from '../tgcloud/handlers/message.js';

ADMIN_IDS.push(777);
const ITEMS = ['Plush Pepe #1042', 'Durov\'s Cap #318', 'Precious Peach #2207', 'Swiss Watch #77'].map((n, i) => ({
  nft_address: 'EQ_SAMPLE_ADDRESS_' + i + 'XXXXXX', nft_name: n, owner: 'x',
  attributes: [{ trait_type: 'Model', value: ['Gold', 'Ruby', 'Ocean', 'Mint'][i] }, { trait_type: 'Backdrop', value: ['Black', 'Amber', 'Navy', 'Ivory'][i] }],
  min_duration: 86400, max_duration: 30 * 86400, price_per_day: String([420000000, 750000000, 1100000000, 1500000000][i]), discount_per_day: 0, listed_at: 1 }));
setFetch(async (url) => {
  const body = url.includes('/collections/gifts/') ? [{ name: 'Plush Pepe', address: 'EQ_COLLECTION_PLUSH_PEPE_0001', extra_data: {} }]
    : url.includes('/attributes/') ? { attributes: [{ trait_type: 'Model', values: [{ value: 'Gold', perc: 1.2 }, { value: 'Ruby', perc: 2.5 }] },
        { trait_type: 'Backdrop', values: [{ value: 'Black', perc: 2 }] }, { trait_type: 'Symbol', values: [{ value: 'Crown', perc: 0.4 }] }] }
    : { cursor: null, items: ITEMS };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
});

const root = path.resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
http.createServer(async (req, res) => {
  if (req.url.startsWith('/__call/')) {
    let raw = ''; for await (const c of req) raw += c;
    const { params, user } = JSON.parse(raw);
    const fn = req.url.endsWith('/admin') ? admin : req.url.endsWith('/contact') ? null : app;
    try {
      if (!fn) { await message({ chat: { id: user.id, type: 'private' }, from: user, contact: { user_id: user.id, phone_number: '998901112233' } }); res.end('{}'); return; }
      const result = await fn(params, { initData: { user } });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result }));
    } catch (e) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ err: { message: e.description || e.message, type: 'ENDPOINT_ERROR', parameters: e.parameters || {} } }));
    }
    return;
  }
  if (req.url === '/__sent') { res.end(JSON.stringify(sent.slice(-30))); return; }
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].split('#')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  try { const b = await readFile(p); res.setHeader('content-type', types[path.extname(p)] || 'application/octet-stream'); res.end(b); }
  catch { res.statusCode = 404; res.end('not found'); }
}).listen(3200, () => console.log('http://localhost:3200'));
