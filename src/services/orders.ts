import type { Tx } from "../db.js";
import { tx, one, q } from "../db.js";
import { AppError } from "../errors.js";
import { newPublicId } from "../publicId.js";
import { applyLedger } from "./balance.js";
import { audit } from "../audit.js";
import { applyPromo, recordRedemption, type PromoResult } from "./promo.js";

export type Service = "nft_gift" | "gift_rent" | "username_rent" | "number_rent" | "premium" | "stars";

export interface NewOrder {
  customerId: number;
  service: Service;
  paymentMethod: "cash" | "installment";
  installmentType?: string | null;
  title: string;
  details: Record<string, unknown>;
  recipient?: string | null;
  price: number | null;          // naqd uchun majburiy; bo'lib to'lashda null (admin aytadi)
  cost?: number | null;
  idempotencyKey: string;
  promoCode?: string | null;     // faqat naqd buyurtmalar uchun
}

export interface CreatedOrder { id: number; publicId: string; duplicate: boolean; queuePosition: number }

/**
 * Buyurtma yaratadi: barcha buyurtmalar umumiy navbatga tushadi.
 * Naqd buyurtmada pul shu tranzaksiyaning o'zida balansdan yechiladi.
 */
export async function createOrder(o: NewOrder): Promise<CreatedOrder> {
  if (o.paymentMethod === "cash" && (o.price == null || !(o.price > 0))) throw new AppError("PRICE_REQUIRED");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tx(async (c) => {
        // Mijoz qatorini qulflaymiz: bir xil kalit bilan parallel so'rovlar ketma-ket bajariladi
        const cust = await c.query("SELECT id, username, phone FROM customers WHERE id = $1 FOR UPDATE", [o.customerId]);
        if (!cust.rowCount) throw new AppError("CUSTOMER_NOT_FOUND", 404);
        const { username, phone } = cust.rows[0];
        if (!phone) throw new AppError("PHONE_REQUIRED", 400);

        const dup = await c.query("SELECT id, public_id FROM orders WHERE customer_id = $1 AND idempotency_key = $2", [o.customerId, o.idempotencyKey]);
        if (dup.rowCount) {
          const d = dup.rows[0];
          return { id: d.id, publicId: d.public_id, duplicate: true, queuePosition: await position(c, d.id) };
        }

        let promo: PromoResult | null = null;
        let price = o.price;
        if (o.promoCode && o.paymentMethod === "cash") {
          promo = await applyPromo(c, o.promoCode, o.customerId, o.service, o.price!, true);
          price = promo.finalPrice;
        }

        const publicId = newPublicId();
        const ins = await c.query(
          `INSERT INTO orders (public_id, customer_id, service, payment_method, installment_type, title, details, recipient,
                               price, cost, customer_username, customer_phone, idempotency_key, promo_code, discount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [publicId, o.customerId, o.service, o.paymentMethod, o.installmentType ?? null, o.title, o.details,
           o.recipient ?? null, price, o.cost ?? null, username, phone, o.idempotencyKey, promo?.code ?? null, promo?.discount ?? 0],
        );
        const id = ins.rows[0].id as number;
        if (promo) await recordRedemption(c, promo, o.customerId, id);

        if (o.paymentMethod === "cash") {
          await applyLedger(c, {
            customerId: o.customerId, amount: -price!, kind: "order_payment",
            key: `order:${id}:pay`, refType: "order", refId: id, note: publicId,
          });
          await c.query("UPDATE orders SET paid_amount = $2 WHERE id = $1", [id, price]);
        }
        return { id, publicId, duplicate: false, queuePosition: await position(c, id) };
      });
    } catch (e: any) {
      // public_id to'qnashuvi (juda kam ehtimol) — qayta urinamiz
      if (e?.code === "23505" && String(e?.constraint).includes("public_id")) continue;
      // bir xil idempotency kalit bilan parallel so'rov — mavjud buyurtmani qaytaramiz
      if (e?.code === "23505" && String(e?.constraint).includes("idempotency")) {
        const d = await one("SELECT id, public_id FROM orders WHERE customer_id = $1 AND idempotency_key = $2", [o.customerId, o.idempotencyKey]);
        if (d) return { id: d.id, publicId: d.public_id, duplicate: true, queuePosition: await positionNoTx(d.id) };
      }
      throw e;
    }
  }
  throw new AppError("ORDER_ID_GENERATION_FAILED", 500);
}

async function position(c: Tx, id: number): Promise<number> {
  const r = await c.query("SELECT position FROM order_queue WHERE id = $1", [id]);
  return r.rowCount ? Number(r.rows[0].position) : 0;
}
async function positionNoTx(id: number): Promise<number> {
  const r = await one("SELECT position FROM order_queue WHERE id = $1", [id]);
  return r ? Number(r.position) : 0;
}

/** Admin: buyurtmani yakunlash yoki bekor qilish. Bekor qilinsa, to'langan summa balansga qaytadi. */
export async function closeOrder(orderId: number, status: "completed" | "cancelled", actor: string, note?: string) {
  return tx(async (c) => {
    const r = await c.query("SELECT id, public_id, customer_id, status, paid_amount FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    if (!r.rowCount) throw new AppError("ORDER_NOT_FOUND", 404);
    const o = r.rows[0];
    if (o.status !== "queued") throw new AppError("ORDER_ALREADY_CLOSED", 409, { status: o.status });

    await c.query(
      "UPDATE orders SET status = $2, closed_at = now(), updated_at = now(), admin_note = COALESCE($3, admin_note) WHERE id = $1",
      [orderId, status, note ?? null],
    );
    let refunded = 0;
    if (status === "cancelled" && Number(o.paid_amount) > 0) {
      await applyLedger(c, {
        customerId: o.customer_id, amount: Number(o.paid_amount), kind: "refund",
        key: `order:${orderId}:refund`, refType: "order", refId: orderId, note: o.public_id, by: actor,
      });
      refunded = Number(o.paid_amount);
    }
    await audit(c, actor, `order.${status}`, o.public_id, { refunded, note });
    return { publicId: o.public_id as string, customerId: o.customer_id as number, refunded };
  });
}

export async function queueList() {
  return q(
    `SELECT qu.position, o.id, o.public_id, o.service, o.payment_method, o.installment_type, o.title, o.recipient,
            o.price, o.paid_amount, o.customer_username, o.customer_phone, o.created_at, o.details
       FROM order_queue qu JOIN orders o ON o.id = qu.id ORDER BY qu.position`,
  );
}
