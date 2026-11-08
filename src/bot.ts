import { Bot, InlineKeyboard, Keyboard, InputFile } from "grammy";
import path from "node:path";
import { config } from "./config.js";
import { pool, one, q } from "./db.js";
import { t, money } from "./botText.js";
import { logError } from "./audit.js";
import { getSettings } from "./settings.js";
import { approveReceipt, rejectReceipt } from "./services/receipts.js";
import { upsertCustomer } from "./auth.js";

export const bot = config.BOT_TOKEN ? new Bot(config.BOT_TOKEN) : null;

const SERVICE_NAME: Record<string, string> = {
  nft_gift: "NFT sovg'a", gift_rent: "NFT sovg'a ijarasi", username_rent: "Username ijarasi",
  number_rent: "Anonim raqam ijarasi", premium: "Telegram Premium", stars: "Telegram Stars",
};

/** Bir xil xabar ikki marta yuborilmasligi uchun: kalit birinchi marta yozilgandagina true. */
async function claim(key: string) {
  const r = await pool.query("INSERT INTO notifications_sent (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  return r.rowCount === 1;
}

async function send(chatId: number, text: string, extra?: Parameters<NonNullable<typeof bot>["api"]["sendMessage"]>[2]) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(chatId, text, extra);
  } catch (e: any) {
    await logError("bot.send", `${chatId}: ${e?.message}`);
  }
}

function adminLink(contact: string, text: string) {
  const u = contact.replace(/^@/, "");
  return u ? new InlineKeyboard().url(text, `https://t.me/${u}`) : undefined;
}

// ---------- Xabarnomalar ----------

export async function notifyNewOrder(orderId: number) {
  if (!(await claim(`order:${orderId}:new`))) return;
  const o = await one(
    `SELECT o.*, c.telegram_id, c.lang, qu.position FROM orders o JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_queue qu ON qu.id = o.id WHERE o.id = $1`, [orderId]);
  if (!o) return;
  const s = await getSettings();
  const lines = [
    `🆕 Yangi buyurtma ${o.public_id}`,
    `Navbat: #${String(o.position ?? "-").padStart(2, "0")}`,
    `Mijoz: ${o.customer_username ? "@" + o.customer_username : "(username yo'q)"} · ${o.customer_phone ?? "-"}`,
    `Xizmat: ${SERVICE_NAME[o.service] ?? o.service}`,
    `Mahsulot: ${o.title}`,
    o.recipient ? `Qabul qiluvchi: @${o.recipient}` : null,
    `To'lov: ${o.payment_method === "cash" ? "Naqd (balansdan yechildi)" : "Bo'lib to'lash" + (o.installment_type ? ` — ${o.installment_type}` : "")}`,
    `Narx: ${o.price != null ? money(o.price) + " so'm" : "admin belgilaydi"}`,
    o.cost != null ? `Tannarx: ${money(o.cost)} so'm` : null,
    `Sana: ${new Date(o.created_at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })}`,
  ].filter(Boolean).join("\n");
  const kb = new InlineKeyboard().url("Admin panel", `${config.PUBLIC_URL}/admin/#queue`);
  for (const id of config.adminIds) await send(id, lines, { reply_markup: kb });

  const det = o.details ?? {};
  if (det.image) for (const id of config.adminIds) {
    try { await bot?.api.sendPhoto(id, new InputFile(path.join(config.UPLOAD_DIR, String(det.image))), { caption: o.public_id }); }
    catch (e: any) { await logError("bot.photo", e?.message); }
  }

  const text = t(o.lang, "order_created", { id: o.public_id, title: o.title }) +
    (o.payment_method === "installment" ? "\n\n" + t(o.lang, "order_inst_hint") : "");
  await send(o.telegram_id, text, { reply_markup: o.payment_method === "installment" ? adminLink(s.admin_contact, t(o.lang, "write_admin")) : undefined });
}

export async function notifyOrderClosed(orderId: number, status: "completed" | "cancelled", refunded: number) {
  if (!(await claim(`order:${orderId}:${status}`))) return;
  const o = await one("SELECT o.public_id, c.telegram_id, c.lang FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1", [orderId]);
  if (!o) return;
  let text = t(o.lang, status === "completed" ? "order_completed" : "order_cancelled", { id: o.public_id });
  if (refunded > 0) text += "\n" + t(o.lang, "refunded", { a: money(refunded, o.lang) });
  await send(o.telegram_id, text);
}

