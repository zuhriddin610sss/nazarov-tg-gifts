/* NAZAROVtggifts — admin panel */
(() => {
"use strict";
const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
let token = store.get("ng_admin_token");
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (x) => x == null ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(x)) + " so'm";
const dt = (d) => d ? new Date(d).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent", dateStyle: "short", timeStyle: "short" }) : "—";
const day = (d) => d ? String(d).slice(0, 10) : "—";
const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
const SVC = { nft_gift: "NFT sovg'a", gift_rent: "NFT ijara", username_rent: "Username ijara", number_rent: "Raqam ijara", premium: "Premium", stars: "Stars" };
const ST = { queued: "Navbatda", completed: "Amalga oshirildi", cancelled: "Bekor qilindi" };
const IT = { plan1: "1-tur", plan2: "Boshlang'ich to'lovsiz", uzum: "Uzum Nasiya" };
let toastT;
const toast = (m) => { const el = $("#toast"); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3500); };
const sheet = (h) => { $("#sheet").innerHTML = h; $("#modal").hidden = false; };
const closeSheet = () => { $("#modal").hidden = true; };
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeSheet(); });
$("#menuBtn").addEventListener("click", () => $("#side").classList.toggle("open"));
$("#side").addEventListener("click", (e) => { if (e.target.closest("a")) $("#side").classList.remove("open"); });

const ERR = { ORDER_ALREADY_CLOSED: "Bu buyurtma allaqachon yopilgan.", RECEIPT_ALREADY_REVIEWED: "Bu chek allaqachon ko'rib chiqilgan.",
  INSUFFICIENT_BALANCE: "Mijoz balansida mablag' yetarli emas.", VALIDATION: "Maydonlarni to'g'ri to'ldiring.", FORBIDDEN: "Ruxsat yo'q. Qaytadan kiring.",
  DOWN_PAYMENT_TOO_BIG: "Boshlang'ich to'lov umumiy narxdan katta bo'lmasin.", ORDER_NOT_INSTALLMENT: "Bu buyurtma bo'lib to'lash emas." };
