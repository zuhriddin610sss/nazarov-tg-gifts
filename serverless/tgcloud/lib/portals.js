// Portals Partner API (SINOV). Rasmiy hujjat qo'limizda yo'q: manzil va javob shakli taxminiy.
// /portals buyrug'i Portals qaytargan javobni adminga ko'rsatadi, shunga qarab bu fayl aniqlashtiriladi.
// Kalit admin panel → Sozlamalarda saqlanadi va hech qachon mijozga yoki jurnalga chiqmaydi.
import { fetch } from 'sdk';
import { getSecret, getSettings, logError } from 'lib/core';

export async function portalsConfigured() {
  return Boolean(await getSecret('portals_key'));
}

const sleep = (ms) => new Promise((r) => (typeof setTimeout === 'function' ? setTimeout(r, ms) : r()));
let lastCall = 0;

/** Bitta so'rov. Limit: sekundiga 1 ta, shuning uchun so'rovlar orasida ~1.1 s kutiladi. */
async function request(path, query) {
  const key = String((await getSecret('portals_key')) || '').trim();
  if (!key) return { ok: false, status: 0, text: 'Portals kaliti kiritilmagan', url: path };
  const s = await getSettings();
  // Eski noto'g'ri manzil saqlangan bo'lsa ham, hujjatdagi to'g'ri manzil ishlatiladi
  let base = String(s.portals_base || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base) || /portals-market\.com\/api$/.test(base)) base = 'https://portal-market.com/partners';
  const qs = Object.entries(query || {}).filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  const url = base + path + (qs ? '?' + qs : '');
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `partners ${key}` } });
      const text = await res.text();
      // Sekundiga 1 ta so'rov chegarasi: band bo'lsa bir marta kutib, qayta urinamiz
      if (res.status === 429 && attempt === 0) { await sleep(1200); lastCall = Date.now(); continue; }
      return { ok: res.ok, status: res.status, text, url };
    } catch (e) {
      return { ok: false, status: 0, text: String(e && e.message), url };
    }
  }
}

const low = (x) => String(x || '').trim().toLowerCase();
const attrVal = (it, type) => { const a = (it.attributes || []).find((x) => low(x.type || x.trait_type) === type); return a ? low(a.value) : null; };
/** Javobdan narxlar ro'yxatini ajratib olish. want berilsa, faqat nomi/modeli/foni mos keladiganlar olinadi. */
let labels = new Map();
/** Oxirgi topilgan eng arzon sovg'aning nomi (admin panelda ko'rsatish uchun). */
export const portalsInfo = { label: null };
function pickPrices(data, want) {
  labels = new Map();
  const arr = Array.isArray(data) ? data : data && (data.results || data.items || data.nfts || data.data || data.listings);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (want && it) {
      if (want.collection && low(it.name).replace(/\s*#\s*\d+$/, '') !== low(want.collection)) continue;
      if (want.model && attrVal(it, 'model') !== low(want.model)) continue;
      if (want.backdrop && attrVal(it, 'backdrop') !== low(want.backdrop)) continue;
    }
    const v = it && (it.price ?? it.floor_price ?? it.min_price ?? it.ton_price ?? (it.listing && it.listing.price));
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      const ton = n > 1e6 ? n / 1e9 : n; // nanoTON bo'lsa TON ga
      out.push(ton);
      if (!labels.has(ton)) labels.set(ton, `${it.name || ''}${it.external_collection_number ? ' #' + it.external_collection_number : ''}`.trim());
    }
  }
  return out;
}

const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let colCache = null, colCacheAt = 0;
/** Portals kolleksiyasini nomidan topish (ID, qisqa nom, eng arzon narx). Ro'yxat 1 soat eslab qolinadi. */
export async function portalsCollection(name) {
  if (!colCache || Date.now() - colCacheAt > 3600000) {
    const r = await request('/collections/preview', {});
    if (!r.ok) { await logError('portals', `${r.status} /collections/preview: ${String(r.text).slice(0, 300)}`); return null; }
    try { const d = JSON.parse(r.text); colCache = Array.isArray(d.collections) ? d.collections : []; colCacheAt = Date.now(); } catch (e) { return null; }
  }
  const n = normName(name);
  return colCache.find((c) => normName(c.name) === n || normName(c.short_name) === n)
    || colCache.find((c) => normName(c.name).replace(/s$/, '') === n.replace(/s$/, '')) || null;
}

