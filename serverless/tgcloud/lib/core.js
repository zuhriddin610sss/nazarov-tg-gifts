// Umumiy yordamchilar: baza, sxema, xatolar, sozlamalar, jurnallar.
import { db, EndpointError } from 'sdk';
import { DDL, SCHEMA_VERSION } from 'lib/ddl';
import { ADMIN_IDS } from 'lib/config';

// ---------- baza ----------
/** {id: 5} -> {':id': 5}; boolean -> 0/1; obyekt -> JSON */
function bind(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    out[':' + k] = v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0)
      : v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}
export const all = (q, p) => db.all(q, bind(p));
export const get = (q, p) => db.get(q, bind(p));
export const run = (q, p) => db.run(q, bind(p));

export const nowMs = () => Date.now();

let ready = false;
/** Faqat testlar uchun: yangi bazada sxemani qayta tekshirish. */
export function __resetForTests() { ready = false; }
/** Sxemani bir marta (har bir ishga tushishda) tekshiradi va kerak bo'lsa yaratadi. */
export async function ensureSchema() {
  if (ready) return;
  const hasMeta = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  if (!hasMeta) await db.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  const v = await db.get("SELECT value FROM meta WHERE key = 'schema'");
  if (!v || Number(v.value) < SCHEMA_VERSION) {
    // Mavjud jadval/indeks/triggerlar qayta yaratilmaydi: "IF NOT EXISTS" bo'lsa ham
    // Serverless bunday so'rovni "o'qish" deb hisoblab, db.run'da xato beradi.
    const have = new Set((await db.all('SELECT name FROM sqlite_master')).map((r) => r.name));
    for (const stmt of DDL) {
      const m = /IF NOT EXISTS\s+(\w+)/i.exec(stmt);
      if (m && have.has(m[1])) continue;
      await db.run(stmt);
    }
    await db.run("INSERT INTO meta (key, value) VALUES ('schema', :v) ON CONFLICT (key) DO UPDATE SET value = excluded.value", { ':v': String(SCHEMA_VERSION) });
  }
  ready = true;
}

// ---------- xatolar ----------
/** Mijozga boradigan xato: kod `parameters.code` da. */
export function fail(code, extra = {}) {
  return new EndpointError(code, { code, ...extra });
}
/** SQLite xatosidan bizning kodni ajratib oladi (RAISE yoki UNIQUE/CHECK). */
export function dbCode(e) {
  const m = String(e && (e.message || e.description || e));
  const known = ['INSUFFICIENT_BALANCE', 'CUSTOMER_NOT_FOUND', 'ORDER_STATE', 'ORDER_ALREADY_CLOSED', 'RECEIPT_ALREADY_REVIEWED', 'AGREEMENT_NOT_FOUND', 'BAD_SIGN'];
  for (const k of known) if (m.includes(k)) return k;
  if (m.includes('UNIQUE')) return 'UNIQUE';
  if (m.includes('CHECK constraint')) return 'CHECK';
  return null;
}

export async function logError(source, message, data) {
  try { await run('INSERT INTO errors (source, message, data) VALUES (:s, :m, :d)', { s: source, m: String(message).slice(0, 2000), d: data ?? null }); }
  catch (e) { console.error('errors jadvaliga yozilmadi', e); }
  console.error(`[${source}]`, message);
}
export async function audit(actor, action, target, data) {
  await run('INSERT INTO audit (actor, action, target, data) VALUES (:a, :b, :t, :d)', { a: actor, b: action, t: target ?? null, d: data ?? null });
}
/** Xabar bir marta yuborilishi uchun: kalit birinchi marta yozilsa true. */
export async function claim(key) {
  const r = await run('INSERT INTO notif (key) VALUES (:k) ON CONFLICT (key) DO NOTHING', { k: key });
  return r.rowsAffected === 1;
}

