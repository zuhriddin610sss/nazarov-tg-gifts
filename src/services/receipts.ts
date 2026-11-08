import { tx, one } from "../db.js";
import { AppError } from "../errors.js";
import { applyLedger } from "./balance.js";
import { audit } from "../audit.js";

export async function createReceipt(customerId: number, amount: number, fileName: string, mime: string) {
  if (!(amount > 0)) throw new AppError("BAD_AMOUNT");
  const r = await one<{ id: number }>(
    "INSERT INTO topup_receipts (customer_id, amount, file_name, file_mime) VALUES ($1,$2,$3,$4) RETURNING id",
    [customerId, amount, fileName, mime],
  );
  return r!.id;
}

/**
 * Admin chekni tasdiqlaydi: balansga aynan bir marta tushadi (idempotency kaliti receipt:<id>).
 * Admin summani o'zgartirishi mumkin (chekdagi haqiqiy summa boshqacha bo'lsa).
 */
export async function approveReceipt(id: number, actor: string, amountOverride?: number) {
  return tx(async (c) => {
    const r = await c.query("SELECT * FROM topup_receipts WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rowCount) throw new AppError("RECEIPT_NOT_FOUND", 404);
    const rc = r.rows[0];
    if (rc.status !== "pending") throw new AppError("RECEIPT_ALREADY_REVIEWED", 409, { status: rc.status });
    const amount = amountOverride ?? Number(rc.amount);
    if (!(amount > 0)) throw new AppError("BAD_AMOUNT");
    const led = await applyLedger(c, {
      customerId: rc.customer_id, amount, kind: "topup", key: `receipt:${id}`, refType: "receipt", refId: id, by: actor,
    });
    await c.query(
      "UPDATE topup_receipts SET status = 'approved', amount = $2, ledger_id = $3, reviewed_at = now() WHERE id = $1",
      [id, amount, led.id],
    );
    await audit(c, actor, "receipt.approve", String(id), { amount, requested: rc.amount });
    return { customerId: rc.customer_id as number, amount, balance: led.balanceAfter };
  });
}

export async function rejectReceipt(id: number, actor: string, note?: string) {
  return tx(async (c) => {
    const r = await c.query("SELECT * FROM topup_receipts WHERE id = $1 FOR UPDATE", [id]);
    if (!r.rowCount) throw new AppError("RECEIPT_NOT_FOUND", 404);
    if (r.rows[0].status !== "pending") throw new AppError("RECEIPT_ALREADY_REVIEWED", 409);
    await c.query("UPDATE topup_receipts SET status = 'rejected', admin_note = $2, reviewed_at = now() WHERE id = $1", [id, note ?? null]);
    await audit(c, actor, "receipt.reject", String(id), { note });
    return { customerId: r.rows[0].customer_id as number, amount: Number(r.rows[0].amount) };
  });
}

/** Admin balansni qo'lda o'zgartiradi (kirim yoki chiqim). */
export async function adminAdjust(customerId: number, amount: number, key: string, actor: string, note: string) {
  return tx(async (c) => {
    const led = await applyLedger(c, {
      customerId, amount, kind: amount > 0 ? "admin_credit" : "admin_debit", key: `admin:${key}`, note, by: actor,
    });
    await audit(c, actor, "balance.adjust", String(customerId), { amount, note, duplicate: led.duplicate });
    return led;
  });
}
