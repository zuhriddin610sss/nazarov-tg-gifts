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

/** Javobdan narxlar ro'yxatini ajratib olish (bir nechta ehtimoliy shakl). */
function pickPrices(data) {
  const arr = Array.isArray(data) ? data : data && (data.results || data.items || data.nfts || data.data || data.listings);
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const v = it && (it.price ?? it.floor_price ?? it.min_price ?? it.ton_price ?? (it.listing && it.listing.price));
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out.push(n > 1e6 ? n / 1e9 : n); // nanoTON bo'lsa TON ga
  }
  return out;
}

/** Sotuvdagi eng arzon narx (TON). attrs: { collection, model, backdrop, symbol }. Topilmasa null. */
export async function portalsFloor(attrs) {
  const r = await request('/nfts/search', {
    offset: 0, limit: 5, sort_by: 'price asc', status: 'listed',
    filter_by_collections: attrs.collection, filter_by_models: attrs.model, filter_by_backdrops: attrs.backdrop, filter_by_symbols: attrs.symbol,
  });
  if (!r.ok) { await logError('portals', `${r.status} ${r.url.replace(/\?.*$/, '')}: ${String(r.text).slice(0, 300)}`); return null; }
  try { const p = pickPrices(JSON.parse(r.text)); return p.length ? Math.min(...p) : null; } catch (e) { return null; }
}

/** /portals buyrug'i uchun: so'rov va javobni ko'rsatish (kalitsiz). */
export async function portalsDebug(attrs) {
  const r = await request('/nfts/search', {
    offset: 0, limit: 3, sort_by: 'price asc', status: 'listed',
    filter_by_collections: attrs.collection, filter_by_models: attrs.model, filter_by_backdrops: attrs.backdrop,
  });
  let prices = [];
  try { prices = pickPrices(JSON.parse(r.text)); } catch (e) { /* JSON emas */ }
  return [`Portals so'rovi: ${r.url}`, `Javob kodi: ${r.status}`, `Topilgan narxlar (TON): ${prices.length ? prices.join(', ') : 'yo\'q'}`, '', 'Javob (boshi):', r.text.slice(0, 700)].join('\n');
}
