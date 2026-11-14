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
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `partners ${key}` } });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, url };
  } catch (e) {
    return { ok: false, status: 0, text: String(e && e.message), url };
  }
}

const low = (x) => String(x || '').trim().toLowerCase();
const attrVal = (it, type) => { const a = (it.attributes || []).find((x) => low(x.type || x.trait_type) === type); return a ? low(a.value) : null; };
/** Javobdan narxlar ro'yxatini ajratib olish. want berilsa, faqat nomi/modeli/foni mos keladiganlar olinadi. */
function pickPrices(data, want) {
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
    if (Number.isFinite(n) && n > 0) out.push(n > 1e6 ? n / 1e9 : n); // nanoTON bo'lsa TON ga
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
  const col = await portalsCollection(attrs.collection);
  if (!col) return null;
  // Faqat kolleksiya bo'yicha: Portals'ning tayyor "floor" narxi
  if (!attrs.model && !attrs.backdrop && !attrs.symbol) { const f = Number(col.floor_price); return f > 0 ? f : null; }
  const r = await request('/nfts/search', {
    collection_id: col.id, filter_by_models: attrs.model, filter_by_backdrops: attrs.backdrop, filter_by_symbols: attrs.symbol,
    status: 'listed', sort_by: 'price asc', limit: 5, offset: 0,
  });
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search: ${String(r.text).slice(0, 300)}`); return null; }
  try { const p = pickPrices(JSON.parse(r.text), attrs); return p.length ? Math.min(...p) : null; } catch (e) { return null; }
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
