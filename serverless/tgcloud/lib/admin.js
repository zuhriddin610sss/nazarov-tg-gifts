// Admin panel amallari (endpoints/admin.js orqali; faqat ADMIN_IDS dagi akkauntlar).
import { api, InputFile } from 'sdk';
import { all, get, run, fail, audit, getSettings, saveSettings, setSecret, getSecret, toSom, toTiyin, int, str, num, DATE_RE, KEY_RE, DEFAULT_SETTINGS, BUILD } from 'lib/core';
import { queueList, closeOrder, approveReceipt, rejectReceipt, adminAdjust, listAgreements, saveAgreement, addManualPayment, savePromo, agreementReport, ownRentIncome } from 'lib/shop';
import { notifyOrderClosed, notifyReceiptReviewed } from 'lib/notify';
import { maybeRunJobs, sendWeeklyReport } from 'lib/jobs';
import { ownSaleQuote, refreshOneStale, monthlyPayment, markupFor, priceSource, ownRentPpd, ownRentFormula, RENT_BASES } from 'lib/calc';
import { rentTotalTon, rentPriceTiyin } from 'lib/pricing';
import { satDebug, satelliteConfigured, satBudget } from 'lib/satellite';
import { splitGiftName } from 'lib/calc';
import { send } from 'lib/notify';
import { money, t } from 'lib/texts';
import { encode, decode } from 'lib/b64';

const SERVICES = ['nft_gift', 'gift_rent', 'username_rent', 'number_rent', 'premium', 'stars'];
const TOGGLES = [...SERVICES, 'cashout'];
const som = (x) => toSom(x);
const dateTime = (v, name) => { if (v == null || v === '') return null; if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(v))) throw fail('VALIDATION', { field: name }); return String(v); };
const date = (v, name) => { if (v == null || v === '') return null; if (!DATE_RE.test(String(v))) throw fail('VALIDATION', { field: name }); return String(v); };
const key = (v) => { if (!KEY_RE.test(String(v || ''))) throw fail('VALIDATION', { field: 'idempotencyKey' }); return String(v); };

function orderOut(o) {
  return { ...o, details: JSON.parse(o.details || '{}'), price: som(o.price), cost: som(o.cost), discount: som(o.discount),
    paid_amount: som(o.paid_amount), refunded: som(o.refunded), created_at: Number(o.created_at), closed_at: o.closed_at ? Number(o.closed_at) : null };
}
function agreementOut(a) {
  const s = a.summary;
  return { ...a, total_price: som(a.total_price), down_payment: som(a.down_payment), monthly_payment: som(a.monthly_payment), paid_sum: som(a.paid_sum),
    bought_price: som(a.bought_price), cash_price: som(a.cash_price), monthly_profit: som(a.monthly_profit),
    summary: { ...s, total: som(s.total), paid: som(s.paid), remaining: som(s.remaining), overdueAmount: som(s.overdueAmount) } };
}

