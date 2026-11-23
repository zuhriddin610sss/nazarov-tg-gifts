// Eslatmalar. Serverless'da jadval (cron) yo'q: ular botga yoki Mini App'ga har qanday murojaatda
// ko'pi bilan 30 daqiqada bir marta ishga tushadi (maybeRunJobs). Admin panelda qo'lda ishga tushirish tugmasi ham bor.
import { api, InputFile } from 'sdk';
import { all, get, run, claim, logError, adminIds, nowMs, takeLock } from 'lib/core';
import { buildXlsx } from 'lib/xlsx';
import { listAgreements, agreementReport, ownRentIncome, REPORT_COLS, ddmmyyyy } from 'lib/shop';
import { getSettings } from 'lib/core';
import { ownSaleQuote } from 'lib/calc';
const SUMS = ['boughtPrice', 'cashPrice', 'profitCash', 'profitInst', 'profitTotal', 'down', 'credit', 'debt', 'monthlyProfit', 'monthly', 'paid', 'allIncome'];
/** Jadval oxiridagi "Jami" qatori. */
function totalRow(rows, cols) {
  const first = Object.keys(rows[0] || {})[0];
  const r = Object.fromEntries(Object.keys(rows[0] || {}).map((k) => [k, '']));
  if (first) r[first] = 'Jami';
  for (const c of cols) r[c] = Math.round(rows.reduce((t, x) => t + (Number(x[c]) || 0), 0) * 100) / 100;
  return r;
}
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

const SVC = { nft_gift: "NFT gift", gift_rent: "NFT gift ijarasi", username_rent: 'Username ijarasi', number_rent: 'Anonim raqam ijarasi', premium: 'Telegram Premium', stars: 'Telegram Stars' };
const STATUS = { pending: "To'lanmagan", queued: 'Navbatda', completed: 'Amalga oshirildi', cancelled: 'Bekor qilindi', failed: 'Xato' };
const som = (tiyin) => (tiyin == null ? '' : Number(tiyin) / 100);

/**
 * Kunlik Excel hisobot: har kuni (Toshkent vaqti 06:00 dan keyin) adminlarga.
 * Varaqlar: Xulosa, Kecha (buyurtmalar), Lizing va bo'lib to'lash (to'liq jadval), Mening mahsulotlarim, Barcha buyurtmalar.
 */
