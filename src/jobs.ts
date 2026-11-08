import { q, pool } from "./db.js";
import { bot } from "./bot.js";
import { t } from "./botText.js";
import { logError } from "./audit.js";
import { config } from "./config.js";
import { InlineKeyboard } from "grammy";
import { money } from "./botText.js";
import { listAgreements } from "./services/installments.js";

const WHAT = { gift_rent: "rent_what_gift", username_rent: "rent_what_username", number_rent: "rent_what_number" } as const;

/**
 * Ijara tugashidan oldin mijozga eslatma (Marketapp talabi: bir necha kun oldin ogohlantirish).
 * Ijara admin buyurtmani "Amalga oshirildi" qilgan paytdan boshlab hisoblanadi.
 * Har bir bosqich (72 soat, 24 soat) uchun bitta xabar: notifications_sent orqali takrorlanmaydi.
 */
export async function sendRentReminders(now = new Date()) {
  const rows = await q(
    `SELECT o.id, o.title, o.service, o.closed_at + make_interval(days => (o.details->>'days')::int) AS ends_at,
            c.telegram_id, c.lang
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'completed' AND o.service IN ('gift_rent','username_rent','number_rent')
        AND o.closed_at + make_interval(days => (o.details->>'days')::int) BETWEEN $1 AND $1::timestamptz + interval '72 hours'`,
    [now],
  );
  let sent = 0;
  for (const r of rows) {
    const hoursLeft = (new Date(r.ends_at).getTime() - now.getTime()) / 3_600_000;
    const stage = hoursLeft <= 24 ? "24h" : "72h";
    const claimed = await pool.query("INSERT INTO notifications_sent (key) VALUES ($1) ON CONFLICT DO NOTHING", [`rent:${r.id}:${stage}`]);
    if (!claimed.rowCount) continue;
    const end = new Date(r.ends_at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", dateStyle: "short", timeStyle: "short" });
    const text = t(r.lang, "rent_ending", { title: r.title, end, what: t(r.lang, WHAT[r.service as keyof typeof WHAT]) });
    try {
      await bot?.api.sendMessage(r.telegram_id, text);
      for (const id of config.adminIds) await bot?.api.sendMessage(id, `⏰ Ijara tugayapti (${stage}): ${r.title} · ${end}`);
      sent++;
    } catch (e: any) {
      await logError("jobs.rent", e?.message ?? String(e));
    }
  }
  return sent;
}

/** Toshkent vaqti bo'yicha bugungi sana (YYYY-MM-DD). */
function tashkentDay(d: Date) {
  return new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/**
 * Oylik to'lov eslatmalari: to'lov kunidan 3 kun oldin, to'lov kuni va muddat o'tgach (1 kun keyin).
 * Mijozga faqat mahsulot, sana va oylik to'lov aytiladi (umumiy qarz ko'rsatilmaydi).
 * Har bir to'lov sanasining har bir bosqichi uchun bitta xabar. Akkauntga bog'lanmagan eski shartnomalar bo'yicha faqat adminga xabar.
 */
export async function sendInstallmentReminders(now = new Date()) {
  const today = tashkentDay(now);
  const agreements = await listAgreements({ status: "active" }, now);
  let sent = 0;
  for (const a of agreements) {
    const s = a.summary;
    if (s.remaining <= 0 || !s.nextDueDate) continue;
    const diff = dayDiff(s.nextDueDate, today);
    const stage = diff === 3 ? "soon" : diff === 0 ? "today" : diff <= -1 && s.overdue ? "late" : null;
    if (!stage) continue;
    const claimed = await pool.query("INSERT INTO notifications_sent (key) VALUES ($1) ON CONFLICT DO NOTHING", [`inst:${a.id}:${s.nextDueDate}:${stage}`]);
    if (!claimed.rowCount) continue;
    const due = s.nextDueDate.split("-").reverse().join(".");
    try {
      const cust = a.customer_id ? (await q("SELECT telegram_id, lang FROM customers WHERE id = $1", [a.customer_id]))[0] : null;
      if (cust && bot) {
        const lang = cust.lang;
        const text = t(lang, stage === "soon" ? "inst_soon" : stage === "today" ? "inst_today" : "inst_late",
          { title: a.product_name, date: due, amount: money(a.monthly_payment, lang) });
        await bot.api.sendMessage(cust.telegram_id, text, { reply_markup: new InlineKeyboard().webApp(t(lang, "open_orders"), `${config.PUBLIC_URL}/#orders`) });
      }
      if (stage !== "soon" && bot) {
        const who = [a.client_name, a.cust_username || a.client_username ? "@" + (a.cust_username || a.client_username) : null, a.cust_phone || a.client_phone].filter(Boolean).join(" · ");
        const head = stage === "today" ? "🔔 Bugun to'lov kuni" : "⚠️ To'lov kechikdi";
        const extra = stage === "late" ? `\nKechikkan summa: ${money(s.overdueAmount)} so'm` : "";
        const note = cust ? "" : "\n(Mijoz saytga ulanmagan: o'zingiz eslating)";
        for (const id of config.adminIds) {
          await bot.api.sendMessage(id, `${head}: ${a.product_name}\n${who || "—"}\nSana: ${due} · Oylik: ${money(a.monthly_payment)} so'm${extra}${note}`);
        }
      }
      sent++;
    } catch (e: any) {
      await logError("jobs.installment", e?.message ?? String(e));
    }
  }
  return sent;
}

export function startJobs() {
  const run = async () => {
    await sendRentReminders().catch((e) => logError("jobs.rent", String(e?.message ?? e)));
    // Mijozni tunda bezovta qilmaslik uchun: Toshkent vaqti bilan 09:00–21:00 oralig'ida
    const h = (new Date().getUTCHours() + 5) % 24;
    if (h >= 9 && h < 21) await sendInstallmentReminders().catch((e) => logError("jobs.installment", String(e?.message ?? e)));
  };
  setTimeout(run, 30_000);
  return setInterval(run, 30 * 60_000);
}
