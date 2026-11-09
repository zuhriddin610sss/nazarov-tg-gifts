// Muhim stsenariylar: haqiqiy SQLite bazasida (node:sqlite), Telegram va Marketapp soxta.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, sent, setFetch, EndpointError } from 'sdk';
import { ADMIN_IDS } from '../tgcloud/lib/config.js';
import appEndpoint from '../tgcloud/endpoints/app.js';
import adminEndpoint from '../tgcloud/endpoints/admin.js';
import messageHandler from '../tgcloud/handlers/message.js';
import callbackHandler from '../tgcloud/handlers/callback_query.js';
import * as core from '../tgcloud/lib/core.js';
import { sendInstallmentReminders, sendRentReminders } from '../tgcloud/lib/jobs.js';

ADMIN_IDS.push(777);
let user = { id: 5001, username: 'mijoz1', first_name: 'Ali', language_code: 'uz' };
const app = (input, u = user) => appEndpoint(input, { initData: { user: u } });
const admin = (input) => adminEndpoint(input, { initData: { user: { id: 777 } } });
const code = (p) => p.then(() => 'OK', (e) => (e instanceof EndpointError ? e.parameters.code : 'THROWN:' + e.message));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let k = 0;
const key = () => 'test-key-' + (++k) + 'xxxx';

async function withPhone(u = user) {
  await app({ action: 'me' }, u);
  await messageHandler({ chat: { id: u.id, type: 'private' }, from: u, contact: { user_id: u.id, phone_number: '998901112233' } });
}
async function topup(som, u = user) {
  await app({ action: 'uploadReceipt', amount: som, image: PNG }, u);
  const rc = (await admin({ action: 'receipts', status: 'pending' }))[0];
  await admin({ action: 'approveReceipt', id: rc.id });
}
const balance = async (u = user) => (await app({ action: 'me' }, u)).balance;

beforeEach(() => {
  resetDb();
  // ensureSchema bir marta ishlaydi: yangi baza uchun qayta tekshirsin
  core.__resetForTests?.();
  sent.length = 0;
});

test('telefonsiz buyurtma yo\'q; boshqaning kontakti qabul qilinmaydi', async () => {
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'installment', installmentType: 'uzum', recipient: { self: true }, idempotencyKey: key() })), 'PHONE_REQUIRED');
  await messageHandler({ chat: { id: user.id, type: 'private' }, from: user, contact: { user_id: 999, phone_number: '998900000000' } });
  assert.equal((await app({ action: 'me' })).hasPhone, false);
  await withPhone();
  assert.equal((await app({ action: 'me' })).hasPhone, true);
});

test('naqd buyurtma: pul bir marta yechiladi, dublikat qaytadi, yetmasa rad', async () => {
  await withPhone();
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: key() })), 'INSUFFICIENT_BALANCE');
  await topup(500000);
  assert.equal(await balance(), 500000);
  const kk = key();
  const a = await app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: kk });
  const b = await app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: kk });
  assert.equal(a.publicId, b.publicId);
  assert.equal(b.duplicate, true);
  assert.equal(await balance(), 500000 - 171600);
  // ikkinchisi (boshqa kalit) — pul yetmaydi
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm12', paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: key() })), 'INSUFFICIENT_BALANCE');
  assert.equal(await balance(), 328400);
  const mine = await app({ action: 'myOrders' });
  assert.equal(mine.orders.length, 1); // 'failed' buyurtma ko'rinmaydi
  assert.ok(!JSON.stringify(mine).includes('position'));
});

test('stars: kamida 50; narx 240 so\'m; qabul qiluvchi tekshiriladi', async () => {
  await withPhone();
  await topup(100000);
  assert.equal(await code(app({ action: 'createOrder', service: 'stars', quantity: 40, paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: key() })), 'STARS_MIN');
  assert.equal(await code(app({ action: 'createOrder', service: 'stars', quantity: 100, paymentMethod: 'cash', recipient: { self: false, username: 'a b' }, idempotencyKey: key() })), 'BAD_USERNAME');
  await app({ action: 'createOrder', service: 'stars', quantity: 100, paymentMethod: 'cash', recipient: { self: false, username: '@dostim' }, idempotencyKey: key() });
  assert.equal(await balance(), 100000 - 24000);
});

