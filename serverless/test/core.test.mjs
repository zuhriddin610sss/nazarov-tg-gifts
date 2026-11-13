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
