// Biznes mantiq: balans, buyurtmalar, navbat, cheklar, bo'lib to'lash, promo-kodlar, sharhlar.
// Barcha pul miqdorlari tiyinda.
import { all, get, run, fail, dbCode, audit, newPublicId, nowMs } from 'lib/core';

// ---------- balans ----------
/**
 * Balans jurnaliga yozuv qo'shadi. Balans va bog'liq holat trigger orqali shu INSERT bilan birga o'zgaradi.
 * Bir xil `key` ikkinchi marta kelsa — dublikat deb qaytariladi, pul qayta o'zgarmaydi.
 */
export async function ledger({ customerId, amount, kind, key, refId = null, note = null, by = 'system' }) {
  if (!Number.isInteger(amount) || amount === 0) throw fail('BAD_AMOUNT');
  try {
    await run(`INSERT INTO ledger (customer_id, amount, kind, ref_id, idem_key, note, created_by)
               VALUES (:c, :a, :k, :r, :key, :n, :by)`, { c: customerId, a: amount, k: kind, r: refId, key, n: note, by });
    return { duplicate: false };
  } catch (e) {
    const code = dbCode(e);
    if (code === 'UNIQUE') {
      const ex = await get('SELECT customer_id, amount FROM ledger WHERE idem_key = :k', { k: key });
      if (ex && Number(ex.customer_id) === customerId && Number(ex.amount) === amount) return { duplicate: true };
      throw fail('IDEMPOTENCY_CONFLICT');
    }
    if (code === 'CHECK') throw fail('INSUFFICIENT_BALANCE');
    if (code) throw fail(code);
    throw e;
  }
}

// ---------- navbat va buyurtmalar ----------
const QUEUE_SQL = `SELECT id, ROW_NUMBER() OVER (ORDER BY queued_at, id) AS position FROM orders WHERE status = 'queued'`;

export async function queuePosition(orderId) {
  const r = await get(`SELECT position FROM (${QUEUE_SQL}) WHERE id = :id`, { id: orderId });
  return r ? Number(r.position) : 0;
}
export async function queueList() {
  return all(`SELECT q.position, o.* FROM (${QUEUE_SQL}) q JOIN orders o ON o.id = q.id ORDER BY q.position`);
}

/**
 * Buyurtma yaratadi. Barcha buyurtmalar umumiy navbatga tushadi.
 * Naqd: avval 'pending' yoziladi, keyin balansdan yechiladi (trigger 'queued' qiladi).
 * Pul yetmasa — buyurtma 'failed' bo'ladi (mijozga ko'rinmaydi), promo-kod qaytariladi.
 */
export async function createOrder(o) {
  const cust = await get('SELECT id, username, phone FROM customers WHERE id = :id', { id: o.customerId });
  if (!cust) throw fail('CUSTOMER_NOT_FOUND');
  if (!cust.phone) throw fail('PHONE_REQUIRED');
  if (o.paymentMethod === 'cash' && !(o.price > 0)) throw fail('PRICE_REQUIRED');

  const existing = async () => get('SELECT id, public_id, status FROM orders WHERE customer_id = :c AND idem_key = :k', { c: o.customerId, k: o.idempotencyKey });
  const dup = await existing();
  if (dup && dup.status !== 'failed') return { id: dup.id, publicId: dup.public_id, duplicate: true };
  if (dup) throw fail('INSUFFICIENT_BALANCE');

  const cash = o.paymentMethod === 'cash';
  let id = null, publicId = null;
  for (let i = 0; i < 5 && !id; i++) {
    publicId = newPublicId();
    try {
      const r = await run(`INSERT INTO orders (public_id, customer_id, service, payment_method, installment_type, status, title, details,
                             recipient, price, cost, customer_username, customer_phone, idem_key, queued_at)
                           VALUES (:pid, :c, :svc, :pm, :it, :st, :title, :det, :rcp, :price, :cost, :u, :ph, :k, :q) RETURNING id`,
        { pid: publicId, c: o.customerId, svc: o.service, pm: o.paymentMethod, it: o.installmentType ?? null,
          st: cash ? 'pending' : 'queued', title: o.title, det: o.details || {}, rcp: o.recipient ?? null,
          price: o.price ?? null, cost: o.cost ?? null, u: cust.username, ph: cust.phone, k: o.idempotencyKey, q: cash ? null : nowMs() });
      id = Number((r.rows && r.rows[0] && r.rows[0].id) ?? r.lastInsertRowid);
    } catch (e) {
      if (dbCode(e) !== 'UNIQUE') throw e;
      const d = await existing(); // parallel so'rov bir xil kalit bilan
      if (d) return { id: d.id, publicId: d.public_id, duplicate: true };
    }
  }
  if (!id) throw fail('ORDER_ID_GENERATION_FAILED');
  if (!cash) return { id, publicId, duplicate: false };

  // Promo-kod (faqat naqd)
  let price = o.price;
  let promo = null;
  if (o.promoCode) {
    try {
      promo = await redeemPromo(o.promoCode, o.customerId, o.service, price, id);
      price = promo.finalPrice;
      await run('UPDATE orders SET price = :p, discount = :d, promo_code = :code WHERE id = :id', { p: price, d: promo.discount, code: promo.code, id });
    } catch (e) {
      await run("UPDATE orders SET status = 'failed' WHERE id = :id", { id });
      throw e;
    }
  }
  try {
    await ledger({ customerId: o.customerId, amount: -price, kind: 'order_payment', key: `order:${id}:pay`, refId: id, note: publicId });
  } catch (e) {
    await run("UPDATE orders SET status = 'failed' WHERE id = :id AND status = 'pending'", { id });
    if (promo) await releasePromo(promo, id);
    throw e;
  }
  return { id, publicId, duplicate: false };
}

