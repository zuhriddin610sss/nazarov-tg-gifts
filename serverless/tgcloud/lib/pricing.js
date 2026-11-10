// Narxlar. Barcha natijalar tiyinda (butun son).

/** Marketapp kunlik narxi (nanoGRAM, satr) × kunlar -> butun muddat narxi TON'da. */
export function rentTotalTon(pricePerDayNano, days) {
  return Number(BigInt(String(pricePerDayNano)) * BigInt(days)) / 1e9;
}
/** Ijara formulasi: (P + add) × mult × rate so'm, butun so'mgacha yuqoriga yaxlitlanadi (6 269,89 -> 6 270). */
export function rentPriceTiyin(P, f) {
  const tiyin = Math.round((P + Number(f.add)) * Number(f.mult) * Number(f.rate) * 100);
  return Math.ceil(tiyin / 100) * 100;
}
/** Tannarx (faqat admin uchun): P × rate. */
export function rentCostTiyin(P, f) {
  return Math.round(P * Number(f.rate) * 100);
}
export const PREMIUM_PLANS = ['m1', 'm3', 'm6', 'm12_login', 'm12'];
export const PREMIUM_LABEL = { m1: '1 oy', m3: '3 oy', m6: '6 oy', m12_login: '12 oy (akkauntga kirib)', m12: '12 oy (akkauntga kirmasdan)' };
export const starsPriceTiyin = (qty, s) => Math.round(qty * Number(s.stars_price) * 100);
