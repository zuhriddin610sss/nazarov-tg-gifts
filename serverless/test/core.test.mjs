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
  const c = (await admin({ action: 'customers', search: String(u.id) }))[0];
  await admin({ action: 'adjust', id: c.id, amount: som, note: 'Naqd', idempotencyKey: key() });
}
const balance = async (u = user) => (await app({ action: 'me' }, u)).balance;

beforeEach(() => {
  resetDb();
  // ensureSchema bir marta ishlaydi: yangi baza uchun qayta tekshirsin
  core.__resetForTests?.();
  sent.length = 0;
});

test('telefonsiz buyurtma yo\'q; boshqaning kontakti qabul qilinmaydi', async () => {
  assert.equal(await code(app({ action: 'createOrder', service: 'premium', plan: 'm3', paymentMethod: 'installment', installmentType: 'uzum', months: 6, recipient: { self: true }, idempotencyKey: key() })), 'PHONE_REQUIRED');
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
  ids.push((await app({ action: 'createOrder', service: 'nft_gift', paymentMethod: 'installment', installmentType: 'plan1', months: 6, giftName: 'Plush Pepe', model: 'any', backdrop: 'Black', idempotencyKey: key() })).publicId);
  assert.equal(await code(app({ action: 'createOrder', service: 'stars', quantity: 100, paymentMethod: 'installment', installmentType: 'uzum', months: 7, recipient: { self: true }, idempotencyKey: key() })), 'VALIDATION');
  assert.equal(await code(app({ action: 'createOrder', service: 'stars', quantity: 100, paymentMethod: 'installment', installmentType: 'plan2', months: 241, recipient: { self: true }, idempotencyKey: key() })), 'VALIDATION');
  ids.push((await app({ action: 'createOrder', service: 'premium', plan: 'm1', paymentMethod: 'installment', installmentType: 'plan2', months: 240, downPayment: 50000, recipient: { self: true }, idempotencyKey: key() })).publicId);
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

test("balansni faqat admin to'ldiradi: chek yuklash yo'q, karta raqami mijozga berilmaydi, tuzatish takrorlanmaydi", async () => {
  await withPhone();
  assert.equal(await code(app({ action: 'uploadReceipt', amount: 50000, image: PNG })), 'UNKNOWN_ACTION');
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), card_number: '8600 0000 0000 0000' });
  const b = await app({ action: 'balance' });
  assert.ok(!JSON.stringify(b).includes('8600'));
  const c = (await admin({ action: 'customers', search: '5001' }))[0];
  await admin({ action: 'adjust', id: c.id, amount: 50000, note: 'Naqd', idempotencyKey: 'adj-same-key-1' });
  await admin({ action: 'adjust', id: c.id, amount: 50000, note: 'Naqd', idempotencyKey: 'adj-same-key-1' });
  assert.equal(await balance(), 50000);
  assert.equal(await code(admin({ action: 'adjust', id: c.id, amount: -60000, note: 'Xato', idempotencyKey: 'adj-neg-key-1' })), 'INSUFFICIENT_BALANCE');
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
  const o = await app({ action: 'createOrder', service: 'nft_gift', paymentMethod: 'installment', installmentType: 'plan1', months: 6, giftName: 'Plush Pepe', model: 'any', backdrop: 'any', idempotencyKey: key() });
  const q = await admin({ action: 'queue' });
  const { id } = await admin({ action: 'saveInstallment', orderId: q[0].id, productName: 'Plush Pepe', totalPrice: 3000000, downPayment: 500000, monthlyPayment: 250000, startDate: '2026-11-08', finalDate: '2027-09-08' });
  const mine = (await app({ action: 'myOrders' })).orders.find((x) => x.publicId === o.publicId);
  assert.deepEqual(Object.keys(mine.installment).sort(), ['active', 'finalDate', 'id', 'monthlyPayment', 'months', 'nextDueDate', 'overdue', 'paidMonths', 'purchasedAt']);
  assert.ok(!('remaining' in mine.installment) && !('total' in mine.installment), 'umumiy qarz ko\'rsatilmaydi');
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
  const o = await app({ action: 'createOrder', service: 'premium', plan: 'm1', paymentMethod: 'installment', installmentType: 'uzum', months: 6, recipient: { self: true }, idempotencyKey: key() });
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

test("o'z mahsulotlari: admin qo'shadi, mijoz ijaraga va sotib oladi; ijara narxi butun so'mga yaxlitlanadi", async () => {
  await withPhone();
  const { rentPriceTiyin } = await import('../tgcloud/lib/pricing.js');
  assert.equal(rentPriceTiyin(0.0149968, { add: 0.15, mult: 2, rate: 19000 }), 627000); // 6 269,89 -> 6 270 so'm
  assert.equal(rentPriceTiyin(0.15, { add: 0.15, mult: 2, rate: 19000 }), 1140000);
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Plush Pepe #9', rent_enabled: true, rent_price: 1000.5, rent_min: 2, rent_max: 10, inst_enabled: true, cash_enabled: true, cash_price: 500 });
  const list = await app({ action: 'ownList', category: 'gifts' });
  const p = list.find((x) => x.name === 'Plush Pepe #9');
  assert.ok(p && p.rent && p.installment && p.cashPrice === 500);
  assert.equal(await code(app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'rent', days: 11, paymentMethod: 'installment', idempotencyKey: key() })), 'BAD_DURATION');
  const r = await app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'plan2', months: 12, downPayment: 100, idempotencyKey: key() });
  assert.match(r.publicId, /^NG-/);
  await admin({ action: 'saveOwnProduct', id: p.id, kind: 'gifts', name: 'Plush Pepe #9', inst_enabled: true, visible: false });
  assert.equal((await app({ action: 'ownList', category: 'gifts' })).some((x) => x.id === p.id), false);
});

test("bo'lib to'lash hisobi: ustama 25/50/100%, boshlang'ich to'lov qolgan summadan ayriladi; 1-tur formulasi", async () => {
  const { monthlyPayment, downByFormula } = await import('../tgcloud/lib/calc.js');
  const s = { ...core.DEFAULT_SETTINGS };
  assert.equal(monthlyPayment(1000000, 0, 6, s).monthly, 250000);
  assert.equal(monthlyPayment(1000000, 200000, 6, s).monthly, 200000);
  assert.equal(monthlyPayment(1000000, 0, 3, s).total, 1250000);
  assert.equal(monthlyPayment(1000000, 0, 12, s).total, 2000000);
  // kuniga 0.05 TON: (0.05*45 + 0.1) * 17000 * 3 = 119 850
  assert.equal(downByFormula('50000000', s), 119850);
  const { calcText } = await import('../tgcloud/lib/admintools.js');
  assert.match(calcText(['1000000', '6', '200000'], s), /oyiga 200 000 so'm/);
});

test("yangilanish: eski bazadagi mijoz, balans va mahsulotlar saqlanadi, yangi ustunlar qo'shiladi", async () => {
  await withPhone();
  await topup(50000);
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Old Gift #1', inst_enabled: true });
  // Eski (2-versiya) bazani taqlid qilamiz: yangi ustunlarni olib tashlab, versiyani 2 ga qaytaramiz
  const { db } = await import('sdk');
  await db.run('CREATE TABLE own_old AS SELECT id, kind, name, image, model, backdrop, symbol, rent_enabled, rent_price, rent_min, rent_max, inst_enabled, cash_enabled, cash_price, visible, position, created_at FROM own_products');
  await db.run('DROP TABLE own_products');
  await db.run('ALTER TABLE own_old RENAME TO own_products');
  await db.run("UPDATE meta SET value = '2' WHERE key = 'schema'");
  core.__resetForTests();
  const me = await app({ action: 'me' });
  assert.equal(me.balance, 50000);
  const cols = (await db.all("SELECT name FROM pragma_table_info('own_products')")).map((r) => r.name);
  for (const c of ['price_source', 'down_mode', 'mk_price_ton']) assert.ok(cols.includes(c), c);
  const list = await admin({ action: 'ownProducts' });
  assert.ok(list.some((p) => p.name === 'Old Gift #1'));
});

test("o'z sovg'asi: qo'lda narx va boshlang'ich to'lov, buyurtmada taxminiy oylik; admin boshlang'ich to'lovni o'zgartiradi", async () => {
  await withPhone();
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Sale Gift #5', inst_enabled: true, price_source: 'manual_som', price_manual: 1000000, down_mode: 'manual', down_manual: 200000 });
  const p = (await app({ action: 'ownList', category: 'gifts' })).find((x) => x.name === 'Sale Gift #5');
  assert.equal(p.salePrice, 1000000);
  assert.equal(p.down1, 200000);
  const r = await app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'plan1', months: 6, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.details.downPayment, 200000);
  assert.equal(o.details.estMonthly, 200000);
  const res = await admin({ action: 'setOrderDown', id: o.id, amount: 400000 });
  assert.equal(res.estMonthly, 150000);
  assert.ok(sent.some((m) => m.params && /boshlang'ich to'lov 400 000/.test(m.params.text || '')));
});