test('navbat: barcha buyurtmalar navbatda, yopilganda raqamlar suriladi, bekor qilinganda pul bir marta qaytadi', async () => {
  await withPhone();
  await topup(1000000);
  const ids = [];
  ids.push((await app({ action: 'createOrder', service: 'stars', quantity: 100, paymentMethod: 'cash', recipient: { self: true }, idempotencyKey: key() })).publicId);
  ids.push((await app({ action: 'createOrder', service: 'nft_gift', paymentMethod: 'installment', installmentType: 'plan1', giftName: 'Plush Pepe', model: 'any', backdrop: 'Black', idempotencyKey: key() })).publicId);
  ids.push((await app({ action: 'createOrder', service: 'premium', plan: 'm1', paymentMethod: 'installment', installmentType: 'plan2', recipient: { self: true }, idempotencyKey: key() })).publicId);
  let q = await admin({ action: 'queue' });
  assert.deepEqual(q.map((x) => [x.position, x.public_id]), [[1, ids[0]], [2, ids[1]], [3, ids[2]]]);
  const first = q[0].id;
  const r1 = await admin({ action: 'closeOrder', id: first, status: 'cancelled' });
  assert.equal(r1.refunded, 24000);
  assert.equal(await code(admin({ action: 'closeOrder', id: first, status: 'cancelled' })), 'ORDER_ALREADY_CLOSED');
  assert.equal(await balance(), 1000000);
  q = await admin({ action: 'queue' });
  assert.deepEqual(q.map((x) => [x.position, x.public_id]), [[1, ids[1]], [2, ids[2]]]);
  await admin({ action: 'closeOrder', id: q[0].id, status: 'completed' });
  q = await admin({ action: 'queue' });
  assert.deepEqual(q.map((x) => x.position), [1]);
});

test('chek: bir marta tasdiqlanadi (sayt va bot tugmasi), rad etilgani tasdiqlanmaydi', async () => {
  await withPhone();
  await app({ action: 'uploadReceipt', amount: 50000, image: PNG });
  const rc = (await admin({ action: 'receipts', status: 'pending' }))[0];
  const photo = sent.find((s) => s.method === 'sendPhoto' && s.params.reply_markup);
  assert.ok(photo.params.reply_markup.inline_keyboard[0][0].callback_data.endsWith(':' + rc.id));
  await callbackHandler({ id: 'q1', data: `rc:ok:${rc.id}`, from: { id: 777 } });
  await callbackHandler({ id: 'q2', data: `rc:ok:${rc.id}`, from: { id: 777 } });
  assert.equal(await code(admin({ action: 'approveReceipt', id: rc.id })), 'RECEIPT_ALREADY_REVIEWED');
  assert.equal(await balance(), 50000);
  await callbackHandler({ id: 'q3', data: `rc:ok:${rc.id}`, from: { id: 1234 } }); // admin emas
  assert.equal(await balance(), 50000);
  assert.equal(await code(app({ action: 'uploadReceipt', amount: 5000, image: 'bm90LWFuLWltYWdl' })), 'FILE_TYPE_NOT_ALLOWED');
});

test('admin endpointi faqat adminlarga', async () => {
  assert.equal(await code(adminEndpoint({ action: 'stats' }, { initData: { user: { id: 5001 } } })), 'FORBIDDEN');
  assert.equal(await code(adminEndpoint({ action: 'stats' }, { initData: {} })), 'FORBIDDEN');
  assert.equal(await code(appEndpoint({ action: 'me' }, { initData: {} })), 'UNAUTHORIZED');
});

