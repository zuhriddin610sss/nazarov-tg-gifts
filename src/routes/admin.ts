import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { z } from "zod";
import { one, q } from "../db.js";
import { AppError } from "../errors.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import { getSettings, saveSettings, SettingsSchema } from "../settings.js";
import { closeOrder, queueList } from "../services/orders.js";
import { approveReceipt, rejectReceipt, adminAdjust } from "../services/receipts.js";
import * as inst from "../services/installments.js";
import { uploadPath } from "../uploads.js";
import { notifyOrderClosed, notifyReceiptReviewed } from "../bot.js";
import { pool } from "../db.js";
import * as promo from "../services/promo.js";

const Id = z.object({ id: z.coerce.number().int().positive() });
const Money = z.number().finite();
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export default async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/admin/")) (req as any).admin = await requireAdmin(req);
  });
  const actor = (req: any) => `admin:${req.admin.tid}`;

  // --- Statistika ---
  app.get("/api/admin/stats", async () => {
    const [o] = await q(`SELECT
        count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent')::int AS today,
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'completed')::int AS completed,
        count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE status = 'queued')::int AS queued,
        COALESCE(SUM(paid_amount) FILTER (WHERE status = 'completed'), 0) AS cash_revenue,
        COALESCE(SUM(price - cost) FILTER (WHERE status = 'completed' AND payment_method = 'cash' AND cost IS NOT NULL), 0) AS rent_profit,
        count(*) FILTER (WHERE service IN ('gift_rent','username_rent','number_rent'))::int AS rent_orders,
        COALESCE(SUM(paid_amount) FILTER (WHERE status = 'completed' AND service IN ('gift_rent','username_rent','number_rent')), 0) AS rent_revenue
      FROM orders`);
    const [c] = await q("SELECT count(*)::int AS customers, COALESCE(SUM(balance),0) AS liabilities FROM customers");
    // Eslatma: legacy shartnomalarning platformadan oldingi to'lovlari ham shu yerga kiradi
    const [p] = await q(`SELECT COALESCE(SUM(amount),0) AS inst_collected,
        COALESCE(SUM(amount) FILTER (WHERE paid_at >= date_trunc('month', now())), 0) AS inst_this_month,
        (SELECT COALESCE(SUM(down_payment),0) FROM installment_agreements) AS down_payments FROM installment_payments`);
    const agreements = await inst.listAgreements({ status: "active" });
    const debt = agreements.reduce((s, a) => s + a.summary.remaining, 0);
    const overdue = agreements.filter((a) => a.summary.overdue).length;
    const [r] = await q(`SELECT (SELECT count(*)::int FROM topup_receipts WHERE status = 'pending') AS pending_receipts,
                                (SELECT count(*)::int FROM reviews WHERE status = 'pending') AS pending_reviews`);
    return { orders: o, customers: c.customers, liabilities: c.liabilities, installments: { ...p, outstandingDebt: debt, overdue, active: agreements.length }, pendingReceipts: r.pending_receipts, pendingReviews: r.pending_reviews };
  });

  // --- Navbat va buyurtmalar ---
  app.get("/api/admin/queue", async () => queueList());

  app.post("/api/admin/orders/:id/close", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ status: z.enum(["completed", "cancelled"]), note: z.string().max(500).optional() }).parse(req.body);
    const r = await closeOrder(id, b.status, actor(req), b.note);
    void notifyOrderClosed(id, b.status, r.refunded);
    return r;
  });

  app.get("/api/admin/orders", async (req) => {
    const f = z.object({
      search: z.string().max(100).optional(), service: z.string().max(30).optional(), method: z.enum(["cash", "installment"]).optional(),
      status: z.enum(["queued", "completed", "cancelled"]).optional(), from: DateStr.optional(), to: DateStr.optional(),
    }).parse(req.query);
    return q(
      `SELECT o.id, o.public_id, o.service, o.payment_method, o.installment_type, o.status, o.title, o.recipient, o.price, o.cost,
              o.paid_amount, o.customer_username, o.customer_phone, o.created_at, o.closed_at, qu.position
         FROM orders o LEFT JOIN order_queue qu ON qu.id = o.id
        WHERE ($1::text IS NULL OR o.public_id ILIKE '%'||$1||'%' OR o.customer_username ILIKE '%'||$1||'%' OR o.customer_phone ILIKE '%'||$1||'%' OR o.title ILIKE '%'||$1||'%')
          AND ($2::text IS NULL OR o.service = $2) AND ($3::text IS NULL OR o.payment_method = $3) AND ($4::text IS NULL OR o.status = $4)
          AND ($5::date IS NULL OR o.created_at >= $5::date) AND ($6::date IS NULL OR o.created_at < $6::date + 1)
        ORDER BY o.created_at DESC LIMIT 300`,
      [f.search ?? null, f.service ?? null, f.method ?? null, f.status ?? null, f.from ?? null, f.to ?? null]);
  });

  app.get("/api/admin/orders/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const o = await one(`SELECT o.*, qu.position, c.telegram_id, c.balance FROM orders o JOIN customers c ON c.id = o.customer_id
                           LEFT JOIN order_queue qu ON qu.id = o.id WHERE o.id = $1`, [id]);
    if (!o) throw new AppError("ORDER_NOT_FOUND", 404);
    const agreement = await one("SELECT id FROM installment_agreements WHERE order_id = $1", [id]);
    return { ...o, agreementId: agreement?.id ?? null };
  });

  // --- Fayllar (cheklar, sovg'a rasmlari) faqat admin uchun ---
  app.get("/api/admin/files/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const p = uploadPath(name);
    const type = name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
    reply.header("cache-control", "private, no-store").type(type);
    return reply.send(createReadStream(p));
  });

  // --- Cheklar ---
  app.get("/api/admin/receipts", async (req) => {
    const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).parse(req.query);
    return q(`SELECT r.*, c.username, c.phone, c.telegram_id FROM topup_receipts r JOIN customers c ON c.id = r.customer_id
               WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`, [status ?? null]);
  });
  app.post("/api/admin/receipts/:id/approve", async (req) => {
    const { id } = Id.parse(req.params);
    const { amount } = z.object({ amount: Money.positive().optional() }).parse(req.body ?? {});
    const r = await approveReceipt(id, actor(req), amount);
    void notifyReceiptReviewed(id, true);
    return r;
  });
  app.post("/api/admin/receipts/:id/reject", async (req) => {
    const { id } = Id.parse(req.params);
    const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const r = await rejectReceipt(id, actor(req), note);
    void notifyReceiptReviewed(id, false);
    return r;
  });

  // --- Mijozlar ---
  app.get("/api/admin/customers", async (req) => {
    const { search } = z.object({ search: z.string().max(100).optional() }).parse(req.query);
    return q(`SELECT c.id, c.telegram_id, c.username, c.first_name, c.phone, c.balance, c.created_at,
                     (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS orders
                FROM customers c
               WHERE ($1::text IS NULL OR c.username ILIKE '%'||$1||'%' OR c.phone ILIKE '%'||$1||'%' OR c.first_name ILIKE '%'||$1||'%' OR c.telegram_id::text = $1)
               ORDER BY c.created_at DESC LIMIT 200`, [search ?? null]);
  });
  app.get("/api/admin/customers/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const c = await one("SELECT * FROM customers WHERE id = $1", [id]);
    if (!c) throw new AppError("CUSTOMER_NOT_FOUND", 404);
    const orders = await q("SELECT id, public_id, title, status, payment_method, price, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC", [id]);
    const ledger = await q("SELECT * FROM balance_ledger WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 200", [id]);
    const agreements = await inst.listAgreements({ customerId: id });
    return { customer: c, orders, ledger, agreements };
  });
  app.post("/api/admin/customers/:id/adjust", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ amount: Money.refine((x) => x !== 0), note: z.string().min(2).max(300), idempotencyKey: z.string().min(8).max(80) }).parse(req.body);
    return adminAdjust(id, b.amount, b.idempotencyKey, actor(req), b.note);
  });

  // --- Bo'lib to'lash boshqaruvi ---
  const AgreementBody = z.object({
    orderId: z.number().int().optional().nullable(), customerId: z.number().int().optional().nullable(), legacy: z.boolean().default(false),
    clientName: z.string().max(120).optional().nullable(), clientUsername: z.string().max(64).optional().nullable(), clientPhone: z.string().max(30).optional().nullable(),
    productName: z.string().min(1).max(200), installmentType: z.string().max(30).optional().nullable(),
    totalPrice: Money.positive(), downPayment: Money.min(0).default(0), monthlyPayment: Money.positive(),
    startDate: DateStr, finalDate: DateStr, collateral: z.string().max(300).optional().nullable(), notes: z.string().max(2000).optional().nullable(),
    alreadyPaid: Money.min(0).optional(),
  });
  app.get("/api/admin/installments", async (req) => {
    const f = z.object({ status: z.enum(["active", "closed"]).optional(), search: z.string().max(100).optional() }).parse(req.query);
    return inst.listAgreements(f);
  });
  app.post("/api/admin/installments", async (req) => ({ id: await inst.createAgreement(AgreementBody.parse(req.body), actor(req)) }));
  app.patch("/api/admin/installments/:id", async (req) => {
    const { id } = Id.parse(req.params);
    const b = AgreementBody.partial().extend({ status: z.enum(["active", "closed"]).optional() }).parse(req.body);
    await inst.updateAgreement(id, b, actor(req));
    return { ok: true };
  });
  app.get("/api/admin/installments/:id/payments", async (req) => inst.agreementPayments(Id.parse(req.params).id));
  app.post("/api/admin/installments/:id/payments", async (req) => {
    const { id } = Id.parse(req.params);
    const b = z.object({ amount: Money.positive(), note: z.string().max(300).optional(), paidAt: DateStr.optional(), idempotencyKey: z.string().min(8).max(80) }).parse(req.body);
    return inst.addManualPayment(id, b.amount, b.idempotencyKey, actor(req), b.note, b.paidAt);
  });

  // --- Sozlamalar ---
  app.get("/api/admin/settings", async () => getSettings());
  app.put("/api/admin/settings", async (req) => {
    const s = SettingsSchema.parse(req.body);
    const before = await getSettings();
    await saveSettings(s);
    await audit(pool, actor(req), "settings.update", null, { before, after: s });
    return { ok: true };
  });

  // --- Promo-kodlar ---
  const PromoBody = z.object({
    code: z.string().min(3).max(32), kind: z.enum(["percent", "fixed"]), value: Money.positive(),
    services: z.array(z.enum(["nft_gift", "gift_rent", "username_rent", "number_rent", "premium", "stars"])).nullable().default(null),
    expiresAt: z.string().max(40).nullable().default(null), maxUses: z.number().int().positive().nullable().default(null), active: z.boolean().default(true),
  });
  app.get("/api/admin/promos", async () => promo.listPromos());
  app.post("/api/admin/promos", async (req) => { await promo.upsertPromo(PromoBody.parse(req.body), actor(req)); return { ok: true }; });
  app.put("/api/admin/promos/:id", async (req) => {
    const { id } = Id.parse(req.params);
    await promo.upsertPromo({ ...PromoBody.parse(req.body), id }, actor(req));
    return { ok: true };
  });

  // --- Sharhlar (moderatsiya) ---
  app.get("/api/admin/reviews", async (req) => {
    const { status } = z.object({ status: z.enum(["pending", "published", "rejected"]).optional() }).parse(req.query);
    return q(`SELECT r.*, o.public_id, o.title, c.username FROM reviews r JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = r.customer_id
               WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`, [status ?? null]);
  });
  app.post("/api/admin/reviews/:id/:action", async (req) => {
    const { id, action } = z.object({ id: z.coerce.number().int(), action: z.enum(["publish", "reject"]) }).parse(req.params);
    const st = action === "publish" ? "published" : "rejected";
    const r = await q("UPDATE reviews SET status = $2, reviewed_at = now() WHERE id = $1 RETURNING id", [id, st]);
    if (!r.length) throw new AppError("NOT_FOUND", 404);
    await audit(pool, actor(req), "review." + action, String(id));
    return { ok: true };
  });

  // --- Jurnallar ---
  app.get("/api/admin/audit", async () => q("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 300"));
  app.get("/api/admin/errors", async () => q("SELECT * FROM error_log ORDER BY created_at DESC LIMIT 300"));
}