// ---------- pul ----------
/** So'm (raqam) -> tiyin (butun). Faqat 2 xonagacha aniqlik. */
export const toTiyin = (som) => Math.round(Number(som) * 100);
export const toSom = (tiyin) => (tiyin == null ? null : Number(tiyin) / 100);
/** 1234567.5 -> "1 234 567,5" (Intl ga bog'lanmasdan) */
export function groupNum(som) {
  const neg = som < 0; const x = Math.abs(Math.round(som * 100) / 100);
  const [i, f] = x.toFixed(2).split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = f === '00' ? '' : ',' + f.replace(/0$/, '');
  return (neg ? '-' : '') + g + frac;
}
export const fmt = (tiyin) => groupNum(toSom(tiyin)) + " so'm";

// ---------- sozlamalar ----------
export const DEFAULT_SETTINGS = {
  card_number: '',
  card_holder: 'Nazarov Z',
  payment_warning: {
    uz: "CLICK (Click ilovasi, Click bot va boshqa Click), ALIF, PAYME va 3-shaxsdan pul qabul qilinmaydi!!! Tashlangan pul qaytarilmaydi.",
    ru: 'Переводы через CLICK (приложение Click, Click-бот и другие сервисы Click), ALIF, PAYME и от третьих лиц не принимаются!!! Отправленные деньги не возвращаются.',
    en: 'Payments via CLICK (Click app, Click bot or any other Click service), ALIF, PAYME or from third parties are not accepted!!! Money sent this way is not refunded.',
    zh: '不接受通过 CLICK（Click 应用、Click 机器人及其他 Click 服务）、ALIF、PAYME 或第三方的付款！！！已转出的款项不予退还。',
  },
  admin_contact: '',
  stars_price: 240,
  stars_min: 50,
  premium_prices: { m1: 42000, m3: 171600, m6: 231000, m12_login: 297000, m12: 418000 },
  rent_formula: { add: 0.15, mult: 2, rate: 19000 },
  services_enabled: { nft_gift: true, gift_rent: true, username_rent: true, number_rent: true, premium: true, stars: true },
  mini_app_url: '',
};

export async function getSettings() {
  const row = await get("SELECT value FROM settings WHERE key = 'main'");
  let saved = {};
  try { saved = row ? JSON.parse(row.value) : {}; } catch (e) {}
  const s = { ...DEFAULT_SETTINGS, ...saved };
  for (const k of ['payment_warning', 'premium_prices', 'rent_formula', 'services_enabled']) s[k] = { ...DEFAULT_SETTINGS[k], ...(saved[k] || {}) };
  return s;
}
export async function saveSettings(s) {
  await run("INSERT INTO settings (key, value) VALUES ('main', :v) ON CONFLICT (key) DO UPDATE SET value = excluded.value", { v: JSON.stringify(s) });
}
/** Maxfiy qiymatlar (masalan Marketapp tokeni): alohida saqlanadi, mijozga hech qachon qaytarilmaydi. */
export async function getSecret(name) {
  const r = await get('SELECT value FROM settings WHERE key = :k', { k: 'secret:' + name });
  return r ? r.value : '';
}
export async function setSecret(name, value) {
  await run('INSERT INTO settings (key, value) VALUES (:k, :v) ON CONFLICT (key) DO UPDATE SET value = excluded.value', { k: 'secret:' + name, v: value });
}

export const isAdmin = (tgId) => ADMIN_IDS.includes(Number(tgId));
export const adminIds = () => ADMIN_IDS.slice();

// ---------- tekshiruvlar ----------
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
export const cleanUser = (s) => String(s || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
export function str(v, max, { required = false, name = 'value' } = {}) {
  if (v == null || v === '') { if (required) throw fail('VALIDATION', { field: name }); return null; }
  const s = String(v).trim();
  if (s.length > max) throw fail('VALIDATION', { field: name });
  return s;
}
export function int(v, { min = -Infinity, max = Infinity, name = 'value' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw fail('VALIDATION', { field: name });
  return n;
}
export function num(v, { min = -Infinity, max = Infinity, name = 'value' } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw fail('VALIDATION', { field: name });
  return n;
}
export const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
export function idemKey(v) {
  if (!KEY_RE.test(String(v || ''))) throw fail('VALIDATION', { field: 'idempotencyKey' });
  return String(v);
}
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newPublicId() {
  const b = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 6; i++) b[i] = Math.floor(Math.random() * 256);
  let s = 'NG-';
  for (const x of b) s += ALPHABET[x % ALPHABET.length];
  return s;
}
