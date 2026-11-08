/**
 * Muhim stsenariylar haqiqiy PostgreSQL bazasida tekshiriladi.
 * Ishga tushirish: DATABASE_URL=postgres://.../ng_test npm test
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac, createHash } from "node:crypto";

process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123";
process.env.DATABASE_URL ??= "postgres://ng:ng@localhost:5432/ng_test";
process.env.BOT_MODE = "off";

const { pool, q, one } = await import("../src/db.js");
const { migrate } = await import("../src/migrate.js");
const { createOrder, closeOrder, queueList } = await import("../src/services/orders.js");
const { approveReceipt, createReceipt, adminAdjust } = await import("../src/services/receipts.js");
const inst = await import("../src/services/installments.js");
const { verifyWebAppInitData, verifyLoginWidget } = await import("../src/telegramAuth.js");
const { rentCustomerPrice, rentTotalTon } = await import("../src/pricing.js");
const promo = await import("../src/services/promo.js");
const { sendRentReminders } = await import("../src/jobs.js");

let n = 0;
async function customer(balance = 0, phone: string | null = "+998901234567") {
  n++;
  const c = await one<{ id: number }>(
    "INSERT INTO customers (telegram_id, username, phone, balance) VALUES ($1,$2,$3,$4) RETURNING id",
    [1000 + n + Math.floor(Math.random() * 1e9), `user${n}`, phone, balance]);
  return c!.id;
}
const order = (cid: number, key: string, price: number | null, method: "cash" | "installment" = "cash") =>
  createOrder({ customerId: cid, service: "stars", paymentMethod: method, title: "Stars", details: {}, price, idempotencyKey: key });
const bal = async (cid: number) => Number((await one("SELECT balance FROM customers WHERE id = $1", [cid])).balance);

beforeAll(async () => { await migrate(); });
beforeEach(async () => {
  await pool.query("TRUNCATE reviews, promo_redemptions, promo_codes, installment_payments, installment_agreements, topup_receipts, balance_ledger, orders, customers, audit_log, notifications_sent RESTART IDENTITY CASCADE");
});
afterAll(async () => { await pool.end(); });

describe("ijara formulasi", () => {
  it("(1.5 + 0.15) × 2 × 19000 = 62 700", () => {
    expect(rentCustomerPrice(1.5, { add: 0.15, mult: 2, rate: 19000 })).toBe(62700);
  });
  it("kunlik nanoGRAM narxidan butun muddat narxi, yaxlitlanmaydi", () => {
    const P = rentTotalTon("123456789", 3); // 0.370370367 TON
    expect(P).toBeCloseTo(0.370370367, 9);
    expect(rentCustomerPrice(P, { add: 0.15, mult: 2, rate: 19000 })).toBe(19774.07);
  });
});

describe("navbat", () => {
  it("bajarilgan yoki bekor qilingan buyurtmadan keyin raqamlar suriladi, ID o'zgarmaydi", async () => {
    const c = await customer();
    const a = await order(c, "key-aaaaaaaa", null, "installment");
    const b = await order(c, "key-bbbbbbbb", null, "installment");
    const d = await order(c, "key-cccccccc", null, "installment");
    expect([a.queuePosition, b.queuePosition, d.queuePosition]).toEqual([1, 2, 3]);
    await closeOrder(a.id, "completed", "test");
    const list = await queueList();
    expect(list.map((x: any) => [Number(x.position), x.public_id])).toEqual([[1, b.publicId], [2, d.publicId]]);
    const e = await order(c, "key-dddddddd", null, "installment");
    expect(e.queuePosition).toBe(3);
  });

  it("parallel yakunlashda ham bo'shliq va takror bo'lmaydi", async () => {
    const c = await customer();
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push((await order(c, `par-key-${i}xx`, null, "installment")).id);
    await Promise.all([ids[0], ids[3], ids[5], ids[8]].map((id, i) => closeOrder(id, i % 2 ? "cancelled" : "completed", "t")));
    const pos = (await queueList()).map((x: any) => Number(x.position));
    expect(pos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("naqd buyurtma ham navbatga tushadi", async () => {
    const c = await customer(100000);
    const r = await order(c, "cash-key-1", 50000);
    expect(r.queuePosition).toBe(1);
  });
});

describe("balans", () => {
  it("naqd buyurtma pulni bir marta yechadi, takroriy so'rov ikkinchi marta yechmaydi", async () => {
    const c = await customer(100000);
    const [r1, r2] = await Promise.all([order(c, "same-key-1", 30000), order(c, "same-key-1", 30000)]);
    expect(r1.publicId).toBe(r2.publicId);
    expect(await bal(c)).toBe(70000);
    expect((await q("SELECT * FROM orders WHERE customer_id = $1", [c])).length).toBe(1);
  });

  it("balans yetmasa buyurtma yaratilmaydi", async () => {
    const c = await customer(10000);
    await expect(order(c, "poor-key-1", 30000)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await bal(c)).toBe(10000);
    expect((await q("SELECT * FROM orders")).length).toBe(0);
  });

  it("parallel buyurtmalar balansni manfiyga tushirmaydi", async () => {
    const c = await customer(100000);
    const res = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => order(c, `race-key-${i}x`, 30000)));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(3);
    expect(await bal(c)).toBe(10000);
  });

  it("bekor qilinganda pul bir marta qaytadi", async () => {
    const c = await customer(100000);
    const o = await order(c, "refund-key-1", 40000);
    await Promise.allSettled([closeOrder(o.id, "cancelled", "t"), closeOrder(o.id, "cancelled", "t")]);
    expect(await bal(c)).toBe(100000);
    const refunds = await q("SELECT * FROM balance_ledger WHERE kind = 'refund'");
    expect(refunds.length).toBe(1);
  });

  it("telefon raqamisiz buyurtma qabul qilinmaydi", async () => {
    const c = await customer(100000, null);
    await expect(order(c, "nophone-key", 1000)).rejects.toMatchObject({ code: "PHONE_REQUIRED" });
  });

  it("chek ikki marta tasdiqlansa ham balansga bir marta tushadi", async () => {
    const c = await customer(0);
    const id = await createReceipt(c, 50000, "x.jpg", "image/jpeg");
    const res = await Promise.allSettled([approveReceipt(id, "a"), approveReceipt(id, "a")]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await bal(c)).toBe(50000);
  });

  it("admin tuzatishi bir xil kalit bilan takrorlanmaydi", async () => {
    const c = await customer(0);
    await adminAdjust(c, 20000, "adj-key-1", "a", "bonus");
    await adminAdjust(c, 20000, "adj-key-1", "a", "bonus");
    expect(await bal(c)).toBe(20000);
  });
});

describe("bo'lib to'lash", () => {
  it("eski shartnoma: qarz va kechikish hisoblanadi", async () => {
    const id = await inst.createAgreement({
      legacy: true, clientName: "Ali", productName: "Plush Pepe", totalPrice: 1_200_000, downPayment: 200_000,
      monthlyPayment: 100_000, startDate: "2026-01-10", finalDate: "2026-11-10", alreadyPaid: 300_000,
    }, "a");
    const a = await inst.getAgreement(id);
    const s = inst.summarize(a, 300_000, new Date("2026-08-15"));
    expect(s.paid).toBe(500_000);
    expect(s.remaining).toBe(700_000);
    // 7 oy o'tgan: kutilgan 200k + 700k = 900k, to'langan 500k
    expect(s.overdueAmount).toBe(400_000);
    expect(s.overdue).toBe(true);
  });

  it("mijoz oylik to'lovni balansdan to'laydi, takroriy so'rov ikki marta yechmaydi", async () => {
    const c = await customer(500_000);
    const o = await order(c, "inst-order-1", null, "installment");
    const id = await inst.createAgreement({
      orderId: o.id, legacy: false, productName: "Gift", totalPrice: 300_000, downPayment: 0, monthlyPayment: 100_000,
      startDate: "2026-10-01", finalDate: "2027-01-01",
    }, "a");
    await Promise.allSettled([inst.payFromBalance(id, c, "pay-key-1"), inst.payFromBalance(id, c, "pay-key-1")]);
    expect(await bal(c)).toBe(400_000);
    const p = await inst.agreementPayments(id);
    expect(p.length).toBe(1);
  });

  it("boshqa mijozning shartnomasini to'lab bo'lmaydi", async () => {
    const c1 = await customer(500_000);
    const c2 = await customer(500_000);
    const o = await order(c1, "inst-order-2", null, "installment");
    const id = await inst.createAgreement({ orderId: o.id, legacy: false, productName: "G", totalPrice: 100_000, downPayment: 0,
      monthlyPayment: 50_000, startDate: "2026-10-01", finalDate: "2026-12-01" }, "a");
    await expect(inst.payFromBalance(id, c2, "pay-key-x")).rejects.toMatchObject({ code: "AGREEMENT_NOT_FOUND" });
  });
});

describe("Telegram autentifikatsiya", () => {
  const token = "123456:TEST_TOKEN";
  it("Mini App initData to'g'ri imzo bilan qabul qilinadi, soxtasi rad etiladi", () => {
    const user = JSON.stringify({ id: 42, username: "ali" });
    const auth_date = String(Math.floor(Date.now() / 1000));
    const fields: Record<string, string> = { auth_date, query_id: "AAA", user };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const hash = createHmac("sha256", secret).update(dcs).digest("hex");
    const init = new URLSearchParams({ ...fields, hash }).toString();
    expect(verifyWebAppInitData(init, token)?.id).toBe(42);
    const forged = new URLSearchParams({ ...fields, user: JSON.stringify({ id: 43 }), hash }).toString();
    expect(verifyWebAppInitData(forged, token)).toBeNull();
  });
  it("Login Widget imzosi tekshiriladi", () => {
    const data: Record<string, string> = { id: "42", first_name: "Ali", auth_date: String(Math.floor(Date.now() / 1000)) };
    const dcs = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n");
    const hash = createHmac("sha256", createHash("sha256").update(token).digest()).update(dcs).digest("hex");
    expect(verifyLoginWidget({ ...data, hash }, token)?.id).toBe(42);
    expect(verifyLoginWidget({ ...data, id: "43", hash }, token)).toBeNull();
  });
});

describe("promo-kodlar", () => {
  const promoOrder = (cid: number, key: string, code: string) =>
    createOrder({ customerId: cid, service: "stars", paymentMethod: "cash", title: "Stars", details: {}, price: 100_000, idempotencyKey: key, promoCode: code });

  it("foizli chegirma narxdan ayiriladi va balansdan kamroq yechiladi", async () => {
    await promo.upsertPromo({ code: "yangi10", kind: "percent", value: 10, services: null, expiresAt: null, maxUses: null, active: true }, "a");
    const c = await customer(200_000);
    const o = await promoOrder(c, "promo-key-1", "YANGI10");
    const row = await one("SELECT price, discount, paid_amount, promo_code FROM orders WHERE id = $1", [o.id]);
    expect([Number(row.price), Number(row.discount), Number(row.paid_amount), row.promo_code]).toEqual([90_000, 10_000, 90_000, "YANGI10"]);
    expect(await bal(c)).toBe(110_000);
  });

  it("bitta mijoz bitta kodni bir marta ishlatadi", async () => {
    await promo.upsertPromo({ code: "BIR", kind: "fixed", value: 5000, services: null, expiresAt: null, maxUses: null, active: true }, "a");
    const c = await customer(500_000);
    await promoOrder(c, "promo-key-2", "BIR");
    await expect(promoOrder(c, "promo-key-3", "BIR")).rejects.toMatchObject({ code: "PROMO_ALREADY_USED" });
    expect(await bal(c)).toBe(405_000);
  });

  it("parallel so'rovlarda ham ishlatish limiti oshmaydi", async () => {
    await promo.upsertPromo({ code: "LIMIT2", kind: "fixed", value: 1000, services: null, expiresAt: null, maxUses: 2, active: true }, "a");
    const cs = await Promise.all([1, 2, 3, 4, 5].map(() => customer(500_000)));
    const res = await Promise.allSettled(cs.map((c, i) => promoOrder(c, `lim-key-${i}xx`, "LIMIT2")));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(2);
    expect((await one("SELECT used_count FROM promo_codes WHERE code = 'LIMIT2'")).used_count).toBe(2);
  });

  it("muddati o'tgan va boshqa xizmatga mo'ljallangan kod rad etiladi", async () => {
    await promo.upsertPromo({ code: "ESKI", kind: "fixed", value: 1000, services: null, expiresAt: "2020-01-01T00:00:00Z", maxUses: null, active: true }, "a");
    await promo.upsertPromo({ code: "PREM", kind: "fixed", value: 1000, services: ["premium"], expiresAt: null, maxUses: null, active: true }, "a");
    const c = await customer(500_000);
    await expect(promoOrder(c, "promo-key-4", "ESKI")).rejects.toMatchObject({ code: "PROMO_EXPIRED" });
    await expect(promoOrder(c, "promo-key-5", "PREM")).rejects.toMatchObject({ code: "PROMO_NOT_FOR_SERVICE" });
    expect(await bal(c)).toBe(500_000);
  });

  it("bekor qilinganda chegirmali summa qaytadi", async () => {
    await promo.upsertPromo({ code: "QAYT", kind: "fixed", value: 20_000, services: null, expiresAt: null, maxUses: null, active: true }, "a");
    const c = await customer(100_000);
    const o = await promoOrder(c, "promo-key-6", "QAYT");
    expect(await bal(c)).toBe(20_000);
    await closeOrder(o.id, "cancelled", "t");
    expect(await bal(c)).toBe(100_000);
  });
});

describe("ijara eslatmalari", () => {
  it("tugashiga 72 va 24 soat qolganda bittadan eslatma yuboriladi", async () => {
    const c = await customer(0);
    const r = await createOrder({ customerId: c, service: "gift_rent", paymentMethod: "installment", title: "Gift #1 — 3 kun", details: { days: 3 }, price: null, idempotencyKey: "rent-key-1" });
    await closeOrder(r.id, "completed", "t");
    const closed = new Date((await one("SELECT closed_at FROM orders WHERE id = $1", [r.id])).closed_at);
    const at = (h: number) => new Date(closed.getTime() + (72 - h) * 3_600_000);
    await sendRentReminders(at(60));
    await sendRentReminders(at(50));
    await sendRentReminders(at(20));
    await sendRentReminders(at(10));
    const keys = (await q("SELECT key FROM notifications_sent WHERE key LIKE 'rent:%' ORDER BY key")).map((x: any) => x.key);
    expect(keys).toEqual([`rent:${r.id}:24h`, `rent:${r.id}:72h`]);
  });
});
