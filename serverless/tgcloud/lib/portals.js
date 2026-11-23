// Portals Partner API (https://portal-market.com/partners, sarlavha "Authorization: partners <kalit>").
// Bepul tarif: sekundiga 1 ta so'rov. Bot bir vaqtda bir nechta nusxada ishlashi mumkin, shuning uchun
// navbat ham, natijalar ham bazada saqlanadi (xotirada emas): hamma nusxalar bitta navbatdan foydalanadi.
// Kalit admin panel → Sozlamalarda saqlanadi va hech qachon mijozga yoki jurnalga chiqmaydi.
import { fetch } from 'sdk';
import { get, run, getSecret, getSettings, logError, takeLock, lockTime } from 'lib/core';

export async function portalsConfigured() {
  return Boolean(await getSecret('portals_key'));
}

const sleep = (ms) => (typeof setTimeout === 'function' ? new Promise((r) => setTimeout(r, ms)) : (async () => { const end = Date.now() + Math.min(ms, 2000); while (Date.now() < end) await Promise.resolve(); })());
const GAP = 1100;        // so'rovlar orasidagi eng kam vaqt (ms)
const MAX_WAIT = 8000;   // navbatda ko'pi bilan shuncha kutiladi

/** Umumiy navbatdan joy olish: oldingi so'rovdan beri GAP o'tgan bo'lsa true. Hamma nusxalar uchun bitta. */
async function takeSlot() {
  const until = Date.now() + MAX_WAIT;
  for (;;) {
    if (await takeLock('portals_slot', GAP)) return true;
    if (Date.now() > until) return false;
    const wait = (await lockTime('portals_slot')) + GAP - Date.now();
    await sleep(Math.max(50, Math.min(GAP, wait)) + Math.floor(Math.random() * 120));
  }
}

/** Bitta so'rov (navbat bilan). 429 kelsa, navbatdan yangi joy olib, bir marta qayta urinadi. */
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
  let last = { ok: false, status: 429, text: 'navbat band', url };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await takeSlot())) return last;
    try {
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `partners ${key}` } });
      last = { ok: res.ok, status: res.status, text: await res.text(), url };
    } catch (e) {
      last = { ok: false, status: 0, text: String(e && e.message), url };
    }
    if (last.status !== 429 && last.status < 500 && last.status !== 0) return last;
  }
  return last;
}

// ---------- bazadagi kesh ----------
async function cacheGet(k, maxAgeMs) {
  const row = await get('SELECT v, at FROM portals_cache WHERE k = :k', { k });
  if (!row) return null;
  return { v: JSON.parse(row.v), fresh: Date.now() - Number(row.at) < maxAgeMs };
}
async function cachePut(k, v) {
  await run(`INSERT INTO portals_cache (k, v, at) VALUES (:k, :v, :at) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at`,
    { k, v: JSON.stringify(v), at: Date.now() });
  // Eskilarini vaqti-vaqti bilan tozalash (1 kundan eski qidiruvlar)
  if (Math.random() < 0.05) await run("DELETE FROM portals_cache WHERE k LIKE 's:%' AND at < :t", { t: Date.now() - 86400000 });
}