test('promo-kod: chegirma, bir mijozga bir marta, limit, bekor qilinganda chegirmali summa qaytadi', async () => {
  await withPhone();
  await topup(500000);
  await admin({ action: 'savePromo', code: 'yangi10', kind: 'percent', value: 10, maxUses: 1 });
  const chk = await app({ action: 'checkPromo', code: 'YANGI10', service: 'premium', price: 171600 });
  assert.equal(chk.finalPrice, 154440);
  const o = await app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, promoCode: 'yangi10', idempotencyKey: key() });
  assert.equal(await balance(), 500000 - 154440);
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, promoCode: 'YANGI10', idempotencyKey: key() })), 'PROMO_ALREADY_USED');
  const u2 = { id: 5002, username: 'ikkinchi' };
  await withPhone(u2); await topup(500000, u2);
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'cash', recipient: { self: true }, promoCode: 'YANGI10', idempotencyKey: key() }, u2)), 'PROMO_USED_UP');
  assert.equal(await balance(u2), 500000);
  const q = await admin({ action: 'queue' });
  await admin({ action: 'closeOrder', id: q.find((x) => x.public_id === o.publicId).id, status: 'cancelled' });
  assert.equal(await balance(), 500000);
});

test("bo'lib to'lash: mijoz faqat 3 ma'lumotni ko'radi, oylik to'lov bir marta yechiladi, boshqaniki to'lanmaydi", async () => {
  await withPhone();
  await topup(600000);
  const o = await app({ action: 'createOrder', service: 'nft_gift', paymentMethod: 'installment', installmentType: 'plan1', giftName: 'Plush Pepe', model: 'any', backdrop: 'any', idempotencyKey: key() });
  const q = await admin({ action: 'queue' });
  const { id } = await admin({ action: 'saveInstallment', orderId: q[0].id, productName: 'Plush Pepe', totalPrice: 3000000, downPayment: 500000, monthlyPayment: 250000, startDate: '2026-11-08', finalDate: '2027-09-08' });
  const mine = (await app({ action: 'myOrders' })).orders.find((x) => x.publicId === o.publicId);
  assert.deepEqual(Object.keys(mine.installment).sort(), ['active', 'finalDate', 'id', 'monthlyPayment', 'purchasedAt']);
  assert.equal(mine.price, null);
  const pk = key();
  await app({ action: 'payInstallment', id, idempotencyKey: pk });
  await app({ action: 'payInstallment', id, idempotencyKey: pk });
  assert.equal(await balance(), 350000);
  const pays = await admin({ action: 'installmentPayments', id });
  assert.equal(pays.length, 1);
  const u2 = { id: 5003, username: 'begona' };
  await withPhone(u2); await topup(500000, u2);
  assert.equal(await code(app({ action: 'payInstallment', id, idempotencyKey: key() }, u2)), 'AGREEMENT_NOT_FOUND');
  const list = await admin({ action: 'installments', status: 'active' });
  assert.equal(list[0].summary.remaining, 2250000);
});

test('eski shartnoma va oylik to\'lov eslatmalari (3 kun oldin, to\'lov kuni, kechikkanda) bittadan', async () => {
  await withPhone();
  const me = await app({ action: 'me' });
  const { id } = await admin({ action: 'saveInstallment', legacy: true, clientUsername: 'mijoz1', productName: 'Plush Pepe', totalPrice: 1200000, monthlyPayment: 100000, startDate: '2026-01-10', finalDate: '2026-12-10' });
  const at = (d) => Date.parse(d + 'T07:00:00Z');
  for (const d of ['2026-02-06', '2026-02-07', '2026-02-07', '2026-02-10', '2026-02-11', '2026-02-12']) await sendInstallmentReminders(at(d));
  const keys = (await core.all("SELECT key FROM notif WHERE key LIKE 'inst:%' ORDER BY rowid")).map((r) => r.key);
  assert.deepEqual(keys, [`inst:${id}:2026-02-10:soon`, `inst:${id}:2026-02-10:today`, `inst:${id}:2026-02-10:late`]);
  const toCustomer = sent.filter((s) => s.method === 'sendMessage' && s.params.chat_id === 5001 && /Plush Pepe/.test(s.params.text));
  assert.equal(toCustomer.length, 3);
  assert.ok(!toCustomer.some((s) => /2 ?\d{3} ?\d{3}|qarz/i.test(s.params.text)));
  assert.ok(me.id);
});

