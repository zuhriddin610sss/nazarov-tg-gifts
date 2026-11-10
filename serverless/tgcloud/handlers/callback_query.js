// Admin: chekni bot ichida tasdiqlash / rad etish.
import { api } from 'sdk';
import { ensureSchema, isAdmin, logError, fmt } from 'lib/core';
import { approveReceipt, rejectReceipt } from 'lib/shop';
import { notifyReceiptReviewed } from 'lib/notify';

export default async function (q, ctx) {
  const m = /^rc:(ok|no):(\d+)$/.exec(String(q.data || ''));
  if (!m) return api.answerCallbackQuery({ callback_query_id: q.id });
  if (!isAdmin(q.from.id)) return api.answerCallbackQuery({ callback_query_id: q.id, text: "Ruxsat yo'q" });
  await ensureSchema();
  const id = Number(m[2]);
  const actor = `admin:${q.from.id}`;
  try {
    if (m[1] === 'ok') {
      const r = await approveReceipt(id, actor);
      await api.answerCallbackQuery({ callback_query_id: q.id, text: `Tasdiqlandi: +${fmt(r.amount)}` });
      await notifyReceiptReviewed(id, true);
    } else {
      await rejectReceipt(id, actor);
      await api.answerCallbackQuery({ callback_query_id: q.id, text: 'Rad etildi' });
      await notifyReceiptReviewed(id, false);
    }
    if (q.message) {
      try { await api.editMessageReplyMarkup({ chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
    }
  } catch (e) {
    const code = e && e.parameters && e.parameters.code;
    await api.answerCallbackQuery({ callback_query_id: q.id, text: code === 'RECEIPT_ALREADY_REVIEWED' ? "Bu chek allaqachon ko'rib chiqilgan" : 'Xato yuz berdi' });
    if (!code) await logError('handler.callback', e && (e.stack || e.message));
  }
}
