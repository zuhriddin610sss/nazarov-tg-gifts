import { tx, q, one } from "../db.js";
import { AppError } from "../errors.js";
import { applyLedger } from "./balance.js";
import { audit } from "../audit.js";
import { toTiyin } from "../pricing.js";

export interface AgreementInput {
  orderId?: number | null;
  customerId?: number | null;
  legacy: boolean;
  clientName?: string | null;
  clientUsername?: string | null;
  clientPhone?: string | null;
  productName: string;
  installmentType?: string | null;
  totalPrice: number;
  downPayment: number;
  monthlyPayment: number;
  startDate: string; // YYYY-MM-DD
  finalDate: string;
  collateral?: string | null;
  notes?: string | null;
  alreadyPaid?: number; // eski shartnomalar: platformadan oldin to'langan summa (boshlang'ichdan tashqari)
}

function ymd(d: Date | string): Date {
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

/** Shartnoma bo'yicha hisob: faqat admin ko'radi. */
export function summarize(a: any, paidSum: number, today = new Date()) {
  const total = Number(a.total_price);
  const monthly = Number(a.monthly_payment);
  const down = Number(a.down_payment);
  const paid = toTiyin(down + paidSum);
  const remaining = toTiyin(Math.max(0, total - paid));
  const start = ymd(a.start_date);
  const t = ymd(today);
  const monthsElapsed = Math.max(0,
    (t.getUTCFullYear() - start.getUTCFullYear()) * 12 + (t.getUTCMonth() - start.getUTCMonth()) - (t.getUTCDate() < start.getUTCDate() ? 1 : 0));
  const expected = Math.min(total, down + monthly * monthsElapsed);
  const overdueAmount = toTiyin(Math.max(0, expected - paid));
  const paidMonths = monthly > 0 ? Math.floor((paidSum + 0.001) / monthly) : 0;
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + paidMonths + 1);
  return {
    total, paid, remaining, overdueAmount,
    overdue: remaining > 0 && overdueAmount > 0,
    nextDueDate: remaining > 0 ? next.toISOString().slice(0, 10) : null,
  };
}