test('ijara: katalog Marketapp\'dan, narx formula bo\'yicha (yaxlitlanmaydi), eskirgan e\'lon rad etiladi', async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST' });
  let auth = null;
  setFetch(async (url, opts) => {
    auth = opts.headers.Authorization;
    assert.ok(url.startsWith('https://api.marketapp.org/v1/rent/gifts/'));
    return { ok: true, status: 200, text: async () => JSON.stringify({ cursor: null, items: [
      { nft_address: 'EQ_TEST_ADDRESS_123456', nft_name: 'Plush Pepe #12', owner: 'x', attributes: [{ trait_type: 'Model', value: 'Gold' }],
        min_duration: 86400, max_duration: 30 * 86400, price_per_day: '1500000000', discount_per_day: 0, listed_at: 1 }] }) };
  });
  const list = await app({ action: 'rentList', category: 'gifts' });
  assert.equal(auth, 'TEST');
  assert.equal(list.items[0].maxDays, 30);
  await topup(200000);
  await app({ action: 'createOrder', service: 'gift_rent', address: 'EQ_TEST_ADDRESS_123456', days: 1, paymentMethod: 'cash', idempotencyKey: key() });
  assert.equal(await balance(), 200000 - 62700); // (1.5 + 0.15) × 2 × 19000
  assert.equal(await code(app({ action: 'createOrder', service: 'gift_rent', address: 'EQ_TEST_ADDRESS_123456', days: 31, paymentMethod: 'cash', idempotencyKey: key() })), 'BAD_DURATION');
  assert.equal(await code(app({ action: 'createOrder', service: 'gift_rent', address: 'NOPE_NOT_SEEN_ADDR', days: 1, paymentMethod: 'cash', idempotencyKey: key() })), 'RENT_ITEM_STALE');
  const q = await admin({ action: 'queue' });
  assert.equal(q[0].cost, 28500); // tannarx faqat adminga
  await admin({ action: 'closeOrder', id: q[0].id, status: 'completed' });
  const closed = Number((await core.get('SELECT closed_at FROM orders WHERE id = :id', { id: q[0].id })).closed_at);
  await sendRentReminders(closed + 2 * 3_600_000);  // 22 soat qoldi
  await sendRentReminders(closed + 3 * 3_600_000);
  assert.equal((await core.all("SELECT key FROM notif WHERE key LIKE 'rent:%'")).length, 1);
  const s = await admin({ action: 'settings' });
  assert.equal(s.marketappTokenSet, true);
  assert.ok(!JSON.stringify(s).includes('TEST'));
});

test('sharh: faqat bajarilgan buyurtmaga, bir marta; admin tasdiqlagach ko\'rinadi', async () => {
  await withPhone();
  const o = await app({ action: 'createOrder', service: 'premium', plan: 'm1', paymentMethod: 'installment', installmentType: 'uzum', recipient: { self: true }, idempotencyKey: key() });
  assert.equal(await code(app({ action: 'leaveReview', publicId: o.publicId, rating: 5, text: 'Zo\'r' })), 'REVIEW_NOT_ALLOWED');
  const q = await admin({ action: 'queue' });
  await admin({ action: 'closeOrder', id: q[0].id, status: 'completed' });
  await app({ action: 'leaveReview', publicId: o.publicId, rating: 5, text: 'Tez va ishonchli' });
  assert.equal(await code(app({ action: 'leaveReview', publicId: o.publicId, rating: 4, text: 'yana' })), 'REVIEW_EXISTS');
  assert.equal((await app({ action: 'reviews' })).length, 0);
  const rv = (await admin({ action: 'reviews', status: 'pending' }))[0];
  await admin({ action: 'reviewAction', id: rv.id, decision: 'publish' });
  const pub = await app({ action: 'reviews' });
  assert.equal(pub.length, 1);
  assert.equal(pub[0].name, 'A***');
});
