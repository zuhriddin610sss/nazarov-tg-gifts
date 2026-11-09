// Mijoz Mini App'i uchun amallar (endpoints/app.js orqali chaqiriladi).
import { api, InputFile } from 'sdk';
import { all, get, run, fail, getSettings, toSom, toTiyin, nowMs, int, str, idemKey, USERNAME_RE, cleanUser, adminIds, logError } from './core.js';
import * as mk from './marketapp.js';
import { PREMIUM_PLANS, PREMIUM_LABEL, rentTotalTon, rentPriceTiyin, rentCostTiyin, starsPriceTiyin } from './pricing.js';
import { createOrder, createReceipt, payInstallment, checkPromo, leaveReview, summarize } from './shop.js';
import { notifyNewOrder, receiptButtons } from './notify.js';
import { decode, imageType } from './b64.js';
import { fmt } from './core.js';

const LANGS = ['uz', 'ru', 'en', 'zh'];
const RENT = { gift_rent: 'gifts', username_rent: 'usernames', number_rent: 'numbers' };

/** Telegram tekshirgan foydalanuvchini topadi yoki yaratadi. */
export async function upsertCustomer(user) {
  const lc = String(user.language_code || '').slice(0, 2);
  await run(`INSERT INTO customers (telegram_id, username, first_name, last_name, lang, last_seen_at)
             VALUES (:tid, :u, :f, :l, :lang, :now)
             ON CONFLICT (telegram_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name,
               last_name = excluded.last_name, last_seen_at = excluded.last_seen_at`,
    { tid: user.id, u: user.username ?? null, f: user.first_name ?? null, l: user.last_name ?? null, lang: LANGS.includes(lc) ? lc : 'uz', now: nowMs() });
  return get('SELECT * FROM customers WHERE telegram_id = :tid', { tid: user.id });
}

/** Rasmni adminning chatiga jo'natib, Telegram file_id sini oladi (fayllar Telegram'da saqlanadi). */
async function storeImage(base64, caption, withButtonsFor) {
  const bytes = decode(base64);
  if (bytes.length === 0) throw fail('FILE_REQUIRED');
  if (bytes.length > 8 * 1024 * 1024) throw fail('FILE_TOO_LARGE');
  const type = imageType(bytes);
  if (!type) throw fail('FILE_TYPE_NOT_ALLOWED');
  const admins = adminIds();
  if (!admins.length) throw fail('ADMIN_NOT_CONFIGURED');
  const name = 'image.' + type.split('/')[1];
  let fileId = null;
  for (const id of admins) {
    try {
      const m = await api.sendPhoto({ chat_id: id, photo: fileId || new InputFile(bytes, name, { type }), caption,
        ...(withButtonsFor ? { reply_markup: receiptButtons(withButtonsFor) } : { disable_notification: true }) });
      if (!fileId && m && Array.isArray(m.photo)) fileId = m.photo[m.photo.length - 1].file_id;
    } catch (e) {
      await logError('upload', e && (e.description || e.message));
    }
  }
  if (!fileId) throw fail('UPLOAD_FAILED');
  return fileId;
}