function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!tg || !tg.Serverless) { const e = new Error("Admin panelni Telegram ichida oching"); e.code = "NOT_IN_TELEGRAM"; return reject(e); }
    tg.Serverless.call("admin", { ...params, action }, (err, result) => {
      if (err) {
        const code = (err.parameters && err.parameters.code) || err.message;
        const e = new Error(ERR[code] || code || "Xato"); e.code = code; e.extra = err.parameters || {}; return reject(e);
      }
      resolve(result);
    });
  });
}
/** Avvalgi REST yo'llarini Serverless admin amallariga moslash. */
async function api(path, opts = {}) {
  const body = opts.body || {};
  const [p, qs] = path.split("?");
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const seg = p.replace(/^\/api\/admin\//, "").split("/");
  const id = seg[1] ? Number(seg[1]) : undefined;
  switch (seg[0]) {
    case "stats": {
      const s = await call("stats");
      return { orders: { ...s.orders, cash_revenue: s.revenue, rent_profit: s.rentProfit, rent_orders: s.orders.rentOrders, rent_revenue: s.rentRevenue },
        customers: s.customers, liabilities: s.liabilities, pendingReceipts: s.pendingReceipts, pendingReviews: s.pendingReviews,
        installments: { inst_collected: 0, down_payments: 0, inst_this_month: s.installments.thisMonth, outstandingDebt: s.installments.outstandingDebt, overdue: s.installments.overdue } };
    }
    case "queue": return call("queue");
    case "orders":
      if (seg[2] === "close") return call("closeOrder", { id, ...body });
      if (id) return call("order", { id });
      return call("orders", q);
    case "receipts":
      if (seg[2] === "approve") return call("approveReceipt", { id, ...body });
      if (seg[2] === "reject") return call("rejectReceipt", { id, ...body });
      return (await call("receipts", q)).map((r) => ({ ...r, file_name: r.file_id }));
    case "customers":
      if (seg[2] === "adjust") return call("adjust", { id, ...body });
      if (id) return call("customer", { id });
      return call("customers", q);
    case "installments":
      if (seg[2] === "payments") return opts.body ? call("addInstallmentPayment", { id, ...body }) : call("installmentPayments", { id });
      if (id) return call("saveInstallment", { id, ...body });
      if (opts.body) return call("saveInstallment", body);
      return call("installments", q);
    case "settings":
      if (opts.method === "PUT") return call("saveSettings", { ...body, payment_warning: body.payment_instructions });
      { const s = await call("settings"); return { ...s, payment_instructions: s.payment_warning }; }
    case "promos":
      if (opts.body) return call("savePromo", { ...body, id, expiresAt: body.expiresAt ? String(body.expiresAt).slice(0, 10) : null });
      return call("promos");
    case "reviews":
      if (seg[2]) return call("reviewAction", { id, decision: seg[2] });
      return call("reviews", q);
    case "own":
      if (opts.method === "DELETE") return call("deleteOwnProduct", { id });
      if (opts.body) return call("saveOwnProduct", { ...body, id });
      return call("ownProducts");
    case "audit": return (await call("logs")).audit;
    case "errors": return (await call("logs")).errors;
  }
  throw new Error("Noma'lum amal: " + path);
}
async function fileUrl(fileId) {
  const r = await call("file", { fileId });
  return r.dataUrl;
}
async function showFile(name) {
  try {
    const u = await fileUrl(name);
    sheet(name.endsWith(".pdf") ? `<a class="btn btn-primary" href="${u}" target="_blank" rel="noopener">PDF'ni ochish</a>` : `<img src="${u}" alt="" style="max-width:100%;border-radius:12px">`);
  } catch (e) { toast(e.message); }
}

// ---------- kirish ----------
async function ensureAuth() {
  if (!tg) {
    $("#view").innerHTML = `<div class="center"><img src="/assets/logo-mark.png" width="80" alt=""><h1>Admin panel</h1>
      <p class="hint">Admin panel faqat Telegram ichida ochiladi: botga /admin yozing va «Admin panel» tugmasini bosing.</p></div>`;
    return false;
  }
  if (ensureAuth.ok) return true;
  try { await call("stats"); ensureAuth.ok = true; return true; }
  catch (e) {
    $("#view").innerHTML = `<div class="center"><img src="/assets/logo-mark.png" width="80" alt=""><h1>Admin panel</h1>
      <p class="alert">${e.code === "FORBIDDEN" ? "Bu Telegram akkauntga admin huquqi berilmagan." : esc(e.message)}</p></div>`;
    return false;
  }
}

// ---------- sahifalar ----------
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => ymd(new Date());
const monthStart = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), 1)); };
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    sc.onload = () => res(window.XLSX); sc.onerror = () => rej(new Error("Excel kutubxonasi yuklanmadi, internetni tekshiring"));
    document.head.appendChild(sc);
  });
}
async function exportExcel(btn, from, to) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = "Tayyorlanmoqda...";
  try {
    const [X, d] = await Promise.all([loadXlsx(), call("exportData", { from, to })]);
    const dts = (ms) => (ms ? new Date(Number(ms)).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" }) : "");
    const orders = d.orders.map((o) => ({
      "Raqam": o.public_id, "Sana": dts(o.created_at), "Mijoz": o.customer_username ? "@" + o.customer_username : "", "Telefon": o.customer_phone || "",
      "Xizmat": SVC[o.service] || o.service, "Mahsulot": o.title, "To'lov": o.payment_method === "cash" ? "Naqd" : "Bo'lib to'lash",
      "Bo'lib to'lash turi": o.installment_type ? IT[o.installment_type] || o.installment_type : "",
      "Muddat (oy)": (o.details && o.details.months) || "", "Boshlang'ich to'lov": (o.details && o.details.downPayment) || "",
      "Narx (so'm)": o.price != null ? Number(o.price) : "", "Chegirma": Number(o.discount) || "", "Tannarx": o.cost != null ? Number(o.cost) : "",
      "Holat": ST[o.status] || o.status, "Yopilgan": dts(o.closed_at),
    }));
    const inst = d.agreements.map((a) => ({
      "Mahsulot": a.product_name, "Mijoz": a.client_name || "", "Username": (a.cust_username || a.client_username) ? "@" + (a.cust_username || a.client_username) : "",
      "Telefon": a.cust_phone || a.client_phone || "", "Turi": a.installment_type ? IT[a.installment_type] || a.installment_type : "",
      "Umumiy narx": Number(a.total_price), "Boshlang'ich": Number(a.down_payment), "Oylik to'lov": Number(a.monthly_payment),
      "To'langan": Number(a.summary.paid), "Qolgan qarz": Number(a.summary.remaining), "Kechikkan": a.summary.overdue ? "Ha" : "Yo'q",
      "Kechikkan summa": Number(a.summary.overdueAmount) || "", "Keyingi to'lov": a.summary.nextDueDate || "",
      "Boshlangan": a.start_date, "Tugaydi": a.final_date, "Holat": a.status === "active" ? "Faol" : "Yopilgan",
    }));
    const cust = d.customers.map((c) => ({
      "Username": c.username ? "@" + c.username : "", "Ism": [c.first_name, c.last_name].filter(Boolean).join(" "), "Telefon": c.phone || "",
      "Telegram ID": String(c.telegram_id), "Balans (so'm)": Number(c.balance), "Buyurtmalar": Number(c.orders_count), "Qo'shilgan": dts(c.created_at),
    }));
    const wb = X.utils.book_new();
    const add = (rows, name) => { const ws = X.utils.json_to_sheet(rows.length ? rows : [{ "": "Ma'lumot yo'q" }]);
      ws["!cols"] = Object.keys(rows[0] || { "": "" }).map((k) => ({ wch: Math.max(10, Math.min(40, k.length + 4)) })); X.utils.book_append_sheet(wb, ws, name); };
    add(orders, "Buyurtmalar"); add(inst, "Bo'lib to'lash"); add(cust, "Mijozlar");
    const file = X.write(wb, { bookType: "xlsx", type: "base64" });
    await call("sendExport", { file, name: `hisobot_${from || "boshidan"}_${to || "bugun"}.xlsx` });
    toast("Excel fayl botdagi chatingizga yuborildi");
  } catch (e) { toast(e.message || "Xato"); }
  finally { btn.disabled = false; btn.textContent = old; }
}
async function dashboard(v) {
  const s = await api("/api/admin/stats");
  const o = s.orders, i = s.installments;
  const revenue = Number(o.cash_revenue) + Number(i.inst_collected) + Number(i.down_payments);
  const box = (l, val, cls = "") => `<div class="stat ${cls}"><small>${esc(l)}</small><b>${esc(val)}</b></div>`;
  v.innerHTML = `<h1>Boshqaruv paneli</h1>
    <div class="section"><h2>Buyurtmalar</h2><div class="stats">
      ${box("Bugun", o.today)}${box("Jami", o.total)}${box("Navbatda", o.queued)}${box("Amalga oshirildi", o.completed)}${box("Bekor qilindi", o.cancelled)}${box("Mijozlar", s.customers)}
    </div></div>
    <div class="section"><h2>Moliya</h2><div class="stats">
      ${box("Tushum", money(revenue))}
      ${box("Foyda (ijara)", money(o.rent_profit))}
      ${box("Mijozlar balansi (majburiyat)", money(s.liabilities), "liab")}
      ${box("Bo'lib to'lash qarzi", money(i.outstandingDebt), "liab")}
      ${box("Shu oy yig'ilgan", money(i.inst_this_month))}
      ${box("Kechikkan shartnomalar", i.overdue)}
    </div>
    <p class="hint">Tushum: bajarilgan naqd buyurtmalar + bo'lib to'lash to'lovlari + boshlang'ich to'lovlar. Mijozlar balansi tushum emas: bu mijozlarga qarzdorlik. Foyda hozircha faqat ijara uchun hisoblanadi (narx − Marketapp narxi × kurs).</p></div>
    <div class="section"><h2>NFT ijara</h2><div class="stats">${box("Ijara buyurtmalari", o.rent_orders)}${box("Ijara tushumi", money(o.rent_revenue))}</div></div>
    <div class="section"><h2>Excel hisobot</h2>
      <p class="hint">Buyurtmalar (tanlangan sanalar bo'yicha), bo'lib to'lashlar va mijozlar bitta Excel faylga yoziladi. Fayl shu botdagi chatingizga yuboriladi.</p>
      <div class="row2"><input class="input" type="date" id="xFrom" value="${esc(monthStart())}"><input class="input" type="date" id="xTo" value="${esc(todayStr())}"></div>
      <button class="btn btn-primary btn-sm" id="xls" type="button">⬇ Excel</button></div>
    <div class="section"><h2>Eslatmalar</h2><p class="hint">Ijara va oylik to'lov eslatmalari bot faol bo'lganda o'zi yuboriladi. Hozir tekshirish uchun bosing.</p>
      <button class="btn btn-ghost btn-sm" id="runJobs" type="button">Eslatmalarni hozir yuborish</button></div>
    ${s.pendingReceipts ? `<p class="alert">Tekshirilmagan cheklar: ${s.pendingReceipts}. <a href="#receipts">Ko'rish</a></p>` : ""}`;
  $("#xls").onclick = (e) => exportExcel(e.currentTarget, $("#xFrom").value, $("#xTo").value);
  $("#runJobs").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { const r = await call("runJobs"); toast(`Yuborildi: ijara ${r.rent}, oylik to'lov ${r.inst}`); }
    catch (er) { toast(er.message); } finally { e.currentTarget.disabled = false; }
  };
}

