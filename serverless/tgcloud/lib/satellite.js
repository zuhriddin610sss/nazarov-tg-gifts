// Gift Satellite API (hujjat: https://gift-satellite.dev/api/docs.md), sarlavha "Authorization: Token <kalit>".
// Bitta kalit bilan 5 ta bozor: Telegram Market, Portals, Tonnel, MRKT, Getgems.
// Bot bu kalitni FAQAT narxlarni o'qish uchun ishlatadi. /user/buy va boshqa yozuvchi so'rovlar kodda yo'q va bo'lmasligi kerak.
// Navbat va natijalar bazada saqlanadi: bot bir nechta nusxada ishlasa ham chegaradan oshmaydi.
import { fetch } from 'sdk';
import { get, run, getSecret, getSettings, logError } from 'lib/core';

export const MARKETS = ['tg', 'portals', 'tonnel', 'mrkt', 'getgems'];
export const MARKET_NAME = { tg: 'Telegram Market', telegram: 'Telegram Market', portals: 'Portals', tonnel: 'Tonnel', mrkt: 'MRKT', getgems: 'Getgems' };
// So'rovlar orasidagi eng kam vaqt (ms): tg — 1 ta / 1.5 s, boshqa bozorlar — 2 ta / s, ma'lumotnoma — 4 ta / s
const GAP = { tg: 1600, portals: 550, tonnel: 550, mrkt: 550, getgems: 550, gift: 300 };
const MAX_WAIT = 8000;

export async function satelliteConfigured() {
  return Boolean(await getSecret('satellite_key'));
}

const sleep = (ms) => new Promise((r) => (typeof setTimeout === 'function' ? setTimeout(r, ms) : r()));
async function takeSlot(lane) {
  const gap = GAP[lane] || 1000, until = Date.now() + MAX_WAIT, key = 'gs_slot_' + lane;
  for (;;) {
    const now = Date.now();
    const r = await run(`INSERT INTO meta (key, value) VALUES (:k, :now)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) <= :limit`, { k: key, now: String(now), limit: now - gap });
    if (r.rowsAffected === 1) return true;
    if (Date.now() > until) return false;
    const row = await get('SELECT value FROM meta WHERE key = :k', { k: key });
    const wait = row ? Number(row.value) + gap - Date.now() : 100;
    await sleep(Math.max(30, Math.min(gap, wait)) + Math.floor(Math.random() * 80));
  }
}

