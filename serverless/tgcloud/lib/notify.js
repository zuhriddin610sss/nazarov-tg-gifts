// Telegram xabarnomalari (admin va mijozlarga). Har bir xabar bir marta yuboriladi (claim).
import { api } from 'sdk';
import { get, claim, logError, adminIds, getSettings, fmt } from 'lib/core';
import { queuePosition } from 'lib/shop';
import { t, money } from 'lib/texts';
import { MINI_APP_URL } from 'lib/config';

const SERVICE = { nft_gift: "NFT gift", gift_rent: "NFT gift ijarasi", username_rent: 'Username ijarasi', number_rent: 'Anonim raqam ijarasi', premium: 'Telegram Premium', stars: 'Telegram Stars' };
const ITYPE = { cashout: 'Pul olish (gift qiymatidan)', lease: 'Lizing', plan1: '1-tur', plan2: "Boshlang'ich to'lovsiz", uzum: 'Uzum Nasiya' };

async function send(chatId, text, extra = {}) {
  try { return await api.sendMessage({ chat_id: chatId, text, ...extra }); }
  catch (e) { await logError('bot.send', `${chatId}: ${e && (e.description || e.message)}`); return null; }
}
const tashkent = (ms) => {
  const d = new Date(Number(ms) + 5 * 3600000);
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
    det.contact ? `📞 Bog'lanish uchun: ${det.contact.username ? '@' + det.contact.username : '-'} · ${det.contact.phone || '-'}` : null,
    `Yozgan akkaunt: ${o.customer_username ? '@' + o.customer_username : "(username yo'q)"} · ${o.customer_phone || '-'}`,
    det.cashout ? `💵 PUL OLISH: mijoz giftini sotmasdan ${money(det.amount)} so'm so'rayapti. Giftni tekshiring, summani tasdiqlang, pulni bering va admin panelda "Pul berildi — shartnoma" tugmasini bosing.` : null,
    det.cashout ? null : `Xizmat: ${det.market ? `${det.market}'dagi giftni sotib olish` : det.portals ? "Portals'dagi giftni sotib olish" : det.listing ? "Mijoz e'lonidan sotib olish" : det.sale ? "Sotuv (o'z mahsulotingiz)" : (SERVICE[o.service] || o.service) + (det.own ? " (o'z mahsulotingiz)" : '')}`,
    `Mahsulot: ${o.title}`,
    o.recipient ? `Qabul qiluvchi: @${o.recipient}` : null,
    det.model || det.backdrop ? [det.model ? `Model: ${det.model === 'any' ? "Farqi yo'q" : det.model}` : null, det.backdrop ? `Fon: ${det.backdrop === 'any' ? "Farqi yo'q" : det.backdrop}` : null].filter(Boolean).join(' · ') : null,
    det.multi ? `Giftlar (${det.multi.length} ta):\n` + det.multi.map((x, k) => `${k + 1}) ${x.name}${x.model ? ' · ' + x.model : ''}${x.backdrop ? ' · ' + x.backdrop : ''} — ${money(x.price)} so'm`).join('\n') + `\nJami: ${money(det.multi.reduce((t2, x) => t2 + x.price, 0))} so'm` : null,
    det.link ? `Havola: ${det.link}` : null,
    det.listing ? `Sotuvchi (gift egasi): ${det.seller}. Unga yozib, giftni oling. E'lon "Sotildi" deb belgilandi.` : null,
    det.market ? `Bozor: ${det.market} · narxi ${det.ton} TON${det.slug ? ` · ${det.slug}` : ''}. Avval hali sotuvdaligini tekshiring.` : null,
    det.portals ? `Portals narxi: ${det.ton} TON (ID: ${det.portals}). Avval Portals'da hali sotuvdaligini tekshiring.` : null,
    `To'lov: ${o.payment_method === 'cash' ? 'Naqd (balansdan yechildi)' : o.installment_type === 'lease' ? 'Lizing' : "Bo'lib to'lash" + (o.installment_type ? ' — ' + (ITYPE[o.installment_type] || o.installment_type) : '')}`,
    det.leaseType ? `Lizing turi: ${ITYPE[det.leaseType] || det.leaseType}` : null,
    det.months ? `Muddat: ${det.months} oy` : null,
    det.downPayment != null ? `Boshlang'ich to'lov: ${det.downPayment > 0 ? money(det.downPayment) + " so'm" : "yo'q"}`
      : o.installment_type === 'plan1' ? "Boshlang'ich to'lov: admin belgilaydi" : null,
    det.estMonthly ? `Taxminiy oylik: ${money(det.estMonthly)} so'm (narx ${money(det.estPrice)} so'm asosida)` : null,
    `Narx: ${o.price != null ? fmt(o.price) : 'admin belgilaydi'}${o.discount > 0 ? ` (promo ${o.promo_code}: −${fmt(o.discount)})` : ''}`,
    o.cost != null ? `Tannarx: ${fmt(o.cost)}` : null,
    det.quotedPrice ? `Formula bo'yicha narx: ${fmt(det.quotedPrice)}` : null,
    `Sana: ${tashkent(o.created_at)}`,
  ].filter(Boolean).join('\n');
  for (const id of adminIds()) {
    let sent = null;
    if (det.image) {
      try { sent = await api.sendPhoto({ chat_id: id, photo: det.image, caption: lines.slice(0, 1024), reply_markup: adminPanelButton() }); }
      catch (e) { await logError('bot.photo', e && (e.description || e.message)); }
    }
    if (!sent) await send(id, lines, { reply_markup: adminPanelButton() });
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

/** Yangi "Giftimni sotaman" e'loni: adminlarga xabar. */
export async function notifyNewListing(id) {
  const l = await get('SELECT l.*, c.username, c.phone FROM sell_listings l JOIN customers c ON c.id = l.customer_id WHERE l.id = :id', { id });
  if (!l) return;
  const text = [`🏷 Yangi e'lon: ${l.name}`, `Narxi: ${fmt(l.price)}`,
    [l.model && `Model: ${l.model}`, l.backdrop && `Fon: ${l.backdrop}`, l.symbol && `Belgi: ${l.symbol}`].filter(Boolean).join(' · ') || null,
    `Havola: ${l.link}`, `Egasi: ${l.username ? '@' + l.username : "(username yo'q)"} · ${l.phone || '-'}`,
    "Admin panel → E'lonlar bo'limida tasdiqlang yoki rad eting."].filter(Boolean).join('\n');
  for (const a of adminIds()) await send(a, text, { reply_markup: adminPanelButton() });
}
export { send, tashkent };