/** Sotuvdagi eng arzon narx (TON). attrs: { collection, model, backdrop, symbol }. Topilmasa null. */
export async function portalsFloor(attrs) {
  portalsInfo.label = null;
  const col = await portalsCollection(attrs.collection);
  if (!col) return null;
  // Faqat kolleksiya bo'yicha: Portals'ning tayyor "floor" narxi
  if (!attrs.model && !attrs.backdrop && !attrs.symbol) { const f = Number(col.floor_price); if (f > 0) portalsInfo.label = `Portals: ${col.name} (kolleksiya eng arzoni)`; return f > 0 ? f : null; }
  const r = await request('/nfts/search', {
    collection_id: col.id, filter_by_models: attrs.model, filter_by_backdrops: attrs.backdrop, filter_by_symbols: attrs.symbol,
    status: 'listed', sort_by: 'price asc', limit: 5, offset: 0,
  });
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search: ${String(r.text).slice(0, 300)}`); return null; }
  try {
    const p = pickPrices(JSON.parse(r.text), attrs);
    if (!p.length) return null;
    const m = Math.min(...p);
    portalsInfo.label = 'Portals: ' + (labels.get(m) || col.name);
    return m;
  } catch (e) { return null; }
}

/** /portals buyrug'i uchun: so'rov va javobni ko'rsatish (kalitsiz). */
export async function portalsDebug(attrs) {
  const col = await portalsCollection(attrs.collection);
  if (!col) return `Portals'da "${attrs.collection}" kolleksiyasi topilmadi (yoki kalit/manzil xato — Jurnallarga qarang).`;
  const L = [`Kolleksiya: ${col.name} · eng arzoni ${col.floor_price || '—'} TON`];
  if (attrs.model || attrs.backdrop) {
    const r = await request('/nfts/search', {
      collection_id: col.id, filter_by_models: attrs.model, filter_by_backdrops: attrs.backdrop,
      status: 'listed', sort_by: 'price asc', limit: 3, offset: 0,
    });
    let prices = [];
    try { prices = pickPrices(JSON.parse(r.text), attrs); } catch (e) { /* JSON emas */ }
    L.push(`Javob kodi: ${r.status}`, `${[attrs.model, attrs.backdrop].filter(Boolean).join(' + ')}: ${prices.length ? prices.join(', ') + ' TON' : 'sotuvda yo\'q'}`);
    if (!r.ok) L.push('', 'Javob (boshi):', r.text.slice(0, 500));
  }
  return L.join('\n');
}

// ---------- Portals'dagi sotuvdagi giftlar (mijozga katalog) ----------
const attrOf = (it, type) => { const a = (it.attributes || []).find((x) => low(x.type || x.trait_type) === type); return a ? String(a.value) : null; };
/** Portals javobidagi bitta giftni ilova uchun qisqa ko'rinishga keltiradi. */
function saleItem(it) {
  const ton = Number(it.price);
  return {
    id: String(it.id), name: String(it.name || ''), num: it.external_collection_number ?? null,
    photo: /^https:\/\//.test(String(it.photo_url || '')) ? it.photo_url : null,
    model: attrOf(it, 'model'), backdrop: attrOf(it, 'backdrop'), symbol: attrOf(it, 'symbol'),
    ton: Number.isFinite(ton) && ton > 0 ? ton : null,
  };
}
const marketCache = new Map();
/**
 * Sotuvdagi giftlar: bitta so'rovda 30 tagacha. Javob 3 daqiqa eslab qolinadi, shuning uchun
 * ko'p mijoz bir vaqtda ochsa ham Portals'ga ortiqcha so'rov ketmaydi (sekundiga 1 ta chegara).
 * { items, total } yoki null (kalit yo'q yoki Portals javob bermadi).
 */
export async function portalsMarket({ collection = null, offset = 0, sort = 'price asc' } = {}) {
  let colId = null;
  if (collection) { const c = await portalsCollection(collection); if (!c) return { items: [], total: 0 }; colId = c.id; }
  const k = `${colId}|${offset}|${sort}`;
  const hit = marketCache.get(k);
  if (hit && Date.now() - hit.at < 180000) return hit.v;
  const r = await request('/nfts/search', { collection_id: colId, status: 'listed', sort_by: sort, limit: 30, offset });
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search (katalog): ${String(r.text).slice(0, 300)}`); return null; }
  let d; try { d = JSON.parse(r.text); } catch (e) { return null; }
  const v = { items: (Array.isArray(d.results) ? d.results : []).map(saleItem).filter((x) => x.ton), total: Number(d.total_count) || 0 };
  if (marketCache.size > 200) marketCache.clear();
  marketCache.set(k, { at: Date.now(), v });
  return v;
}
/** Bitta giftni Portals ID'si bo'yicha yangidan tekshiradi (buyurtma paytida). Sotuvda bo'lmasa null. */
export async function portalsSaleItem(id) {
  const r = await request('/nfts/search', { ids: id, limit: 1, offset: 0 });
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search?ids: ${String(r.text).slice(0, 300)}`); throw new Error('PORTALS_UNAVAILABLE'); }
  let d; try { d = JSON.parse(r.text); } catch (e) { throw new Error('PORTALS_UNAVAILABLE'); }
  const it = (Array.isArray(d.results) ? d.results : []).find((x) => String(x.id) === String(id));
  if (!it || (it.status && String(it.status) !== 'listed')) return null;
  const out = saleItem(it);
  return out.ton ? out : null;
}
/** Kolleksiyalar nomi (filtr uchun), 1 soat eslab qolinadi. */
export async function portalsCollectionNames() {
  await portalsCollection('');
  return (colCache || []).map((c) => String(c.name)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}