/** Faqat GET so'rov. 429 yoki vaqtinchalik xato bo'lsa, navbatdan yangi joy olib bir marta qayta urinadi. */
async function request(lane, path, query) {
  const key = String((await getSecret('satellite_key')) || '').trim();
  if (!key) return { ok: false, status: 0, text: 'Gift Satellite kaliti kiritilmagan' };
  const s = await getSettings();
  let base = String(s.satellite_base || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) base = 'https://gift-satellite.dev/api';
  const qs = Object.entries(query || {}).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  const url = base + path + (qs ? '?' + qs : '');
  let last = { ok: false, status: 429, text: 'navbat band' };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await takeSlot(lane))) return last;
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Token ${key}` } });
      last = { ok: res.ok, status: res.status, text: await res.text() };
    } catch (e) {
      last = { ok: false, status: 0, text: String(e && e.message) };
    }
    if (last.status !== 429 && last.status < 500 && last.status !== 0) return last;
  }
  return last;
}

// ---------- bazadagi kesh (portals_cache jadvali, "gs:" bilan) ----------
async function cacheGet(k, maxAgeMs) {
  const row = await get('SELECT v, at FROM portals_cache WHERE k = :k', { k });
  return row ? { v: JSON.parse(row.v), fresh: Date.now() - Number(row.at) < maxAgeMs } : null;
}
async function cachePut(k, v) {
  await run('INSERT INTO portals_cache (k, v, at) VALUES (:k, :v, :at) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at', { k, v: JSON.stringify(v), at: Date.now() });
  if (Math.random() < 0.05) await run("DELETE FROM portals_cache WHERE k LIKE 'gs:s:%' AND at < :t", { t: Date.now() - 86400000 });
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** "PlushPepe" -> "Plush Pepe" (ko'rsatish uchun). */
export const spaced = (n) => String(n || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');

/** Kolleksiyalar ro'yxati (Gift Satellite nomlari). Bazada 1 kun. null — javob yo'q. */
async function collections() {
  const c = await cacheGet('gs:collections', 86400000);
  if (c && c.fresh) return c.v;
  const r = await request('gift', '/gift/collections', {});
  if (r.ok) {
    try { const d = JSON.parse(r.text); const list = (Array.isArray(d) ? d : []).map((x) => String(x.name)).filter(Boolean); if (list.length) { await cachePut('gs:collections', list); return list; } } catch (e) { /* JSON emas */ }
  } else await logError('satellite', `${r.status} /gift/collections: ${String(r.text).slice(0, 300)}`);
  return c ? c.v : null;
}
/** Ilovadagi kolleksiya nomini ("Durov's Cap") Gift Satellite nomiga ("DurovsCap") moslash. null — topilmadi, undefined — javob yo'q. */
export async function satCollection(name) {
  const list = await collections();
  if (!list) return undefined;
  const n = norm(name);
  return list.find((x) => norm(x) === n) || list.find((x) => norm(x).replace(/s$/, '') === n.replace(/s$/, '')) || null;
}
export async function satCollectionNames() {
  return ((await collections()) || []).map(spaced).sort((a, b) => a.localeCompare(b));
}

/** Bitta e'lonni ilova ko'rinishiga keltirish. */
function listingOut(l) {
  const slug = String(l.slug || '');
  const m = /^(.*?)-(\d+)$/.exec(slug);
  const market = String(l.market || '').toLowerCase() === 'telegram' ? 'tg' : String(l.market || '').toLowerCase();
  return {
    // ID ichida bozor nomi emas, raqami (mijozga bozor nomi ko'rinmasligi uchun)
    id: `gs${MARKETS.indexOf(market)}:${l.giftId}:${slug}`, market,
    name: spaced(l.collectionName || (m ? m[1] : slug)), num: m ? Number(m[2]) : null, photo: null,
    model: l.modelName || null, backdrop: l.backdropName || null, symbol: l.symbolName || null,
    ton: Number(l.normalizedPrice) > 0 ? Number(l.normalizedPrice) : null, link: /^https:\/\//.test(String(l.link || '')) ? l.link : null,
  };
}

/**
 * Bitta bozordagi qidiruv (eng arzonidan, 50 tagacha). Natija bazada 5 daqiqa.
 * { ok: true, items } yoki { ok: false } (javob yo'q).
 */
async function searchMarket(market, colName, f, { fresh = false } = {}) {
  const q = { models: f.model || null, backdrops: f.backdrop || null, symbols: f.symbol || null, number: f.num != null ? String(f.num).slice(0, 6) : null };
  const k = 'gs:s:' + market + ':' + colName + ':' + JSON.stringify(q);
  const c = fresh ? null : await cacheGet(k, 300000);
  if (c && c.fresh) return { ok: true, items: c.v };
  const r = await request(market, `/search/${market}/${encodeURIComponent(colName)}`, q);
  if (!r.ok) {
    await logError('satellite', `${r.status} /search/${market}/${colName}: ${String(r.text).slice(0, 200)}`);
    return c ? { ok: true, items: c.v } : { ok: false };
  }
  let items;
  try { const d = JSON.parse(r.text); items = (Array.isArray(d) ? d : []).map(listingOut).filter((x) => x.ton); } catch (e) { return c ? { ok: true, items: c.v } : { ok: false }; }
  await cachePut(k, items);
  return { ok: true, items };
}

/**
 * Hamma bozorlardan sotuvdagi giftlar (birlashtirilgan, narx bo'yicha). f: { collection, model, backdrop, symbol, num }.
 * { items } yoki null (hech bir bozor javob bermadi).
 */
export async function satMarket(f = {}) {
  let colName = 'all-collections';
  if (f.collection) {
    const c = await satCollection(f.collection);
    if (c === undefined) return null;
    if (!c) return { items: [] };
    colName = c;
  }
  const markets = colName === 'all-collections' ? MARKETS.filter((m) => m !== 'tg') : MARKETS;
  // Hamma bozorlardan bir vaqtda (har birining o'z navbati bor). 6 soniyada javob bermagani kutilmaydi.
  const timeout = (ms) => new Promise((r) => (typeof setTimeout === 'function' ? setTimeout(() => r({ ok: false }), ms) : r({ ok: false })));
  const res = await Promise.all(markets.map((m) => Promise.race([searchMarket(m, colName, f).catch(() => ({ ok: false })), timeout(6000)])));
  let items = [], okAny = false;
  for (const r of res) if (r.ok) { okAny = true; items = items.concat(r.items); }
  if (!okAny) return null;
  // Bitta gift bir nechta bozorda bo'lsa — eng arzoni qoladi
  const best = new Map();
  for (const it of items) { const k = it.name + '#' + it.num; if (!best.has(k) || it.ton < best.get(k).ton) best.set(k, it); }
  return { items: [...best.values()].sort((a, b) => a.ton - b.ton) };
}

/**
 * Model / fon bo'yicha eng arzon narx (hamma bozorlarda). attrs: { collection, model, backdrop }.
 * { status: 'ok', ton, label } | { status: 'none' } | { status: 'error' }
 */
export async function satFloor(attrs) {
  if (!attrs.model && !attrs.backdrop) return { status: 'none' };
  const r = await satMarket({ collection: attrs.collection, model: attrs.model, backdrop: attrs.backdrop });
  if (!r) return { status: 'error' };
  const low = (x) => String(x || '').trim().toLowerCase();
  const it = r.items.find((x) => (!attrs.model || low(x.model) === low(attrs.model)) && (!attrs.backdrop || low(x.backdrop) === low(attrs.backdrop)));
  return it ? { status: 'ok', ton: it.ton, label: `${MARKET_NAME[it.market] || it.market}: ${it.name} #${it.num}` } : { status: 'none' };
}

/** Buyurtma paytida: shu gift hali shu bozorda sotuvdami va narxi qancha (keshsiz). null — sotuvda yo'q. */
export async function satSaleItem(id) {
  const m = /^gs(\d):([^:]+):(.+)$/.exec(String(id));
  if (!m || !MARKETS[Number(m[1])]) return null;
  const market = MARKETS[Number(m[1])], slug = m[3];
  const sm = /^(.*?)-(\d+)$/.exec(slug);
  if (!sm) return null;
  const col = await satCollection(sm[1]);
  if (col === undefined) throw new Error('SATELLITE_UNAVAILABLE');
  if (!col) return null;
  const r = await searchMarket(market, col, { num: sm[2] }, { fresh: true });
  if (!r.ok) throw new Error('SATELLITE_UNAVAILABLE');
  return r.items.find((x) => String(x.id) === String(id)) || r.items.find((x) => x.num === Number(sm[2]) && x.market === market) || null;
}