const DK = { months: "Muddat (oy)", downPayment: "Boshlang'ich to'lov (so'm)", name: "Nomi", link: "Havola", model: "Model", backdrop: "Fon", days: "Kun", quantity: "Soni", plan: "Tarif" };
function orderSheet(o) {
  const d = o.details || {};
  const lines = Object.entries(d).filter(([k, val]) => val != null && k !== "attributes" && k !== "formula").map(([k, val]) => `${DK[k] || k}: ${typeof val === "object" ? JSON.stringify(val) : val}`).join("\n");
  sheet(`<h2>${esc(o.public_id)} · ${esc(o.title)}</h2>
    <div class="kv"><span>Holat</span><b>${esc(ST[o.status])}${o.position ? ` · navbat #${String(o.position).padStart(2, "0")}` : ""}</b>
      <span>Xizmat</span><b>${esc(SVC[o.service])}</b>
      <span>To'lov</span><b>${o.payment_method === "cash" ? "Naqd" : "Bo'lib to'lash" + (o.installment_type ? " · " + esc(IT[o.installment_type] || o.installment_type) : "")}</b>
      <span>Narx</span><b>${o.price != null ? esc(money(o.price)) : "admin belgilaydi"}</b>
      ${o.cost != null ? `<span>Tannarx</span><b>${esc(money(o.cost))}</b><span>Foyda</span><b>${o.price != null ? esc(money(Number(o.price) - Number(o.cost))) : "—"}</b>` : ""}
      ${Number(o.discount) > 0 ? `<span>Promo-kod</span><b>${esc(o.promo_code)} · −${esc(money(o.discount))}</b>` : ""}
      <span>Yechilgan</span><b>${esc(money(o.paid_amount))}</b>
      <span>Mijoz</span><b>${o.customer_username ? "@" + esc(o.customer_username) : "—"} · ${esc(o.customer_phone || "—")}</b>
      ${o.recipient ? `<span>Qabul qiluvchi</span><b>@${esc(o.recipient)}</b>` : ""}
      <span>Sana</span><b>${esc(dt(o.created_at))}</b></div>
    ${lines ? `<div class="det">${esc(lines)}</div>` : ""}
    ${d.image ? `<button class="btn btn-ghost btn-sm" id="img" type="button">Sovg'a rasmini ko'rish</button>` : ""}
    ${o.customer_username ? `<a class="btn btn-ghost btn-sm" href="https://t.me/${esc(o.customer_username)}" target="_blank" rel="noopener">Mijozga yozish</a>` : ""}
    ${o.customer_id ? `<button class="btn btn-primary btn-sm" id="topUp" type="button">Balansni to'ldirish${o.balance != null ? ` (hozir: ${esc(money(o.balance))})` : ""}</button>` : ""}
    ${o.payment_method === "installment" && !o.agreementId ? `<button class="btn btn-ghost btn-sm" id="mkAgr" type="button">Shartnoma tuzish</button>` : ""}
    ${o.status === "queued" ? `<textarea class="input" id="note" rows="2" placeholder="Izoh (ixtiyoriy)"></textarea>
      <div class="row2"><button class="btn btn-primary" id="done" type="button">Amalga oshirildi</button>
      <button class="btn btn-ghost" id="cancel" type="button">Bekor qilish${Number(o.paid_amount) > 0 ? " (pul qaytadi)" : ""}</button></div>` : ""}`);
  const img = $("#img"); if (img) img.onclick = () => showFile(d.image);
  const tu = $("#topUp"); if (tu) tu.onclick = () => customerSheet(o.customer_id);
  const mk = $("#mkAgr"); if (mk) mk.onclick = () => agreementForm({ order_id: o.id, product_name: o.title, installment_type: o.installment_type, client_username: o.customer_username, client_phone: o.customer_phone });
  const close = async (status, btn) => {
    if (status === "cancelled" && !btn.dataset.sure) { btn.dataset.sure = "1"; btn.textContent = "Tasdiqlash: bekor qilinsinmi?"; return; }
    btn.disabled = true;
    try { const r = await api(`/api/admin/orders/${o.id}/close`, { body: { status, note: $("#note").value || undefined } }); closeSheet(); toast(status === "completed" ? "Bajarildi" : `Bekor qilindi${r.refunded ? `, ${money(r.refunded)} qaytarildi` : ""}`); render(); }
    catch (e) { btn.disabled = false; toast(e.message); }
  };
  const dn = $("#done"); if (dn) dn.onclick = (e) => close("completed", e.currentTarget);
  const cn = $("#cancel"); if (cn) cn.onclick = (e) => close("cancelled", e.currentTarget);
}
const openOrder = async (id) => { try { orderSheet(await api("/api/admin/orders/" + id)); } catch (e) { toast(e.message); } };

async function queue(v) {
  const rows = await api("/api/admin/queue");
  v.innerHTML = `<h1>Navbat (${rows.length})</h1>
    ${rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>ID</th><th>Mahsulot</th><th>To'lov</th><th>Narx</th><th>Mijoz</th><th>Sana</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="qn">#${String(r.position).padStart(2, "0")}</td><td><code>${esc(r.public_id)}</code></td>
      <td>${esc(r.title)}${r.recipient ? `<br><small class="hint">→ @${esc(r.recipient)}</small>` : ""}</td>
      <td>${r.payment_method === "cash" ? "Naqd" : "Bo'lib · " + esc(IT[r.installment_type] || "—")}</td>
      <td class="num">${r.price != null ? esc(money(r.price)) : "—"}</td>
      <td>${r.customer_username ? "@" + esc(r.customer_username) : "—"}<br><small class="hint">${esc(r.customer_phone || "")}</small></td>
      <td>${esc(dt(r.created_at))}</td><td><button class="btn btn-ghost btn-sm" data-o="${r.id}" type="button">Ochish</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="empty">Navbat bo'sh.</p>`}`;
  v.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => openOrder(b.dataset.o)));
}