export const actions = {
  async config() {
    const s = await getSettings();
    return {
      services: s.services_enabled, starsPrice: s.stars_price, starsMin: s.stars_min, premiumPrices: s.premium_prices,
      rentFormula: s.rent_formula, adminContact: s.admin_contact, marketapp: await mk.marketappConfigured(),
    };
  },

  async me(_i, c) {
    return { id: c.id, username: c.username, firstName: c.first_name, phone: c.phone, hasPhone: Boolean(c.phone), lang: c.lang, balance: toSom(c.balance) };
  },

  async setLang(i, c) {
    if (!LANGS.includes(i.lang)) throw fail('VALIDATION');
    await run('UPDATE customers SET lang = :l WHERE id = :id', { l: i.lang, id: c.id });
    return { ok: true };
  },

  /** Telefon raqamini Telegram kontakti orqali olish: Mini App requestContact -> botga kontakt keladi. Bu yerda faqat holat. */
  async phoneStatus(_i, c) {
    return { hasPhone: Boolean(c.phone) };
  },

  async rentList(i) {
    const category = ['gifts', 'usernames', 'numbers'].includes(i.category) ? i.category : null;
    if (!category) throw fail('VALIDATION', { field: 'category' });
    const s = await getSettings();
    const data = await mk.listRent(category, i);
    return {
      cursor: data.cursor, formula: s.rent_formula,
      items: data.items.map((it) => ({
        address: it.nft_address, name: it.nft_name, attributes: it.attributes || [],
        minDays: Math.max(1, Math.ceil(Number(it.min_duration) / 86400)), maxDays: Math.floor(Number(it.max_duration) / 86400),
        pricePerDayNano: String(it.price_per_day),
      })),
    };
  },

  async giftCollections() { return mk.giftCollections(); },
  async collectionAttributes(i) { return mk.collectionAttributes(i.address); },

  async checkRecipient(i) {
    const u = cleanUser(i.username);
    if (!USERNAME_RE.test(u)) throw fail('BAD_USERNAME');
    if (!(await mk.marketappConfigured())) return { username: u, verified: false };
    const r = await mk.searchRecipient(i.service, u);
    return { username: u, verified: true, name: r.name, photo: r.photo };
  },

  async uploadImage(i, c) {
    const fileId = await storeImage(i.image, `Mijoz rasm yukladi: ${c.username ? '@' + c.username : c.telegram_id}`, null);
    return { file: fileId };
  },

  async checkPromo(i, c) {
    const price = toTiyin(i.price);
    if (!(price > 0)) throw fail('VALIDATION');
    const r = await checkPromo(str(i.code, 32, { required: true }), c.id, String(i.service), price);
    return { code: r.code, discount: toSom(r.discount), finalPrice: toSom(r.finalPrice) };
  },

  async createOrder(i, c) {
    const s = await getSettings();
    const service = i.service;
    if (!s.services_enabled[service]) throw fail(service in s.services_enabled ? 'SERVICE_DISABLED' : 'VALIDATION');
    const method = i.paymentMethod === 'cash' ? 'cash' : i.paymentMethod === 'installment' ? 'installment' : null;
    if (!method) throw fail('VALIDATION', { field: 'paymentMethod' });
    const key = idemKey(i.idempotencyKey);

    const recipient = (r) => {
      const u = r && r.self ? c.username : cleanUser(r && r.username);
      if (!u) throw fail(r && r.self ? 'SELF_USERNAME_MISSING' : 'RECIPIENT_REQUIRED');
      if (!USERNAME_RE.test(u)) throw fail('BAD_USERNAME');
      return u;
    };
    const itype = (allowed) => {
      if (method !== 'installment') return null;
      if (!allowed.includes(i.installmentType)) throw fail('INSTALLMENT_TYPE_REQUIRED');
      return i.installmentType;
    };

    let o;
    if (service === 'premium') {
      if (!PREMIUM_PLANS.includes(i.plan)) throw fail('VALIDATION', { field: 'plan' });
      o = { service, title: `Telegram Premium — ${PREMIUM_LABEL[i.plan]}`, details: { plan: i.plan }, recipient: recipient(i.recipient),
        installmentType: itype(['plan2', 'uzum']), price: method === 'cash' ? toTiyin(s.premium_prices[i.plan]) : null };
    } else if (service === 'stars') {
      const q = int(i.quantity, { min: 1, max: 1_000_000, name: 'quantity' });
      if (q < s.stars_min) throw fail('STARS_MIN', { min: s.stars_min });
      o = { service, title: `Telegram Stars — ${q} ta`, details: { quantity: q }, recipient: recipient(i.recipient),
        installmentType: itype(['plan2', 'uzum']), price: method === 'cash' ? starsPriceTiyin(q, s) : null };
    } else if (service === 'nft_gift') {
      if (method !== 'installment') throw fail('VALIDATION', { field: 'paymentMethod' });
      const name = str(i.giftName, 120), link = str(i.giftLink, 300), image = str(i.giftImage, 300);
      if (!name && !link && !image) throw fail('GIFT_IDENTIFICATION_REQUIRED');
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw fail('BAD_LINK');
      o = { service, title: name ? `NFT sovg'a — ${name}` : "NFT sovg'a (maxsus so'rov)", installmentType: itype(['plan1', 'plan2', 'uzum']), price: null,
        details: { name, link, image, collectionAddress: str(i.collectionAddress, 80), model: str(i.model, 80) || 'any', backdrop: str(i.backdrop, 80) || 'any' } };
    } else if (RENT[service]) {
      const item = await mk.seenRentItem(RENT[service], str(i.address, 100, { required: true }));
      const minDays = Math.max(1, Math.ceil(Number(item.min_duration) / 86400)), maxDays = Math.floor(Number(item.max_duration) / 86400);
      const days = int(i.days, { min: 1, max: 3650, name: 'days' });
      if (days < minDays || days > maxDays) throw fail('BAD_DURATION', { minDays, maxDays });
      const P = rentTotalTon(item.price_per_day, days);
      const price = rentPriceTiyin(P, s.rent_formula);
      o = { service, title: `${item.nft_name} — ${days} kun`, installmentType: null, cost: rentCostTiyin(P, s.rent_formula),
        price: method === 'cash' ? price : null,
        details: { address: item.nft_address, name: item.nft_name, days, pricePerDayNano: String(item.price_per_day), marketappTotalTon: P,
          attributes: item.attributes, formula: s.rent_formula, ...(method === 'installment' ? { quotedPrice: price } : {}) } };
    } else throw fail('VALIDATION', { field: 'service' });

    const r = await createOrder({ ...o, customerId: c.id, paymentMethod: method, idempotencyKey: key,
      promoCode: method === 'cash' && i.promoCode ? String(i.promoCode).trim().slice(0, 32) : null });
    if (!r.duplicate) await notifyNewOrder(r.id);
    return { publicId: r.publicId, duplicate: r.duplicate, paymentMethod: method };
  },

  /** Xaridlarim: navbat raqami va ichki hisob ko'rsatilmaydi. */
  async myOrders(_i, c) {
    const rows = await all(`SELECT o.*, a.id AS agreement_id, a.start_date, a.monthly_payment, a.final_date, a.status AS agreement_status, rv.status AS review_status
        FROM orders o LEFT JOIN agreements a ON a.order_id = o.id LEFT JOIN reviews rv ON rv.order_id = o.id
        WHERE o.customer_id = :c AND o.status NOT IN ('pending','failed') ORDER BY o.created_at DESC LIMIT 200`, { c: c.id });
    const legacy = await all(`SELECT id, product_name, start_date, monthly_payment, final_date, status FROM agreements
        WHERE customer_id = :c AND order_id IS NULL ORDER BY start_date DESC`, { c: c.id });
    const DAY = 86_400_000;
    return {
      orders: rows.map((r) => {
        const det = JSON.parse(r.details || '{}');
        const rent = RENT[r.service] && r.status === 'completed' && r.closed_at ? Number(r.closed_at) + Number(det.days || 0) * DAY : null;
        return {
          publicId: r.public_id, service: r.service, title: r.title, paymentMethod: r.payment_method, status: r.status,
          price: r.payment_method === 'cash' ? toSom(r.price) : null, recipient: r.recipient, createdAt: Number(r.created_at), rentEndsAt: rent,
          canReview: r.status === 'completed' && !r.review_status, reviewStatus: r.review_status || null,
          installment: r.agreement_id ? { id: r.agreement_id, purchasedAt: r.start_date, monthlyPayment: toSom(r.monthly_payment), finalDate: r.final_date, active: r.agreement_status === 'active' } : null,
        };
      }),
      agreements: legacy.map((a) => ({ id: a.id, title: a.product_name, purchasedAt: a.start_date, monthlyPayment: toSom(a.monthly_payment), finalDate: a.final_date, active: a.status === 'active' })),
    };
  },

  async track(i) {
    const id = String(i.publicId || '').trim().toUpperCase();
    if (!/^NG-[A-Z0-9]{6}$/.test(id)) throw fail('ORDER_NOT_FOUND');
    const o = await get(`SELECT public_id, title, status, created_at FROM orders WHERE public_id = :p AND status NOT IN ('pending','failed')`, { p: id });
    if (!o) throw fail('ORDER_NOT_FOUND');
    return { publicId: o.public_id, title: o.title, status: o.status, createdAt: Number(o.created_at) };
  },

  async balance(_i, c) {
    const s = await getSettings();
    const ledger = await all('SELECT amount, kind, note, created_at FROM ledger WHERE customer_id = :c ORDER BY id DESC LIMIT 100', { c: c.id });
    const receipts = await all('SELECT id, amount, status, created_at FROM receipts WHERE customer_id = :c ORDER BY id DESC LIMIT 20', { c: c.id });
    return {
      balance: toSom(c.balance),
      ledger: ledger.map((l) => ({ amount: toSom(l.amount), kind: l.kind, note: l.note, createdAt: Number(l.created_at) })),
      receipts: receipts.map((r) => ({ id: r.id, amount: toSom(r.amount), status: r.status, createdAt: Number(r.created_at) })),
      adminContact: s.admin_contact,
    };
  },



  async payInstallment(i, c) {
    const r = await payInstallment(int(i.id, { min: 1 }), c.id, idemKey(i.idempotencyKey));
    return { amount: toSom(r.amount) };
  },

  async leaveReview(i, c) {
    const rating = int(i.rating, { min: 1, max: 5, name: 'rating' });
    const text = str(i.text, 1000, { required: true, name: 'text' });
    if (text.length < 2) throw fail('VALIDATION', { field: 'text' });
    await leaveReview(c.id, String(i.publicId || ''), rating, text);
    return { ok: true };
  },

  async reviews() {
    const rows = await all(`SELECT r.rating, r.text, r.created_at, c.first_name FROM reviews r JOIN customers c ON c.id = r.customer_id
        WHERE r.status = 'published' ORDER BY r.id DESC LIMIT 30`);
    return rows.map((r) => ({ rating: r.rating, text: r.text, createdAt: Number(r.created_at), name: r.first_name ? String(r.first_name).slice(0, 1).toUpperCase() + '***' : '***' }));
  },
};

export { summarize };