/** Admin: bajarildi yoki bekor qilindi. Naqd buyurtma bekor qilinsa — pul trigger orqali bir marta qaytadi. */
export async function closeOrder(orderId, status, actor, note) {
  const o = await get('SELECT * FROM orders WHERE id = :id', { id: orderId });
  if (!o) throw fail('ORDER_NOT_FOUND');
  if (o.status !== 'queued') throw fail('ORDER_ALREADY_CLOSED');
  let refunded = 0;
  if (status === 'cancelled' && Number(o.paid_amount) > 0) {
    await ledger({ customerId: o.customer_id, amount: Number(o.paid_amount), kind: 'refund', key: `order:${orderId}:refund`, refId: orderId, note: o.public_id, by: actor });
    refunded = Number(o.paid_amount);
    if (note) await run('UPDATE orders SET admin_note = :n WHERE id = :id', { n: note, id: orderId });
  } else {
    const r = await run(`UPDATE orders SET status = :s, closed_at = :t, admin_note = COALESCE(:n, admin_note) WHERE id = :id AND status = 'queued'`,
      { s: status, t: nowMs(), n: note ?? null, id: orderId });
    if (r.rowsAffected !== 1) throw fail('ORDER_ALREADY_CLOSED');
  }
  await audit(actor, 'order.' + status, o.public_id, { refunded, note });
  return { publicId: o.public_id, customerId: o.customer_id, refunded };
}

