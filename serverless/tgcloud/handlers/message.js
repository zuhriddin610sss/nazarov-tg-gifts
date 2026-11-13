// Bot xabarlari: /start, /balance, /orders, /admin, /help, telefon raqamini ulashish.
import { api } from 'sdk';
import { ensureSchema, get, all, run, getSettings, isAdmin, logError } from 'lib/core';
import { upsertCustomer } from 'lib/customer';
import { t, money } from 'lib/texts';
import { openAppButton, adminPanelButton } from 'lib/notify';
import { maybeRunJobs } from 'lib/jobs';
import { handleAdminText, ADMIN_HELP } from 'lib/admintools';

const reply = (chat, text, extra = {}) => api.sendMessage({ chat_id: chat, text, ...extra });
const phoneKb = (lang) => ({ keyboard: [[{ text: t(lang, 'share_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });

export default async function (message, ctx) {
  if (!message.from || message.chat.type !== 'private') return;
  await ensureSchema();
  try {
    const c = await upsertCustomer(message.from);
    const lang = c.lang;
    const chat = message.chat.id;

    if (message.contact) {
      // Faqat o'z raqami qabul qilinadi
      if (message.contact.user_id !== message.from.id) return reply(chat, t(lang, 'phone_not_own'));
      const phone = String(message.contact.phone_number).startsWith('+') ? message.contact.phone_number : '+' + message.contact.phone_number;
      await run('UPDATE customers SET phone = :p WHERE id = :id', { p: phone, id: c.id });
      await reply(chat, t(lang, 'phone_saved'), { reply_markup: { remove_keyboard: true } });
      return reply(chat, '👇', { reply_markup: openAppButton(t(lang, 'open')) });
    }

    if (isAdmin(message.from.id) && message.text) {
      const out = await handleAdminText(message.text);
      if (out) return reply(chat, out, { disable_web_page_preview: true });
    }
    const cmd = String(message.text || '').split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/start') {
      await reply(chat, t(lang, 'welcome'), { reply_markup: openAppButton(t(lang, 'open')) });
      if (!c.phone) await reply(chat, t(lang, 'share_phone'), { reply_markup: phoneKb(lang) });
      if (isAdmin(message.from.id)) await reply(chat, 'Siz adminsiz.', { reply_markup: adminPanelButton() });
    } else if (cmd === '/phone') {
      await reply(chat, t(lang, 'share_phone'), { reply_markup: phoneKb(lang) });
    } else if (cmd === '/balance') {
      await reply(chat, t(lang, 'balance', { b: money(c.balance / 100) }), { reply_markup: openAppButton(t(lang, 'open'), 'balance') });
    } else if (cmd === '/orders') {
      const rows = await all(`SELECT public_id, title, status FROM orders WHERE customer_id = :c AND status NOT IN ('pending','failed') ORDER BY id DESC LIMIT 10`, { c: c.id });
      if (!rows.length) await reply(chat, t(lang, 'no_orders'));
      else {
        const st = (s) => t(lang, s === 'queued' ? 'st_queued' : s === 'completed' ? 'st_completed' : 'st_cancelled');
        await reply(chat, t(lang, 'orders_head') + '\n\n' + rows.map((r) => `${r.public_id} · ${r.title}\n${st(r.status)}`).join('\n\n'),
          { reply_markup: openAppButton(t(lang, 'open'), 'orders') });
      }
    } else if (cmd === '/admin') {
      if (isAdmin(message.from.id)) await reply(chat, 'Admin panel\n\n' + ADMIN_HELP, { reply_markup: adminPanelButton() });
      const s = await getSettings();
      if (s.admin_contact) await reply(chat, t(lang, 'admin_contact', { u: s.admin_contact }),
        { reply_markup: { inline_keyboard: [[{ text: t(lang, 'write_admin'), url: `https://t.me/${s.admin_contact}` }]] } });
      else if (!isAdmin(message.from.id)) await reply(chat, t(lang, 'help'));
    } else if (cmd === '/help') {
      await reply(chat, t(lang, 'help'));
    }
  } catch (e) {
    await logError('handler.message', e && (e.stack || e.message || e.description));
  } finally {
    await maybeRunJobs();
  }
}