test("ijara bo'lib to'lashda: turi va muddat so'raladi", async () => {
  await withPhone();
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Rent Gift #7', rent_enabled: true, rent_price: 1000, rent_min: 1, rent_max: 30 });
  const p = (await app({ action: 'ownList', category: 'gifts' })).find((x) => x.name === 'Rent Gift #7');
  assert.equal(await code(app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'rent', days: 10, paymentMethod: 'installment', idempotencyKey: key() })), 'INSTALLMENT_TYPE_REQUIRED');
  const r = await app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'rent', days: 10, paymentMethod: 'installment', installmentType: 'uzum', months: 3, downPayment: 0, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.installment_type, 'uzum');
  assert.equal(o.details.estMonthly, Math.ceil(10000 * 1.25 / 3));
});

test("admin bot: sovg'a havolasi bo'yicha bozor narxi, ijara va 1-tur boshlang'ich to'lovi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST' });
  const rentItem = { nft_address: 'EQ_TRAPPED_19604_XXXXXXXXXXXXXX', nft_name: 'Trapped Heart #19604', price_per_day: '50000000', min_duration: 86400, max_duration: 30 * 86400,
    attributes: [{ trait_type: 'Model', value: 'Crime Scene' }, { trait_type: 'Backdrop', value: 'Persimmon' }] };
  setFetch(async (url) => {
    const u = String(url);
    let body;
    if (u.startsWith('https://t.me/nft/')) body = '<table><tr><th>Model</th><td>Crime Scene <mark>2.6%</mark></td></tr><tr><th>Backdrop</th><td>Persimmon <mark>1.5%</mark></td></tr><tr><th>Symbol</th><td>Patched Heart</td></tr></table>';
    else if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/gifts/onsale/')) body = { cursor: null, items: [{ min_bid: u.includes('model=') && u.includes('backdrop=') ? '45000000000' : '20000000000', attributes: [] }] };
    else if (u.includes('/rent/gifts/')) body = { cursor: null, items: [rentItem] };
    else body = {};
    return { ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  });
  sent.length = 0;
  await messageHandler({ chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Admin' }, text: 'https://t.me/nft/TrappedHeart-19604' });
  const txt = sent.map((m) => m.params.text || '').join('\n');
  assert.match(txt, /Model: Crime Scene · Fon: Persimmon/);
  assert.match(txt, /Model \+ fon: 45 TON ≈ 765 000 so'm/);
  assert.match(txt, /1-tur boshlang'ich to'lovi \(formula\): 119 850 so'm/);
  sent.length = 0;
  await messageHandler({ chat: { id: 5001, type: 'private' }, from: user, text: '/hisob 1000000 6' });
  assert.ok(!sent.some((m) => /oyiga/.test(m.params.text || '')), 'mijozga kalkulyator ishlamaydi');
});

test("o'z gifti narxi: eski 'Marketapp' manbasi 'barcha bozorlar'ga o'tadi; model + fon topilmasa kengroq usulga o'tilmaydi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_K' });
  setFetch(async (url) => {
    const u = decodeURIComponent(String(url));
    let body = {};
    if (u.includes('/collections/preview')) body = { collections: [{ id: 'th', name: 'Trapped Heart', short_name: 'x', floor_price: '9' }] };
    else if (u.includes('/nfts/search')) body = { results: u.includes('filter_by_backdrops') ? [] : [{ name: 'Trapped Heart', external_collection_number: 3, price: '40', status: 'listed', attributes: [{ type: 'model', value: 'Crime Scene' }] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Trapped Heart #19604', model: 'Crime Scene', backdrop: 'Persimmon', inst_enabled: true, price_source: 'model_backdrop' });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Trapped Heart #19604');
  assert.equal(p.price_source, 'sat_model_backdrop');
  // Faqat belgilangan usul (model + fon): topilmasa model bo'yicha arzonroq narxga tushmaydi
  assert.equal(p.quote.price, null);
});

test("Portals (sinov): kalit saqlanadi, /portals javobni ko'rsatadi (kalitsiz), 'eng arzoni' Marketapp va Portals'ni solishtiradi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST', portalsKey: 'portals_SECRETKEY123' });
  assert.equal((await admin({ action: 'settings' })).portalsKeySet, true);
  let auth = null;
  setFetch(async (url, opts) => {
    const u = String(url);
    let body = {};
    if (u.includes('portal-market.com/partners/collections/preview')) { auth = opts.headers.Authorization; body = { collections: [{ id: 'col-uuid-1', name: 'Trapped Heart', short_name: 'trappedheart', floor_price: '12' }] }; }
    else if (u.includes('portal-market.com')) { assert.ok(u.includes('collection_id=col-uuid-1')); body = { results: [{ name: 'Pool Float', price: '4.44', attributes: [] }, { name: 'Trapped Heart', price: '18.5', attributes: [{ type: 'model', value: 'Crime Scene' }, { type: 'backdrop', value: 'Persimmon' }] }, { name: 'Trapped Heart', price: '25', attributes: [{ type: 'model', value: 'Crime Scene' }, { type: 'backdrop', value: 'Persimmon' }] }] }; }
    else if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/gifts/onsale/')) body = { cursor: null, items: [{ min_bid: '40000000000' }] };
    else if (u.includes('/rent/gifts/')) body = { cursor: null, items: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  sent.length = 0;
  await messageHandler({ chat: { id: 777, type: 'private' }, from: { id: 777, first_name: 'Admin' }, text: '/portals Trapped Heart | Crime Scene | Persimmon' });
  const txt = sent.map((m) => m.params.text || '').join('\n');
  assert.match(txt, /Crime Scene \+ Persimmon: 18\.5 TON/);
  assert.match(txt, /eng arzoni 12 TON/);
  assert.ok(!txt.includes('SECRETKEY'), 'kalit ko\'rinmasligi kerak');
  assert.equal(auth, 'partners portals_SECRETKEY123');
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Trapped Heart #777', model: 'Crime Scene', backdrop: 'Persimmon', inst_enabled: true, price_source: 'best', down_mode: 'manual', down_manual: 1 });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Trapped Heart #777');
  assert.equal(p.quote.price, Math.ceil(18.8 * 17000));
  assert.equal(p.quote.by, 'sat_model_backdrop');
  assert.equal(p.quote.src, 'Portals: Trapped Heart');
  assert.equal(p.quote.down1By, 'manual'); // ijarada yo'q -> qo'lda yozilgan summa
});

test("Marketapp sotuv narxi 402 bersa ham, boshlang'ich to'lov ijara narxidan formula bilan hisoblanadi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST' });
  const rentItem = { nft_address: 'EQ_X', nft_name: 'Trapped Heart #6329', price_per_day: '20000000', max_duration: 2592000, min_duration: 86400, attributes: [] };
  setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/gifts/onsale/')) return { ok: false, status: 402, text: async () => JSON.stringify({ code: 'PAYMENT_REQUIRED' }) };
    let body = {};
    if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/rent/gifts/')) body = { cursor: null, items: [rentItem] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Trapped Heart #6329', model: 'Crime Scene', backdrop: 'Persimmon', inst_enabled: true, price_source: 'model_backdrop', down_manual: 500000 });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Trapped Heart #6329');
  assert.equal(p.quote.price, null); // bozor kaliti yo'q, qo'lda narx ham yo'q
  // (0.02 × 45 + 0.1) × 17 000 × 3 = 51 000
  assert.equal(p.quote.down1, 51000);
  assert.equal(p.quote.down1By, 'formula');
});


test("Portals'dagi sotuvdagi giftlar: narx (TON + 0.1) × 17 000, faqat naqd, buyurtmada narx qayta tekshiriladi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_SECRETKEY123' });
  let price = '10';
  const urls = [];
  setFetch(async (url) => {
    const u = String(url); urls.push(u);
    let body = {};
    if (u.includes('/collections/preview')) body = { collections: [{ id: 'col-uuid-1', name: 'Trapped Heart', short_name: 'trappedheart', floor_price: '9' }] };
    else if (u.includes('/nfts/search')) body = { total_count: 45, results: [{ id: 'nft-1', name: 'Trapped Heart', external_collection_number: 6329, price, status: 'listed', photo_url: 'https://cdn.example/x.png',
      attributes: [{ type: 'model', value: 'Crime Scene' }, { type: 'backdrop', value: 'Persimmon' }] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  assert.equal((await app({ action: 'config' })).portalsSale, true);
  const list = await app({ action: 'portalsSale', collection: 'Trapped Heart' });
  assert.equal(list.items[0].price, 171700); // (10 + 0.1) × 17 000
  assert.equal(list.items[0].model, 'Crime Scene');
  assert.equal(list.items[0].ton, undefined);
  assert.equal(list.next, 30);
  assert.ok(urls.some((u) => u.includes('collection_id=col-uuid-1') && u.includes('status=listed')));
  await assert.rejects(app({ action: 'createOrder', service: 'portals', portalsId: 'nft-1', paymentMethod: 'installment', installmentType: 'plan2', months: 3, idempotencyKey: key() }), (e) => e.parameters.code === 'VALIDATION');
  await assert.rejects(app({ action: 'createOrder', service: 'portals', portalsId: 'nft-1', expectedPrice: 171700, paymentMethod: 'cash', idempotencyKey: key() }, { id: 99123, first_name: 'Yangi' }),
    (e) => ['INSUFFICIENT_BALANCE', 'PHONE_REQUIRED'].includes(e.parameters.code));
  price = '11';
  await assert.rejects(app({ action: 'createOrder', service: 'portals', portalsId: 'nft-1', expectedPrice: 171700, paymentMethod: 'cash', idempotencyKey: key() }), (e) => e.parameters.code === 'PRICE_CHANGED' && e.parameters.price === 188700);
  setFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: [], total_count: 0 }) }));
  await assert.rejects(app({ action: 'createOrder', service: 'portals', portalsId: 'nft-1', paymentMethod: 'cash', idempotencyKey: key() }), (e) => e.parameters.code === 'GIFT_SOLD');
});

test("Giftimni sotaman: e'lon admin tasdig'idan keyin Sotuvda chiqadi, sotib olinsa 'sotildi' bo'ladi", async () => {
  const seller = { id: 6001, username: 'sotuvchi', first_name: 'S' };
  await withPhone(seller); await withPhone();
  setFetch(async (url) => {
    const u = String(url);
    if (u.startsWith('https://t.me/nft/')) return { ok: true, status: 200, text: async () => '<table><tr><th>Model</th><td>Crime Scene</td></tr><tr><th>Backdrop</th><td>Persimmon</td></tr></table>' };
    return { ok: true, status: 200, text: async () => '{}' };
  });
  assert.equal(await code(app({ action: 'sellGift', link: 'https://example.com', price: 500000 }, seller)), 'BAD_LINK');
  sent.length = 0;
  await app({ action: 'sellGift', link: 'https://t.me/nft/TrappedHeart-6329', price: 500000 }, seller);
  assert.ok(sent.some((m) => /Yangi e'lon: Trapped Heart #6329/.test(m.params.text || '') && /@sotuvchi/.test(m.params.text)));
  // Tasdiqlanmaguncha ko'rinmaydi (Portals kaliti yo'q: faqat e'lonlar)
  assert.equal((await app({ action: 'portalsSale' })).items.length, 0);
  const l = (await admin({ action: 'listings' }))[0];
  assert.equal(l.status, 'pending'); assert.equal(l.model, 'Crime Scene'); assert.equal(Number(l.price), 500000);
  sent.length = 0;
  await admin({ action: 'setListing', id: l.id, status: 'active' });
  assert.ok(sent.some((m) => m.params.chat_id === 6001 && /tasdiqlandi/.test(m.params.text)));
  const list = await app({ action: 'portalsSale', collection: 'Trapped Heart', model: 'Crime Scene', maxPrice: 600000 });
  assert.equal(list.items.length, 1);
  assert.deepEqual([list.items[0].id, list.items[0].num, list.items[0].price], ['u' + l.id, 6329, 500000]);
  assert.equal((await app({ action: 'portalsSale', minPrice: 600000 }).catch(() => ({ items: [] }))).items.length, 0);
  assert.equal(await code(app({ action: 'createOrder', service: 'portals', portalsId: 'u' + l.id, paymentMethod: 'cash', idempotencyKey: key() }, seller)), 'OWN_LISTING');
  // Bo'lib to'lash o'chiq
  assert.equal(await code(app({ action: 'createOrder', service: 'portals', portalsId: 'u' + l.id, paymentMethod: 'installment', installmentType: 'plan2', months: 3, idempotencyKey: key() })), 'VALIDATION');
  await topup(500000);
  sent.length = 0;
  const r = await app({ action: 'createOrder', service: 'portals', portalsId: 'u' + l.id, expectedPrice: 500000, paymentMethod: 'cash', idempotencyKey: key() });
  assert.ok(r.publicId);
  assert.ok(sent.some((m) => /Sotuvchi \(gift egasi\): @sotuvchi/.test(m.params.text || '')));
  assert.equal((await admin({ action: 'listings' }))[0].status, 'sold');
  assert.equal(await code(app({ action: 'createOrder', service: 'portals', portalsId: 'u' + l.id, paymentMethod: 'cash', idempotencyKey: key() })), 'GIFT_SOLD');
  const o = (await app({ action: 'myOrders' })).orders[0];
  assert.ok(!/Portals/i.test(o.title));
});

test("Sotuvda: filtrlar Portals'ga uzatiladi; bo'lib to'lash yoqilsa faqat chegaragacha", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_K', sale_inst: { enabled: true, max: 200000 } });
  const urls = [];
  setFetch(async (url) => {
    const u = String(url); urls.push(u);
    const body = u.includes('/collections/preview') ? { collections: [{ id: 'col-1', name: 'Trapped Heart', short_name: 'x', floor_price: '9' }] }
      : { total_count: 2, results: [{ id: 'a', name: 'Trapped Heart', external_collection_number: 1, price: '10', status: 'listed', attributes: [] },
          { id: 'b', name: 'Trapped Heart', external_collection_number: 2, price: '20', status: 'listed', attributes: [] }].filter((x) => !u.includes('ids=') || u.includes('ids=' + x.id)) };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  assert.deepEqual((await app({ action: 'config' })).saleInst, { max: 200000 });
  await app({ action: 'portalsSale', collection: 'Trapped Heart', model: 'Crime Scene', backdrop: 'Persimmon', symbol: 'Heart', minPrice: 171700, maxPrice: 345100, num: '#63', sort: 'price desc' });
  const q = decodeURIComponent(urls.filter((u) => u.includes('/nfts/search')).pop());
  for (const x of ['collection_id=col-', 'filter_by_models=Crime Scene', 'filter_by_backdrops=Persimmon', 'filter_by_symbols=Heart', 'min_price=10', 'max_price=20.2', 'external_collection_number=63', 'sort_by=price desc'])
    assert.ok(q.includes(x), x + ' yo\'q: ' + q);
  // 10 TON -> 171 700 (chegaradan past): bo'lib to'lash mumkin; 20 TON -> 341 700: mumkin emas
  const ok = await app({ action: 'createOrder', service: 'portals', portalsId: 'a', paymentMethod: 'installment', installmentType: 'plan2', months: 6, downPayment: 0, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: ok.publicId }))[0];
  assert.equal(o.details.estMonthly, Math.ceil(Math.ceil(171700 * 1.5) / 6));
  assert.equal(await code(app({ action: 'createOrder', service: 'portals', portalsId: 'b', paymentMethod: 'installment', installmentType: 'plan2', months: 6, downPayment: 0, idempotencyKey: key() })), 'VALIDATION');
  // 1-tur: Marketapp ulanmagan -> boshlang'ich to'lovni admin yozadi
  const p1 = await app({ action: 'createOrder', service: 'portals', portalsId: 'a', paymentMethod: 'installment', installmentType: 'plan1', months: 3, idempotencyKey: key() });
  const o1 = (await admin({ action: 'orders', search: p1.publicId }))[0];
  assert.equal(o1.installment_type, 'plan1');
  assert.equal(o1.details.downPayment, null);
  assert.deepEqual(await app({ action: 'saleDown1', name: 'Trapped Heart #1' }), { down1: null });
});

test("kunlik Excel hisobot: ertasi kuni 09:00 dan keyin bir marta, .xlsx fayl (lizing jadvali bilan)", async () => {
  const { sendWeeklyReport } = await import('../tgcloud/lib/jobs.js');
  await withPhone(); await topup(100000);
  await app({ action: 'createOrder', service: 'stars', quantity: 100, recipient: { self: true }, paymentMethod: 'cash', idempotencyKey: key() });
  const created = Number((await admin({ action: 'orders' }))[0].created_at);
  // Buyurtmaning ertasi kuni, Toshkent vaqti
  const d = new Date(created + 5 * 3600000); const mon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5 * 3600000 + 86400000;
  sent.length = 0;
  assert.equal(await sendWeeklyReport(mon + 5 * 3600000), 0); // 05:00 — hali erta
  assert.equal(await sendWeeklyReport(mon + 6.5 * 3600000), 1);
  assert.equal(await sendWeeklyReport(mon + 11 * 3600000), 0); // ikkinchi marta yo'q
  const doc = sent.find((m) => m.method === 'sendDocument');
  assert.ok(doc, 'fayl yuborilmadi');
  assert.match(doc.params.caption, /Buyurtmalar: 1 · Tushum: 24 000 so'm/);
  const bytes = doc.params.document.bytes;
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  if (bytes) { const fs = await import('node:fs'); fs.writeFileSync(process.env.XLSX_OUT || '/dev/null', Buffer.from(bytes)); }
});

test("Sotuvda 1-tur: gift Marketapp ijarasida bo'lsa, boshlang'ich to'lov formula bilan", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST', portalsKey: 'portals_K', sale_inst: { enabled: true, max: 1000000 } });
  setFetch(async (url) => {
    const u = String(url);
    let body = {};
    if (u.includes('portal-market.com')) body = { total_count: 1, results: [{ id: 'z', name: 'Trapped Heart', external_collection_number: 6329, price: '10', status: 'listed', attributes: [] }] };
    else if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/rent/gifts/')) body = { cursor: null, items: [{ nft_address: 'EQ_X', nft_name: 'Trapped Heart #6329', price_per_day: '20000000', max_duration: 2592000, min_duration: 86400, attributes: [] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  assert.deepEqual(await app({ action: 'saleDown1', name: 'Trapped Heart #6329' }), { down1: 51000 });
  const r = await app({ action: 'createOrder', service: 'portals', portalsId: 'z', paymentMethod: 'installment', installmentType: 'plan1', months: 6, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.details.downPayment, 51000);
  assert.equal(o.details.estMonthly, Math.ceil(Math.ceil((171700 - 51000) * 1.5) / 6));
});

test("1-tur formulasi: admin tanlagan usul bo'yicha (model + fon eng arzon ijara), Sotuvda uchun sozlamadan", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST', portalsKey: 'portals_K', sale_inst: { enabled: true, max: 1000000 }, sale_down_by: 'model' });
  const rentQ = [];
  setFetch(async (url) => {
    const u = String(url);
    let body = {};
    if (u.includes('portal-market.com')) body = { total_count: 1, results: [{ id: 'z9', name: 'Trapped Heart', external_collection_number: 1, price: '10', status: 'listed', attributes: [{ type: 'model', value: 'Crime Scene' }] }] };
    else if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/rent/gifts/')) {
      rentQ.push(decodeURIComponent(u));
      body = { cursor: null, items: [{ nft_address: 'EQ_A', nft_name: 'Trapped Heart #5', price_per_day: '30000000', max_duration: 2592000, min_duration: 86400, attributes: [] },
        { nft_address: 'EQ_B', nft_name: 'Trapped Heart #7', price_per_day: '20000000', max_duration: 2592000, min_duration: 86400, attributes: [] }] };
    }
    else if (u.includes('/gifts/onsale/')) return { ok: false, status: 402, text: async () => '{}' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Trapped Heart #6329', model: 'Crime Scene', backdrop: 'Persimmon', inst_enabled: true, price_source: 'manual_som', price_manual: 1000000, down_by: 'model_backdrop' });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Trapped Heart #6329');
  assert.equal(p.down_mode, 'model_backdrop');
  assert.equal(p.quote.down1, 51000); // eng arzoni 0.02 TON: (0.02 × 45 + 0.1) × 17 000 × 3
  assert.deepEqual([p.quote.down1By, p.quote.down1Base], ['formula', 'model_backdrop']);
  assert.ok(rentQ.some((q) => q.includes('model=Crime Scene') && q.includes('backdrop=Persimmon')));
  // Sotuvda: sozlamada "model" tanlangan
  rentQ.length = 0;
  assert.deepEqual(await app({ action: 'saleDown1', name: 'Trapped Heart #1', model: 'Crime Scene' }), { down1: 51000 });
  assert.ok(rentQ.some((q) => q.includes('model=Crime Scene') && !q.includes('backdrop=')));
});

test("Portals: 429 bo'lsa narx kolleksiyaga tushmaydi va avvalgisi qoladi; sotuvda yo'q bo'lsa qo'lda narx; so'rovlar orasida 1 soniya", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_K' });
  let mode = 'ok';
  const times = [];
  setFetch(async (url) => {
    const u = String(url);
    times.push(Date.now());
    if (mode === '429' && u.includes('/nfts/search')) return { ok: false, status: 429, text: async () => '{"code":"RATE_LIMITED"}' };
    let body = {};
    if (u.includes('/collections/preview')) body = { collections: [{ id: 'mp', name: 'Mood Pack', short_name: 'moodpack', floor_price: '5.25' }] };
    else if (u.includes('/nfts/search')) body = { results: mode === 'none' ? [] : [{ name: 'Mood Pack', external_collection_number: 76644, price: '10.5', status: 'listed',
      attributes: [{ type: 'model', value: 'Lady Arcana' }, { type: 'backdrop', value: 'Ranger Green' }] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Mood Pack #59717', model: 'Lady Arcana', backdrop: 'Ranger Green', inst_enabled: true, price_source: 'portals_model_backdrop', price_manual: 150000 });
  let p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Mood Pack #59717');
  assert.equal(p.quote.price, 183600); // (10.5 + 0.3) × 17 000
  assert.equal(p.quote.src, 'Portals: Mood Pack #76644');
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000, 'so\'rovlar juda tez: ' + (times[i] - times[i - 1]));
  // 429: narx o'zgarmaydi, kolleksiyaning 5.25 TON iga tushmaydi
  mode = '429';
  await core.run('UPDATE own_products SET mk_checked_at = NULL');
  await core.run("DELETE FROM portals_cache WHERE k LIKE 's:%'");
  p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Mood Pack #59717');
  assert.equal(p.quote.price, 183600);
  // Sotuvda yo'q: qo'lda yozilgan narx
  mode = 'none';
  await core.run('UPDATE own_products SET mk_checked_at = NULL');
  await core.run("DELETE FROM portals_cache WHERE k LIKE 's:%'");
  p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Mood Pack #59717');
  assert.deepEqual([p.quote.price, p.quote.by], [150000, 'fallback_som']);
});

test("Sotuvda katalogi: natija bazada saqlanadi, Portals 429 bersa oxirgi ro'yxat ko'rsatiladi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_K' });
  let n = 0, fail = false;
  setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/nfts/search')) { n++; if (fail) return { ok: false, status: 429, text: async () => '{}' }; }
    const body = u.includes('/collections/preview') ? { collections: [{ id: 'c1', name: 'Artisan Brick', short_name: 'x', floor_price: '3' }] }
      : { total_count: 1, results: [{ id: 'q', name: 'Artisan Brick', external_collection_number: 5, price: '3', status: 'listed', attributes: [] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const a = await app({ action: 'portalsSale', collection: 'Artisan Brick' });
  await app({ action: 'portalsSale', collection: 'Artisan Brick' });
  assert.equal(n, 1, 'ikkinchi marta bazadan olinishi kerak');
  fail = true;
  await core.run("UPDATE portals_cache SET at = 0 WHERE k LIKE 's:list:%'");
  const b = await app({ action: 'portalsSale', collection: 'Artisan Brick' });
  assert.deepEqual(b.items.map((x) => x.id), a.items.map((x) => x.id));
});

test("Gift Satellite: 5 bozor bitta ro'yxatda, mijozga bozor nomi berilmaydi, adminga beriladi; narx manbasi 'barcha bozorlar'", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), satelliteKey: 'Token SECRET_SAT', sale_inst: { enabled: true, max: 200000 } });
  assert.equal((await admin({ action: 'settings' })).satelliteKeySet, true);
  const seen = [];
  const L = (market, slug, price, model = 'Lady Arcana', backdrop = 'Ranger Green') => ({ market, slug, giftId: 'g-' + slug, collectionName: 'MoodPack', modelName: model, backdropName: backdrop, symbolName: 'X', normalizedPrice: price, link: 'https://m.example/' + slug });
  setFetch(async (url, opts) => {
    const u = decodeURIComponent(String(url)); seen.push({ u, auth: opts.headers.Authorization, method: opts.method });
    let body = [];
    if (u.includes('/gift/collections')) body = [{ name: 'MoodPack' }, { name: 'PlushPepe' }];
    else if (u.includes('/search/mrkt/')) body = [L('mrkt', 'MoodPack-76644', 10.2)];
    else if (u.includes('/search/portals/')) body = [L('portals', 'MoodPack-76644', 10.5), L('portals', 'MoodPack-39538', 10.68)];
    else if (u.includes('/search/tg/')) body = [L('telegram', 'MoodPack-5', 30)];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const r = await app({ action: 'portalsSale', collection: 'Mood Pack', model: 'Lady Arcana' });
  assert.deepEqual(r.items.map((x) => [x.name, x.num, x.price]), [['Mood Pack', 76644, Math.ceil(10.3 * 17000)], ['Mood Pack', 39538, Math.ceil(10.78 * 17000)], ['Mood Pack', 5, Math.ceil(30.1 * 17000)]]);
  assert.ok(!JSON.stringify(r).match(/mrkt|portals|tonnel|getgems|m\.example/i), 'mijozga bozor nomi ketmasligi kerak');
  assert.ok(seen.every((x) => x.auth === 'Token SECRET_SAT' && x.method === 'GET'));
  assert.ok(seen.some((x) => x.u.includes('/search/getgems/MoodPack?models=Lady Arcana')));
  assert.ok(!seen.some((x) => /\/user\/buy/.test(x.u)));
  // Faqat bo'lib to'lashga mumkinlari (200 000 gacha)
  assert.equal((await app({ action: 'portalsSale', collection: 'Mood Pack', model: 'Lady Arcana', inst: true })).items.length, 2);
  // Buyurtma: adminga bozor nomi va havola
  await topup(200000);
  sent.length = 0;
  const o = await app({ action: 'createOrder', service: 'portals', portalsId: r.items[0].id, expectedPrice: r.items[0].price, paymentMethod: 'cash', idempotencyKey: key() });
  const msg = sent.map((m) => m.params.text || '').join('\n');
  assert.match(msg, /MRKT'dagi giftni sotib olish/);
  assert.match(msg, /Havola: https:\/\/m\.example\/MoodPack-76644/);
  assert.ok(!/MRKT/i.test((await app({ action: 'myOrders' })).orders.find((x) => x.publicId === o.publicId).title));
  // O'z mahsuloti: "barcha bozorlar: model + fon"
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Mood Pack #59717', model: 'Lady Arcana', backdrop: 'Ranger Green', inst_enabled: true, price_source: 'sat_model_backdrop' });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Mood Pack #59717');
  assert.deepEqual([p.quote.price, p.quote.by, p.quote.src], [Math.ceil(10.5 * 17000), 'sat_model_backdrop', 'MRKT: Mood Pack #76644']);
});

test("Gift Satellite: kolleksiya nomi probelsiz yuboriladi; javob bo'lmasa Portals'dan; navbat (takeLock) qayta o'qib tekshiradi", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), satelliteKey: 'K', portalsKey: 'portals_K' });
  const urls = [];
  let satDown = false;
  setFetch(async (url) => {
    const u = decodeURIComponent(String(url)); urls.push(u);
    let body = [];
    if (u.includes('gift-satellite.dev')) {
      if (satDown && u.includes('/search/')) return { ok: false, status: 503, text: async () => '{}' };
      if (u.includes('/gift/collections')) body = [{ name: 'Balls Ice Cream' }];
      else if (u.includes('/search/')) body = /\/search\/[a-z]+\/BallsIceCream/.test(u) ? [{ market: 'mrkt', slug: 'BallsIceCream-7', giftId: 'g7', collectionName: 'BallsIceCream', modelName: 'M', backdropName: 'B', normalizedPrice: 3 }] : null;
    } else if (u.includes('/collections/preview')) body = { collections: [{ id: 'bic', name: 'Balls Ice Cream', short_name: 'x', floor_price: '2' }] };
    else if (u.includes('/nfts/search')) body = { total_count: 1, results: [{ id: 'p9', name: 'Balls Ice Cream', external_collection_number: 9, price: '2.5', status: 'listed', attributes: [] }] };
    if (body === null) return { ok: false, status: 400, text: async () => '{"message":"Неверный формат коллекции"}' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const a = await app({ action: 'portalsSale', collection: 'Balls Ice Cream' });
  assert.deepEqual(a.items.map((x) => x.num), [7]);
  assert.ok(urls.some((u) => u.includes('/search/getgems/BallsIceCream')));
  // Gift Satellite ishlamasa — Portals
  satDown = true;
  await core.run("DELETE FROM portals_cache WHERE k LIKE 'gs:s:%'");
  const b = await app({ action: 'portalsSale', collection: 'Balls Ice Cream' });
  assert.deepEqual(b.items.map((x) => x.num), [9]);
  // Navbat: birinchisi oladi, darhol ikkinchisi ololmaydi, vaqt o'tgach yana oladi
  assert.equal(await core.takeLock('test_lock', 60000), true);
  assert.equal(await core.takeLock('test_lock', 60000), false);
  await core.run("UPDATE meta SET value = '1000.5' WHERE key = 'test_lock'");
  assert.equal(await core.takeLock('test_lock', 60000), true);
});

test("O'z giftining ijarasi avtomatik: Marketapp'dagi model + fon eng arzon ijarasidan, (P + 0.15) × 3 × 19 000", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), marketappToken: 'TEST' });
  const rq = [];
  setFetch(async (url) => {
    const u = decodeURIComponent(String(url));
    let body = {};
    if (u.includes('/collections/gifts/')) body = [{ name: 'Trapped Heart', address: 'EQ_COLLECTION_TRAPPED_HEART_01', extra_data: {} }];
    else if (u.includes('/rent/gifts/')) { rq.push(u); body = { cursor: null, items: [
      { nft_address: 'EQ_R1', nft_name: 'Trapped Heart #11', price_per_day: '30000000', max_duration: 2592000, min_duration: 86400, attributes: [] },
      { nft_address: 'EQ_R2', nft_name: 'Trapped Heart #12', price_per_day: '20000000', max_duration: 2592000, min_duration: 86400, attributes: [] }] }; }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Trapped Heart #19604', model: 'Crime Scene', backdrop: 'Persimmon', rent_enabled: true, rent_by: 'model_backdrop', rent_min: 1, rent_max: 30, price_source: 'manual_som' });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Trapped Heart #19604');
  assert.ok(rq.some((q) => q.includes('model=Crime Scene') && q.includes('backdrop=Persimmon')));
  assert.equal(p.rentAuto.day1, 9690);           // (0.02 + 0.15) × 3 × 19 000
  assert.equal(p.rentAuto.perDay, Math.ceil(42750 / 30)); // 30 kun: (0.6 + 0.15) × 3 × 19 000 = 42 750
  const own = (await app({ action: 'ownList', category: 'gifts' })).find((x) => x.id === p.id);
  assert.deepEqual([own.rent.pricePerDayNano, own.rent.formula.mult], ['20000000', 3]);
  await topup(50000);
  const r = await app({ action: 'createOrder', service: 'own', ownId: p.id, ownMode: 'rent', days: 30, paymentMethod: 'cash', idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(Number(o.price), 42750);
});

test("Lizing: ustama 0%, boshlang'ich to'lov ixtiyoriy; o'z gifti va bozor gifti uchun", async () => {
  await withPhone();
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), portalsKey: 'portals_K', sale_inst: { enabled: true, max: 1000000 } });
  setFetch(async (url) => {
    const u = String(url);
    const body = u.includes('/collections/preview') ? { collections: [{ id: 'c', name: 'Trapped Heart', short_name: 'x', floor_price: '9' }] }
      : { total_count: 1, results: [{ id: 'L1', name: 'Trapped Heart', external_collection_number: 5, price: '10', status: 'listed', attributes: [] }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  // Bozor gifti: 10 TON -> (10 + 0.1) × 17 000 = 171 700; 24 oy, boshlang'ich 21 700 -> 150 000 × (1 + 24×100%/12) / 24 = 18 750 (lizing ustamasi 100%/yil)
  const r = await app({ action: 'createOrder', service: 'portals', portalsId: 'L1', paymentMethod: 'installment', installmentType: 'lease', months: 24, downPayment: 21700, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.installment_type, 'lease');
  assert.deepEqual([o.details.downPayment, o.details.estMonthly], [21700, 18750]);
  // O'z gifti: boshlang'ich to'lovsiz, 240 oy
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Diamond Ring #1250', inst_enabled: true, price_source: 'manual_som', price_manual: 765340 });
  const own = (await app({ action: 'ownList', category: 'gifts' })).find((x) => x.name === 'Diamond Ring #1250');
  const r2 = await app({ action: 'createOrder', service: 'own', ownId: own.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'lease', months: 240, downPayment: 0, idempotencyKey: key() });
  const o2 = (await admin({ action: 'orders', search: r2.publicId }))[0];
  assert.equal(o2.details.estMonthly, Math.ceil(Math.ceil(765340 * 21) / 240));
  sent.length = 0;
});

test("Pul olish (gift sotilmaydi): havola + summa + muddat, oylik lizing ustamasi bilan, adminga ariza", async () => {
  await withPhone();
  setFetch(async () => ({ ok: true, status: 200, text: async () => '<table><tr><th>Model</th><td>Bow Wizzle</td></tr><tr><th>Backdrop</th><td>Gunmetal</td></tr></table>' }));
  await assert.rejects(app({ action: 'createOrder', service: 'cashout', giftLink: 'https://example.com', amount: 800000, months: 12, paymentMethod: 'installment', idempotencyKey: key() }), /BAD_LINK/);
  const r = await app({ action: 'createOrder', service: 'cashout', giftLink: 'https://t.me/nft/SnoopDogg-1203', amount: 800000, months: 12, paymentMethod: 'installment', idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.installment_type, 'cashout');
  assert.equal(o.title, 'Snoop Dogg #1203 — pul olish');
  // 800 000 × (1 + 12 × 100%/12) / 12 = 133 334
  assert.deepEqual([o.details.amount, o.details.model, o.details.estMonthly, o.details.downPayment], [800000, 'Bow Wizzle', 133334, 0]);
  const st = await admin({ action: 'settings' });
  await admin({ action: 'saveSettings', ...st, services_enabled: { ...st.services_enabled, cashout: false } });
  await assert.rejects(app({ action: 'createOrder', service: 'cashout', giftLink: 'https://t.me/nft/SnoopDogg-1203', amount: 800000, months: 12, paymentMethod: 'installment', idempotencyKey: key() }), /SERVICE_DISABLED/);
  await admin({ action: 'saveSettings', ...st });
});

test("Narx: model + fon birgalikda qidiriladi, aynan mosi olinadi; bozor javob bermasa arzonroqqa tushmaydi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), satelliteKey: 'K' });
  await core.run("DELETE FROM portals_cache WHERE k LIKE 'gs:%'");
  let mrktDown = false;
  setFetch(async (url) => {
    const u = decodeURIComponent(String(url));
    let body = [];
    if (u.includes('/gift/collections')) body = [{ name: 'JingleBells' }];
    else if (u.includes('/search/')) {
      if (mrktDown && u.includes('/search/mrkt/')) return { ok: false, status: 503, text: async () => '{}' };
      const both = u.includes('models=') && u.includes('backdrops=');
      const L = (m, slug, model, bd, ton) => ({ market: m, slug, giftId: slug, collectionName: 'JingleBells', modelName: model, backdropName: bd, normalizedPrice: ton });
      if (u.includes('/search/portals/') && u.includes('models=Polynesia') && !both) body = [L('portals', 'JingleBells-91329', 'Polynesia', 'Black', 12.9)];
      // birlashgan filtr MRKT'da natija bermaydi, faqat model bo'yicha esa aynan shu fon bor
      if (u.includes('/search/mrkt/') && u.includes('models=Polynesia')) body = [L('mrkt', 'JingleBells-10665', 'Polynesia', 'Onyx Black', 30.6)];
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const r = await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Jingle Bells #89238', model: 'Polynesia', backdrop: 'Onyx Black', inst_enabled: true, price_source: 'sat_model_backdrop' });
  const id = r.id ?? (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Jingle Bells #89238').id;
  const q = await admin({ action: 'refreshOwnPrice', id, debug: true });
  assert.ok(q.debug.some((x) => /MRKT · model \+ fon: 1 ta, aynan mos: 30.6 TON/.test(x)));
  assert.equal(q.marketPriceTon, 30.6);
  assert.equal(q.by, 'sat_model_backdrop');
  // MRKT javob bermasa: model + fon "topilmadi" deyilmaydi, narx o'zgarmaydi (12.9 ga tushmaydi)
  mrktDown = true;
  await core.run("DELETE FROM portals_cache WHERE k LIKE 'gs:s:%'");
  const q2 = await admin({ action: 'refreshOwnPrice', id });
  assert.equal(q2.marketPriceTon, 30.6);
});

test("Gift Satellite: yangi kolleksiya probel bilan ('Jingle Bells') — probelsiz 400 bersa probel bilan qayta so'raladi; Getgems 404 natijani buzmaydi", async () => {
  await admin({ action: 'saveSettings', ...(await admin({ action: 'settings' })), satelliteKey: 'K' });
  await core.run("DELETE FROM portals_cache WHERE k LIKE 'gs:%'");
  const urls = [];
  setFetch(async (url) => {
    const u = decodeURIComponent(String(url)); urls.push(u);
    if (u.includes('/gift/collections')) return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'Jingle Bells' }]) };
    if (u.includes('/search/getgems/')) return { ok: false, status: 404, text: async () => '{"message":"Route GET:/search/getgems/x not found"}' };
    if (u.includes('/search/') && u.includes('/JingleBells')) return { ok: false, status: 400, text: async () => '{"message":"Неверный формат коллекции"}' };
    const body = u.includes('/search/tonnel/Jingle Bells') ? [{ market: 'tonnel', slug: 'JingleBells-58498', giftId: 'x', collectionName: 'Jingle Bells', modelName: 'Pinky', backdropName: 'Onyx Black', normalizedPrice: 24.11 }] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const r = await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Jingle Bells #89238', model: 'Polynesia', backdrop: 'Onyx Black', inst_enabled: true, price_source: 'sat_backdrop' });
  const id = r.id ?? (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Jingle Bells #89238').id;
  const q = await admin({ action: 'refreshOwnPrice', id });
  assert.equal(q.marketPriceTon, 24.11);
  assert.ok(urls.some((u) => u.includes('/search/tonnel/Jingle Bells?')));
});

test("To'liq jadval: foydalar, kredit, qolgan qarz, gift olib kelgan hamma pul", async () => {
  const r = await admin({ action: 'saveInstallment', legacy: true, productName: 'Report Gift #1', clientName: 'Ali', clientUsername: 'ali_r', clientPhone: '998901234567',
    installmentType: 'lease', totalPrice: 2400000, downPayment: 400000, monthlyPayment: 200000, startDate: '2026-01-10', finalDate: '2026-11-10',
    alreadyPaid: 600000, boughtAt: '2025-12-20', boughtPrice: 1000000, cashPrice: 1500000, monthlyProfit: 50000 });
  const row = (await admin({ action: 'installmentReport' })).find((x) => x.id === r.id);
  assert.deepEqual([row.boughtPrice, row.cashPrice, row.profitCash, row.profitInst, row.profitTotal, row.down, row.credit, row.paid, row.debt, row.months, row.monthsLeft, row.monthlyProfit, row.finalDate, row.soldAt, row.username],
    [1000000, 1500000, 500000, 900000, 1400000, 400000, 2000000, 1000000, 1400000, 10, 7, 50000, '10.11.2026', '10.01.2026', '@ali_r']);
  assert.equal(row.allIncome, 1000000);
});

test("Qilingan daromad: bizning gift lizingga sotilib, mijoz to'lamay qo'ysa ham to'langani kiradi", async () => {
  await withPhone();
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Income Gift #5', inst_enabled: true, price_source: 'manual_som', price_manual: 1000000, bought_at: '2026-01-01', bought_price: 600000 });
  const own = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Income Gift #5');
  assert.equal(own.bought_price, 600000);
  const r = await app({ action: 'createOrder', service: 'own', ownId: own.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'lease', months: 10, downPayment: 100000, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  await admin({ action: 'saveInstallment', orderId: o.id, productName: o.title, installmentType: 'lease', totalPrice: 1500000, downPayment: 100000, monthlyPayment: 140000, startDate: '2026-02-01', finalDate: '2026-12-01' });
  const ag = (await admin({ action: 'installments', status: 'active' })).find((a) => a.order_id === o.id);
  await admin({ action: 'addInstallmentPayment', id: ag.id, amount: 140000, idempotencyKey: key() });
  const own2 = (await admin({ action: 'ownProducts' })).find((x) => x.id === own.id);
  assert.equal(own2.earned, 240000);
  const row = (await admin({ action: 'installmentReport' })).find((x) => x.id === ag.id);
  assert.deepEqual([row.boughtPrice, row.cashPrice, row.allIncome], [600000, 1000000, 240000]);
});

test("Test ma'lumotlarini o'chirish: to'lov, shartnoma, buyurtma; summalarni 0 qilish", async () => {
  await withPhone();
  const r = await admin({ action: 'saveInstallment', legacy: true, productName: 'Del Gift #1', installmentType: 'lease', totalPrice: 1000000, downPayment: 100000, monthlyPayment: 100000, startDate: '2026-01-01', finalDate: '2026-10-01', alreadyPaid: 300000 });
  const before = (await admin({ action: 'stats' })).revenue;
  const pays = await admin({ action: 'installmentPayments', id: r.id });
  await admin({ action: 'deleteInstPayment', id: pays[0].id });
  assert.equal((await admin({ action: 'installmentPayments', id: r.id })).length, 0);
  assert.equal((await admin({ action: 'stats' })).revenue, before - 300000);
  await admin({ action: 'deleteAgreement', id: r.id });
  assert.ok(!(await admin({ action: 'installments' })).some((a) => a.id === r.id));
  const o = await app({ action: 'createOrder', service: 'cashout', giftLink: 'https://t.me/nft/SnoopDogg-1', amount: 100000, months: 3, paymentMethod: 'installment', idempotencyKey: key() });
  const ord = (await admin({ action: 'orders', search: o.publicId }))[0];
  await admin({ action: 'deleteOrder', id: ord.id });
  assert.equal((await admin({ action: 'orders', search: o.publicId })).length, 0);
  await admin({ action: 'resetStats' });
  const s = await admin({ action: 'stats' });
  assert.deepEqual([s.revenue, s.installments.collected], [0, 0]);
});

test("Bir nechta / hammasini o'chirish: buyurtmalar (navbatdagisi bekor qilinib, pul qaytadi), shartnomalar, to'lovlar", async () => {
  await withPhone(); await topup(100000);
  const a = await app({ action: 'createOrder', service: 'stars', quantity: 50, recipient: { self: true }, paymentMethod: 'cash', idempotencyKey: key() });
  const b = await app({ action: 'createOrder', service: 'cashout', giftLink: 'https://t.me/nft/SnoopDogg-2', amount: 100000, months: 3, paymentMethod: 'installment', idempotencyKey: key() });
  const ids = [];
  for (const p of [a.publicId, b.publicId]) ids.push((await admin({ action: 'orders', search: p }))[0].id);
  const r = await admin({ action: 'deleteOrders', ids });
  assert.deepEqual([r.done, r.skipped.length], [2, 0]);
  const ag1 = await admin({ action: 'saveInstallment', legacy: true, productName: 'B1', totalPrice: 100000, monthlyPayment: 10000, startDate: '2026-01-01', finalDate: '2026-10-01', alreadyPaid: 20000 });
  const ag2 = await admin({ action: 'saveInstallment', legacy: true, productName: 'B2', totalPrice: 100000, monthlyPayment: 10000, startDate: '2026-01-01', finalDate: '2026-10-01' });
  await admin({ action: 'addInstallmentPayment', id: ag2.id, amount: 5000, idempotencyKey: key() });
  assert.equal((await admin({ action: 'deleteAllInstPayments', id: ag2.id })).done, 1);
  assert.equal((await admin({ action: 'deleteAgreements', ids: [ag1.id, ag2.id] })).done, 2);
});

test("Botdan oldingi daromad umumiy daromadga qo'shiladi", async () => {
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Before Gift #9', inst_enabled: true, price_source: 'manual_som', price_manual: 300000, bought_price: 290000, earned_before: 45000 });
  const p = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Before Gift #9');
  assert.deepEqual([p.earned, p.earned_before, p.bought_price - p.earned], [45000, 45000, 245000]);
});

test("Narxlar navbatma-navbat avtomatik: eng eski bitta gift, 4 daqiqada bir marta", async () => {
  const { maybeRefreshPrice } = await import('../tgcloud/lib/jobs.js');
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Auto Gift #1', inst_enabled: true, price_source: 'manual_som', price_manual: 100000 });
  const id = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Auto Gift #1').id;
  await core.run("DELETE FROM meta WHERE key = 'price_tick'");
  await core.run("UPDATE own_products SET mk_checked_at = :t", { t: Date.now() });
  await core.run('UPDATE own_products SET mk_checked_at = 5 WHERE id = :id', { id });
  assert.equal(await maybeRefreshPrice(), id);
  assert.equal(await maybeRefreshPrice(), null); // 4 daqiqa o'tmagan
});

test("Bir nechta giftni birga lizingga olish: narxlar qo'shiladi, bitta buyurtma", async () => {
  await withPhone();
  for (const [n, pr] of [['Multi A #1', 100000], ['Multi B #2', 200000]]) await admin({ action: 'saveOwnProduct', kind: 'gifts', name: n, inst_enabled: true, price_source: 'manual_som', price_manual: pr });
  const own = await admin({ action: 'ownProducts' });
  const ids = ['Multi A #1', 'Multi B #2'].map((n) => own.find((x) => x.name === n).id);
  await assert.rejects(app({ action: 'createOrder', service: 'own_multi', ownIds: [ids[0]], paymentMethod: 'installment', installmentType: 'lease', months: 12, idempotencyKey: key() }), /VALIDATION/);
  sent.length = 0;
  const r = await app({ action: 'createOrder', service: 'own_multi', ownIds: ids, expectedTotal: 300000, paymentMethod: 'installment', installmentType: 'lease', months: 12, downPayment: 0, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.equal(o.title, '2 ta gift — sotib olish');
  assert.deepEqual([o.details.estPrice, o.details.multi.length], [300000, 2]);
  assert.match(sent.map((m) => m.params.text || m.params.caption || '').join('\n'), /Giftlar \(2 ta\)[\s\S]*Jami: 300 000/);
});

test("Lizingda ham tur: 1-tur boshlang'ich to'lovi belgilangan, Uzum yo'q", async () => {
  await withPhone();
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Lease Type #1', inst_enabled: true, price_source: 'manual_som', price_manual: 1200000, down_manual: 200000 });
  const own = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Lease Type #1');
  const r = await app({ action: 'createOrder', service: 'own', ownId: own.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'lease', leaseType: 'plan1', months: 10, downPayment: 0, idempotencyKey: key() });
  const o = (await admin({ action: 'orders', search: r.publicId }))[0];
  assert.deepEqual([o.installment_type, o.details.leaseType, o.details.downPayment], ['lease', 'plan1', 200000]);
  const r2 = await app({ action: 'createOrder', service: 'own', ownId: own.id, ownMode: 'buy', paymentMethod: 'installment', installmentType: 'lease', leaseType: 'uzum', months: 10, idempotencyKey: key() });
  assert.equal((await admin({ action: 'orders', search: r2.publicId }))[0].details.leaseType, undefined); // lizingda Uzum yo'q
});

test("1-tur: o'z usulida topilmasa, giftning ijara narxidan (masalan fon bo'yicha) hisoblanadi", async () => {
  await admin({ action: 'saveOwnProduct', kind: 'gifts', name: 'Down Rent #1', inst_enabled: true, price_source: 'manual_som', price_manual: 500000 });
  const id = (await admin({ action: 'ownProducts' })).find((x) => x.name === 'Down Rent #1').id;
  await core.run("UPDATE own_products SET rent_ppd_nano = '100000000', mk_ppd_nano = NULL, mk_checked_at = :t WHERE id = :id", { id, t: Date.now() });
  const own = (await app({ action: 'ownList', category: 'gifts' })).find((x) => x.name === 'Down Rent #1');
  assert.ok(own.down1 > 0);
});