export async function createAgreement(i: AgreementInput, actor: string) {
  if (i.downPayment > i.totalPrice) throw new AppError("DOWN_PAYMENT_TOO_BIG");
  return tx(async (c) => {
    let customerId = i.customerId ?? null;
    if (i.orderId) {
      const o = await c.query("SELECT customer_id, payment_method FROM orders WHERE id = $1", [i.orderId]);
      if (!o.rowCount) throw new AppError("ORDER_NOT_FOUND", 404);
      if (o.rows[0].payment_method !== "installment") throw new AppError("ORDER_NOT_INSTALLMENT");
      customerId = o.rows[0].customer_id;
    } else if (!customerId && i.clientUsername) {
      const cu = await c.query("SELECT id FROM customers WHERE lower(username) = lower($1)", [i.clientUsername.replace(/^@/, "")]);
      if (cu.rowCount) customerId = cu.rows[0].id;
    }
    const r = await c.query(
      `INSERT INTO installment_agreements (order_id, customer_id, legacy, client_name, client_username, client_phone, product_name,
         installment_type, total_price, down_payment, monthly_payment, start_date, final_date, collateral, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [i.orderId ?? null, customerId, i.legacy, i.clientName ?? null, i.clientUsername?.replace(/^@/, "") ?? null, i.clientPhone ?? null,
       i.productName, i.installmentType ?? null, i.totalPrice, i.downPayment, i.monthlyPayment, i.startDate, i.finalDate,
       i.collateral ?? null, i.notes ?? null],
    );
    const id = r.rows[0].id as number;
    if (i.alreadyPaid && i.alreadyPaid > 0) {
      await c.query(
        `INSERT INTO installment_payments (agreement_id, amount, source, note, idempotency_key, created_by, paid_at)
         VALUES ($1, $2, 'manual', $3, $4, $5, $6)`,
        [id, i.alreadyPaid, "Platformadan oldingi to'lovlar", `agreement:${id}:legacy`, actor, i.startDate],
      );
    }
    await audit(c, actor, "installment.create", String(id), i);
    return id;
  });
}

export async function updateAgreement(id: number, i: Partial<AgreementInput> & { status?: "active" | "closed" }, actor: string) {
  return tx(async (c) => {
    const r = await c.query("SELECT * FROM installment_agreements WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rowCount) throw new AppError("AGREEMENT_NOT_FOUND", 404);
    const map: Record<string, unknown> = {
      client_name: i.clientName, client_username: i.clientUsername?.replace(/^@/, ""), client_phone: i.clientPhone,
      product_name: i.productName, installment_type: i.installmentType, total_price: i.totalPrice, down_payment: i.downPayment,
      monthly_payment: i.monthlyPayment, start_date: i.startDate, final_date: i.finalDate, collateral: i.collateral,
      notes: i.notes, status: i.status,
    };
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(map)) if (v !== undefined) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    if (sets.length) await c.query(`UPDATE installment_agreements SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
    await audit(c, actor, "installment.update", String(id), { before: r.rows[0], changes: i });
  });
}

/** Admin qo'lda to'lov yozadi (naqd, karta va h.k.). */
export async function addManualPayment(agreementId: number, amount: number, key: string, actor: string, note?: string, paidAt?: string) {
  if (!(amount > 0)) throw new AppError("BAD_AMOUNT");
  return tx(async (c) => {
    const a = await c.query("SELECT id FROM installment_agreements WHERE id = $1 FOR UPDATE", [agreementId]);
    if (!a.rowCount) throw new AppError("AGREEMENT_NOT_FOUND", 404);
    const ins = await c.query(
      `INSERT INTO installment_payments (agreement_id, amount, source, note, idempotency_key, created_by, paid_at)
       VALUES ($1, $2, 'manual', $3, $4, $5, COALESCE($6::timestamptz, now()))
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [agreementId, amount, note ?? null, `admin:${key}`, actor, paidAt ?? null],
    );
    await audit(c, actor, "installment.payment", String(agreementId), { amount, note, duplicate: !ins.rowCount });
    return { duplicate: !ins.rowCount };
  });
}

/**
 * Mijoz o'zi tasdiqlab, oylik to'lovni balansdan to'laydi.
 * Summa: oylik to'lov yoki qolgan qarz (qaysi biri kichik bo'lsa). Avtomatik yechish yo'q.
 */
export async function payFromBalance(agreementId: number, customerId: number, key: string) {
  return tx(async (c) => {
    const r = await c.query("SELECT * FROM installment_agreements WHERE id = $1 AND customer_id = $2 FOR UPDATE", [agreementId, customerId]);
    if (!r.rowCount) throw new AppError("AGREEMENT_NOT_FOUND", 404);
    const a = r.rows[0];
    const dup = await c.query("SELECT amount FROM installment_payments WHERE idempotency_key = $1", [`cust:${customerId}:${key}`]);
    if (dup.rowCount) return { amount: Number(dup.rows[0].amount), duplicate: true };
    if (a.status !== "active") throw new AppError("AGREEMENT_CLOSED", 409);

    const paidSum = Number((await c.query("SELECT COALESCE(SUM(amount),0) s FROM installment_payments WHERE agreement_id = $1", [agreementId])).rows[0].s);
    const s = summarize(a, paidSum);
    if (s.remaining <= 0) throw new AppError("NOTHING_TO_PAY", 409);
    const amount = toTiyin(Math.min(Number(a.monthly_payment), s.remaining));

    const led = await applyLedger(c, {
      customerId, amount: -amount, kind: "installment_payment", key: `installment:${agreementId}:${customerId}:${key}`,
      refType: "installment", refId: agreementId,
    });
    await c.query(
      `INSERT INTO installment_payments (agreement_id, amount, source, ledger_id, idempotency_key, created_by)
       VALUES ($1, $2, 'balance', $3, $4, $5)`,
      [agreementId, amount, led.id, `cust:${customerId}:${key}`, `customer:${customerId}`],
    );
    if (toTiyin(s.remaining - amount) <= 0) {
      await c.query("UPDATE installment_agreements SET status = 'closed', updated_at = now() WHERE id = $1", [agreementId]);
    }
    return { amount, duplicate: false };
  });
}

export async function listAgreements(filter: { status?: string; search?: string; customerId?: number } = {}) {
  const rows = await q(
    `SELECT a.*, c.username AS cust_username, c.phone AS cust_phone, o.public_id AS order_public_id,
            COALESCE((SELECT SUM(amount) FROM installment_payments p WHERE p.agreement_id = a.id), 0) AS paid_sum
       FROM installment_agreements a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN orders o ON o.id = a.order_id
      WHERE ($1::text IS NULL OR a.status = $1)
        AND ($3::bigint IS NULL OR a.customer_id = $3)
        AND ($2::text IS NULL OR a.product_name ILIKE '%' || $2 || '%' OR a.client_name ILIKE '%' || $2 || '%'
             OR a.client_username ILIKE '%' || $2 || '%' OR c.username ILIKE '%' || $2 || '%' OR a.client_phone ILIKE '%' || $2 || '%')
      ORDER BY a.status, a.start_date DESC`,
    [filter.status ?? null, filter.search ?? null, filter.customerId ?? null],
  );
  return rows.map((a) => ({ ...a, summary: summarize(a, Number(a.paid_sum)) }));
}

export async function agreementPayments(id: number) {
  return q("SELECT id, amount, source, note, paid_at, created_by FROM installment_payments WHERE agreement_id = $1 ORDER BY paid_at", [id]);
}

export async function getAgreement(id: number) {
  return one("SELECT * FROM installment_agreements WHERE id = $1", [id]);
}
