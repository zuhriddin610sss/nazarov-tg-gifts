// Gift Satellite API (hujjat: https://gift-satellite.dev/api/docs.md), sarlavha "Authorization: Token <kalit>".
// Bitta kalit bilan 5 ta bozor: Telegram Market, Portals, Tonnel, MRKT, Getgems.
// Bot bu kalitni FAQAT narxlarni o'qish uchun ishlatadi. /user/buy va boshqa yozuvchi so'rovlar kodda yo'q va bo'lmasligi kerak.
// Natijalar bazada saqlanadi: bir xil so'rov 5 daqiqa ichida qayta yuborilmaydi.
import { fetch } from 'sdk';
import { get, all, run, getSecret, getSettings, logError } from 'lib/core';

export const MARKETS = ['tg', 'portals', 'tonnel', 'mrkt', 'getgems'];
export const MARKET_NAME = { tg: 'Telegram Market', telegram: 'Telegram Market', portals: 'Portals', tonnel: 'Tonnel', mrkt: 'MRKT', getgems: 'Getgems' };
export async function satelliteConfigured() {
  return Boolean(await getSecret('satellite_key'));
}

// Serverless muhitida setTimeout bo'lmasligi mumkin: unda kutish soat bo'yicha (qisqa, 2 soniyagacha)
const HAS_TIMER = typeof setTimeout === 'function';
let deadline = 0;
/** Bitta so'rov (masalan "Narxni yangilash") uchun vaqt chegarasi: undan keyin bozorlarga so'rov yuborilmaydi (server vaqti tugamasin). */
export function satBudget(ms) { deadline = ms ? Date.now() + ms : 0; }
// Taymer bo'lmasa kutilmaydi (protsessorni band qilib aylanish server xatosiga olib kelardi)
const sleep = (ms) => {
  const left = deadline ? Math.max(0, deadline - Date.now()) : ms;
  const t = Math.min(ms, left, 1500);
  return HAS_TIMER && t > 0 ? new Promise((r) => setTimeout(r, t)) : Promise.resolve();
};
/** Vaqt chegarasi: taymer bo'lmasa — chegarasiz kutiladi (avval darhol "javob yo'q" qaytib, Gift Satellite hech ishlamay qolardi). */
const withTimeout = (p, ms, onTimeout) => (HAS_TIMER ? Promise.race([p, new Promise((r) => setTimeout(() => r(onTimeout), ms))]) : p);

/**
 * Faqat GET so'rov. Navbat yo'q (Gift Satellite chegarasi keng: sekundiga 2–4 ta, natijalar esa 5 daqiqa saqlanadi).
 * "Band" (429) yoki vaqtinchalik xato bo'lsa, yarim soniya kutib bir marta qayta urinadi.
 */