const low = (x) => String(x || '').trim().toLowerCase();
const attrLow = (it, type) => { const a = (it.attributes || []).find((x) => low(x.type || x.trait_type) === type); return a ? low(a.value) : null; };
const attrOf = (it, type) => { const a = (it.attributes || []).find((x) => low(x.type || x.trait_type) === type); return a ? String(a.value) : null; };
const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Kolleksiyalar ro'yxati (ID, nom, eng arzon narx). Bazada 1 kun saqlanadi; Portals javob bermasa eskisi ishlatiladi. */
async function collections() {
  // Ro'yxat va eng arzon narxlar 15 daqiqa saqlanadi (bitta so'rov)
  const c = await cacheGet('collections', 900000);
  if (c && c.fresh) return c.v;
  const r = await request('/collections/preview', {});
  if (r.ok) {
    try {
      const d = JSON.parse(r.text);
      const list = (Array.isArray(d.collections) ? d.collections : []).map((x) => ({ id: x.id, name: x.name, short_name: x.short_name, floor_price: x.floor_price }));
      if (list.length) { await cachePut('collections', list); return list; }
    } catch (e) { /* JSON emas */ }
  } else await logError('portals', `${r.status} /collections/preview: ${String(r.text).slice(0, 300)}`);
  return c ? c.v : null;
}
/** Portals kolleksiyasini nomidan topish. null — topilmadi, undefined — Portals javob bermadi. */
export async function portalsCollection(name) {
  const list = await collections();
  if (!list) return undefined;
  const n = normName(name);
  return list.find((c) => normName(c.name) === n || normName(c.short_name) === n)
    || list.find((c) => normName(c.name).replace(/s$/, '') === n.replace(/s$/, '')) || null;
}
/** Kolleksiyalar va ularning eng arzon narxi (TON). */
export async function portalsCollectionFloors() {
  return ((await collections()) || []).map((c) => ({ name: String(c.name), floor: Number(c.floor_price) > 0 ? Number(c.floor_price) : null })).filter((x) => x.name);
}
/** Kolleksiyalar nomi (filtr uchun). */
export async function portalsCollectionNames() {
  return ((await collections()) || []).map((c) => String(c.name)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Javobdagi giftlar (nomi/modeli/foni mos kelganlari) va eng arzonining narxi. */
function pickCheapest(data, want) {
  const arr = Array.isArray(data) ? data : data && (data.results || data.items || data.nfts || data.data);
  if (!Array.isArray(arr)) return null;
  let best = null;
  for (const it of arr) {
    if (!it || (it.status && it.status !== 'listed')) continue;
    if (want.collection && low(it.name).replace(/\s*#\s*\d+$/, '') !== low(want.collection)) continue;
    if (want.model && attrLow(it, 'model') !== low(want.model)) continue;
    if (want.backdrop && attrLow(it, 'backdrop') !== low(want.backdrop)) continue;
    const n = Number(it.price ?? it.floor_price);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ton = n > 1e6 ? n / 1e9 : n;
    if (!best || ton < best.ton) best = { ton, label: `${it.name || ''}${it.external_collection_number ? ' #' + it.external_collection_number : ''}`.trim() };
  }
  return best;
}

/**
 * Sotuvdagi eng arzon narx. attrs: { collection, model, backdrop } — model yoki fon bo'lishi shart
 * (butun kolleksiyaning eng arzoni olinmaydi: u boshqa modeldagi gift bo'ladi).
 * Natija: { status: 'ok', ton, label } | { status: 'none' } (sotuvda yo'q) | { status: 'error' } (Portals javob bermadi).
 */
export async function portalsFloor(attrs) {
  if (!attrs.model && !attrs.backdrop) return { status: 'none' };
  const col = await portalsCollection(attrs.collection);
  if (col === undefined) return { status: 'error' };
  if (!col) return { status: 'none' };
  const q = { collection_id: col.id, filter_by_models: attrs.model || null, filter_by_backdrops: attrs.backdrop || null,
    status: 'listed', sort_by: 'price asc', limit: 10, offset: 0 };
  const k = 's:floor:' + JSON.stringify(q);
  const c = await cacheGet(k, 300000);
  if (c && c.fresh) return c.v;
  const r = await request('/nfts/search', q);
  if (!r.ok) {
    await logError('portals', `${r.status} /nfts/search: ${String(r.text).slice(0, 300)}`);
    return c ? c.v : { status: 'error' };
  }
  let best;
  try { best = pickCheapest(JSON.parse(r.text), attrs); } catch (e) { return { status: 'error' }; }
  const v = best ? { status: 'ok', ton: best.ton, label: 'Portals: ' + (best.label || col.name) } : { status: 'none' };
  await cachePut(k, v);
  return v;
}

/** /portals buyrug'i uchun: so'rov va javobni ko'rsatish (kalitsiz). */
export async function portalsDebug(attrs) {
  const col = await portalsCollection(attrs.collection);
  if (col === undefined) return 'Portals hozir javob bermayapti (juda ko\'p so\'rov yoki kalit xato). Jurnallarga qarang.';
  if (!col) return `Portals'da "${attrs.collection}" kolleksiyasi topilmadi.`;
  const L = [`Kolleksiya: ${col.name} · eng arzoni ${col.floor_price || '—'} TON`];
  if (attrs.model || attrs.backdrop) {
    const f = await portalsFloor(attrs);
    L.push(`${[attrs.model, attrs.backdrop].filter(Boolean).join(' + ')}: ${f.status === 'ok' ? `${f.ton} TON (${f.label})` : f.status === 'none' ? "sotuvda yo'q" : 'Portals javob bermadi'}`);
  }
  return L.join('\n');
}

// ---------- "Sotuvda" katalogi ----------
function saleItem(it) {
  const ton = Number(it.price);
  return {
    id: String(it.id), name: String(it.name || ''), num: it.external_collection_number ?? null,
    photo: /^https:\/\//.test(String(it.photo_url || '')) ? it.photo_url : null,
    model: attrOf(it, 'model'), backdrop: attrOf(it, 'backdrop'), symbol: attrOf(it, 'symbol'),
    ton: Number.isFinite(ton) && ton > 0 ? ton : null,
  };
}
/**
 * Sotuvdagi giftlar: bitta so'rovda 30 tagacha. Natija bazada 5 daqiqa saqlanadi: bir xil filtrni
 * ko'p mijoz ochsa ham Portals'ga bitta so'rov ketadi. Portals javob bermasa, oxirgi saqlangan ro'yxat qaytadi.
 * { items, total } yoki null.
 */
export async function portalsMarket(f = {}) {
  const { collection = null, model = null, backdrop = null, symbol = null, minTon = null, maxTon = null, num = null, offset = 0, sort = 'price asc' } = f;
  let colId = null;
  if (collection) {
    const c = await portalsCollection(collection);
    if (c === undefined) return null;
    if (!c) return { items: [], total: 0 };
    colId = c.id;
  }
  const tonStr = (x) => (x != null && Number(x) > 0 ? String(Math.round(Number(x) * 1000) / 1000) : null);
  const q = { collection_id: colId, filter_by_models: model, filter_by_backdrops: backdrop, filter_by_symbols: symbol,
    min_price: tonStr(minTon), max_price: tonStr(maxTon), external_collection_number: num, status: 'listed', sort_by: sort, limit: 30, offset };
  const k = 's:list:' + JSON.stringify(q);
  const c = await cacheGet(k, 300000);
  if (c && c.fresh) return c.v;
  const r = await request('/nfts/search', q);
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search (katalog): ${String(r.text).slice(0, 300)}`); return c ? c.v : null; }
  let d; try { d = JSON.parse(r.text); } catch (e) { return c ? c.v : null; }
  const v = { items: (Array.isArray(d.results) ? d.results : []).filter((x) => !x.status || x.status === 'listed').map(saleItem).filter((x) => x.ton), total: Number(d.total_count) || 0 };
  await cachePut(k, v);
  return v;
}
/** Bitta giftni Portals ID'si bo'yicha yangidan tekshiradi (buyurtma paytida, keshsiz). Sotuvda bo'lmasa null. */
export async function portalsSaleItem(id) {
  const r = await request('/nfts/search', { ids: id, limit: 1, offset: 0 });
  if (!r.ok) { await logError('portals', `${r.status} /nfts/search?ids: ${String(r.text).slice(0, 300)}`); throw new Error('PORTALS_UNAVAILABLE'); }
  let d; try { d = JSON.parse(r.text); } catch (e) { throw new Error('PORTALS_UNAVAILABLE'); }
  const it = (Array.isArray(d.results) ? d.results : []).find((x) => String(x.id) === String(id));
  if (!it || (it.status && String(it.status) !== 'listed')) return null;
  const out = saleItem(it);
  return out.ton ? out : null;
}
