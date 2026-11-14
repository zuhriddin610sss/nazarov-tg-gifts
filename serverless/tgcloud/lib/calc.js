// Bo'lib to'lash hisobi va narx manbalari. Barcha summalar so'mda (butun son, yuqoriga yaxlitlangan).
import { get, run, nowMs, logError } from 'lib/core';
import { giftsOnSaleFloor, listRent, giftCollections, marketappConfigured } from 'lib/marketapp';
import { portalsFloor, portalsConfigured } from 'lib/portals';

/** Ustama foizi: oy soni × (yillik ustama / 12). 3 oy -> 25, 6 oy -> 50, 12 oy -> 100. */
export function markupPercent(months, s) {
  return (Number(months) * Number(s.inst_markup_year)) / 12;
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

/**
 * O'z mahsulotining sotuv narxi va 1-tur boshlang'ich to'lovi (so'm). Marketapp ma'lumoti 30 daqiqa keshlanadi.
 * { price: so'm|null, down1: so'm|null }
 */
export async function ownSaleQuote(p, s, { fresh = false } = {}) {
  const attrs = { model: p.model, backdrop: p.backdrop, symbol: p.symbol };
  const src = p.price_source || 'manual_som';
  const MK = ['model_backdrop', 'model', 'backdrop'], PT = ['portals_model_backdrop', 'portals_model', 'portals_backdrop'];
  const CHAIN = { model_backdrop: ['model_backdrop', 'model', 'backdrop', 'collection'], model: ['model', 'backdrop', 'collection'], backdrop: ['backdrop', 'collection'] };
  const needMarket = MK.includes(src) || src === 'best' || p.down_mode !== 'manual';
  const usesMarketPrice = MK.includes(src) || PT.includes(src) || src === 'best';
  let mkPrice = p.mk_price_ton, mkPpd = p.mk_ppd_nano, mkBy = p.mk_by || null;
  const stale = !p.mk_checked_at || nowMs() - Number(p.mk_checked_at) > 30 * 60000;
  if (needMarket && (stale || fresh) && p.kind === 'gifts' && (await marketappConfigured())) {
    try {
      let col = p.collection_address;
      if (!col) { const c = await collectionByName(splitGiftName(p.name).collection); col = c ? c.address : null; }
      if (col) {
        if (MK.includes(src) || src === 'best') {
          // Zanjirli qidiruv: tanlangan usulda topilmasa, kengroq usulga o'tadi
          const chain = CHAIN[src === 'best' ? 'model_backdrop' : src];
          mkPrice = null; mkBy = null;
          for (const by of chain) {
            const t = await floorPrice(col, attrs, by === 'collection' ? null : by);
            if (t) { mkPrice = t; mkBy = by; break; }
          }
        }
        if (p.down_mode !== 'manual') { const r = await rentListingFor(col, p.name, attrs); mkPpd = r ? String(r.price_per_day) : null; }
        await run(`UPDATE own_products SET collection_address = :c, mk_price_ton = :pt, mk_ppd_nano = :pp, mk_by = :by, mk_checked_at = :t WHERE id = :id`,
          { c: col, pt: mkPrice ?? null, pp: mkPpd ?? null, by: mkBy, t: nowMs(), id: p.id });
      } else {
        mkBy = 'no_collection';
      }
    } catch (e) { mkBy = e && e.parameters && e.parameters.status === 402 ? 'paid' : 'error'; await logError('narx', `${p.name}: ${e && (e.description || e.message)}`); }
  }
  // Portals (sinov): xuddi shunday zanjir, Portals narxlari bo'yicha
  if ((PT.includes(src) || src === 'best') && (stale || fresh) && p.kind === 'gifts' && (await portalsConfigured())) {
    const chain = CHAIN[src === 'best' ? 'model_backdrop' : src.replace('portals_', '')];
    const collection = splitGiftName(p.name).collection;
    let ptPrice = null, ptBy = null;
    for (const by of chain) {
      const a = { collection, model: ['model_backdrop', 'model'].includes(by) ? attrs.model : null, backdrop: ['model_backdrop', 'backdrop'].includes(by) ? attrs.backdrop : null };
      if ((by === 'model_backdrop' && !(a.model && a.backdrop)) || (by === 'model' && !a.model) || (by === 'backdrop' && !a.backdrop)) continue;
      const t = await portalsFloor(a);
      if (t) { ptPrice = t; ptBy = by; break; }
    }
    if (src === 'best') { if (ptPrice && (!mkPrice || ptPrice < mkPrice)) { mkPrice = ptPrice; mkBy = 'portals_' + ptBy; } }
    else { mkPrice = ptPrice; mkBy = ptBy ? 'portals_' + ptBy : null; }
    await run('UPDATE own_products SET mk_price_ton = :pt, mk_by = :by, mk_checked_at = :t WHERE id = :id', { pt: mkPrice ?? null, by: mkBy, t: nowMs(), id: p.id });
  }
  let price = null;
  if (src === 'manual_som') price = p.price_manual ? Math.ceil(Number(p.price_manual) / 100) : (p.cash_price ? Math.ceil(Number(p.cash_price) / 100) : null);
  else if (src === 'manual_ton') price = p.price_ton ? Math.ceil(Number(p.price_ton) * Number(s.sale_rate)) : null;
  else if (usesMarketPrice) price = mkPrice ? Math.ceil(Number(mkPrice) * Number(s.sale_rate)) : null;
  let down1 = null;
  if (p.down_mode === 'manual') down1 = p.down_manual ? Math.ceil(Number(p.down_manual) / 100) : null;
  else if (mkPpd) down1 = downByFormula(mkPpd, s);
  return { price, down1, marketPriceTon: mkPrice ?? null, by: usesMarketPrice ? mkBy : src };
}