// Gift Satellite chegarasi: har bir bozorga sekundiga ~2 ta (Telegram Market — 1.5 soniyada 1 ta).
// Bir chaqiruv ichida so'rovlar har bir bozor bo'yicha navbat bilan, oraliq bilan yuboriladi.
const GAP = { tg: 1600, gift: 1100 };
const nextAt = {};
const chain = {};
/** Bir bozorga so'rovlar qat'iy navbat bilan (bir vaqtda faqat bittasi), taymer bo'lsa oraliq bilan. */
function lock(lane) {
  const prev = chain[lane] || Promise.resolve();
  let release;
  chain[lane] = new Promise((r) => (release = r));
  return prev.then(async () => {
    const gap = GAP[lane] || 600, now = Date.now(), at = Math.max(now, nextAt[lane] || 0);
    nextAt[lane] = at + gap;
    if (at > now) await sleep(at - now);
    return release;
  });
}
/** Oxirgi so'rovlar natijasi (tekshiruv oynasi uchun — qayta so'ramaslik). */
export const lastSearch = new Map();
async function request(lane, path, query) {
  const key = String((await getSecret('satellite_key')) || '').trim();
  if (!key) return { ok: false, status: 0, text: 'Gift Satellite kaliti kiritilmagan' };
  const s = await getSettings();
  let base = String(s.satellite_base || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) base = 'https://gift-satellite.dev/api';
  const qs = Object.entries(query || {}).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  const url = base + path + (qs ? '?' + qs : '');
  let last = { ok: false, status: 0, text: '' };
  for (let attempt = 0; attempt < (HAS_TIMER ? 3 : 1); attempt++) {
    if (attempt) await sleep((last.status === 429 ? 1200 : 600) + Math.floor(Math.random() * 300));
    const release = await lock(lane);
    if (deadline && Date.now() > deadline) { release(); return { ok: false, status: 0, text: 'vaqt tugadi' }; }
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Token ${key}` } });
      last = { ok: res.ok, status: res.status, text: await res.text() };
    } catch (e) {
      last = { ok: false, status: 0, text: String(e && e.message) };
    } finally {
      release();
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
const colSlug = (x) => (x === 'all-collections' ? x : String(x || '').replace(/[^A-Za-z0-9]/g, ''));
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
/** Ko'rilgan kolleksiyalarning barcha bozorlardagi eng arzoni (oxirgi 1 soat): { normNomi: TON }. */
export async function satCachedFloors() {
  const rows = await all("SELECT k, v FROM portals_cache WHERE k LIKE 'gs:floor:%' AND at > :t", { t: Date.now() - 3600000 });
  return Object.fromEntries(rows.map((r) => [r.k.slice(9), Number(JSON.parse(r.v))]));
}
export const normName = norm;
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
const sKey = (market, colName, f) => market + '|' + colName + '|' + (f.model || '') + '|' + (f.backdrop || '') + '|' + (f.symbol || '') + '|' + (f.num ?? '');
async function searchMarket(market, colName, f, opt) {
  const r = await searchMarket0(market, colName, f, opt);
  lastSearch.set(sKey(market, colName, f), r);
  return r;
}
async function searchMarket0(market, colName, f, { fresh = false } = {}) {
  const q = { models: f.model || null, backdrops: f.backdrop || null, symbols: f.symbol || null, number: f.num != null ? String(f.num).slice(0, 6) : null };
  const k = 'gs:s:' + market + ':' + colName + ':' + JSON.stringify(q);
  const c = fresh ? null : await cacheGet(k, 300000);
  if (c && c.fresh) return { ok: true, items: c.v };
  // Gift Satellite kolleksiya nomini probelsiz kutadi: "Balls Ice Cream" -> "BallsIceCream", "Durov's Cap" -> "DurovsCap"
  // Kolleksiya nomi: eski kolleksiyalar probelsiz ("PlushPepe"), yangilari esa ro'yxatdagidek probel bilan ("Jingle Bells").
  // Avval eslab qolingan usul, keyin ikkinchisi; "Неверный формат коллекции" (400) bo'lsa boshqasini sinaymiz.
  const known = colName === 'all-collections' ? null : await cacheGet('gs:slug:' + colName, 7 * 86400000);
  const variants = [...new Set([...(known ? [known.v] : []), colSlug(colName), colName])];
  let r;
  for (const v of variants) {
    r = await request(market, `/search/${market}/${encodeURIComponent(v)}`, q);
    if (r.ok) { if (colName !== 'all-collections' && (!known || known.v !== v)) await cachePut('gs:slug:' + colName, v); break; }
    if (!(r.status === 400 && /коллекц|collection/i.test(String(r.text)))) break;
  }
  // Bozor yo'li umuman yo'q (404 "Route … not found") — bu bozor qidiruvi ishlamaydi: bo'sh deb olamiz, butun natijani buzmaydi
  if (!r.ok && r.status === 404 && /route/i.test(String(r.text))) return { ok: true, items: [] };
  if (!r.ok) {
    await logError('satellite', `${r.status} /search/${market}/${colName}: ${String(r.text).slice(0, 200)}`);
    return c ? { ok: true, items: c.v } : { ok: false, status: r.status, text: String(r.text || '').slice(0, 120) };
  }
  let items;
  try { const d = JSON.parse(r.text); items = (Array.isArray(d) ? d : []).map(listingOut).filter((x) => x.ton); }
  catch (e) {
    await logError('satellite', `JSON emas /search/${market}/${colName}: ${String(r.text).slice(0, 200)}`);
    return c ? { ok: true, items: c.v } : { ok: false, status: r.status, text: 'JSON emas: ' + String(r.text).slice(0, 80) };
  }
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
  const res = await Promise.all(markets.map((m) => withTimeout(searchMarket(m, colName, f).catch(() => ({ ok: false })), 15000, { ok: false })));
  let items = [], okAny = false, failed = 0;
  for (const r of res) if (r.ok) { okAny = true; items = items.concat(r.items); } else failed++;
  if (!okAny) return null;
  // Kolleksiya filtrsiz ochilganda: uning barcha bozorlardagi eng arzonini eslab qolamiz ("… so'mdan" uchun)
  if (colName !== 'all-collections' && !f.model && !f.backdrop && !f.symbol && f.num == null && items.length) {
    await cachePut('gs:floor:' + norm(colName), Math.min(...items.map((x) => x.ton)));
  }
  // Bitta gift bir nechta bozorda bo'lsa — eng arzoni qoladi
  const best = new Map();
  for (const it of items) { const k = it.name + '#' + it.num; if (!best.has(k) || it.ton < best.get(k).ton) best.set(k, it); }
  // partial: kamida bitta bozor javob bermadi (natija to'liq emas)
  return { items: [...best.values()].sort((a, b) => a.ton - b.ton), partial: failed > 0 };
}

/**
 * Model / fon bo'yicha eng arzon narx (hamma bozorlarda). attrs: { collection, model, backdrop }.
 * { status: 'ok', ton, label } | { status: 'none' } | { status: 'error' }
 */
export async function satFloor(attrs) {
  if (!attrs.model && !attrs.backdrop) return { status: 'none' };
  const low = (x) => String(x || '').trim().toLowerCase();
  // Model + fon: bozorning birlashgan filtri ba'zan aynan shu giftni qaytarmaydi. Shuning uchun uch xil qidiramiz
  // (model + fon, faqat model, faqat fon) va natijalardan aynan model + fon mos kelganini o'zimiz ajratamiz.
  const qs = attrs.model && attrs.backdrop
    ? [{ model: attrs.model }, { backdrop: attrs.backdrop }]
    : [{ model: attrs.model || null, backdrop: attrs.backdrop || null }];
  const rs = await Promise.all(qs.map((q) => satMarket({ collection: attrs.collection, ...q }).catch(() => null)));
  if (rs.every((x) => !x)) return { status: 'error' };
  const r = { items: rs.filter(Boolean).flatMap((x) => x.items).sort((a, b) => a.ton - b.ton), partial: rs.some((x) => !x || x.partial) };
  const it = r.items.find((x) => (!attrs.model || low(x.model) === low(attrs.model)) && (!attrs.backdrop || low(x.backdrop) === low(attrs.backdrop)));
  if (it) return { status: 'ok', ton: it.ton, label: `${MARKET_NAME[it.market] || it.market}: ${it.name} #${it.num}` };
  // Bozorlardan biri javob bermagan bo'lsa "yo'q" deb bo'lmaydi: u yerda aynan shu gift bo'lishi mumkin.
  // Aks holda keyingi (kengroq, arzonroq) usulga o'tib, gift arzon baholanib qoladi — narx o'zgarmaydi.
  return r.partial ? { status: 'error' } : { status: 'none' };
}

/**
 * Admin uchun tekshiruv: har bir bozor va har bir qidiruv (model + fon, model, fon) nima qaytardi.
 * Keshsiz. Qatorlar: "MRKT · model: 23 ta, aynan mos: 30.6 TON" yoki "MRKT · model: javob yo'q (503)".
 */
export async function satDebug(attrs) {
  const col = await satCollection(attrs.collection);
  if (col === undefined) return ["Gift Satellite: kolleksiyalar ro'yxati kelmadi (kalit yoki internet)"];
  if (!col) return [`Gift Satellite: "${attrs.collection}" kolleksiyasi topilmadi`];
  const low = (x) => String(x || '').trim().toLowerCase();
  const qs = [['model', { model: attrs.model }], ['fon', { backdrop: attrs.backdrop }]]
    .filter(([, q]) => (q.model || q.backdrop) && (!('backdrop' in q) || q.backdrop) && (!('model' in q) || q.model));
  const out = [`Qidiruv: ${col} · model: ${attrs.model || '—'} · fon: ${attrs.backdrop || '—'}`];
  for (const [label, q] of qs) {
    const res = MARKETS.map((m) => lastSearch.get(sKey(m, col, q)) || { ok: false, skipped: true });
    res.forEach((r, k) => {
      const name = MARKET_NAME[MARKETS[k]];
      if (r.skipped) { out.push(`${name} · ${label}: so'ralmadi (vaqt yetmadi yoki kerak bo'lmadi)`); return; }
      if (!r.ok) { out.push(`${name} · ${label}: javob yo'q${r.to ? ' (20 soniyada kelmadi)' : r.status != null ? ` (xato ${r.status}${r.text ? ': ' + r.text : ''})` : ''}`); return; }
      const ex = r.items.filter((x) => (!attrs.model || low(x.model) === low(attrs.model)) && (!attrs.backdrop || low(x.backdrop) === low(attrs.backdrop))).sort((a, b) => a.ton - b.ton)[0];
      out.push(`${name} · ${label}: ${r.items.length} ta${ex ? `, aynan mos: ${ex.ton} TON (#${ex.num})` : ''}`);
    });
  }
  return out;
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
