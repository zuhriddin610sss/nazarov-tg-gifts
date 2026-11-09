// Telegram xabarnomalari (admin va mijozlarga). Har bir xabar bir marta yuboriladi (claim).
import { api } from 'sdk';
import { get, claim, logError, adminIds, getSettings, fmt } from './core.js';
import { queuePosition } from './shop.js';
import { t, money } from './texts.js';
import { MINI_APP_URL } from './config.js';

const SERVICE = { nft_gift: "NFT sovg'a", gift_rent: "NFT sovg'a ijarasi", username_rent: 'Username ijarasi', number_rent: 'Anonim raqam ijarasi', premium: 'Telegram Premium', stars: 'Telegram Stars' };
const ITYPE = { plan1: '1-tur', plan2: "Boshlang'ich to'lovsiz", uzum: 'Uzum Nasiya' };

async function send(chatId, text, extra = {}) {
  try { return await api.sendMessage({ chat_id: chatId, text, ...extra }); }
  catch (e) { await logError('bot.send', `${chatId}: ${e && (e.description || e.message)}`); return null; }
}
const tashkent = (ms) => {
  const d = new Date(Number(ms) + 5 * 3_600_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};
export const adminPanelButton = () => (MINI_APP_URL ? { inline_keyboard: [[{ text: 'Admin panel', web_app: { url: MINI_APP_URL + 'admin.html' } }]] } : undefined);
export const openAppButton = (text, hash = '') => (MINI_APP_URL ? { inline_keyboard: [[{ text, web_app: { url: MINI_APP_URL + (hash ? '#' + hash : '') } }]] } : undefined);
const adminLinkButton = (contact, text) => {
  const u = String(contact || '').replace(/^@/, '');
  return u ? { inline_keyboard: [[{ text, url: `https://t.me/${u}` }]] } : undefined;
};

export async function notifyNewOrder(orderId) {
  if (!(await claim(`order:${orderId}:new`))) return;
  const o = await get('SELECT o.*, c.telegram_id, c.lang FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = :id', { id: orderId });
  if (!o) return;
  const pos = await queuePosition(orderId);
  const det = JSON.parse(o.details || '{}');
  const lines = [
    `🆕 Yangi buyurtma ${o.public_id}`,
    `Navbat: #${String(pos || '-').padStart(2, '0')}`,
    `Mijoz: ${o.customer_username ? '@' + o.customer_username : "(username yo'q)"} · ${o.customer_phone || '-'}`,
    `Xizmat: ${SERVICE[o.service] || o.service}`,
    `Mahsulot: ${o.title}`,
    o.recipient ? `Qabul qiluvchi: @${o.recipient}` : null,
    det.model || det.backdrop ? `Model: ${det.model === 'any' ? "Farqi yo'q" : det.model} · Fon: ${det.backdrop === 'any' ? "Farqi yo'q" : det.backdrop}` : null,
    det.link ? `Havola: ${det.link}` : null,
    `To'lov: ${o.payment_method === 'cash' ? 'Naqd (balansdan yechildi)' : "Bo'lib to'lash" + (o.installment_type ? ' — ' + (ITYPE[o.installment_type] || o.installment_type) : '')}`,
    `Narx: ${o.price != null ? fmt(o.price) : 'admin belgilaydi'}${o.discount > 0 ? ` (promo ${o.promo_code}: −${fmt(o.discount)})` : ''}`,
    o.cost != null ? `Tannarx: ${fmt(o.cost)}` : null,
    det.quotedPrice ? `Formula bo'yicha narx: ${fmt(det.quotedPrice)}` : null,
    `Sana: ${tashkent(o.created_at)}`,
  ].filter(Boolean).join('\n');
  for (const id of adminIds()) {
    await send(id, lines, { reply_markup: adminPanelButton() });
    if (det.image) {
      try { await api.sendPhoto({ chat_id: id, photo: det.image, caption: o.public_id }); }
      catch (e) { await logError('bot.photo', e && (e.description || e.message)); }
    }
  }
  const s = await getSettings();
  const inst = o.payment_method === 'installment';
  const text = t(o.lang, 'order_created', { id: o.public_id, title: o.title }) + (inst ? '\n\n' + t(o.lang, 'order_inst_hint') : '');
  await send(o.telegram_id, text, inst ? { reply_markup: adminLinkButton(s.admin_contact, t(o.lang, 'write_admin')) } : {});
}

export async function notifyOrderClosed(orderId, status, refunded) {
  if (!(await claim(`order:${orderId}:${status}`))) return;
  const o = await get('SELECT o.public_id, c.telegram_id, c.lang FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = :id', { id: orderId });
  if (!o) return;
  let text = t(o.lang, status === 'completed' ? 'order_completed' : 'order_cancelled', { id: o.public_id });
  if (refunded > 0) text += '\n' + t(o.lang, 'refunded', { a: money(refunded / 100) });
  await send(o.telegram_id, text);
}

export function receiptButtons(id) {
  return { inline_keyboard: [[{ text: '✅ Tasdiqlash', callback_data: `rc:ok:${id}` }, { text: '❌ Rad etish', callback_data: `rc:no:${id}` }]] };
}
export async function notifyReceiptReviewed(receiptId, ok) {
  if (!(await claim(`receipt:${receiptId}:${ok ? 'ok' : 'no'}`))) return;
  const r = await get('SELECT r.amount, c.telegram_id, c.lang, c.balance FROM receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = :id', { id: receiptId });
  if (!r) return;
  await send(r.telegram_id, ok ? t(r.lang, 'receipt_ok', { a: money(r.amount / 100), b: money(r.balance / 100) }) : t(r.lang, 'receipt_no'));
}

export { send, tashkent };