// ---------- cheklar ----------
export async function createReceipt(customerId, amount, fileId) {
  const r = await run('INSERT INTO receipts (customer_id, amount, file_id) VALUES (:c, :a, :f) RETURNING id', { c: customerId, a: amount, f: fileId });
  return Number((r.rows && r.rows[0] && r.rows[0].id) ?? r.lastInsertRowid);
}
export async function approveReceipt(id, actor, amountOverride) {
  const rc = await get('SELECT * FROM receipts WHERE id = :id', { id });
  if (!rc) throw fail('RECEIPT_NOT_FOUND');
  if (rc.status !== 'pending') throw fail('RECEIPT_ALREADY_REVIEWED');
  const amount = amountOverride ?? Number(rc.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw fail('BAD_AMOUNT');
  const r = await ledger({ customerId: rc.customer_id, amount, kind: 'topup', key: `receipt:${id}`, refId: id, by: actor });
  if (r.duplicate) throw fail('RECEIPT_ALREADY_REVIEWED');
  await audit(actor, 'receipt.approve', String(id), { amount, requested: rc.amount });
  return { customerId: rc.customer_id, amount };
}
export async function rejectReceipt(id, actor, note) {
  const r = await run(`UPDATE receipts SET status = 'rejected', admin_note = :n, reviewed_at = :t WHERE id = :id AND status = 'pending'`, { id, n: note ?? null, t: nowMs() });
  if (r.rowsAffected !== 1) throw fail('RECEIPT_ALREADY_REVIEWED');
  await audit(actor, 'receipt.reject', String(id), { note });
  const rc = await get('SELECT customer_id FROM receipts WHERE id = :id', { id });
  return { customerId: rc.customer_id };
}
export async function adminAdjust(customerId, amount, key, actor, note) {
  const r = await ledger({ customerId, amount, kind: amount > 0 ? 'admin_credit' : 'admin_debit', key: `admin:${key}`, note, by: actor });
  await audit(actor, 'balance.adjust', String(customerId), { amount, note, duplicate: r.duplicate });
  return r;
}

// ---------- bo'lib to'lash ----------
const ymd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

/** Shartnoma hisobi (faqat admin uchun). Miqdorlar tiyinda. */
export function summarize(a, paidSum, today = new Date()) {
  const total = Number(a.total_price), monthly = Number(a.monthly_payment), down = Number(a.down_payment);
  const paid = down + paidSum;
  const remaining = Math.max(0, total - paid);
  const start = ymd(a.start_date);
  const t = ymd(new Date(today.getTime() + 5 * 3600000).toISOString()); // Toshkent sanasi
  const monthsElapsed = Math.max(0, (t.getUTCFullYear() - start.getUTCFullYear()) * 12 + (t.getUTCMonth() - start.getUTCMonth()) - (t.getUTCDate() < start.getUTCDate() ? 1 : 0));
  const expected = Math.min(total, down + monthly * monthsElapsed);
  const overdueAmount = Math.max(0, expected - paid);
  const paidMonths = monthly > 0 ? Math.floor(paidSum / monthly) : 0;
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + paidMonths + 1);
  return { total, paid, remaining, overdueAmount, overdue: remaining > 0 && overdueAmount > 0, nextDueDate: remaining > 0 ? next.toISOString().slice(0, 10) : null };
}

export async function listAgreements({ status, search, customerId } = {}, today = new Date()) {
  const rows = await all(`SELECT a.*, c.username AS cust_username, c.phone AS cust_phone, o.public_id AS order_public_id,
       COALESCE((SELECT SUM(amount) FROM inst_payments p WHERE p.agreement_id = a.id), 0) AS paid_sum
     FROM agreements a LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN orders o ON o.id = a.order_id
     WHERE (:st IS NULL OR a.status = :st) AND (:cid IS NULL OR a.customer_id = :cid)
       AND (:q IS NULL OR a.product_name LIKE '%' || :q || '%' OR a.client_name LIKE '%' || :q || '%' OR a.client_username LIKE '%' || :q || '%'
            OR c.username LIKE '%' || :q || '%' OR a.client_phone LIKE '%' || :q || '%')
     ORDER BY a.status, a.start_date DESC`, { st: status || null, cid: customerId ?? null, q: search || null });
  return rows.map((a) => ({ ...a, summary: summarize(a, Number(a.paid_sum), today) }));
}