export async function sendDailyReport(now = nowMs(), force = false) {
  const local = new Date(now + 5 * 3600000);
  if (!force && local.getUTCHours() < 6) return 0;
  const to = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 5 * 3600000, from = to - DAY;
  const label = tashkentDay(from);
  if (!force && !(await claim('daily:' + label))) return 0;
  const orders = await all(`SELECT * FROM orders WHERE status NOT IN ('pending','failed') ORDER BY id DESC LIMIT 5000`);
  const day = orders.filter((o) => Number(o.created_at) >= from && Number(o.created_at) < to);
  const ok = day.filter((o) => o.status !== 'cancelled');
  const income = ok.reduce((a, o) => a + Number(o.paid_amount || 0), 0);
  const ag = await agreementReport(new Date(now));
  const active = ag.filter((r) => r.status === 'active');
  const sum = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const summary = [
    { "Ko'rsatkich": 'Sana', "Qiymat": label },
    { "Ko'rsatkich": 'Kechagi buyurtmalar', "Qiymat": ok.length },
    { "Ko'rsatkich": "Kechagi tushum (balansdan), so'm", "Qiymat": income / 100 },
    { "Ko'rsatkich": "Faol lizing / bo'lib to'lash", "Qiymat": active.length },
    { "Ko'rsatkich": "Qolgan qarz (jami), so'm", "Qiymat": sum(active, 'debt') },
    { "Ko'rsatkich": "To'langan (jami), so'm", "Qiymat": sum(ag, 'paid') },
    { "Ko'rsatkich": "Umumiy foyda (jami), so'm", "Qiymat": sum(ag, 'profitTotal') },
  ];
  const oRow = (o) => ({ "Raqam": o.public_id, "Sana": tashkent(o.created_at), "Mijoz": o.customer_username ? '@' + o.customer_username : '', "Telefon": o.customer_phone || '',
    "Xizmat": SVC[o.service] || o.service, "Mahsulot": o.title, "To'lov": o.payment_method === 'cash' ? 'Naqd' : "Bo'lib to'lash",
    "Narx, so'm": som(o.price), "Yechilgan, so'm": som(o.paid_amount), "Holat": STATUS[o.status] || o.status });
  const agRows = ag.map((r) => Object.fromEntries(REPORT_COLS.map(([k, l]) => [l, r[k] ?? ''])));
  if (agRows.length) agRows.push(totalRow(agRows, REPORT_COLS.filter(([k]) => SUMS.includes(k)).map(([, l]) => l)));
  const rentInc = await ownRentIncome();
  const sett = await getSettings();
  const ownRows = await all('SELECT * FROM own_products ORDER BY position, id DESC');
  const own = [];
  for (const [k, p] of ownRows.entries()) {
    const earned = rentInc[p.id] || 0, bought = p.bought_price != null ? Number(p.bought_price) : null;
    const q = p.kind === 'gifts' ? await ownSaleQuote(p, sett, { cached: true }) : { price: null, down1: null };
    const cash = q.price != null ? q.price * 100 : null;
    own.push({ "№": k + 1, "Sotib olingan sana": ddmmyyyy(p.bought_at), "Sotib olingan narxi": som(bought), "Tushirilgan qiymati": bought != null ? som(bought - earned) : '',
      "Mahsulot": p.name, "Naqdga hisoblangan narxi": som(cash), "Umumiy daromad": som(earned), "Boshlang'ich to'lov": q.down1 != null ? q.down1 : '' });
  }
  own.push(totalRow(own, ["Sotib olingan narxi", "Tushirilgan qiymati", "Naqdga hisoblangan narxi", "Umumiy daromad", "Boshlang'ich to'lov"]));
  const file = buildXlsx([{ name: 'Xulosa', rows: summary }, { name: 'Kecha', rows: day.map(oRow) },
    { name: "Lizing va bo'lib to'lash", rows: agRows }, { name: 'Mening mahsulotlarim', rows: own }, { name: 'Barcha buyurtmalar', rows: orders.map(oRow) }]);
  const caption = `📊 Kunlik hisobot: ${label}\nBuyurtmalar: ${ok.length} · Tushum: ${money(income / 100)} so'm\nFaol shartnomalar: ${active.length} · Qolgan qarz: ${money(sum(active, 'debt'))} so'm`;
  for (const id of adminIds()) {
    try { await api.sendDocument({ chat_id: id, document: new InputFile(file, `hisobot_${label}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), caption }); }
    catch (e) { await logError('daily', `${id}: ${e && (e.description || e.message)}`); }
  }
  return 1;
}
/** Eski nom (admin paneldagi "hisobotni hozir olish" tugmasi). */
export const sendWeeklyReport = sendDailyReport;

/** Ko'pi bilan 30 daqiqada bir marta ishlaydi; bir vaqtda faqat bitta chaqiruv "yutadi". */
export async function maybeRunJobs(force = false) {
  const now = nowMs();
  try {
    if (!force) {
      if (!(await takeLock('jobs', 30 * 60000))) return null;
    }
    const rent = await sendRentReminders(now);
    // Mijozni tunda bezovta qilmaslik uchun: Toshkent vaqti bilan 09:00–21:00
    const h = new Date(now + 5 * 3600000).getUTCHours();
    const inst = force || (h >= 9 && h < 21) ? await sendInstallmentReminders(now) : 0;
    const daily = await sendDailyReport(now);
    return { rent, inst, daily };
  } catch (e) {
    await logError('jobs', e && (e.message || e.description));
    return null;
  }
}