async function orders(v) {
  const f = (orders.f ||= {});
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x));
  const rows = await api("/api/admin/orders?" + qs);
  v.innerHTML = `<h1>Buyurtmalar</h1>
    <form class="filters" id="flt">
      <input class="input" name="search" placeholder="ID, username, telefon" value="${esc(f.search || "")}">
      <select class="input" name="service"><option value="">Barcha xizmatlar</option>${Object.entries(SVC).map(([k, l]) => `<option value="${k}" ${f.service === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select class="input" name="method"><option value="">Barcha to'lovlar</option><option value="cash" ${f.method === "cash" ? "selected" : ""}>Naqd</option><option value="installment" ${f.method === "installment" ? "selected" : ""}>Bo'lib to'lash</option></select>
      <select class="input" name="status"><option value="">Barcha holatlar</option>${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <input class="input" type="date" name="from" value="${esc(f.from || "")}"><input class="input" type="date" name="to" value="${esc(f.to || "")}">
      <button class="btn btn-primary btn-sm" type="submit">Qidirish</button>
    </form>
    <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Holat</th><th>Mahsulot</th><th>Xizmat</th><th>To'lov</th><th>Narx</th><th>Mijoz</th><th>Sana</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-o="${r.id}" style="cursor:pointer"><td><code>${esc(r.public_id)}</code></td><td><span class="badge b-${r.status}">${esc(ST[r.status])}${r.position ? " #" + r.position : ""}</span></td>
      <td>${esc(r.title)}</td><td>${esc(SVC[r.service])}</td><td>${r.payment_method === "cash" ? "Naqd" : "Bo'lib"}</td><td class="num">${esc(money(r.price))}</td>
      <td>${r.customer_username ? "@" + esc(r.customer_username) : "—"}</td><td>${esc(dt(r.created_at))}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Topilmadi</td></tr>`}
    </tbody></table></div>`;
  $("#flt").onsubmit = (e) => { e.preventDefault(); orders.f = Object.fromEntries(new FormData(e.target)); render(); };
  v.querySelectorAll("[data-o]").forEach((tr) => (tr.onclick = () => openOrder(tr.dataset.o)));
}

async function receipts(v) {
  const st = receipts.st ?? "pending";
  const rows = await api("/api/admin/receipts" + (st ? "?status=" + st : ""));
  v.innerHTML = `<h1>Cheklar</h1>
    <div class="filters">${[["pending", "Tekshirilmagan"], ["approved", "Tasdiqlangan"], ["rejected", "Rad etilgan"], ["", "Hammasi"]].map(([k, l]) => `<button class="chip" data-s="${k}" aria-pressed="${st === k}" type="button">${l}</button>`).join("")}</div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Mijoz</th><th>Summa</th><th>Holat</th><th>Sana</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r.id}</td><td>${r.username ? "@" + esc(r.username) : "—"}<br><small class="hint">${esc(r.phone || "")}</small></td>
      <td class="num">${esc(money(r.amount))}</td><td>${esc({ pending: "Tekshirilmoqda", approved: "Tasdiqlandi", rejected: "Rad etildi" }[r.status])}</td><td>${esc(dt(r.created_at))}</td>
      <td><div class="acts"><button class="btn btn-ghost btn-sm" data-f="${esc(r.file_name)}" type="button">Chek</button>
      ${r.status === "pending" ? `<button class="btn btn-primary btn-sm" data-ok="${r.id}" data-a="${esc(r.amount)}" type="button">Tasdiqlash</button><button class="btn btn-ghost btn-sm" data-no="${r.id}" type="button">Rad etish</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Chek yo'q</td></tr>`}
    </tbody></table></div>`;
  v.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { receipts.st = b.dataset.s; render(); }));
  v.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => showFile(b.dataset.f)));
  v.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => {
    sheet(`<h2>Chek #${b.dataset.ok}ni tasdiqlash</h2><div class="field"><label for="am">Balansga tushadigan summa</label><input class="input" id="am" value="${esc(Number(b.dataset.a))}" inputmode="decimal"></div>
      <p class="hint">Chekdagi summa boshqacha bo'lsa, to'g'rilang.</p><button class="btn btn-primary" id="go" type="button">Tasdiqlash</button>`);
    $("#go").onclick = async (e) => { e.currentTarget.disabled = true; try { await api(`/api/admin/receipts/${b.dataset.ok}/approve`, { body: { amount: Number($("#am").value.replace(/[\s,]/g, "")) } }); closeSheet(); toast("Balansga tushirildi"); render(); } catch (er) { e.currentTarget.disabled = false; toast(er.message); } };
  }));
  v.querySelectorAll("[data-no]").forEach((b) => (b.onclick = () => {
    sheet(`<h2>Chek #${b.dataset.no}ni rad etish</h2><textarea class="input" id="nt" rows="2" placeholder="Sabab (ixtiyoriy)"></textarea><button class="btn btn-primary" id="go" type="button">Rad etish</button>`);
    $("#go").onclick = async () => { try { await api(`/api/admin/receipts/${b.dataset.no}/reject`, { body: { note: $("#nt").value || undefined } }); closeSheet(); toast("Rad etildi"); render(); } catch (er) { toast(er.message); } };
  }));
}