export async function saveAgreement(i, actor) {
  if (i.downPayment > i.totalPrice) throw fail('DOWN_PAYMENT_TOO_BIG');
  if (i.finalDate < i.startDate) throw fail('VALIDATION', { field: 'finalDate' });
  const user = i.clientUsername ? i.clientUsername.replace(/^@/, '') : null;
  if (i.id) {
    const r = await run(`UPDATE agreements SET client_name = :cn, client_username = :cu, client_phone = :cp, product_name = :pn, installment_type = :it,
        total_price = :tp, down_payment = :dp, monthly_payment = :mp, start_date = :sd, final_date = :fd, collateral = :col, notes = :nt,
        status = COALESCE(:st, status) WHERE id = :id`,
      { id: i.id, cn: i.clientName, cu: user, cp: i.clientPhone, pn: i.productName, it: i.installmentType, tp: i.totalPrice, dp: i.downPayment,
        mp: i.monthlyPayment, sd: i.startDate, fd: i.finalDate, col: i.collateral, nt: i.notes, st: i.status ?? null });
    if (r.rowsAffected !== 1) throw fail('AGREEMENT_NOT_FOUND');
    await audit(actor, 'installment.update', String(i.id), i);
    return i.id;
  }
  let customerId = i.customerId ?? null;
  if (i.orderId) {
    const o = await get('SELECT customer_id, payment_method FROM orders WHERE id = :id', { id: i.orderId });
    if (!o) throw fail('ORDER_NOT_FOUND');
    if (o.payment_method !== 'installment') throw fail('ORDER_NOT_INSTALLMENT');
    customerId = o.customer_id;
  } else if (!customerId && user) {
    const c = await get('SELECT id FROM customers WHERE lower(username) = lower(:u)', { u: user });
    if (c) customerId = c.id;
  }
  let id;
  try {
    const r = await run(`INSERT INTO agreements (order_id, customer_id, legacy, client_name, client_username, client_phone, product_name, installment_type,
        total_price, down_payment, monthly_payment, start_date, final_date, collateral, notes)
      VALUES (:oid, :cid, :lg, :cn, :cu, :cp, :pn, :it, :tp, :dp, :mp, :sd, :fd, :col, :nt) RETURNING id`,
      { oid: i.orderId ?? null, cid: customerId, lg: Boolean(i.legacy), cn: i.clientName, cu: user, cp: i.clientPhone, pn: i.productName, it: i.installmentType,
        tp: i.totalPrice, dp: i.downPayment, mp: i.monthlyPayment, sd: i.startDate, fd: i.finalDate, col: i.collateral, nt: i.notes });
    id = Number((r.rows && r.rows[0] && r.rows[0].id) ?? r.lastInsertRowid);
  } catch (e) {
    if (dbCode(e) === 'UNIQUE') throw fail('AGREEMENT_EXISTS');
    throw e;
  }
  if (i.alreadyPaid > 0) {
    await run(`INSERT INTO inst_payments (agreement_id, amount, source, note, idem_key, created_by, paid_at)
               VALUES (:id, :a, 'manual', :n, :k, :by, :t)`,
      { id, a: i.alreadyPaid, n: "Platformadan oldingi to'lovlar", k: `agreement:${id}:legacy`, by: actor, t: ymd(i.startDate).getTime() });
  }
  await audit(actor, 'installment.create', String(id), i);
  return id;
}

export async function addManualPayment(agreementId, amount, key, actor, note, paidAt) {
  const a = await get('SELECT id FROM agreements WHERE id = :id', { id: agreementId });
  if (!a) throw fail('AGREEMENT_NOT_FOUND');
  const r = await run(`INSERT INTO inst_payments (agreement_id, amount, source, note, idem_key, created_by, paid_at)
                       VALUES (:id, :a, 'manual', :n, :k, :by, :t) ON CONFLICT (idem_key) DO NOTHING`,
    { id: agreementId, a: amount, n: note ?? null, k: `admin:${key}`, by: actor, t: paidAt ? ymd(paidAt).getTime() + 12 * 3600000 : nowMs() });
  await audit(actor, 'installment.payment', String(agreementId), { amount, note, duplicate: r.rowsAffected === 0 });
  await closeIfPaid(agreementId);
  return { duplicate: r.rowsAffected === 0 };
}

/** Mijoz o'zi tasdiqlab oylik to'lovni balansdan to'laydi (avtomatik yechish yo'q). */
export async function payInstallment(agreementId, customerId, key) {
  const a = await get('SELECT * FROM agreements WHERE id = :id AND customer_id = :c', { id: agreementId, c: customerId });
  if (!a) throw fail('AGREEMENT_NOT_FOUND');
  const ledgerKey = `installment:${agreementId}:${customerId}:${key}`;
  const done = await get('SELECT amount FROM inst_payments WHERE idem_key = :k', { k: ledgerKey });
  if (done) return { amount: Number(done.amount), duplicate: true };
  if (a.status !== 'active') throw fail('AGREEMENT_CLOSED');
  const paidSum = Number((await get('SELECT COALESCE(SUM(amount), 0) AS s FROM inst_payments WHERE agreement_id = :id', { id: agreementId })).s);
  const s = summarize(a, paidSum);
  if (s.remaining <= 0) throw fail('NOTHING_TO_PAY');
  const amount = Math.min(Number(a.monthly_payment), s.remaining);
  const r = await ledger({ customerId, amount: -amount, kind: 'installment_payment', key: ledgerKey, refId: agreementId });
  await closeIfPaid(agreementId);
  return { amount, duplicate: r.duplicate };
}

async function closeIfPaid(agreementId) {
  await run(`UPDATE agreements SET status = 'closed' WHERE id = :id AND status = 'active'
             AND down_payment + COALESCE((SELECT SUM(amount) FROM inst_payments WHERE agreement_id = :id), 0) >= total_price`, { id: agreementId });
}