export const actions = {
  // ---------- Test ma'lumotlarini o'chirish (bittalab) ----------
  /** Qo'lda kiritilgan to'lovni o'chirish (balansdan to'langani o'chirilmaydi — u mijoz balansiga bog'langan). */
  async deleteInstPayment(i, admin) {
    const p = await get('SELECT * FROM inst_payments WHERE id = :id', { id: int(i.id, { min: 1 }) });
    if (!p) throw fail('NOT_FOUND');
    if (p.source !== 'manual') throw fail('VALIDATION', { field: 'source' });
    await run('DELETE FROM inst_payments WHERE id = :id', { id: p.id });
    await run("UPDATE agreements SET status = 'active' WHERE id = :a", { a: p.agreement_id });
    await audit(admin, 'installment.payment.delete', String(p.agreement_id), { amount: p.amount });
    return { ok: true };
  },
  /** Shartnomani (va uning qo'lda kiritilgan to'lovlarini) o'chirish. */
  async deleteAgreement(i, admin) {
    const id = int(i.id, { min: 1 });
    const bal = await get("SELECT COUNT(*) AS n FROM inst_payments WHERE agreement_id = :id AND source = 'balance'", { id });
    if (Number(bal.n)) throw fail('VALIDATION', { field: 'balance_payments' });
    await run('DELETE FROM inst_payments WHERE agreement_id = :id', { id });
    const r = await run('DELETE FROM agreements WHERE id = :id', { id });
    if (r.rowsAffected !== 1) throw fail('NOT_FOUND');
    await audit(admin, 'installment.delete', String(id));
    return { ok: true };
  },
  /** Buyurtmani o'chirish: faqat balansdan pul yechilmagan bo'lsa (bo'lib to'lash arizasi yoki bekor qilingan, pul qaytarilgan). */
  async deleteOrder(i, admin) {
    const o = await get('SELECT * FROM orders WHERE id = :id', { id: int(i.id, { min: 1 }) });
    if (!o) throw fail('ORDER_NOT_FOUND');
    const kept = Number(o.paid_amount || 0) - Number(o.refunded || 0);
    if (kept > 0) throw fail('VALIDATION', { field: 'paid' });
    if (await get('SELECT id FROM agreements WHERE order_id = :id', { id: o.id })) throw fail('VALIDATION', { field: 'agreement' });
    await run('DELETE FROM orders WHERE id = :id', { id: o.id });
    await audit(admin, 'order.delete', o.public_id);
    return { ok: true };
  },

  /** Bosh sahifadagi pul hisoblagichlarini nolga tushirish (test pullari). Ma'lumot o'chirilmaydi: shu paytdan keyingilar hisoblanadi. */
  async resetStats(_i, admin) {
    const m = await get('SELECT COALESCE(MAX(id), 0) AS p, (SELECT COALESCE(MAX(id), 0) FROM agreements) AS a FROM inst_payments');
    await run("INSERT INTO meta (key, value) VALUES ('stats_reset', :v) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      { v: JSON.stringify({ at: Date.now(), payId: Number(m.p), agId: Number(m.a) }) });
    await audit(admin, 'stats.reset', '');
    return { ok: true };
  },

  async stats() {
    const rs = await get("SELECT value FROM meta WHERE key = 'stats_reset'");
    const B = rs ? JSON.parse(rs.value) : { at: 0, payId: 0, agId: 0 };
    const o = await get(`SELECT
        SUM(CASE WHEN created_at >= :today THEN 1 ELSE 0 END) AS today,
        COUNT(*) AS total,
        SUM(status = 'completed') AS completed, SUM(status = 'cancelled') AS cancelled, SUM(status = 'queued') AS queued,
        COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= :b THEN paid_amount END), 0) AS cash_revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= :b AND payment_method = 'cash' AND cost IS NOT NULL THEN price - cost END), 0) AS rent_profit,
        SUM(service IN ('gift_rent','username_rent','number_rent')) AS rent_orders,
        COALESCE(SUM(CASE WHEN status = 'completed' AND created_at >= :b AND service IN ('gift_rent','username_rent','number_rent') THEN paid_amount END), 0) AS rent_revenue
      FROM orders WHERE status NOT IN ('pending','failed')`, { today: startOfTashkentDay(), b: Number(B.at) || 0 });
    const c = await get('SELECT COUNT(*) AS customers, COALESCE(SUM(balance), 0) AS liabilities FROM customers');
    const p = await get(`SELECT COALESCE(SUM(amount), 0) AS collected, COALESCE(SUM(CASE WHEN paid_at >= :m THEN amount END), 0) AS this_month,
        (SELECT COALESCE(SUM(down_payment), 0) FROM agreements WHERE id > :ag) AS down FROM inst_payments WHERE id > :pi`,
      { m: startOfTashkentMonth(), pi: Number(B.payId) || 0, ag: Number(B.agId) || 0 });
    const ag = await listAgreements({ status: 'active' });
    const pend = await get(`SELECT (SELECT COUNT(*) FROM receipts WHERE status = 'pending' AND file_id <> '') AS receipts, (SELECT COUNT(*) FROM reviews WHERE status = 'pending') AS reviews`);
    const n = (x) => Number(x || 0);
    return {
      orders: { today: n(o.today), total: n(o.total), completed: n(o.completed), cancelled: n(o.cancelled), queued: n(o.queued), rentOrders: n(o.rent_orders) },
      revenue: som(n(o.cash_revenue) + n(p.collected) + n(p.down)), rentProfit: som(o.rent_profit), rentRevenue: som(o.rent_revenue),
      customers: n(c.customers), liabilities: som(c.liabilities),
      installments: { collected: som(p.collected), thisMonth: som(p.this_month), outstandingDebt: som(ag.reduce((s, a) => s + a.summary.remaining, 0)),
        overdue: ag.filter((a) => a.summary.overdue).length, active: ag.length },
      pendingReceipts: n(pend.receipts), pendingReviews: n(pend.reviews),
      build: BUILD,
    };
  },

  async queue() { return (await queueList()).map((r) => ({ ...orderOut(r), position: Number(r.position) })); },

  async closeOrder(i, admin) {
    const status = i.status === 'completed' ? 'completed' : i.status === 'cancelled' ? 'cancelled' : null;
    if (!status) throw fail('VALIDATION');
    const r = await closeOrder(int(i.id, { min: 1 }), status, admin, str(i.note, 500));
    await notifyOrderClosed(Number(i.id), status, r.refunded);
    return { ...r, refunded: som(r.refunded) };
  },

  async orders(i) {
    const rows = await all(`SELECT o.*, q.position FROM orders o
        LEFT JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY queued_at, id) AS position FROM orders WHERE status = 'queued') q ON q.id = o.id
        WHERE o.status NOT IN ('pending','failed')
          AND (:q IS NULL OR o.public_id LIKE '%' || :q || '%' OR o.customer_username LIKE '%' || :q || '%' OR o.customer_phone LIKE '%' || :q || '%' OR o.title LIKE '%' || :q || '%')
          AND (:svc IS NULL OR o.service = :svc) AND (:pm IS NULL OR o.payment_method = :pm) AND (:st IS NULL OR o.status = :st)
          AND (:from IS NULL OR o.created_at >= :from) AND (:to IS NULL OR o.created_at < :to)
        ORDER BY o.id DESC LIMIT 300`,
      { q: str(i.search, 100), svc: SERVICES.includes(i.service) ? i.service : null, pm: ['cash', 'installment'].includes(i.method) ? i.method : null,
        st: ['queued', 'completed', 'cancelled'].includes(i.status) ? i.status : null,
        from: date(i.from, 'from') ? Date.parse(i.from + 'T00:00:00+05:00') : null, to: date(i.to, 'to') ? Date.parse(i.to + 'T00:00:00+05:00') + 86400000 : null });
    return rows.map((r) => ({ ...orderOut(r), position: r.position ? Number(r.position) : null }));
  },

  async order(i) {
    const id = int(i.id, { min: 1 });
    const o = await get('SELECT o.*, c.telegram_id, c.balance FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = :id', { id });
    if (!o) throw fail('ORDER_NOT_FOUND');
    const q = await get(`SELECT position FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY queued_at, id) AS position FROM orders WHERE status = 'queued') WHERE id = :id`, { id });
    const ag = await get('SELECT id FROM agreements WHERE order_id = :id', { id });
    return { ...orderOut(o), balance: som(o.balance), position: q ? Number(q.position) : null, agreementId: ag ? ag.id : null };
  },

  /** Chek yoki gift rasmi: Telegram'dan olib, ma'lumot sifatida qaytaradi. */
  async file(i) {
    const fileId = str(i.fileId, 300, { required: true });
    const bytes = await api.getFileContent(fileId);
    return { dataUrl: 'data:image/jpeg;base64,' + encode(bytes) };
  },

  async receipts(i) {
    const st = ['pending', 'approved', 'rejected'].includes(i.status) ? i.status : null;
    const rows = await all(`SELECT r.*, c.username, c.phone FROM receipts r JOIN customers c ON c.id = r.customer_id
        WHERE r.file_id <> '' AND (:st IS NULL OR r.status = :st) ORDER BY r.id DESC LIMIT 200`, { st });
    return rows.map((r) => ({ ...r, amount: som(r.amount), created_at: Number(r.created_at) }));
  },
  async approveReceipt(i, admin) {
    const id = int(i.id, { min: 1 });
    const amount = i.amount != null && i.amount !== '' ? toTiyin(num(i.amount, { min: 1 })) : undefined;
    const r = await approveReceipt(id, admin, amount);
    await notifyReceiptReviewed(id, true);
    return { amount: som(r.amount) };
  },
  async rejectReceipt(i, admin) {
    const id = int(i.id, { min: 1 });
    await rejectReceipt(id, admin, str(i.note, 500));
    await notifyReceiptReviewed(id, false);
    return { ok: true };
  },

  async customers(i) {
    const q = str(i.search, 100);
    const rows = await all(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('pending','failed')) AS orders
        FROM customers c WHERE (:q IS NULL OR c.username LIKE '%' || :q || '%' OR c.phone LIKE '%' || :q || '%' OR c.first_name LIKE '%' || :q || '%' OR CAST(c.telegram_id AS TEXT) = :q)
        ORDER BY c.id DESC LIMIT 200`, { q });
    return rows.map((c) => ({ ...c, balance: som(c.balance), created_at: Number(c.created_at) }));
  },
  async customer(i) {
    const id = int(i.id, { min: 1 });
    const c = await get('SELECT * FROM customers WHERE id = :id', { id });
    if (!c) throw fail('CUSTOMER_NOT_FOUND');
    const orders = await all(`SELECT * FROM orders WHERE customer_id = :id AND status NOT IN ('pending','failed') ORDER BY id DESC`, { id });
    const ledger = await all('SELECT * FROM ledger WHERE customer_id = :id ORDER BY id DESC LIMIT 200', { id });
    const agreements = await listAgreements({ customerId: id });
    return { customer: { ...c, balance: som(c.balance) }, orders: orders.map(orderOut),
      ledger: ledger.map((l) => ({ ...l, amount: som(l.amount), balance_after: som(l.balance_after), created_at: Number(l.created_at) })),
      agreements: agreements.map(agreementOut) };
  },
  async adjust(i, admin) {
    const amount = toTiyin(num(i.amount));
    if (!amount) throw fail('BAD_AMOUNT');
    const note = str(i.note, 300, { required: true, name: 'note' });
    const r = await adminAdjust(int(i.id, { min: 1 }), amount, key(i.idempotencyKey), admin, note);
    return { duplicate: r.duplicate };
  },

  async installments(i) {
    const rows = await listAgreements({ status: ['active', 'closed'].includes(i.status) ? i.status : null, search: str(i.search, 100) });
    return rows.map(agreementOut);
  },
  async saveInstallment(i, admin) {
    const a = {
      id: i.id ? int(i.id, { min: 1 }) : null, orderId: i.orderId ? int(i.orderId, { min: 1 }) : null, legacy: Boolean(i.legacy),
      clientName: str(i.clientName, 120), clientUsername: str(i.clientUsername, 64), clientPhone: str(i.clientPhone, 30),
      productName: str(i.productName, 200, { required: true, name: 'productName' }), installmentType: str(i.installmentType, 30),
      totalPrice: toTiyin(num(i.totalPrice, { min: 1, name: 'totalPrice' })), downPayment: toTiyin(num(i.downPayment || 0, { min: 0, name: 'downPayment' })),
      monthlyPayment: toTiyin(num(i.monthlyPayment, { min: 1, name: 'monthlyPayment' })),
      startDate: date(i.startDate, 'startDate'), finalDate: date(i.finalDate, 'finalDate'),
      collateral: str(i.collateral, 300), notes: str(i.notes, 2000),
      alreadyPaid: toTiyin(num(i.alreadyPaid || 0, { min: 0 })), status: ['active', 'closed'].includes(i.status) ? i.status : null,
      // Hisobot uchun (ixtiyoriy)
      boughtAt: dateTime(i.boughtAt, 'boughtAt'), boughtPrice: Number(i.boughtPrice) > 0 ? toTiyin(num(i.boughtPrice, { min: 0 })) : null,
      cashPrice: Number(i.cashPrice) > 0 ? toTiyin(num(i.cashPrice, { min: 0 })) : null,
      monthlyProfit: i.monthlyProfit !== '' && i.monthlyProfit != null && !Number.isNaN(Number(i.monthlyProfit)) ? toTiyin(num(i.monthlyProfit)) : null,
    };
    if (!a.startDate || !a.finalDate) throw fail('VALIDATION', { field: 'dates' });
    return { id: await saveAgreement(a, admin) };
  },
  /** To'liq jadval (lizing va bo'lib to'lash). */
  async installmentReport() { return agreementReport(); },
  async installmentPayments(i) {
    const rows = await all('SELECT * FROM inst_payments WHERE agreement_id = :id ORDER BY paid_at', { id: int(i.id, { min: 1 }) });
    return rows.map((p) => ({ ...p, amount: som(p.amount), paid_at: Number(p.paid_at) }));
  },
  async addInstallmentPayment(i, admin) {
    return addManualPayment(int(i.id, { min: 1 }), toTiyin(num(i.amount, { min: 0.01 })), key(i.idempotencyKey), admin, str(i.note, 300), date(i.paidAt, 'paidAt'));
  },

  async promos() {
    const rows = await all(`SELECT p.*, COALESCE((SELECT SUM(discount) FROM promo_red r WHERE r.promo_id = p.id), 0) AS total_discount FROM promo p ORDER BY p.id DESC`);
    return rows.map((p) => ({ ...p, value: p.kind === 'percent' ? Number(p.value) / 100 : som(p.value), total_discount: som(p.total_discount),
      services: p.services ? JSON.parse(p.services) : null, active: Boolean(p.active), expires_at: p.expires_at ? Number(p.expires_at) : null }));
  },
  async savePromo(i, admin) {
    const kind = i.kind === 'fixed' ? 'fixed' : 'percent';
    const value = kind === 'percent' ? Math.round(num(i.value, { min: 0.01, max: 100 }) * 100) : toTiyin(num(i.value, { min: 1 }));
    const services = Array.isArray(i.services) ? i.services.filter((s) => SERVICES.includes(s)) : null;
    const exp = date(i.expiresAt, 'expiresAt');
    await savePromo({ id: i.id ? int(i.id, { min: 1 }) : null, code: i.code, kind, value, services,
      expiresAt: exp ? Date.parse(exp + 'T23:59:59+05:00') : null, maxUses: i.maxUses ? int(i.maxUses, { min: 1 }) : null, active: i.active !== false }, admin);
    return { ok: true };
  },

  async reviews(i) {
    const st = ['pending', 'published', 'rejected'].includes(i.status) ? i.status : null;
    const rows = await all(`SELECT r.*, o.public_id, o.title, c.username FROM reviews r JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = r.customer_id
        WHERE (:st IS NULL OR r.status = :st) ORDER BY r.id DESC LIMIT 200`, { st });
    return rows.map((r) => ({ ...r, created_at: Number(r.created_at) }));
  },
  async reviewAction(i, admin) {
    const st = i.decision === 'publish' ? 'published' : i.decision === 'reject' ? 'rejected' : null;
    if (!st) throw fail('VALIDATION');
    const r = await run('UPDATE reviews SET status = :s, reviewed_at = :t WHERE id = :id', { s: st, t: Date.now(), id: int(i.id, { min: 1 }) });
    if (r.rowsAffected !== 1) throw fail('NOT_FOUND');
    await audit(admin, 'review.' + i.decision, String(i.id));
    return { ok: true };
  },

  async settings() {
    const s = await getSettings();
    return { ...s, marketappTokenSet: Boolean(await getSecret('marketapp_token')), portalsKeySet: Boolean(await getSecret('portals_key')), satelliteKeySet: Boolean(await getSecret('satellite_key')) };
  },
  async saveSettings(i, admin) {
    const n = (v, name, min = 0) => num(v, { min, name });
    const L = (o) => Object.fromEntries(['uz', 'ru', 'en', 'zh'].map((l) => [l, String((o && o[l]) ?? '').slice(0, 1000)]));
    const s = {
      card_number: String(i.card_number ?? '').trim().slice(0, 40), card_holder: String(i.card_holder ?? '').trim().slice(0, 80),
      payment_warning: L(i.payment_warning), admin_contact: String(i.admin_contact ?? '').trim().replace(/^@/, '').slice(0, 64),
      stars_price: n(i.stars_price, 'stars_price', 0.01), stars_min: int(i.stars_min, { min: 1, name: 'stars_min' }),
      premium_prices: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.premium_prices).map((k) => [k, n(i.premium_prices && i.premium_prices[k], 'premium_' + k, 0.01)])),
      rent_formula: { add: n(i.rent_formula && i.rent_formula.add, 'add'), mult: n(i.rent_formula && i.rent_formula.mult, 'mult', 0.0001), rate: n(i.rent_formula && i.rent_formula.rate, 'rate', 0.0001) },
      services_enabled: Object.fromEntries(TOGGLES.map((k) => [k, Boolean(i.services_enabled && i.services_enabled[k])])),
      inst_markup_year: n(i.inst_markup_year ?? DEFAULT_SETTINGS.inst_markup_year, 'inst_markup_year'),
      lease_markup_year: n(i.lease_markup_year ?? DEFAULT_SETTINGS.lease_markup_year, 'lease_markup_year'),
      cashout_pct: n(i.cashout_pct ?? DEFAULT_SETTINGS.cashout_pct, 'cashout_pct'),
      about_since: /^\d{4}-\d{2}$/.test(String(i.about_since || '')) ? String(i.about_since) : DEFAULT_SETTINGS.about_since,
      about_channel: String(i.about_channel ?? DEFAULT_SETTINGS.about_channel).trim().replace(/^(https?:\/\/)?t\.me\//, '').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 64),
      about_orders_extra: Math.max(0, Math.round(Number(i.about_orders_extra) || 0)),
      about_customers_extra: Math.max(0, Math.round(Number(i.about_customers_extra) || 0)),
      cashout_max: n(i.cashout_max ?? DEFAULT_SETTINGS.cashout_max, 'cashout_max', 10000),
      down_formula: { days: n(i.down_formula && i.down_formula.days, 'df_days', 1), add: n(i.down_formula && i.down_formula.add, 'df_add'),
        rate: n(i.down_formula && i.down_formula.rate, 'df_rate', 0.0001), mult: n(i.down_formula && i.down_formula.mult, 'df_mult', 0.0001) },
      sale_rate: n(i.sale_rate ?? DEFAULT_SETTINGS.sale_rate, 'sale_rate', 0.0001),
      own_add: n(i.own_add ?? DEFAULT_SETTINGS.own_add, 'own_add'),
      own_rent_mult: n(i.own_rent_mult ?? DEFAULT_SETTINGS.own_rent_mult, 'own_rent_mult', 0.0001),
      sale_down_by: ['exact', 'model_backdrop', 'model', 'backdrop'].includes(i.sale_down_by) ? i.sale_down_by : 'exact',
      sale_inst: { enabled: Boolean(i.sale_inst && i.sale_inst.enabled), max: n(i.sale_inst && i.sale_inst.max != null ? i.sale_inst.max : DEFAULT_SETTINGS.sale_inst.max, 'si_max', 1) },
      portals_sale: { add: n(i.portals_sale && i.portals_sale.add != null ? i.portals_sale.add : DEFAULT_SETTINGS.portals_sale.add, 'ps_add'),
        rate: n(i.portals_sale && i.portals_sale.rate != null ? i.portals_sale.rate : DEFAULT_SETTINGS.portals_sale.rate, 'ps_rate', 0.0001) },
      satellite_base: /^https:\/\/[^\s]+$/.test(String(i.satellite_base || '')) ? String(i.satellite_base).trim().slice(0, 200) : DEFAULT_SETTINGS.satellite_base,
      portals_base: /^https:\/\/[^\s]+$/.test(String(i.portals_base || '')) ? String(i.portals_base).trim().slice(0, 200) : DEFAULT_SETTINGS.portals_base,
    };
    const before = await getSettings();
    await saveSettings(s);
    if (typeof i.satelliteKey === 'string' && i.satelliteKey.trim()) {
      await setSecret('satellite_key', i.satelliteKey.trim().replace(/^token\s+/i, '').slice(0, 500));
      await audit(admin, 'settings.satellite_key', null, { set: true });
    }
    if (typeof i.portalsKey === 'string' && i.portalsKey.trim()) {
      await setSecret('portals_key', i.portalsKey.trim().replace(/^bearer\s+/i, '').slice(0, 500));
      await audit(admin, 'settings.portals_key', null, { set: true });
    }
    if (typeof i.marketappToken === 'string' && i.marketappToken.trim()) {
      await setSecret('marketapp_token', i.marketappToken.trim().slice(0, 500));
      await audit(admin, 'settings.marketapp_token', null, { set: true });
    }
    await audit(admin, 'settings.update', null, { before, after: s });
    return { ok: true };
  },

  async logs() {
    const a = await all('SELECT * FROM audit ORDER BY id DESC LIMIT 300');
    const e = await all('SELECT * FROM errors ORDER BY id DESC LIMIT 300');
    return { audit: a.map((x) => ({ ...x, created_at: Number(x.created_at) })), errors: e.map((x) => ({ ...x, created_at: Number(x.created_at) })) };
  },

  /** Buyurtmadagi boshlang'ich to'lovni qo'lda o'zgartirish; mijozga xabar boradi. */
  async setOrderDown(i, admin) {
    const id = int(i.id, { min: 1 });
    const amount = Math.round(num(i.amount, { min: 0, name: 'amount' }));
    const o = await get('SELECT o.*, c.telegram_id, c.lang FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = :id', { id });
    if (!o) throw fail('ORDER_NOT_FOUND');
    if (o.payment_method !== 'installment') throw fail('VALIDATION', { field: 'payment_method' });
    const det = JSON.parse(o.details || '{}');
    det.downPayment = amount;
    if (det.estPrice && det.months && amount < det.estPrice) det.estMonthly = monthlyPayment(det.estPrice, amount, det.months, markupFor(await getSettings(), o.installment_type)).monthly;
    await run('UPDATE orders SET details = :d WHERE id = :id', { d: JSON.stringify(det), id });
    await audit(admin, 'order.down', o.public_id, { amount });
    const txt = { uz: `Buyurtma ${o.public_id}: boshlang'ich to'lov ${money(amount)} so'm`, ru: `Заказ ${o.public_id}: первоначальный взнос ${money(amount)} сум`,
      en: `Order ${o.public_id}: down payment ${money(amount)} UZS`, zh: `订单 ${o.public_id}：首付 ${money(amount)} 苏姆` };
    await send(o.telegram_id, (txt[o.lang] || txt.uz) + (det.estMonthly ? (o.lang === 'ru' ? `, ежемесячно ≈ ${money(det.estMonthly)} сум` : o.lang === 'en' ? `, monthly ≈ ${money(det.estMonthly)} UZS` : o.lang === 'zh' ? `，月供约 ${money(det.estMonthly)} 苏姆` : `, oyiga ≈ ${money(det.estMonthly)} so'm`) : ''));
    return { ok: true, estMonthly: det.estMonthly || null };
  },

  // ---------- O'z mahsulotlari ("Reklama") ----------
  /** Bitta mahsulot narxini hozir bozorlardan qayta olish (30 daqiqa kutmasdan). */
  async refreshOwnPrice(i) {
    const p = await get('SELECT * FROM own_products WHERE id = :id', { id: int(i.id, { min: 1 }) });
    if (!p) throw fail('NOT_FOUND');
    const before = p.mk_price_ton;
    satBudget(9000);
    let q;
    try { q = await ownSaleQuote({ ...p, kind: p.kind, collection_address: p.collection_address }, await getSettings(), { fresh: true, noRent: true }); } finally { satBudget(0); }
    const after = await get('SELECT mk_checked_at FROM own_products WHERE id = :id', { id: p.id });
    // Tekshiruv: har bir bozor nima qaytardi (faqat "Narxni yangilash" bittalab bosilganda)
    const debug = i.debug && p.kind === 'gifts' && (p.model || p.backdrop) && (await satelliteConfigured())
      ? await satDebug({ collection: splitGiftName(p.name).collection, model: p.model, backdrop: p.backdrop }) : null;
    return { price: q.price, by: q.by, src: q.src, marketPriceTon: q.marketPriceTon, kept: !after || Number(after.mk_checked_at) <= 1, before, debug, build: BUILD };
  },

  async ownProducts() {
    const rows = await all('SELECT * FROM own_products ORDER BY position, id DESC');
    const s = await getSettings();
    const rentInc = await ownRentIncome();
    const out = [];
    await refreshOneStale(rows, s);
    for (const p of rows) {
      const q = p.inst_enabled ? await ownSaleQuote(p, s, { cached: true }) : { price: null, down1: null, marketPriceTon: null };
      // Avtomatik ijara: eng uzoq muddatda kuniga tushadigan narx (so'm)
      const ppd = p.rent_enabled ? await ownRentPpd(p, { cached: true }) : null;
      const rentAuto = ppd ? { perDay: Math.ceil(rentPriceTiyin(rentTotalTon(ppd, p.rent_max), ownRentFormula(s)) / 100 / p.rent_max),
        day1: Math.ceil(rentPriceTiyin(rentTotalTon(ppd, 1), ownRentFormula(s)) / 100), ppdTon: Number(ppd) / 1e9 } : null;
      out.push({ ...p, rent_price: som(p.rent_price), cash_price: som(p.cash_price), price_manual: som(p.price_manual), down_manual: som(p.down_manual),
        rent_enabled: Boolean(p.rent_enabled), inst_enabled: Boolean(p.inst_enabled), cash_enabled: Boolean(p.cash_enabled), visible: Boolean(p.visible),
        quote: q, rentAuto, bought_price: som(p.bought_price), earned: som(rentInc[p.id] || 0) });
    }
    return out;
  },
  async saveOwnProduct(i, admin) {
    const kind = ['gifts', 'usernames', 'numbers'].includes(i.kind) ? i.kind : null;
    if (!kind) throw fail('VALIDATION', { field: 'kind' });
    const rentOn = Boolean(i.rent_enabled), cashOn = Boolean(i.cash_enabled);
    // Foiz yozilgan bo'lsa olib tashlanadi: "Crime Scene 2.6%" -> "Crime Scene"
    const attr = (v) => { const x = str(v, 80); return x ? x.replace(/\s*\(?[\d.,]+\s*%\)?\s*$/, '').trim() || null : null; };
    // Gift havolasi (t.me/nft/TrappedHeart-19604) rasm manziliga aylantiriladi
    let image = str(i.image, 500);
    const nft = image && /^(?:https?:\/\/)?t\.me\/nft\/([A-Za-z0-9]+)-(\d+)\/?$/i.exec(image);
    if (nft) image = `https://nft.fragment.com/gift/${nft[1].toLowerCase()}-${nft[2]}.webp`;
    const p = {
      kind, name: str(i.name, 120, { required: true, name: 'name' }), image,
      model: attr(i.model), backdrop: attr(i.backdrop), symbol: attr(i.symbol),
      rent_enabled: rentOn ? 1 : 0,
      rent_by: RENT_BASES.includes(i.rent_by) ? i.rent_by : 'manual',
      // Avtomatik usulda kunlik narx ixtiyoriy (Marketapp'da topilmasa ishlatiladi)
      rent_price: rentOn && (!RENT_BASES.includes(i.rent_by) || Number(i.rent_price) > 0) ? toTiyin(num(i.rent_price, { min: 1, name: 'rent_price' })) : null,
      rent_min: rentOn ? int(i.rent_min, { min: 1, max: 3650, name: 'rent_min' }) : null,
      rent_max: rentOn ? int(i.rent_max, { min: 1, max: 3650, name: 'rent_max' }) : null,
      inst_enabled: i.inst_enabled ? 1 : 0, cash_enabled: cashOn ? 1 : 0,
      cash_price: cashOn ? toTiyin(num(i.cash_price, { min: 1, name: 'cash_price' })) : null,
      visible: i.visible === false ? 0 : 1, position: i.position ? int(i.position, { min: -1000, max: 1000 }) : 0,
      price_source: priceSource(i.price_source),
      // Qo'lda narx: "qo'lda" usul tanlanganda asosiy narx, bozor usulida esa bozorda topilmasa ishlatiladi
      price_ton: i.price_source === 'manual_ton' ? num(i.price_ton, { min: 0.01, name: 'price_ton' }) : Number(i.price_ton) > 0 ? num(i.price_ton, { min: 0.01, name: 'price_ton' }) : null,
      price_manual: Number(i.price_manual) > 0 ? toTiyin(num(i.price_manual, { min: 1, name: 'price_manual' })) : null,
      // Boshlang'ich to'lov har doim avval formula bilan; bu summa faqat formula topilmasa ishlatiladi
      down_mode: ['exact', 'model_backdrop', 'model', 'backdrop'].includes(i.down_by) ? i.down_by : 'exact',
      down_manual: Number(i.down_manual) > 0 ? toTiyin(num(i.down_manual, { min: 1, name: 'down_manual' })) : null,
      bought_at: dateTime(i.bought_at, 'bought_at'), bought_price: Number(i.bought_price) > 0 ? toTiyin(num(i.bought_price, { min: 0 })) : null,
    };
    if (p.image && !/^https:\/\/\S+$/i.test(p.image)) throw fail('VALIDATION', { field: 'image' });
    if (rentOn && p.rent_max < p.rent_min) throw fail('VALIDATION', { field: 'rent_max' });
    if (!rentOn && !p.inst_enabled && !cashOn) throw fail('VALIDATION', { field: 'modes' });
    const id = i.id ? int(i.id, { min: 1 }) : null;
    if (id) {
      const r = await run(`UPDATE own_products SET kind=:kind, name=:name, image=:image, model=:model, backdrop=:backdrop, symbol=:symbol,
          rent_enabled=:rent_enabled, rent_price=:rent_price, rent_min=:rent_min, rent_max=:rent_max, inst_enabled=:inst_enabled,
          cash_enabled=:cash_enabled, cash_price=:cash_price, visible=:visible, position=:position,
          price_source=:price_source, price_ton=:price_ton, price_manual=:price_manual, down_mode=:down_mode, down_manual=:down_manual,
          rent_by=:rent_by, bought_at=:bought_at, bought_price=:bought_price, rent_checked_at=NULL, collection_address=NULL, mk_checked_at=NULL WHERE id = :id`, { ...p, id });
      if (r.rowsAffected !== 1) throw fail('NOT_FOUND');
    } else {
      await run(`INSERT INTO own_products (kind, name, image, model, backdrop, symbol, rent_enabled, rent_price, rent_min, rent_max,
          inst_enabled, cash_enabled, cash_price, visible, position, created_at, price_source, price_ton, price_manual, down_mode, down_manual, rent_by, bought_at, bought_price)
          VALUES (:kind, :name, :image, :model, :backdrop, :symbol, :rent_enabled, :rent_price, :rent_min, :rent_max,
          :inst_enabled, :cash_enabled, :cash_price, :visible, :position, :now, :price_source, :price_ton, :price_manual, :down_mode, :down_manual, :rent_by, :bought_at, :bought_price)`, { ...p, now: Date.now() });
    }
    await audit(admin, 'own.save', id ? String(id) : p.name);
    return { ok: true };
  },
  async deleteOwnProduct(i, admin) {
    const id = int(i.id, { min: 1 });
    await run('DELETE FROM own_products WHERE id = :id', { id });
    await audit(admin, 'own.delete', String(id));
    return { ok: true };
  },

  // ---------- Excel ----------
  async exportData(i) {
    const from = date(i.from, 'from') ? Date.parse(i.from + 'T00:00:00+05:00') : 0;
    const to = date(i.to, 'to') ? Date.parse(i.to + 'T00:00:00+05:00') + 86400000 : 8.64e15;
    const orders = await all(`SELECT * FROM orders WHERE status NOT IN ('pending','failed') AND created_at >= :from AND created_at < :to ORDER BY id`, { from, to });
    const customers = await all(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('pending','failed')) AS orders_count
        FROM customers c ORDER BY c.id`);
    const agreements = await listAgreements({});
    return { orders: orders.map(orderOut), customers: customers.map((c) => ({ ...c, balance: som(c.balance), created_at: Number(c.created_at) })),
      agreements: agreements.map(agreementOut) };
  },
  /** Brauzerda tayyorlangan Excel faylni adminning Telegram chatiga hujjat qilib yuboradi. */
  async sendExport(i, admin) {
    const chatId = Number(String(admin).split(':')[1]);
    const bytes = decode(str(i.file, 15000000, { required: true, name: 'file' }));
    if (bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw fail('VALIDATION', { field: 'file' }); // xlsx = zip ("PK")
    const name = (String(i.name || 'hisobot.xlsx').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)).replace(/(\.xlsx)?$/, '.xlsx');
    await api.sendDocument({ chat_id: chatId, document: new InputFile(bytes, name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      caption: 'Excel hisobot' });
    await audit(admin, 'export.excel', name);
    return { ok: true };
  },

  // ---------- Mijozlar e'lonlari ("Giftimni sotaman") ----------
  async listings(i) {
    const st = ['pending', 'active', 'sold', 'hidden'].includes(i.status) ? i.status : null;
    const rows = await all(`SELECT l.*, c.username, c.phone, c.first_name FROM sell_listings l JOIN customers c ON c.id = l.customer_id
      WHERE (:st IS NULL OR l.status = :st) ORDER BY CASE l.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, l.id DESC LIMIT 300`, { st });
    return rows.map((l) => ({ ...l, price: som(l.price), created_at: Number(l.created_at) }));
  },
  async setListing(i, admin) {
    const id = int(i.id, { min: 1, name: 'id' });
    const l = await get('SELECT l.*, c.telegram_id, c.lang FROM sell_listings l JOIN customers c ON c.id = l.customer_id WHERE l.id = :id', { id });
    if (!l) throw fail('NOT_FOUND');
    if (i.delete) { await run('DELETE FROM sell_listings WHERE id = :id', { id }); await audit(admin, 'listing.delete', String(id)); return { ok: true }; }
    const status = ['active', 'hidden', 'pending', 'sold'].includes(i.status) ? i.status : null;
    const price = i.price != null && Number(i.price) > 0 ? toTiyin(num(i.price, { min: 1000, name: 'price' })) : Number(l.price);
    if (!status) throw fail('VALIDATION', { field: 'status' });
    await run('UPDATE sell_listings SET status = :st, price = :p, updated_at = :t WHERE id = :id', { st: status, p: price, t: Date.now(), id });
    if (status !== l.status && (status === 'active' || (status === 'hidden' && l.status === 'pending'))) {
      const ok = status === 'active';
      await send(l.telegram_id, t(l.lang, ok ? 'listing_ok' : 'listing_rejected', { name: l.name }));
    }
    await audit(admin, 'listing.' + status, String(id));
    return { ok: true };
  },

  async weeklyReport() { await sendWeeklyReport(Date.now(), true); return { ok: true }; },
  async runJobs() { return (await maybeRunJobs(true)) || { rent: 0, inst: 0 }; },
};

function startOfTashkentDay(now = Date.now()) {
  const d = new Date(now + 5 * 3600000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5 * 3600000;
}
function startOfTashkentMonth(now = Date.now()) {
  const d = new Date(now + 5 * 3600000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 5 * 3600000;
}
