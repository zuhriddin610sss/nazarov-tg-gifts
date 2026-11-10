// Admin panel amallari (endpoints/admin.js orqali; faqat ADMIN_IDS dagi akkauntlar).
import { api } from 'sdk';
import { all, get, run, fail, audit, getSettings, saveSettings, setSecret, getSecret, toSom, toTiyin, int, str, num, DATE_RE, KEY_RE, DEFAULT_SETTINGS } from 'lib/core';
import { queueList, closeOrder, approveReceipt, rejectReceipt, adminAdjust, listAgreements, saveAgreement, addManualPayment, savePromo } from 'lib/shop';
import { notifyOrderClosed, notifyReceiptReviewed } from 'lib/notify';
import { maybeRunJobs } from 'lib/jobs';
import { encode } from 'lib/b64';

const SERVICES = ['nft_gift', 'gift_rent', 'username_rent', 'number_rent', 'premium', 'stars'];
const som = (x) => toSom(x);
const date = (v, name) => { if (v == null || v === '') return null; if (!DATE_RE.test(String(v))) throw fail('VALIDATION', { field: name }); return String(v); };
const key = (v) => { if (!KEY_RE.test(String(v || ''))) throw fail('VALIDATION', { field: 'idempotencyKey' }); return String(v); };

function orderOut(o) {
  return { ...o, details: JSON.parse(o.details || '{}'), price: som(o.price), cost: som(o.cost), discount: som(o.discount),
    paid_amount: som(o.paid_amount), refunded: som(o.refunded), created_at: Number(o.created_at), closed_at: o.closed_at ? Number(o.closed_at) : null };
}
function agreementOut(a) {
  const s = a.summary;
  return { ...a, total_price: som(a.total_price), down_payment: som(a.down_payment), monthly_payment: som(a.monthly_payment), paid_sum: som(a.paid_sum),
    summary: { ...s, total: som(s.total), paid: som(s.paid), remaining: som(s.remaining), overdueAmount: som(s.overdueAmount) } };
}

export const actions = {
  async stats() {
    const o = await get(`SELECT
        SUM(CASE WHEN created_at >= :today THEN 1 ELSE 0 END) AS today,
        COUNT(*) AS total,
        SUM(status = 'completed') AS completed, SUM(status = 'cancelled') AS cancelled, SUM(status = 'queued') AS queued,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN paid_amount END), 0) AS cash_revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' AND cost IS NOT NULL THEN price - cost END), 0) AS rent_profit,
        SUM(service IN ('gift_rent','username_rent','number_rent')) AS rent_orders,
        COALESCE(SUM(CASE WHEN status = 'completed' AND service IN ('gift_rent','username_rent','number_rent') THEN paid_amount END), 0) AS rent_revenue
      FROM orders WHERE status NOT IN ('pending','failed')`, { today: startOfTashkentDay() });
    const c = await get('SELECT COUNT(*) AS customers, COALESCE(SUM(balance), 0) AS liabilities FROM customers');
    const p = await get(`SELECT COALESCE(SUM(amount), 0) AS collected, COALESCE(SUM(CASE WHEN paid_at >= :m THEN amount END), 0) AS this_month,
        (SELECT COALESCE(SUM(down_payment), 0) FROM agreements) AS down FROM inst_payments`, { m: startOfTashkentMonth() });
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
        from: date(i.from, 'from') ? Date.parse(i.from + 'T00:00:00+05:00') : null, to: date(i.to, 'to') ? Date.parse(i.to + 'T00:00:00+05:00') + 86_400_000 : null });
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

  /** Chek yoki sovg'a rasmi: Telegram'dan olib, ma'lumot sifatida qaytaradi. */
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
    };
    if (!a.startDate || !a.finalDate) throw fail('VALIDATION', { field: 'dates' });
    return { id: await saveAgreement(a, admin) };
  },
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
    return { ...s, marketappTokenSet: Boolean(await getSecret('marketapp_token')) };
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
      services_enabled: Object.fromEntries(SERVICES.map((k) => [k, Boolean(i.services_enabled && i.services_enabled[k])])),
    };
    const before = await getSettings();
    await saveSettings(s);
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

  async runJobs() { return (await maybeRunJobs(true)) || { rent: 0, inst: 0 }; },
};

function startOfTashkentDay(now = Date.now()) {
  const d = new Date(now + 5 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5 * 3_600_000;
}
function startOfTashkentMonth(now = Date.now()) {
  const d = new Date(now + 5 * 3_600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 5 * 3_600_000;
}