// ---------- promo-kodlar ----------
export async function checkPromo(code, customerId, service, price) {
  const p = await get('SELECT * FROM promo WHERE code = :c COLLATE NOCASE', { c: String(code).trim() });
  if (!p || !p.active) throw fail('PROMO_INVALID');
  if (p.expires_at && Number(p.expires_at) < nowMs()) throw fail('PROMO_EXPIRED');
  const services = p.services ? JSON.parse(p.services) : null;
  if (services && !services.includes(service)) throw fail('PROMO_NOT_FOR_SERVICE');
  if (await get('SELECT 1 AS x FROM promo_red WHERE promo_id = :p AND customer_id = :c', { p: p.id, c: customerId })) throw fail('PROMO_ALREADY_USED');
  if (p.max_uses != null && Number(p.used_count) >= Number(p.max_uses)) throw fail('PROMO_USED_UP');
  let discount = p.kind === 'percent' ? Math.round((price * Number(p.value)) / 10000) : Number(p.value); // percent: value = foiz × 100
  discount = Math.min(discount, price - 100); // narx kamida 1 so'm qoladi
  if (discount <= 0) throw fail('PROMO_INVALID');
  return { promoId: p.id, code: p.code, discount, finalPrice: price - discount };
}

async function redeemPromo(code, customerId, service, price, orderId) {
  const r = await checkPromo(code, customerId, service, price);
  try {
    await run('INSERT INTO promo_red (promo_id, customer_id, order_id, discount) VALUES (:p, :c, :o, :d)', { p: r.promoId, c: customerId, o: orderId, d: r.discount });
  } catch (e) {
    if (dbCode(e) === 'UNIQUE') throw fail('PROMO_ALREADY_USED');
    throw e;
  }
  const u = await run('UPDATE promo SET used_count = used_count + 1 WHERE id = :id AND (max_uses IS NULL OR used_count < max_uses)', { id: r.promoId });
  if (u.rowsAffected !== 1) {
    await run('DELETE FROM promo_red WHERE order_id = :o', { o: orderId });
    throw fail('PROMO_USED_UP');
  }
  return r;
}
async function releasePromo(promo, orderId) {
  const d = await run('DELETE FROM promo_red WHERE order_id = :o', { o: orderId });
  if (d.rowsAffected === 1) await run('UPDATE promo SET used_count = used_count - 1 WHERE id = :id AND used_count > 0', { id: promo.promoId });
}

export async function savePromo(p, actor) {
  const code = String(p.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw fail('PROMO_CODE_FORMAT');
  const params = { code, kind: p.kind, value: p.value, services: p.services && p.services.length ? JSON.stringify(p.services) : null,
    exp: p.expiresAt ?? null, max: p.maxUses ?? null, active: p.active !== false };
  try {
    if (p.id) await run(`UPDATE promo SET code = :code, kind = :kind, value = :value, services = :services, expires_at = :exp, max_uses = :max, active = :active WHERE id = :id`, { ...params, id: p.id });
    else await run(`INSERT INTO promo (code, kind, value, services, expires_at, max_uses, active) VALUES (:code, :kind, :value, :services, :exp, :max, :active)`, params);
  } catch (e) {
    if (dbCode(e) === 'UNIQUE') throw fail('PROMO_CODE_EXISTS');
    if (dbCode(e) === 'CHECK') throw fail('VALIDATION');
    throw e;
  }
  await audit(actor, p.id ? 'promo.update' : 'promo.create', code, params);
}

// ---------- sharhlar ----------
export async function leaveReview(customerId, publicId, rating, text) {
  const o = await get('SELECT id, status FROM orders WHERE public_id = :p AND customer_id = :c', { p: publicId, c: customerId });
  if (!o) throw fail('ORDER_NOT_FOUND');
  if (o.status !== 'completed') throw fail('REVIEW_NOT_ALLOWED');
  const r = await run('INSERT INTO reviews (order_id, customer_id, rating, text) VALUES (:o, :c, :r, :t) ON CONFLICT (order_id) DO NOTHING', { o: o.id, c: customerId, r: rating, t: text });
  if (r.rowsAffected !== 1) throw fail('REVIEW_EXISTS');
}
