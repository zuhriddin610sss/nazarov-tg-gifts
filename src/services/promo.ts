import type { Tx } from "../db.js";
import { q, one, pool } from "../db.js";
import { AppError } from "../errors.js";
import { toTiyin } from "../pricing.js";
import { audit } from "../audit.js";

export interface PromoResult { promoId: number; code: string; discount: number; finalPrice: number }

/**
 * Promo-kodni tekshiradi va chegirmani hisoblaydi. Faqat naqd buyurtmalar uchun.
 * lock=true bo'lsa (buyurtma tranzaksiyasi ichida) kod qatori qulflanadi va foydalanish soni oshiriladi.
 */
export async function applyPromo(c: Tx | typeof pool, code: string, customerId: number, service: string, price: number, lock: boolean): Promise<PromoResult> {
  const r = await c.query(`SELECT * FROM promo_codes WHERE upper(code) = upper($1)${lock ? " FOR UPDATE" : ""}`, [code.trim()]);
  const p = r.rows[0];
  if (!p || !p.active) throw new AppError("PROMO_INVALID");
  if (p.expires_at && new Date(p.expires_at) < new Date()) throw new AppError("PROMO_EXPIRED");
  if (p.max_uses != null && p.used_count >= p.max_uses) throw new AppError("PROMO_USED_UP");
  if (p.services && !p.services.includes(service)) throw new AppError("PROMO_NOT_FOR_SERVICE");
  const used = await c.query("SELECT 1 FROM promo_redemptions WHERE promo_id = $1 AND customer_id = $2", [p.id, customerId]);
  if (used.rowCount) throw new AppError("PROMO_ALREADY_USED");

  let discount = p.kind === "percent" ? toTiyin((price * Number(p.value)) / 100) : Number(p.value);
  // Narx kamida 1 so'm qoladi: bepul buyurtma promo orqali yaratilmaydi
  discount = toTiyin(Math.min(discount, price - 1));
  if (discount <= 0) throw new AppError("PROMO_INVALID");
  return { promoId: p.id, code: p.code, discount, finalPrice: toTiyin(price - discount) };
}

export async function recordRedemption(c: Tx, promo: PromoResult, customerId: number, orderId: number) {
  await c.query("INSERT INTO promo_redemptions (promo_id, customer_id, order_id, discount) VALUES ($1,$2,$3,$4)", [promo.promoId, customerId, orderId, promo.discount]);
  await c.query("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = $1", [promo.promoId]);
}

export async function listPromos() {
  return q(`SELECT p.*, COALESCE((SELECT SUM(discount) FROM promo_redemptions r WHERE r.promo_id = p.id), 0) AS total_discount
              FROM promo_codes p ORDER BY p.created_at DESC`);
}

export async function upsertPromo(input: {
  id?: number; code: string; kind: "percent" | "fixed"; value: number; services: string[] | null;
  expiresAt: string | null; maxUses: number | null; active: boolean;
}, actor: string) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new AppError("PROMO_CODE_FORMAT");
  try {
    if (input.id) {
      await pool.query(
        `UPDATE promo_codes SET code=$2, kind=$3, value=$4, services=$5, expires_at=$6, max_uses=$7, active=$8 WHERE id=$1`,
        [input.id, code, input.kind, input.value, input.services, input.expiresAt, input.maxUses, input.active]);
    } else {
      await pool.query(
        `INSERT INTO promo_codes (code, kind, value, services, expires_at, max_uses, active) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [code, input.kind, input.value, input.services, input.expiresAt, input.maxUses, input.active]);
    }
  } catch (e: any) {
    if (e?.code === "23505") throw new AppError("PROMO_CODE_EXISTS", 409);
    throw e;
  }
  await audit(pool, actor, input.id ? "promo.update" : "promo.create", code, input);
}

export async function getPromo(id: number) {
  return one("SELECT * FROM promo_codes WHERE id = $1", [id]);
}
