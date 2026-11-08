import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { one, q } from "../db.js";
import { AppError } from "../errors.js";
import { issueToken, requireCustomer, upsertCustomer } from "../auth.js";
import { verifyLoginWidget, verifyWebAppInitData } from "../telegramAuth.js";
import { getSettings } from "../settings.js";
import { createOrder, type NewOrder } from "../services/orders.js";
import { createReceipt } from "../services/receipts.js";
import { payFromBalance } from "../services/installments.js";
import { PREMIUM_PLANS, rentCost, rentCustomerPrice, rentTotalTon, starsPrice } from "../pricing.js";
import * as mk from "../marketapp.js";
import { saveUpload } from "../uploads.js";
import { notifyNewOrder, notifyNewReceipt } from "../bot.js";

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const IdemKey = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
const cleanUser = (s: string) => s.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");

const RENT_CATEGORY = { gift_rent: "gifts", username_rent: "usernames", number_rent: "numbers" } as const;

export default async function customerRoutes(app: FastifyInstance) {
  // --- Ochiq sozlamalar ---
  app.get("/api/config", async () => {
    const s = await getSettings();
    return {
      botUsername: config.BOT_USERNAME ?? null,
      services: s.services_enabled,
      starsPrice: s.stars_price,
      starsMin: s.stars_min,
      premiumPrices: s.premium_prices,
      rentFormula: s.rent_formula,
      adminContact: s.admin_contact,
      marketapp: mk.marketappConfigured(),
    };
  });

  // --- Telegram orqali kirish ---
  app.post("/api/auth/telegram", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({ initData: z.string().max(4096).optional(), widget: z.record(z.string()).optional() }).parse(req.body);
    if (!config.BOT_TOKEN) throw new AppError("BOT_NOT_CONFIGURED", 503);
    const user = body.initData ? verifyWebAppInitData(body.initData, config.BOT_TOKEN)
      : body.widget ? verifyLoginWidget(body.widget, config.BOT_TOKEN) : null;
    if (!user) throw new AppError("TELEGRAM_AUTH_FAILED", 401);
    const c = await upsertCustomer(user);
    const admin = config.adminIds.has(user.id);
    return { token: await issueToken({ cid: c!.id, tid: user.id, admin }), admin };
  });

  app.get("/api/me", async (req) => {
    const s = await requireCustomer(req);
    const c = await one("SELECT id, telegram_id, username, first_name, phone, lang, balance FROM customers WHERE id = $1", [s.cid]);
    if (!c) throw new AppError("UNAUTHORIZED", 401);
    return { ...c, admin: s.admin, hasPhone: Boolean(c.phone) };
  });

  app.post("/api/me/lang", async (req) => {
    const s = await requireCustomer(req);
    const { lang } = z.object({ lang: z.enum(["uz", "ru", "en", "zh"]) }).parse(req.body);
    await q("UPDATE customers SET lang = $2 WHERE id = $1", [s.cid, lang]);
    return { ok: true };
  });

  // --- Ijara katalogi ---
  app.get("/api/rent/:category", async (req) => {
    const { category } = z.object({ category: z.enum(["gifts", "usernames", "numbers"]) }).parse(req.params);
    const qs = z.object({
      cursor: z.string().max(200).optional(), sort_by: z.enum(["price_per_day", "min_price", "duration_asc", "duration_desc", "item_num_asc", "item_num_desc", "recently_touch"]).optional(),
      model: z.string().max(80).optional(), backdrop: z.string().max(80).optional(), symbol: z.string().max(80).optional(),
      collection_address: z.string().max(80).optional(),
    }).parse(req.query);
    const s = await getSettings();
    const data = await mk.listRent(category, qs);
    return {
      cursor: data.cursor,
      formula: s.rent_formula,
      items: data.items.map((it) => ({
        address: it.nft_address, name: it.nft_name, attributes: it.attributes,
        minDays: Math.max(1, Math.ceil(it.min_duration / 86400)), maxDays: Math.floor(it.max_duration / 86400),
        pricePerDayNano: it.price_per_day,
      })),
    };
  });

  app.get("/api/nft/collections", async () => mk.listGiftCollections());
  app.get("/api/nft/collections/:address/attributes", async (req) => {
    const { address } = z.object({ address: z.string() }).parse(req.params);
    return mk.collectionAttributes(address);
  });

  // --- Qabul qiluvchini tekshirish (Stars / Premium) ---
  app.post("/api/recipient/check", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    await requireCustomer(req);
    const b = z.object({ service: z.enum(["premium", "stars"]), username: z.string().max(64) }).parse(req.body);
    const u = cleanUser(b.username);
    if (!USERNAME.test(u)) throw new AppError("BAD_USERNAME");
    if (!mk.marketappConfigured()) return { username: u, verified: false };
    const r = b.service === "stars" ? await mk.searchStarsRecipient(u) : await mk.searchPremiumRecipient(u);
    return { username: u, verified: true, name: r.name, photo: r.photo };
  });

  // --- Rasm yuklash (maxsus NFT sovg'a so'rovi) ---
  app.post("/api/uploads/image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    await requireCustomer(req);
    const f = await req.file();
    if (!f) throw new AppError("FILE_REQUIRED");
    const saved = await saveUpload(await f.toBuffer(), false);
    return { file: saved.name };
  });

  // --- Buyurtma berish ---
  const Recipient = z.object({ self: z.boolean(), username: z.string().max(64).optional() });
  const OrderBody = z.discriminatedUnion("service", [
    z.object({ service: z.literal("premium"), plan: z.enum(PREMIUM_PLANS), paymentMethod: z.enum(["cash", "installment"]),
      installmentType: z.enum(["plan2", "uzum"]).optional(), recipient: Recipient, idempotencyKey: IdemKey }),
    z.object({ service: z.literal("stars"), quantity: z.number().int().max(1_000_000), paymentMethod: z.enum(["cash", "installment"]),
      installmentType: z.enum(["plan2", "uzum"]).optional(), recipient: Recipient, idempotencyKey: IdemKey }),
    z.object({ service: z.literal("nft_gift"), paymentMethod: z.literal("installment"), installmentType: z.enum(["plan1", "plan2", "uzum"]),
      giftName: z.string().max(120).optional(), giftLink: z.string().max(300).optional(), giftImage: z.string().max(80).optional(),
      collectionAddress: z.string().max(80).optional(),
      model: z.string().max(80), backdrop: z.string().max(80), idempotencyKey: IdemKey }),
    ...(["gift_rent", "username_rent", "number_rent"] as const).map((sv) => z.object({
      service: z.literal(sv), address: z.string().min(10).max(100), days: z.number().int().min(1).max(3650),
      paymentMethod: z.enum(["cash", "installment"]), idempotencyKey: IdemKey })),
  ] as any);

  app.post("/api/orders", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req) => {
    const sess = await requireCustomer(req);
    const b = OrderBody.parse(req.body) as any;
    const s = await getSettings();
    if (!s.services_enabled[b.service as keyof typeof s.services_enabled]) throw new AppError("SERVICE_DISABLED", 409);
    const cust = await one("SELECT username FROM customers WHERE id = $1", [sess.cid]);

    const resolveRecipient = (r: { self: boolean; username?: string }) => {
      const u = r.self ? cust?.username : r.username ? cleanUser(r.username) : "";
      if (!u) throw new AppError(r.self ? "SELF_USERNAME_MISSING" : "RECIPIENT_REQUIRED");
      if (!USERNAME.test(u)) throw new AppError("BAD_USERNAME");
      return u;
    };

    let o: NewOrder;
    const base = { customerId: sess.cid, idempotencyKey: b.idempotencyKey, paymentMethod: b.paymentMethod, installmentType: b.paymentMethod === "installment" ? b.installmentType ?? null : null };

    if (b.service === "premium") {
      if (b.paymentMethod === "installment" && !b.installmentType) throw new AppError("INSTALLMENT_TYPE_REQUIRED");
      const months = { m1: "1", m3: "3", m6: "6", m12_login: "12", m12: "12" }[b.plan as string];
      const title = `Telegram Premium — ${months} oy${b.plan === "m12_login" ? " (akkauntga kirib)" : b.plan === "m12" ? " (akkauntga kirmasdan)" : ""}`;
      o = { ...base, service: "premium", title, details: { plan: b.plan }, recipient: resolveRecipient(b.recipient),
        price: b.paymentMethod === "cash" ? s.premium_prices[b.plan as keyof typeof s.premium_prices] : null };
    } else if (b.service === "stars") {
      if (b.quantity < s.stars_min) throw new AppError("STARS_MIN", 400, { min: s.stars_min });
      if (b.paymentMethod === "installment" && !b.installmentType) throw new AppError("INSTALLMENT_TYPE_REQUIRED");
      o = { ...base, service: "stars", title: `Telegram Stars — ${b.quantity} ta`, details: { quantity: b.quantity },
        recipient: resolveRecipient(b.recipient), price: b.paymentMethod === "cash" ? starsPrice(b.quantity, s) : null };
    } else if (b.service === "nft_gift") {
      const name = b.giftName?.trim(), link = b.giftLink?.trim(), image = b.giftImage?.trim();
      if (!name && !link && !image) throw new AppError("GIFT_IDENTIFICATION_REQUIRED");
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw new AppError("BAD_LINK");
      if (image && !/^\d+-[a-f0-9]{24}\.(jpg|png|webp)$/.test(image)) throw new AppError("BAD_IMAGE");
      o = { ...base, service: "nft_gift", title: name ? `NFT sovg'a — ${name}` : "NFT sovg'a (maxsus so'rov)",
        details: { name: name ?? null, link: link ?? null, image: image ?? null, collectionAddress: b.collectionAddress ?? null,
          model: b.model || "any", backdrop: b.backdrop || "any" }, price: null };
    } else {
      const category = RENT_CATEGORY[b.service as keyof typeof RENT_CATEGORY];
      const item = mk.getSeenRentItem(category, b.address);
      const minDays = Math.max(1, Math.ceil(item.min_duration / 86400));
      const maxDays = Math.floor(item.max_duration / 86400);
      if (b.days < minDays || b.days > maxDays) throw new AppError("BAD_DURATION", 400, { minDays, maxDays });
      const P = rentTotalTon(item.price_per_day, b.days);
      const price = rentCustomerPrice(P, s.rent_formula);
      o = { ...base, service: b.service, installmentType: null, title: `${item.nft_name} — ${b.days} kun`,
        details: { address: item.nft_address, name: item.nft_name, days: b.days, pricePerDayNano: item.price_per_day,
          marketappTotalTon: P, attributes: item.attributes, formula: s.rent_formula },
        price: b.paymentMethod === "cash" ? price : null, cost: rentCost(P, s.rent_formula) };
      if (b.paymentMethod === "installment") (o.details as any).quotedPrice = price;
    }

    const r = await createOrder(o);
    if (!r.duplicate) void notifyNewOrder(r.id);
    return { publicId: r.publicId, duplicate: r.duplicate, paymentMethod: o.paymentMethod };
  });

  // --- Xaridlarim (navbat raqami va ichki hisob ko'rsatilmaydi) ---
  app.get("/api/orders", async (req) => {
    const s = await requireCustomer(req);
    const rows = await q(
      `SELECT o.public_id, o.service, o.title, o.payment_method, o.status, o.price, o.recipient, o.created_at, o.details,
              a.id AS agreement_id, a.start_date, a.monthly_payment, a.final_date, a.status AS agreement_status
         FROM orders o LEFT JOIN installment_agreements a ON a.order_id = o.id
        WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [s.cid]);
    const legacy = await q(
      `SELECT id AS agreement_id, product_name AS title, start_date, monthly_payment, final_date, status AS agreement_status, created_at
         FROM installment_agreements WHERE customer_id = $1 AND order_id IS NULL ORDER BY start_date DESC`, [s.cid]);
    return {
      orders: rows.map((r) => ({
        publicId: r.public_id, service: r.service, title: r.title, paymentMethod: r.payment_method, status: r.status,
        price: r.payment_method === "cash" ? r.price : null, recipient: r.recipient, createdAt: r.created_at,
        image: r.details?.address && r.service !== "nft_gift" ? { service: r.service, name: r.details.name } : null,
        installment: r.agreement_id ? {
          id: r.agreement_id, purchasedAt: r.start_date, monthlyPayment: r.monthly_payment, finalDate: r.final_date,
          active: r.agreement_status === "active",
        } : null,
      })),
      agreements: legacy.map((a) => ({
        id: a.agreement_id, title: a.title, purchasedAt: a.start_date, monthlyPayment: a.monthly_payment, finalDate: a.final_date,
        active: a.agreement_status === "active",
      })),
    };
  });

  // Buyurtmani ID orqali kuzatish (shaxsiy ma'lumotsiz)
  app.get("/api/track/:publicId", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { publicId } = z.object({ publicId: z.string().regex(/^NG-[A-Z0-9]{6}$/i) }).parse(req.params);
    const o = await one("SELECT public_id, title, status, created_at FROM orders WHERE public_id = $1", [publicId.toUpperCase()]);
    if (!o) throw new AppError("ORDER_NOT_FOUND", 404);
    return { publicId: o.public_id, title: o.title, status: o.status, createdAt: o.created_at };
  });

  // --- Balans ---
  app.get("/api/balance", async (req) => {
    const s = await requireCustomer(req);
    const st = await getSettings();
    const c = await one("SELECT balance, lang FROM customers WHERE id = $1", [s.cid]);
    const ledger = await q("SELECT amount, kind, note, created_at FROM balance_ledger WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100", [s.cid]);
    const receipts = await q("SELECT id, amount, status, created_at FROM topup_receipts WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20", [s.cid]);
    return {
      balance: c.balance, ledger, receipts,
      card: { number: st.card_number, holder: st.card_holder },
      instructions: st.payment_instructions[(c.lang as "uz") ?? "uz"] ?? st.payment_instructions.uz,
      adminContact: st.admin_contact,
    };
  });

  app.post("/api/balance/receipts", { config: { rateLimit: { max: 6, timeWindow: "10 minutes" } } }, async (req) => {
    const s = await requireCustomer(req);
    const pending = await one("SELECT count(*)::int n FROM topup_receipts WHERE customer_id = $1 AND status = 'pending'", [s.cid]);
    if (pending.n >= 5) throw new AppError("TOO_MANY_PENDING_RECEIPTS", 429);
    let amount = NaN;
    let buf: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") buf = await part.toBuffer();
      else if (part.fieldname === "amount") amount = Number(String(part.value).replace(/[\s,]/g, ""));
    }
    if (!Number.isFinite(amount) || amount < 1000 || amount > 1_000_000_000) throw new AppError("BAD_AMOUNT");
    if (!buf) throw new AppError("FILE_REQUIRED");
    const f = await saveUpload(buf, true);
    const id = await createReceipt(s.cid, Math.round(amount * 100) / 100, f.name, f.mime);
    void notifyNewReceipt(id);
    return { id };
  });

  // --- Bo'lib to'lash: oylik to'lovni mijoz o'zi tasdiqlab to'laydi ---
  app.post("/api/installments/:id/pay", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const s = await requireCustomer(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const { idempotencyKey } = z.object({ idempotencyKey: IdemKey }).parse(req.body);
    const r = await payFromBalance(id, s.cid, idempotencyKey);
    return { amount: r.amount };
  });
}
