// Bo'lib to'lash hisobi va narx manbalari. Barcha summalar so'mda (butun son, yuqoriga yaxlitlangan).
import { get, run, nowMs, logError } from 'lib/core';
import { giftsOnSaleFloor, listRent, giftCollections, marketappConfigured, floorInfo } from 'lib/marketapp';
import { portalsFloor, portalsConfigured } from 'lib/portals';
import { satFloor, satelliteConfigured, satBudget } from 'lib/satellite';

/** Ustama foizi: oy soni × (yillik ustama / 12). 3 oy -> 25, 6 oy -> 50, 12 oy -> 100. */
export function markupPercent(months, s) {
  return (Number(months) * Number(s.inst_markup_year)) / 12;
}

/** Lizing uchun alohida yillik ustama (lease_markup_year), qolganlarga inst_markup_year. */
export function markupFor(s, itype) {
  return itype === 'lease' || itype === 'cashout' ? { ...s, inst_markup_year: s.lease_markup_year ?? s.inst_markup_year } : s;
}

/** Oylik to'lov: (narx − boshlang'ich) × (1 + ustama) ÷ oy. */
export function monthlyPayment(priceSom, downSom, months, s) {
  const rest = Math.max(0, Number(priceSom) - Number(downSom || 0));
  const total = Math.ceil(rest * (1 + markupPercent(months, s) / 100));
  return { rest, total, monthly: Math.ceil(total / Number(months)), markup: markupPercent(months, s) };
}