export async function notifyNewReceipt(receiptId: number) {
  if (!(await claim(`receipt:${receiptId}:new`))) return;
  const r = await one(
    `SELECT r.*, c.username, c.phone FROM topup_receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [receiptId]);
  if (!r || !bot) return;
  const caption = `💳 Yangi chek #${r.id}\nMijoz: ${r.username ? "@" + r.username : "-"} · ${r.phone ?? "-"}\nSumma: ${money(r.amount)} so'm`;
  const kb = new InlineKeyboard().text("✅ Tasdiqlash", `rc:ok:${r.id}`).text("❌ Rad etish", `rc:no:${r.id}`);
  for (const id of config.adminIds) {
    try {
      const file = new InputFile(path.join(config.UPLOAD_DIR, r.file_name));
      if (r.file_mime === "application/pdf") await bot.api.sendDocument(id, file, { caption, reply_markup: kb });
      else await bot.api.sendPhoto(id, file, { caption, reply_markup: kb });
    } catch (e: any) {
      await logError("bot.receipt", e?.message);
      await send(id, caption, { reply_markup: kb });
    }
  }
}

export async function notifyReceiptReviewed(receiptId: number, ok: boolean) {
  if (!(await claim(`receipt:${receiptId}:${ok ? "ok" : "no"}`))) return;
  const r = await one(
    `SELECT r.amount, c.telegram_id, c.lang, c.balance FROM topup_receipts r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`, [receiptId]);
  if (!r) return;
  await send(r.telegram_id, ok
    ? t(r.lang, "receipt_ok", { a: money(r.amount, r.lang), b: money(r.balance, r.lang) })
    : t(r.lang, "receipt_no"));
}

// ---------- Bot buyruqlari ----------

if (bot) {
  const webAppKb = (lang: string) => new InlineKeyboard().webApp(t(lang, "open"), `${config.PUBLIC_URL}/`);
  const phoneKb = (lang: string) => new Keyboard().requestContact(t(lang, "share_btn")).resized().oneTime();

  const me = async (from: { id: number; username?: string; first_name?: string; last_name?: string; language_code?: string }) => {
    const c = await upsertCustomer(from);
    return one("SELECT id, lang, phone, balance FROM customers WHERE id = $1", [c!.id]);
  };

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    await ctx.reply(t(c.lang, "welcome"), { reply_markup: webAppKb(c.lang) });
    if (!c.phone) await ctx.reply(t(c.lang, "share_phone"), { reply_markup: phoneKb(c.lang) });
  });

  bot.command("phone", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    await ctx.reply(t(c.lang, "share_phone"), { reply_markup: phoneKb(c.lang) });
  });

  bot.on("message:contact", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    const contact = ctx.message.contact;
    // Faqat o'z raqami qabul qilinadi: boshqa odamning kontaktini yuborib bo'lmaydi
    if (contact.user_id !== ctx.from.id) return ctx.reply(t(c.lang, "phone_not_own"));
    const phone = contact.phone_number.startsWith("+") ? contact.phone_number : "+" + contact.phone_number;
    await pool.query("UPDATE customers SET phone = $2 WHERE id = $1", [c.id, phone]);
    await ctx.reply(t(c.lang, "phone_saved"), { reply_markup: { remove_keyboard: true } });
    await ctx.reply("👇", { reply_markup: webAppKb(c.lang) });
  });

  bot.command("balance", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    await ctx.reply(t(c.lang, "balance", { b: money(c.balance, c.lang) }), { reply_markup: webAppKb(c.lang) });
  });

  bot.command("orders", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    const rows = await q("SELECT public_id, title, status FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10", [c.id]);
    if (!rows.length) return ctx.reply(t(c.lang, "no_orders"));
    const st = (s: string) => t(c.lang, s === "queued" ? "st_queued" : s === "completed" ? "st_completed" : "st_cancelled");
    await ctx.reply(t(c.lang, "orders_head") + "\n\n" + rows.map((r) => `${r.public_id} · ${r.title}\n${st(r.status)}`).join("\n\n"),
      { reply_markup: webAppKb(c.lang) });
  });

  bot.command("admin", async (ctx) => {
    if (!ctx.from) return;
    const c = await me(ctx.from);
    const s = await getSettings();
    if (!s.admin_contact) return ctx.reply(t(c.lang, "help"));
    await ctx.reply(t(c.lang, "admin_contact", { u: s.admin_contact.replace(/^@/, "") }),
      { reply_markup: adminLink(s.admin_contact, t(c.lang, "write_admin")) });
  });

  bot.command("help", async (ctx) => {
    const c = ctx.from ? await me(ctx.from) : { lang: "uz" };
    await ctx.reply(t(c.lang, "help"));
  });

  // Admin: chekni bot ichida tasdiqlash / rad etish
  bot.callbackQuery(/^rc:(ok|no):(\d+)$/, async (ctx) => {
    if (!config.adminIds.has(ctx.from.id)) return ctx.answerCallbackQuery({ text: "Ruxsat yo'q" });
    const [, act, idStr] = ctx.match!;
    const id = Number(idStr);
    try {
      if (act === "ok") {
        const r = await approveReceipt(id, `admin:${ctx.from.id}`);
        await ctx.answerCallbackQuery({ text: `Tasdiqlandi: +${money(r.amount)} so'm` });
        await notifyReceiptReviewed(id, true);
      } else {
        await rejectReceipt(id, `admin:${ctx.from.id}`);
        await ctx.answerCallbackQuery({ text: "Rad etildi" });
        await notifyReceiptReviewed(id, false);
      }
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    } catch (e: any) {
      await ctx.answerCallbackQuery({ text: e?.code === "RECEIPT_ALREADY_REVIEWED" ? "Bu chek allaqachon ko'rib chiqilgan" : "Xato yuz berdi" });
    }
  });

  bot.catch((err) => { void logError("bot", String(err.error ?? err.message)); });
}
