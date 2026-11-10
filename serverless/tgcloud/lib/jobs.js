// Eslatmalar. Serverless'da jadval (cron) yo'q: ular botga yoki Mini App'ga har qanday murojaatda
// ko'pi bilan 30 daqiqada bir marta ishga tushadi (maybeRunJobs). Admin panelda qo'lda ishga tushirish tugmasi ham bor.
import { all, get, run, claim, logError, adminIds, nowMs } from 'lib/core';
import { listAgreements } from 'lib/shop';
import { t, money } from 'lib/texts';
import { send, tashkent, openAppButton } from 'lib/notify';

const WHAT = { gift_rent: 'rent_what_gift', username_rent: 'rent_what_username', number_rent: 'rent_what_number' };
const DAY = 86400000;

/** Ijara admin "Amalga oshirildi" qilgan paytdan hisoblanadi. Tugashiga 72 va 24 soat qolganda bittadan eslatma. */
export async function sendRentReminders(now = nowMs()) {
  const rows = await all(`SELECT o.id, o.title, o.service, o.closed_at + CAST(json_extract(o.details, '$.days') AS INTEGER) * ${DAY} AS ends_at,
        c.telegram_id, c.lang
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'completed' AND o.service IN ('gift_rent','username_rent','number_rent')
        AND o.closed_at + CAST(json_extract(o.details, '$.days') AS INTEGER) * ${DAY} BETWEEN :now AND :now + ${3 * DAY}`, { now });
  let sent = 0;
  for (const r of rows) {
    const stage = (Number(r.ends_at) - now) <= DAY ? '24h' : '72h';
    if (!(await claim(`rent:${r.id}:${stage}`))) continue;
    const end = tashkent(r.ends_at);
    await send(r.telegram_id, t(r.lang, 'rent_ending', { title: r.title, end, what: t(r.lang, WHAT[r.service]) }));
    for (const id of adminIds()) await send(id, `⏰ Ijara tugayapti (${stage}): ${r.title} · ${end}`);
    sent++;
  }
  return sent;
}

const tashkentDay = (ms) => new Date(ms + 5 * 3600000).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

/** Oylik to'lov: 3 kun oldin, to'lov kuni, kechikkanda (ertasi kundan). Mijozga umumiy qarz aytilmaydi. */
export async function sendInstallmentReminders(now = nowMs()) {
  const today = tashkentDay(now);
  const agreements = await listAgreements({ status: 'active' }, new Date(now));
  let sent = 0;
  for (const a of agreements) {
    const s = a.summary;
    if (s.remaining <= 0 || !s.nextDueDate) continue;
    const diff = dayDiff(s.nextDueDate, today);
    const stage = diff === 3 ? 'soon' : diff === 0 ? 'today' : diff <= -1 && s.overdue ? 'late' : null;
    if (!stage) continue;
    if (!(await claim(`inst:${a.id}:${s.nextDueDate}:${stage}`))) continue;
    const due = s.nextDueDate.split('-').reverse().join('.');
    const cust = a.customer_id ? await get('SELECT telegram_id, lang FROM customers WHERE id = :id', { id: a.customer_id }) : null;
    if (cust) {
      const key = stage === 'soon' ? 'inst_soon' : stage === 'today' ? 'inst_today' : 'inst_late';
      await send(cust.telegram_id, t(cust.lang, key, { title: a.product_name, date: due, amount: money(a.monthly_payment / 100) }),
        { reply_markup: openAppButton(t(cust.lang, 'open_orders'), 'orders') });
    }
    if (stage !== 'soon') {
      const who = [a.client_name, (a.cust_username || a.client_username) ? '@' + (a.cust_username || a.client_username) : null, a.cust_phone || a.client_phone].filter(Boolean).join(' · ');
      const head = stage === 'today' ? "🔔 Bugun to'lov kuni" : "⚠️ To'lov kechikdi";
      const extra = stage === 'late' ? `\nKechikkan summa: ${money(s.overdueAmount / 100)} so'm` : '';
      const note = cust ? '' : "\n(Mijoz botga ulanmagan: o'zingiz eslating)";
      for (const id of adminIds()) await send(id, `${head}: ${a.product_name}\n${who || '—'}\nSana: ${due} · Oylik: ${money(a.monthly_payment / 100)} so'm${extra}${note}`);
    }
    sent++;
  }
  return sent;
}

/** Ko'pi bilan 30 daqiqada bir marta ishlaydi; bir vaqtda faqat bitta chaqiruv "yutadi". */
export async function maybeRunJobs(force = false) {
  const now = nowMs();
  try {
    if (!force) {
      const r = await run(`INSERT INTO meta (key, value) VALUES ('jobs', :now)
                           ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(meta.value AS INTEGER) < :limit`,
        { now: String(now), limit: now - 30 * 60000 });
      if (r.rowsAffected !== 1) return null;
    }
    const rent = await sendRentReminders(now);
    // Mijozni tunda bezovta qilmaslik uchun: Toshkent vaqti bilan 09:00–21:00
    const h = new Date(now + 5 * 3600000).getUTCHours();
    const inst = force || (h >= 9 && h < 21) ? await sendInstallmentReminders(now) : 0;
    return { rent, inst };
  } catch (e) {
    await logError('jobs', e && (e.message || e.description));
    return null;
  }
}
