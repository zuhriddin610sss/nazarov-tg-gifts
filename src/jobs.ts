import { q, pool } from "./db.js";
import { bot } from "./bot.js";
import { t } from "./botText.js";
import { logError } from "./audit.js";
import { config } from "./config.js";

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

export function startJobs() {
  const run = () => sendRentReminders().catch((e) => logError("jobs", String(e?.message ?? e)));
  setTimeout(run, 30_000);
  return setInterval(run, 30 * 60_000);
}
