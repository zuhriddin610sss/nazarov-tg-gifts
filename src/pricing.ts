import type { Settings } from "./settings.js";

/** So'mni tiyingacha (2 xona) aniqlikda qaytaradi. Formula natijasi butun so'mga yaxlitlanmaydi. */
export function toTiyin(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Marketapp kunlik narxi nanoGRAM (string) va kunlar soni -> butun muddat narxi TON'da. */
export function rentTotalTon(pricePerDayNano: string, days: number): number {
  const nano = BigInt(pricePerDayNano) * BigInt(days);
  return Number(nano) / 1e9;
}

/** Ijara formulasi: (P + add) × mult × rate. P — butun muddat narxi, TON. */
export function rentCustomerPrice(P: number, f: Settings["rent_formula"]): number {
  return toTiyin((P + f.add) * f.mult * f.rate);
}

/** Tannarx so'mda (faqat admin uchun): P × rate. */
export function rentCost(P: number, f: Settings["rent_formula"]): number {
  return toTiyin(P * f.rate);
}

export const PREMIUM_PLANS = ["m1", "m3", "m6", "m12_login", "m12"] as const;
export type PremiumPlan = (typeof PREMIUM_PLANS)[number];
/** Marketapp orqali avtomatik bajarilishi mumkin bo'lgan rejalar (oylar soni). */
export const PREMIUM_MARKETAPP_MONTHS: Partial<Record<PremiumPlan, number>> = { m3: 3, m6: 6, m12: 12 };

export function starsPrice(qty: number, s: Settings): number {
  return toTiyin(qty * s.stars_price);
}