async function customers(v) {
  const s = customers.s || "";
  const rows = await api("/api/admin/customers" + (s ? "?search=" + encodeURIComponent(s) : ""));
  v.innerHTML = `<h1>Mijozlar</h1>
    <form class="filters" id="flt"><input class="input" name="s" placeholder="Username, telefon, ism yoki Telegram ID" value="${esc(s)}"><button class="btn btn-primary btn-sm">Qidirish</button></form>
    <div class="tbl-wrap"><table><thead><tr><th>Mijoz</th><th>Telefon</th><th>Balans</th><th>Buyurtmalar</th><th>Qo'shilgan</th></tr></thead><tbody>
    ${rows.map((c) => `<tr data-c="${c.id}" style="cursor:pointer"><td>${c.username ? "@" + esc(c.username) : esc(c.first_name || "—")}<br><small class="hint">ID ${esc(c.telegram_id)}</small></td>
      <td>${esc(c.phone || "—")}</td><td class="num">${esc(money(c.balance))}</td><td class="num">${c.orders}</td><td>${esc(day(c.created_at))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Topilmadi</td></tr>`}
    </tbody></table></div>`;
  $("#flt").onsubmit = (e) => { e.preventDefault(); customers.s = new FormData(e.target).get("s"); render(); };
  v.querySelectorAll("[data-c]").forEach((tr) => (tr.onclick = () => customerSheet(tr.dataset.c)));
}
async function customerSheet(id) {
  const d = await api("/api/admin/customers/" + id);
  const c = d.customer;
  sheet(`<h2>${c.username ? "@" + esc(c.username) : esc(c.first_name || "Mijoz")}</h2>
    <div class="kv"><span>Telefon</span><b>${esc(c.phone || "—")}</b><span>Telegram ID</span><b>${esc(c.telegram_id)}</b><span>Balans</span><b>${esc(money(c.balance))}</b></div>
    <div class="section"><h2>Balansni o'zgartirish</h2>
      <div class="row2"><input class="input" id="adjA" placeholder="Summa (− yechish uchun)" inputmode="decimal"><input class="input" id="adjN" placeholder="Sabab"></div>
      <button class="btn btn-primary btn-sm" id="adj" type="button">Saqlash</button></div>
    <h2>Buyurtmalar (${d.orders.length})</h2>
    <div class="det">${d.orders.map((o) => `${o.public_id} · ${o.title} · ${ST[o.status]} · ${o.price != null ? money(o.price) : "—"}`).map(esc).join("\n") || "—"}</div>
    <h2>Bo'lib to'lash</h2>
    <div class="det">${d.agreements.map((a) => `${a.product_name}: qarz ${money(a.summary.remaining)}, oylik ${money(a.monthly_payment)}${a.summary.overdue ? " · KECHIKKAN" : ""}`).map(esc).join("\n") || "—"}</div>
    <h2>Balans tarixi</h2>
    <div class="det">${d.ledger.slice(0, 30).map((l) => `${dt(l.created_at)} · ${l.kind} · ${Number(l.amount) > 0 ? "+" : ""}${money(l.amount)} → ${money(l.balance_after)}${l.note ? " · " + l.note : ""}`).map(esc).join("\n") || "—"}</div>`);
  const k = key();
  $("#adj").onclick = async (e) => {
    const amount = Number($("#adjA").value.replace(/[\s,]/g, "")), note = $("#adjN").value.trim();
    if (!amount || note.length < 2) return toast("Summa va sababni kiriting");
    e.currentTarget.disabled = true;
    try { await api(`/api/admin/customers/${id}/adjust`, { body: { amount, note, idempotencyKey: k } }); toast("Saqlandi"); customerSheet(id); }
    catch (er) { e.currentTarget.disabled = false; toast(er.message); }
  };
}

async function installments(v) {
  const f = (installments.f ||= { status: "active" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x));
  const rows = await api("/api/admin/installments?" + qs);
  v.innerHTML = `<h1>Bo'lib to'lash boshqaruvi</h1>
    <div class="filters">
      <form id="flt" style="display:contents"><input class="input" name="search" placeholder="Mahsulot, mijoz, telefon" value="${esc(f.search || "")}">
      <select class="input" name="status"><option value="active" ${f.status === "active" ? "selected" : ""}>Faol</option><option value="closed" ${f.status === "closed" ? "selected" : ""}>Yopilgan</option><option value="" ${!f.status ? "selected" : ""}>Hammasi</option></select>
      <button class="btn btn-ghost btn-sm">Qidirish</button></form>
      <button class="btn btn-primary btn-sm" id="new" type="button">+ Yangi shartnoma</button>
      <button class="btn btn-ghost btn-sm" id="legacy" type="button">+ Eski shartnoma</button>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Mijoz</th><th>Mahsulot</th><th>Umumiy</th><th>To'langan</th><th>Qarz</th><th>Oylik</th><th>Boshlanish</th><th>Oxirgi</th><th>Keyingi to'lov</th><th></th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td>${esc(a.client_name || "")} ${a.cust_username || a.client_username ? "@" + esc(a.cust_username || a.client_username) : ""}<br><small class="hint">${esc(a.cust_phone || a.client_phone || "")}${a.legacy ? " · eski" : ""}${a.order_public_id ? " · " + esc(a.order_public_id) : ""}</small></td>
      <td>${esc(a.product_name)}<br><small class="hint">${esc(IT[a.installment_type] || a.installment_type || "")}</small></td>
      <td class="num">${esc(money(a.summary.total))}</td><td class="num">${esc(money(a.summary.paid))}</td><td class="num">${esc(money(a.summary.remaining))}</td>
      <td class="num">${esc(money(a.monthly_payment))}</td><td>${esc(day(a.start_date))}</td><td>${esc(day(a.final_date))}</td>
      <td>${a.summary.overdue ? `<span class="over">Kechikkan: ${esc(money(a.summary.overdueAmount))}</span>` : esc(a.summary.nextDueDate || "—")}</td>
      <td><div class="acts"><button class="btn btn-primary btn-sm" data-pay="${a.id}" type="button">To'lov</button><button class="btn btn-ghost btn-sm" data-ed="${a.id}" type="button">Tahrir</button><button class="btn btn-ghost btn-sm" data-h="${a.id}" type="button">Tarix</button></div></td></tr>`).join("") || `<tr><td colspan="10" class="empty">Shartnoma yo'q</td></tr>`}
    </tbody></table></div>`;
  $("#flt").onsubmit = (e) => { e.preventDefault(); installments.f = Object.fromEntries(new FormData(e.target)); render(); };
  $("#new").onclick = () => agreementForm({});
  $("#legacy").onclick = () => agreementForm({ legacy: true });
  v.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => agreementForm(rows.find((a) => String(a.id) === b.dataset.ed))));
  v.querySelectorAll("[data-h]").forEach((b) => (b.onclick = async () => {
    const p = await api(`/api/admin/installments/${b.dataset.h}/payments`);
    sheet(`<h2>To'lovlar tarixi</h2><div class="det">${p.map((x) => `${dt(x.paid_at)} · ${money(x.amount)} · ${x.source === "balance" ? "balansdan" : "qo'lda"}${x.note ? " · " + x.note : ""}`).map(esc).join("\n") || "To'lov yo'q"}</div>`);
  }));
  v.querySelectorAll("[data-pay]").forEach((b) => (b.onclick = () => {
    const k = key();
    sheet(`<h2>To'lov qo'shish</h2><div class="form"><div class="field"><label for="pa">Summa</label><input class="input" id="pa" inputmode="decimal"></div>
      <div class="field"><label for="pd">Sana</label><input class="input" id="pd" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field full"><label for="pn">Izoh</label><input class="input" id="pn" placeholder="Naqd, karta…"></div></div>
      <button class="btn btn-primary" id="go" type="button">Saqlash</button>`);
    $("#go").onclick = async (e) => {
      const amount = Number($("#pa").value.replace(/[\s,]/g, ""));
      if (!(amount > 0)) return toast("Summani kiriting");
      e.currentTarget.disabled = true;
      try { await api(`/api/admin/installments/${b.dataset.pay}/payments`, { body: { amount, paidAt: $("#pd").value, note: $("#pn").value || undefined, idempotencyKey: k } }); closeSheet(); toast("Saqlandi"); render(); }
      catch (er) { e.currentTarget.disabled = false; toast(er.message); }
    };
  }));
}
function agreementForm(a) {
  const edit = Boolean(a.id);
  const legacy = a.legacy === true;
  const val = (k) => esc(a[k] ?? "");
  sheet(`<h2>${edit ? "Shartnomani tahrirlash" : legacy ? "Eski shartnoma qo'shish" : "Yangi shartnoma"}</h2>
    <form class="form" id="af">
      <div class="field full"><label>Mahsulot</label><input class="input" name="productName" required value="${val("product_name")}"></div>
      <div class="field"><label>Mijoz ismi</label><input class="input" name="clientName" value="${val("client_name")}"></div>
      <div class="field"><label>Telegram username</label><input class="input" name="clientUsername" value="${val("client_username") || val("cust_username")}"></div>
      <div class="field"><label>Telefon</label><input class="input" name="clientPhone" value="${val("client_phone")}"></div>
      <div class="field"><label>Turi</label><select class="input" name="installmentType"><option value="">—</option>${Object.entries(IT).map(([k, l]) => `<option value="${k}" ${a.installment_type === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label>Umumiy narx</label><input class="input" name="totalPrice" required inputmode="decimal" value="${val("total_price")}"></div>
      <div class="field"><label>Boshlang'ich to'lov</label><input class="input" name="downPayment" inputmode="decimal" value="${a.down_payment ?? 0}"></div>
      <div class="field"><label>Oylik to'lov</label><input class="input" name="monthlyPayment" required inputmode="decimal" value="${val("monthly_payment")}"></div>
      <div class="field"><label>Boshlanish sanasi</label><input class="input" type="date" name="startDate" required value="${esc(day(a.start_date) === "—" ? "" : day(a.start_date))}"></div>
      <div class="field"><label>Oxirgi to'lov sanasi</label><input class="input" type="date" name="finalDate" required value="${esc(day(a.final_date) === "—" ? "" : day(a.final_date))}"></div>
      ${legacy && !edit ? `<div class="field"><label>Shu kungacha to'langan (boshlang'ichdan tashqari)</label><input class="input" name="alreadyPaid" inputmode="decimal" value="0"></div>` : ""}
      <div class="field"><label>Garov</label><input class="input" name="collateral" value="${val("collateral")}"></div>
      ${edit ? `<div class="field"><label>Holat</label><select class="input" name="status"><option value="active" ${a.status === "active" ? "selected" : ""}>Faol</option><option value="closed" ${a.status === "closed" ? "selected" : ""}>Yopilgan</option></select></div>` : ""}
      <div class="field full"><label>Izoh</label><textarea class="input" name="notes" rows="2">${val("notes")}</textarea></div>
      <button class="btn btn-primary full" type="submit">Saqlash</button>
    </form>`);
  $("#af").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const num = (x) => (x === "" || x == null ? undefined : Number(String(x).replace(/[\s,]/g, "")));
    const body = {
      productName: f.productName, clientName: f.clientName || null, clientUsername: f.clientUsername || null, clientPhone: f.clientPhone || null,
      installmentType: f.installmentType || null, totalPrice: num(f.totalPrice), downPayment: num(f.downPayment) ?? 0, monthlyPayment: num(f.monthlyPayment),
      startDate: f.startDate, finalDate: f.finalDate, collateral: f.collateral || null, notes: f.notes || null,
    };
    try {
      if (edit) await api("/api/admin/installments/" + a.id, { method: "PATCH", body: { ...body, status: f.status } });
      else await api("/api/admin/installments", { body: { ...body, legacy, orderId: a.order_id || undefined, alreadyPaid: num(f.alreadyPaid) } });
      closeSheet(); toast("Saqlandi"); if (location.hash !== "#installments") location.hash = "installments"; else render();
    } catch (er) { toast(er.message); }
  };
}

async function settings(v) {
  const s = await api("/api/admin/settings");
  const L = ["uz", "ru", "en", "zh"];
  const svcL = { nft_gift: "NFT sovg'a sotib olish", gift_rent: "NFT sovg'a ijarasi", username_rent: "Username ijarasi", number_rent: "Anonim raqam ijarasi", premium: "Telegram Premium", stars: "Telegram Stars" };
  v.innerHTML = `<h1>Sozlamalar</h1><form id="sf">
    <div class="section"><h2>To'lov</h2><div class="form">
      <div class="field"><label>Karta raqami</label><input class="input" name="card_number" value="${esc(s.card_number)}"></div>
      <div class="field"><label>Karta egasi</label><input class="input" name="card_holder" value="${esc(s.card_holder)}"></div>
      <div class="field"><label>Admin Telegram username</label><input class="input" name="admin_contact" value="${esc(s.admin_contact)}" placeholder="username (@ siz)"></div>
      ${L.map((l) => `<div class="field full"><label>Karta ostidagi ogohlantirish (${l.toUpperCase()})</label><textarea class="input" name="pi_${l}" rows="2">${esc(s.payment_instructions[l])}</textarea></div>`).join("")}
    </div></div>
    <div class="section"><h2>Marketapp</h2><div class="form">
      <div class="field full"><label>Marketapp API tokeni ${s.marketappTokenSet ? "(saqlangan ✓ — almashtirish uchun yangisini yozing)" : "(hali kiritilmagan)"}</label>
        <input class="input" name="marketapp_token" type="password" autocomplete="off" placeholder="${s.marketappTokenSet ? "••••••••" : "Tokenni shu yerga qo'ying"}"></div>
    </div><p class="hint">Token faqat serverda saqlanadi va bu yerda qayta ko'rsatilmaydi.</p></div>
    <div class="section"><h2>Narxlar</h2><div class="form">
      <div class="field"><label>1 star narxi (so'm)</label><input class="input" name="stars_price" value="${esc(s.stars_price)}"></div>
      <div class="field"><label>Eng kam star</label><input class="input" name="stars_min" value="${esc(s.stars_min)}"></div>
      ${[["m1", "Premium 1 oy"], ["m3", "Premium 3 oy"], ["m6", "Premium 6 oy"], ["m12_login", "Premium 12 oy (akkauntga kirib)"], ["m12", "Premium 12 oy (akkauntga kirmasdan)"]].map(([k, l]) => `<div class="field"><label>${l}</label><input class="input" name="pp_${k}" value="${esc(s.premium_prices[k])}"></div>`).join("")}
    </div></div>
    <div class="section"><h2>Ijara formulasi: (P + qo'shimcha) × koeffitsiyent × kurs</h2><div class="form">
      <div class="field"><label>Qo'shimcha</label><input class="input" name="rf_add" value="${esc(s.rent_formula.add)}"></div>
      <div class="field"><label>Koeffitsiyent</label><input class="input" name="rf_mult" value="${esc(s.rent_formula.mult)}"></div>
      <div class="field"><label>Kurs</label><input class="input" name="rf_rate" value="${esc(s.rent_formula.rate)}"></div>
    </div><p class="hint">Misol: P = 1.5 → ${esc(money((1.5 + s.rent_formula.add) * s.rent_formula.mult * s.rent_formula.rate))}</p></div>
    <div class="section"><h2>Xizmatlar</h2><div class="form">
      ${Object.entries(svcL).map(([k, l]) => `<label class="opt" style="cursor:pointer"><input type="checkbox" name="se_${k}" ${s.services_enabled[k] ? "checked" : ""}> ${l}</label>`).join("")}
    </div></div>
    <button class="btn btn-primary" type="submit">Saqlash</button></form>`;
  $("#sf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const n = (k) => Number(String(f.get(k)).replace(/[\s,]/g, ""));
    const body = {
      card_number: String(f.get("card_number")).trim(), card_holder: String(f.get("card_holder")).trim(), admin_contact: String(f.get("admin_contact")).trim().replace(/^@/, ""),
      payment_instructions: Object.fromEntries(L.map((l) => [l, String(f.get("pi_" + l))])),
      stars_price: n("stars_price"), stars_min: n("stars_min"),
      premium_prices: Object.fromEntries(["m1", "m3", "m6", "m12_login", "m12"].map((k) => [k, n("pp_" + k)])),
      rent_formula: { add: n("rf_add"), mult: n("rf_mult"), rate: n("rf_rate") },
      services_enabled: Object.fromEntries(Object.keys(svcL).map((k) => [k, f.get("se_" + k) === "on"])),
      marketappToken: String(f.get("marketapp_token") || "").trim() || undefined,
    };
    try { await api("/api/admin/settings", { method: "PUT", body }); toast("Saqlandi"); } catch (er) { toast(er.message); }
  };
}

async function promos(v) {
  const rows = await api("/api/admin/promos");
  v.innerHTML = `<h1>Promo-kodlar</h1>
    <p class="hint" style="margin-bottom:12px">Promo-kod faqat naqd buyurtmalarga ishlaydi. Har bir mijoz bitta kodni bir marta ishlata oladi.</p>
    <button class="btn btn-primary btn-sm" id="new" type="button" style="margin-bottom:12px">+ Yangi promo-kod</button>
    <div class="tbl-wrap"><table><thead><tr><th>Kod</th><th>Chegirma</th><th>Xizmatlar</th><th>Muddat</th><th>Ishlatilgan</th><th>Jami chegirma</th><th>Holat</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><code>${esc(p.code)}</code></td><td>${p.kind === "percent" ? esc(Number(p.value)) + "%" : esc(money(p.value))}</td>
      <td>${p.services ? p.services.map((s) => esc(SVC[s])).join(", ") : "Hammasi"}</td><td>${p.expires_at ? esc(dt(p.expires_at)) : "Cheksiz"}</td>
      <td class="num">${p.used_count}${p.max_uses ? " / " + p.max_uses : ""}</td><td class="num">${esc(money(p.total_discount))}</td>
      <td>${p.active ? "Faol" : "O'chirilgan"}</td><td><button class="btn btn-ghost btn-sm" data-ed="${p.id}" type="button">Tahrir</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">Promo-kod yo'q</td></tr>`}
    </tbody></table></div>`;
  $("#new").onclick = () => promoForm({});
  v.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => promoForm(rows.find((p) => String(p.id) === b.dataset.ed))));
}
function promoForm(p) {
  const edit = Boolean(p.id);
  const exp = p.expires_at ? new Date(p.expires_at).toISOString().slice(0, 10) : "";
  sheet(`<h2>${edit ? "Promo-kodni tahrirlash" : "Yangi promo-kod"}</h2>
    <form class="form" id="pf">
      <div class="field"><label>Kod</label><input class="input" name="code" required value="${esc(p.code || "")}" placeholder="YANGIYIL" style="text-transform:uppercase"></div>
      <div class="field"><label>Turi</label><select class="input" name="kind"><option value="percent" ${p.kind !== "fixed" ? "selected" : ""}>Foiz (%)</option><option value="fixed" ${p.kind === "fixed" ? "selected" : ""}>Qat'iy summa (so'm)</option></select></div>
      <div class="field"><label>Qiymati</label><input class="input" name="value" required inputmode="decimal" value="${esc(p.value ? Number(p.value) : "")}"></div>
      <div class="field"><label>Amal qilish muddati</label><input class="input" type="date" name="expires" value="${esc(exp)}"></div>
      <div class="field"><label>Necha marta ishlatiladi (bo'sh: cheksiz)</label><input class="input" name="maxUses" inputmode="numeric" value="${esc(p.max_uses || "")}"></div>
      <div class="field"><label>Holat</label><select class="input" name="active"><option value="1" ${p.active !== false ? "selected" : ""}>Faol</option><option value="0" ${p.active === false ? "selected" : ""}>O'chirilgan</option></select></div>
      <div class="field full"><label>Qaysi xizmatlarga (hech biri belgilanmasa: hammasiga)</label>
        <div class="acts">${Object.entries(SVC).map(([k, l]) => `<label class="chip"><input type="checkbox" name="svc" value="${k}" ${p.services && p.services.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
      <button class="btn btn-primary full" type="submit">Saqlash</button>
    </form>`);
  $("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const svcs = f.getAll("svc");
    const body = {
      code: String(f.get("code")).trim().toUpperCase(), kind: f.get("kind"), value: Number(String(f.get("value")).replace(/[\s,]/g, "")),
      expiresAt: f.get("expires") ? f.get("expires") + "T23:59:59+05:00" : null,
      maxUses: f.get("maxUses") ? Number(f.get("maxUses")) : null, active: f.get("active") === "1", services: svcs.length ? svcs : null,
    };
    try { await api("/api/admin/promos" + (edit ? "/" + p.id : ""), { method: edit ? "PUT" : "POST", body }); closeSheet(); toast("Saqlandi"); render(); }
    catch (er) { toast(er.code === "PROMO_CODE_EXISTS" ? "Bunday kod allaqachon bor" : er.code === "PROMO_CODE_FORMAT" ? "Kod 3–32 belgi: lotin harflari, raqamlar, - va _" : er.message); }
  };
}

async function reviews(v) {
  const st = reviews.st ?? "pending";
  const rows = await api("/api/admin/reviews" + (st ? "?status=" + st : ""));
  v.innerHTML = `<h1>Sharhlar</h1>
    <div class="filters">${[["pending", "Tekshirilmagan"], ["published", "E'lon qilingan"], ["rejected", "Rad etilgan"], ["", "Hammasi"]].map(([k, l]) => `<button class="chip" data-s="${k}" aria-pressed="${st === k}" type="button">${l}</button>`).join("")}</div>
    <div class="list">${rows.map((r) => `<article class="item"><div class="item-h"><b>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)} · ${r.username ? "@" + esc(r.username) : "—"}</b><span class="hint">${esc(r.public_id)} · ${esc(dt(r.created_at))}</span></div>
      <p>${esc(r.text)}</p><p class="hint">${esc(r.title)}</p>
      ${r.status === "pending" ? `<div class="acts"><button class="btn btn-primary btn-sm" data-pub="${r.id}" type="button">E'lon qilish</button><button class="btn btn-ghost btn-sm" data-rej="${r.id}" type="button">Rad etish</button></div>` : ""}</article>`).join("") || `<p class="empty">Sharh yo'q</p>`}</div>`;
  v.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { reviews.st = b.dataset.s; render(); }));
  const act = async (id, a) => { try { await api(`/api/admin/reviews/${id}/${a}`, { body: {} }); toast(a === "publish" ? "E'lon qilindi" : "Rad etildi"); render(); } catch (e) { toast(e.message); } };
  v.querySelectorAll("[data-pub]").forEach((b) => (b.onclick = () => act(b.dataset.pub, "publish")));
  v.querySelectorAll("[data-rej]").forEach((b) => (b.onclick = () => act(b.dataset.rej, "reject")));
}

async function logs(v) {
  const [a, er] = await Promise.all([api("/api/admin/audit"), api("/api/admin/errors")]);
  v.innerHTML = `<h1>Jurnallar</h1>
    <div class="section"><h2>Xatolar (Marketapp, bot, server)</h2><div class="det">${er.map((x) => `${dt(x.created_at)} · ${x.source} · ${x.message}`).map(esc).join("\n") || "Xato yo'q"}</div></div>
    <div class="section"><h2>Admin harakatlari</h2><div class="det">${a.map((x) => `${dt(x.created_at)} · ${x.actor} · ${x.action}${x.target ? " · " + x.target : ""}`).map(esc).join("\n") || "—"}</div></div>`;
}

// ---------- O'z mahsulotlari ("Reklama") ----------
const KIND = { gifts: "NFT sovg'a", usernames: "Username", numbers: "Anonim raqam" };
async function own(v) {
  const rows = await api("/api/admin/own");
  v.innerHTML = `<h1>Mening mahsulotlarim</h1>
    <p class="hint" style="margin-bottom:12px">Bu mahsulotlar mijozga <b>"Reklama"</b> yorlig'i bilan har doim birinchi ko'rinadi: qaysi filtr tanlansa ham.</p>
    <button class="btn btn-primary btn-sm" id="new" type="button" style="margin-bottom:12px">+ Yangi mahsulot</button>
    <div class="tbl-wrap"><table><thead><tr><th>Mahsulot</th><th>Turi</th><th>Ijara</th><th>Bo'lib to'lash</th><th>Naqd</th><th>Holat</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.model ? `<br><small class="hint">${esc(p.model)}${p.backdrop ? " · " + esc(p.backdrop) : ""}</small>` : ""}</td>
      <td>${esc(KIND[p.kind])}</td>
      <td>${p.rent_enabled ? `${esc(money(p.rent_price))}/kun<br><small class="hint">${p.rent_min}–${p.rent_max} kun</small>` : "—"}</td>
      <td>${p.inst_enabled ? "Ha" : "—"}</td><td>${p.cash_enabled ? esc(money(p.cash_price)) : "—"}</td>
      <td>${p.visible ? "Ko'rinadi" : "Yashirin"}</td>
      <td><div class="acts"><button class="btn btn-ghost btn-sm" data-ed="${p.id}" type="button">Tahrir</button>
        <button class="btn btn-ghost btn-sm" data-del="${p.id}" type="button">O'chirish</button></div></td></tr>`).join("") || `<tr><td colspan="7" class="empty">Hali mahsulot yo'q</td></tr>`}
    </tbody></table></div>`;
  $("#new").onclick = () => ownForm({});
  v.querySelectorAll("[data-ed]").forEach((b) => (b.onclick = () => ownForm(rows.find((p) => String(p.id) === b.dataset.ed))));
  v.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Rostdan o'chirilsinmi?"; return; }
    try { await api("/api/admin/own/" + b.dataset.del, { method: "DELETE" }); toast("O'chirildi"); render(); } catch (e) { toast(e.message); }
  }));
}
function ownForm(p) {
  const edit = Boolean(p.id);
  const ck = (name, on, label) => `<label class="chip"><input type="checkbox" name="${name}" ${on ? "checked" : ""}> ${label}</label>`;
  sheet(`<h2>${edit ? "Mahsulotni tahrirlash" : "Yangi mahsulot"}</h2>
    <form class="form" id="of">
      <div class="field"><label>Turi</label><select class="input" name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label>Nomi</label><input class="input" name="name" required value="${esc(p.name || "")}" placeholder="Plush Pepe #123 yoki @nazarov yoki +888 0123 4567"></div>
      <div class="field full"><label>Rasm havolasi (ixtiyoriy, https://...). Bo'sh qolsa, NFT rasmi nomidan avtomatik olinadi</label><input class="input" name="image" value="${esc(p.image || "")}" inputmode="url"></div>
      <div class="field"><label>Model (ixtiyoriy)</label><input class="input" name="model" value="${esc(p.model || "")}"></div>
      <div class="field"><label>Fon (ixtiyoriy)</label><input class="input" name="backdrop" value="${esc(p.backdrop || "")}"></div>
      <div class="field"><label>Belgi (ixtiyoriy)</label><input class="input" name="symbol" value="${esc(p.symbol || "")}"></div>
      <div class="field full"><label>Mijoz nima qila oladi?</label>
        <div class="acts">${ck("rent_enabled", p.rent_enabled, "Ijaraga olish")}${ck("inst_enabled", p.inst_enabled, "Bo'lib to'lab sotib olish")}${ck("cash_enabled", p.cash_enabled, "Naqd sotib olish")}</div></div>
      <div class="field"><label>Ijara: kunlik narx (so'm)</label><input class="input" name="rent_price" inputmode="decimal" value="${esc(p.rent_price ? Number(p.rent_price) : "")}"></div>
      <div class="field"><label>Ijara: eng kam kun</label><input class="input" name="rent_min" inputmode="numeric" value="${esc(p.rent_min || 1)}"></div>
      <div class="field"><label>Ijara: eng ko'p kun</label><input class="input" name="rent_max" inputmode="numeric" value="${esc(p.rent_max || 30)}"></div>
      <div class="field"><label>Naqd sotuv narxi (so'm)</label><input class="input" name="cash_price" inputmode="decimal" value="${esc(p.cash_price ? Number(p.cash_price) : "")}"></div>
      <div class="field"><label>Tartib (kichik raqam tepada)</label><input class="input" name="position" inputmode="numeric" value="${esc(p.position || 0)}"></div>
      <div class="field"><label>Holat</label><select class="input" name="visible"><option value="1" ${p.visible !== false ? "selected" : ""}>Ko'rinadi</option><option value="0" ${p.visible === false ? "selected" : ""}>Yashirin (sotilgan)</option></select></div>
      <p class="alert full" id="ofErr" hidden></p>
      <button class="btn btn-primary full" type="submit">Saqlash</button>
    </form>`);
  $("#of").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const n = (k) => Number(String(f.get(k) || "").replace(/[\s,]/g, ""));
    const body = {
      kind: f.get("kind"), name: String(f.get("name")).trim(), image: String(f.get("image") || "").trim() || null,
      model: String(f.get("model") || "").trim() || null, backdrop: String(f.get("backdrop") || "").trim() || null, symbol: String(f.get("symbol") || "").trim() || null,
      rent_enabled: f.get("rent_enabled") === "on", rent_price: n("rent_price"), rent_min: n("rent_min"), rent_max: n("rent_max"),
      inst_enabled: f.get("inst_enabled") === "on", cash_enabled: f.get("cash_enabled") === "on", cash_price: n("cash_price"),
      position: n("position"), visible: f.get("visible") === "1",
    };
    if (!body.rent_enabled && !body.inst_enabled && !body.cash_enabled) {
      const box = $("#ofErr"); const m = "Kamida bittasini belgilang: Ijaraga olish, Bo'lib to'lab sotib olish yoki Naqd sotib olish";
      box.textContent = m; box.hidden = false; box.scrollIntoView({ block: "center" }); return toast(m);
    }
    try { await api("/api/admin/own" + (edit ? "/" + p.id : ""), { body }); closeSheet(); toast("Saqlandi"); render(); }
    catch (er) {
      const F = { name: "Nomi", image: "Rasm havolasi (https:// bilan boshlanishi kerak)", rent_price: "Ijara: kunlik narx", rent_min: "Ijara: eng kam kun",
        rent_max: "Ijara: eng ko'p kun (eng kam kundan kichik bo'lmasin)", cash_price: "Naqd sotuv narxi", modes: "Mijoz nima qila oladi", kind: "Turi" };
      const field = er.code === "VALIDATION" && er.extra && er.extra.field;
      const msg = field ? "Shu maydonni tekshiring: " + (F[field] || field) : (er.message || "Xato") + " (Jurnallar bo'limida batafsil)";
      const box = $("#ofErr"); if (box) { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: "center" }); }
      toast(msg);
    }
  };
}

const VIEWS = { dashboard, queue, orders, receipts, customers, installments, promos, reviews, settings, logs, own };
async function render() {
  if (!(await ensureAuth())) return;
  const r = location.hash.slice(1) || "dashboard";
  document.querySelectorAll("[data-r]").forEach((a) => (a.dataset.r === r ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const v = $("#view");
  v.innerHTML = `<div class="spin"></div>`;
  try { await (VIEWS[r] || dashboard)(v); } catch (e) { v.innerHTML = `<p class="alert">${esc(e.message)}</p>`; }
  api("/api/admin/stats").then((s) => {
    const q = $("#cQueue"), c = $("#cRc");
    q.textContent = s.orders.queued; q.hidden = !s.orders.queued;
    c.textContent = s.pendingReceipts; c.hidden = !s.pendingReceipts;
    const rv = $("#cRv"); rv.textContent = s.pendingReviews; rv.hidden = !s.pendingReviews;
  }).catch(() => {});
}
window.addEventListener("hashchange", render);
render();
})();
