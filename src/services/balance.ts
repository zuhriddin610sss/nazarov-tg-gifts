import type { Tx } from "../db.js";
import { AppError } from "../errors.js";

export type LedgerKind = "topup" | "order_payment" | "refund" | "admin_credit" | "admin_debit" | "installment_payment";

/**
 * Balansni o'zgartiradi. Tranzaksiya ichida chaqirilishi shart.
 * - Mijoz qatori FOR UPDATE bilan qulflanadi (bir vaqtdagi yechishlar navbatma-navbat bajariladi).
 * - idempotency_key takrorlansa, o'sha yozuv qaytariladi va balans qayta o'zgarmaydi.
 * - Balans manfiy bo'la olmaydi.
 */
export async function applyLedger(
  c: Tx,
  p: { customerId: number; amount: number; kind: LedgerKind; key: string; refType?: string; refId?: number; note?: string; by?: string },
): Promise<{ id: number; balanceAfter: string; duplicate: boolean }> {
  if (!Number.isFinite(p.amount) || p.amount === 0) throw new AppError("BAD_AMOUNT");
  const cust = await c.query("SELECT balance FROM customers WHERE id = $1 FOR UPDATE", [p.customerId]);
  if (!cust.rowCount) throw new AppError("CUSTOMER_NOT_FOUND", 404);

  const existing = await c.query("SELECT id, balance_after, customer_id, amount FROM balance_ledger WHERE idempotency_key = $1", [p.key]);
  if (existing.rowCount) {
    const e = existing.rows[0];
    if (Number(e.customer_id) !== p.customerId || Number(e.amount) !== p.amount) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    return { id: e.id, balanceAfter: e.balance_after, duplicate: true };
  }

  const upd = await c.query(
    "UPDATE customers SET balance = balance + $2 WHERE id = $1 AND balance + $2 >= 0 RETURNING balance",
    [p.customerId, p.amount],
  );
  if (!upd.rowCount) throw new AppError("INSUFFICIENT_BALANCE", 402, { balance: cust.rows[0].balance });
  const balanceAfter = upd.rows[0].balance as string;

  const ins = await c.query(
    `INSERT INTO balance_ledger (customer_id, amount, balance_after, kind, ref_type, ref_id, idempotency_key, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [p.customerId, p.amount, balanceAfter, p.kind, p.refType ?? null, p.refId ?? null, p.key, p.note ?? null, p.by ?? "system"],
  );
  return { id: ins.rows[0].id, balanceAfter, duplicate: false };
}