/** 1-tur boshlang'ich to'lovi: (kunlik ijara narxi (nanoTON) × kun + add) × rate × mult. */
export function downByFormula(pricePerDayNano, s) {
  const f = s.down_formula;
  const ton = Number(BigInt(String(pricePerDayNano)) * BigInt(Math.round(Number(f.days)))) / 1e9;
  return Math.ceil((ton + Number(f.add)) * Number(f.rate) * Number(f.mult));
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Trapped Heart #19604" -> { collection: "Trapped Heart", num: 19604 } */
export function splitGiftName(name) {
  const m = /^(.*?)\s*#\s*(\d+)\s*$/.exec(String(name || ''));
  return m ? { collection: m[1].trim(), num: Number(m[2]) } : { collection: String(name || '').trim(), num: null };
}

/** Kolleksiya manzilini nomidan topadi ("Trapped Heart" yoki "TrappedHeart"). */
export async function collectionByName(name) {
  const cols = await giftCollections();
  const n = norm(name), list = Array.isArray(cols) ? cols : [];
  // "Trapped Heart" ~ "Trapped Hearts" ham topilsin
  return list.find((c) => norm(c.name) === n) || list.find((c) => norm(c.name).replace(/s$/, '') === n.replace(/s$/, '')) || null;
}

/**
 * Sotuvdagi eng arzon narx (TON). by: 'model_backdrop' | 'model' | 'backdrop' | 'collection'.
 * Topilmasa null.
 */
export async function floorPrice(collectionAddress, attrs, by) {
  const q = { collection_address: collectionAddress };
  if ((by === 'model_backdrop' || by === 'model') && attrs.model) q.model = attrs.model;
  if ((by === 'model_backdrop' || by === 'backdrop') && attrs.backdrop) q.backdrop = attrs.backdrop;
  if (by === 'model_backdrop' && !(attrs.model && attrs.backdrop)) return null;
  if (by === 'model' && !attrs.model) return null;
  if (by === 'backdrop' && !attrs.backdrop) return null;
  return giftsOnSaleFloor(q);
}

/** Shu sovg'aning Marketapp'dagi ijara e'loni (kunlik narxi) — nomi bo'yicha. */
export async function rentListingFor(collectionAddress, name, attrs) {
  const seen = await get('SELECT item FROM rent_seen WHERE category = :c AND json_extract(item, \'$.nft_name\') = :n', { c: 'gifts', n: name });
  if (seen) return JSON.parse(seen.item);
  const q = { collection_address: collectionAddress, sort_by: 'price_per_day' };
  for (const k of ['model', 'backdrop', 'symbol']) if (attrs[k]) q[k] = attrs[k];
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const r = await listRent('gifts', { ...q, cursor });
    const it = r.items.find((x) => x.nft_name === name);
    if (it) return it;
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return null;
}

/** 1-tur formulasi qaysi ijara narxidan: aynan shu gift, model + fon, model yoki fon (eng arzon ijara). */
export const DOWN_BASES = ['exact', 'model_backdrop', 'model', 'backdrop'];
export const downBase = (x) => (DOWN_BASES.includes(x) ? x : 'exact');
/** Tanlangan usul bo'yicha Marketapp ijarasidagi kunlik narx (nanoTON, matn) yoki null. */
export async function rentPpdFor(collectionAddress, name, attrs, base) {
  base = downBase(base);
  if (base === 'exact') { const r = await rentListingFor(collectionAddress, name, attrs || {}); return r ? String(r.price_per_day) : null; }
  const q = { collection_address: collectionAddress, sort_by: 'price_per_day' };
  if (base !== 'backdrop') { if (!attrs || !attrs.model) return null; q.model = attrs.model; }
  if (base !== 'model') { if (!attrs || !attrs.backdrop) return null; q.backdrop = attrs.backdrop; }
  const r = await listRent('gifts', q);
  const best = (r.items || []).reduce((m, x) => (m == null || BigInt(String(x.price_per_day)) < BigInt(String(m.price_per_day)) ? x : m), null);
  return best ? String(best.price_per_day) : null;
}

/**
 * Istalgan gift uchun 1-tur boshlang'ich to'lovi (so'm): Marketapp'dagi shu giftning ijara narxidan formula bilan.
 * Gift ijarada bo'lmasa yoki Marketapp ulanmagan bo'lsa null (admin o'zi yozadi).
 */
export async function giftDown1(name, attrs, s, base = s.sale_down_by) {
  try {
    if (!(await marketappConfigured())) return null;
    const c = await collectionByName(splitGiftName(name).collection);
    if (!c) return null;
    const ppd = await rentPpdFor(c.address, name, attrs || {}, base);
    return ppd ? downByFormula(ppd, s) : null;
  } catch (e) { return null; }
}

/** Eski narx manbalari (Marketapp / Portals / "eng arzoni") endi "barcha bozorlar"ga o'tkaziladi. */
export function priceSource(x) {
  const v = String(x || 'manual_som');
  if (['manual_som', 'manual_ton'].includes(v)) return v;
  if (v === 'best') return 'sat_model_backdrop';
  const base = v.replace(/^(portals_|sat_)/, '');
  return ['model_backdrop', 'model', 'backdrop'].includes(base) ? 'sat_' + base : 'manual_som';
}

/** Model / fon bo'yicha eng arzon narx: avval barcha bozorlar (Gift Satellite), u javob bermasa Portals (zaxira). */
async function marketFloor(a) {
  if (await satelliteConfigured()) {
    const r = await satFloor(a);
    if (r.status !== 'error') return r;
  }
  if (await portalsConfigured()) return portalsFloor(a);
  return { status: 'error' };
}

/**
 * O'z mahsulotining sotuv narxi va 1-tur boshlang'ich to'lovi (so'm). Bozor ma'lumoti 30 daqiqa saqlanadi.
 * Narx = (bozordagi eng arzoni + own_add) × sale_rate. Topilmasa — admin qo'lda yozgan narx.
 */
export async function ownSaleQuote(p, s, { fresh = false, cached = false, noRent = false } = {}) {
  const attrs = { model: p.model, backdrop: p.backdrop, symbol: p.symbol };
  const src = priceSource(p.price_source);
  // Zanjir: tanlangan usulda topilmasa kengroq usul. Butun kolleksiyaning eng arzoniga tushilmaydi.
  const CHAIN = { model_backdrop: ['model_backdrop', 'model', 'backdrop'], model: ['model', 'backdrop'], backdrop: ['backdrop'] };
  const usesMarketPrice = src.startsWith('sat_');
  let mkPrice = p.mk_price_ton, mkPpd = p.mk_ppd_nano, mkBy = p.mk_by || null, mkSrc = p.mk_src || null;
  const stale = !cached && (!p.mk_checked_at || nowMs() - Number(p.mk_checked_at) > 30 * 60000);
  // Marketapp: faqat ijara narxi (1-tur formulasi uchun) — bepul tarifda ishlaydi
  if (!noRent && (stale || fresh) && p.kind === 'gifts' && (await marketappConfigured())) {
    let col = p.collection_address;
    try {
      if (!col) { const c = await collectionByName(splitGiftName(p.name).collection); col = c ? c.address : null; }
      if (col) mkPpd = await rentPpdFor(col, p.name, attrs, p.down_mode);
    } catch (e) { /* xato bo'lsa avvalgi ijara narxi qoladi */ await logError('ijara', `${p.name}: ${e && (e.description || e.message)}`); }
    await run('UPDATE own_products SET collection_address = :c, mk_ppd_nano = :pp WHERE id = :id', { c: col || null, pp: mkPpd ?? null, id: p.id });
  }
  // Sotuv narxi: barcha bozorlar (zaxira — Portals)
  if (usesMarketPrice && (stale || fresh) && p.kind === 'gifts') {
    const chain = CHAIN[src.replace('sat_', '')];
    const collection = splitGiftName(p.name).collection;
    let nPrice = null, nBy = null, nSrc = null, failed = false;
    for (const by of chain) {
      const a = { collection, model: ['model_backdrop', 'model'].includes(by) ? attrs.model : null, backdrop: ['model_backdrop', 'backdrop'].includes(by) ? attrs.backdrop : null };
      if ((by === 'model_backdrop' && !(a.model && a.backdrop)) || (by === 'model' && !a.model) || (by === 'backdrop' && !a.backdrop)) continue;
      const t = await marketFloor(a);
      // Javob bo'lmasa — keyingi usulga o'tilmaydi va avvalgi narx o'zgarmaydi
      if (t.status === 'error') { failed = true; break; }
      if (t.status === 'ok') { nPrice = t.ton; nBy = 'sat_' + by; nSrc = t.label; break; }
    }
    if (!failed) {
      mkPrice = nPrice; mkBy = nBy; mkSrc = nSrc;
      await run('UPDATE own_products SET mk_price_ton = :pt, mk_by = :by, mk_src = :sl, mk_checked_at = :t WHERE id = :id', { pt: mkPrice ?? null, by: mkBy, sl: mkSrc, t: nowMs(), id: p.id });
    } else {
      // 1 = "oxirgi urinish muvaffaqiyatsiz": ro'yxatlar qayta-qayta urinmaydi, admin tugmasi bilan yangilanadi
      await run('UPDATE own_products SET mk_checked_at = 1 WHERE id = :id', { id: p.id });
    }
  } else if ((stale || fresh) && p.kind === 'gifts') {
    await run('UPDATE own_products SET mk_checked_at = :t WHERE id = :id', { t: nowMs(), id: p.id });
  }
  let price = null, by = src;
  if (src === 'manual_som') price = p.price_manual ? Math.ceil(Number(p.price_manual) / 100) : (p.cash_price ? Math.ceil(Number(p.cash_price) / 100) : null);
  else if (src === 'manual_ton') price = p.price_ton ? Math.ceil(Number(p.price_ton) * Number(s.sale_rate)) : null;
  else {
    by = mkBy;
    price = mkPrice ? Math.ceil((Number(mkPrice) + Number(s.own_add)) * Number(s.sale_rate)) : null;
    // Bozorda (model / fon bo'yicha) topilmasa: admin qo'lda yozgan narx
    if (!price && p.price_manual) { price = Math.ceil(Number(p.price_manual) / 100); by = 'fallback_som'; }
    else if (!price && p.price_ton) { price = Math.ceil(Number(p.price_ton) * Number(s.sale_rate)); by = 'fallback_ton'; }
  }
  // 1-tur boshlang'ich to'lovi: avval formula (Marketapp ijara narxi), topilmasa admin yozgan summa
  let down1 = null, down1By = null;
  const down1Base = downBase(p.down_mode);
  if (mkPpd) { down1 = downByFormula(mkPpd, s); down1By = 'formula'; }
  // 1-tur usulida topilmasa, lekin giftning ijara narxi topilgan bo'lsa (masalan "fon" bo'yicha) — shu ijaradan hisoblanadi
  else if (p.rent_ppd_nano) { down1 = downByFormula(p.rent_ppd_nano, s); down1By = 'formula'; }
  else if (p.down_manual) { down1 = Math.ceil(Number(p.down_manual) / 100); down1By = 'manual'; }
  const tonR = mkPrice != null ? Math.round(Number(mkPrice) * 100) / 100 : null;
  return { price, down1, down1By, down1Base, marketPriceTon: usesMarketPrice ? tonR : null, by, src: usesMarketPrice && !String(by).startsWith('fallback') ? mkSrc : null };
}

/** O'z giftlari ijarasi formulasi: bozor ijarasi formulasi, faqat koeffitsienti boshqa (odatda 3). */
export const ownRentFormula = (s) => ({ add: Number(s.rent_formula.add), mult: Number(s.own_rent_mult), rate: Number(s.rent_formula.rate) });
export const RENT_BASES = ['model_backdrop', 'model', 'backdrop'];

/**
 * O'z giftining ijara narxi uchun Marketapp'dagi kunlik narx (nanoTON, matn) — admin tanlagan usulda
 * (model + fon / model / fon bo'yicha eng arzon ijara). 30 daqiqa saqlanadi. Topilmasa null (qo'lda narx olinadi).
 */
/**
 * Ro'yxatlar (mijoz ilovasi, admin panel) bozorlarni kutmasin: har bir ochilishda faqat ENG ESKI bitta mahsulot
 * narxi yangilanadi, qolganlari saqlangan narx bilan ko'rsatiladi. Aks holda 18 ta gift × 5 bozor — server vaqti tugaydi.
 */
export async function refreshOneStale(rows, s) {
  if (!rows.length) return;
  satBudget(6000);
  try { await refreshOneStale2(rows, s); } finally { satBudget(0); }
}
async function refreshOneStale2(rows, s) {
  await refreshOneRent(rows);
  const old = (p) => (p.kind === 'gifts' && p.inst_enabled ? Number(p.mk_checked_at || 0) : Infinity);
  const p = rows.reduce((a, b) => (old(b) < old(a) ? b : a), rows[0]);
  if (!p || old(p) !== 0) return; // faqat hali tekshirilmagani (yangi yoki tahrirlangan)
  try { await ownSaleQuote(p, s); } catch (e) { await logError('narx', `${p.name}: ${e && e.message}`); }
  const r = await get('SELECT * FROM own_products WHERE id = :id', { id: p.id });
  if (r) Object.assign(p, r);
}
async function refreshOneRent(rows) {
  const old = (p) => (p.kind === 'gifts' && p.rent_enabled && RENT_BASES.includes(p.rent_by) ? Number(p.rent_checked_at || 0) : Infinity);
  const p = rows.reduce((a, b) => (old(b) < old(a) ? b : a), rows[0]);
  if (!p || old(p) !== 0) return; // faqat hali tekshirilmagani (yangi yoki tahrirlangan)
  await ownRentPpd(p);
  const r = await get('SELECT * FROM own_products WHERE id = :id', { id: p.id });
  if (r) Object.assign(p, r);
}

export async function ownRentPpd(p, { fresh = false, cached = false } = {}) {
  if (!RENT_BASES.includes(p.rent_by) || !p.rent_enabled || p.kind !== 'gifts') return null;
  const stale = !p.rent_checked_at || nowMs() - Number(p.rent_checked_at) > 30 * 60000;
  if (cached || (!stale && !fresh)) return p.rent_ppd_nano || null;
  if (!(await marketappConfigured())) return p.rent_ppd_nano || null;
  let ppd = p.rent_ppd_nano || null;
  try {
    const c = await collectionByName(splitGiftName(p.name).collection);
    ppd = c ? await rentPpdFor(c.address, p.name, { model: p.model, backdrop: p.backdrop }, p.rent_by) : null;
    await run('UPDATE own_products SET rent_ppd_nano = :pp, rent_checked_at = :t WHERE id = :id', { pp: ppd, t: nowMs(), id: p.id });
  } catch (e) { await logError('ijara', `${p.name}: ${e && (e.description || e.message)}`); }
  return ppd;
}
