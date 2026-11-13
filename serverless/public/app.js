/* NAZAROVtggifts — mijoz ilovasi (sayt va Telegram Mini App) */
(() => {
"use strict";
const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }

const LANGS = ["uz", "ru", "en", "zh"];
const LOCALE = { uz: "uz-UZ", ru: "ru-RU", en: "en-US", zh: "zh-CN" };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
// t.me havolalari Telegram ichida chatni to'g'ridan-to'g'ri ochsin
document.addEventListener("click", (e) => {
  const l = e.target.closest && e.target.closest('a[href^="https://t.me/"]');
  if (l && tg && tg.openTelegramLink) { e.preventDefault(); try { closeSheet(); } catch (_) {} tg.openTelegramLink(l.href); }
});
const S = {
  lang: pickLang(),
  token: store.get("ng_token"),
  me: null, cfg: null,
  drafts: {},          // har bir xizmat uchun tanlovlar
  rent: {},            // kategoriya bo'yicha katalog
  lastOrder: null,
};
function pickLang() {
  const s = store.get("ng_lang");
  if (LANGS.includes(s)) return s;
  const n = ((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language || "uz").slice(0, 2);
  return LANGS.includes(n) ? n : "uz";
}

// ---------- yordamchilar ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function t(k, vars) {
  let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.uz[k] ?? k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split("{" + a + "}").join(b);
  return s;
}
// O'zbekcha: 1 234 567 ko'rinishi (bo'sh joy bilan guruhlash)
const money = (x) => new Intl.NumberFormat(S.lang === "uz" ? "ru-RU" : LOCALE[S.lang], { maximumFractionDigits: 2 }).format(Number(x));
const som = (x) => money(x) + " " + ({ uz: "so'm", ru: "сум", en: "UZS", zh: "苏姆" }[S.lang]);
function date(d) {
  if (!d) return "—";
  const x = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d);
  if (S.lang === "uz") return String(x.getDate()).padStart(2, "0") + "." + String(x.getMonth() + 1).padStart(2, "0") + "." + x.getFullYear();
  return x.toLocaleDateString(LOCALE[S.lang], { year: "numeric", month: "long", day: "numeric" });
}
const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
const round2 = (x) => Math.round(x * 100) / 100;
function rentPrice(ppdNano, days, f) {
  const P = Number(BigInt(ppdNano) * BigInt(days)) / 1e9;
  return Math.ceil(round2((P + f.add) * f.mult * f.rate));
}
/** Har qanday ijara mahsuloti (Marketapp yoki o'zimizniki) uchun d kunlik narx, butun so'm. */
function itemPrice(it, f, d) { return it.own ? Math.ceil(it.ppd * d) : rentPrice(it.pricePerDayNano, d, f); }
/** Eng uzoq muddatga olinganda kuniga tushadigan eng arzon narx. */
function bestPerDay(it, f) { return Math.ceil(itemPrice(it, f, it.maxDays) / it.maxDays); }

let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }
function errText(e) {
  const code = e && e.code;
  if (code && I18N.uz["err_" + code]) {
    const x = e.extra || {};
    return t("err_" + code, x);
  }
  return t("err_generic");
}

/** Serverless backendga chaqiruv: Telegram.WebApp.Serverless.call('app', { action, ... }). */
function call(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!tg || !tg.Serverless) return reject({ code: "NOT_IN_TELEGRAM", extra: {} });
    tg.Serverless.call("app", { ...params, action }, (err, result) => {
      if (err) {
        const p = err.parameters || {};
        const { code, ...extra } = p;
        return reject({ code: code || (err.type === "ENDPOINT_ERROR" ? err.message : "INTERNAL"), extra });
      }
      resolve(result);
    });
  });
}

/** Rasmni JPEG ga siqib, base64 qiladi (katta tomoni 1600px gacha). */
function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject({ code: "FILE_TYPE_NOT_ALLOWED", extra: {} });
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject({ code: "FILE_TYPE_NOT_ALLOWED", extra: {} }); };
    img.src = url;
  });
}

/** Avvalgi REST yo'llarini Serverless amallariga moslash (sahifalar kodi o'zgarmasligi uchun). */
async function api(path, opts = {}) {
  const body = opts.body;
  const [p, qs] = path.split("?");
  const parts = p.replace(/^\/api\//, "").split("/");
  const m = (re) => re.exec(p);
  let x;
  if (p === "/api/config") return call("config");
  if (p === "/api/me") return call("me");
  if (p === "/api/me/lang") return call("setLang", body);
  if (p === "/api/auth/telegram") return { token: "telegram" };
  if (p === "/api/orders") return body ? call("createOrder", body) : call("myOrders");
  if (p === "/api/promo/check") return call("checkPromo", body);
  if (p === "/api/nft/collections") return call("giftCollections");
  if ((x = m(/^\/api\/nft\/collections\/([^/]+)\/attributes$/))) return call("collectionAttributes", { address: decodeURIComponent(x[1]) });
  if (p === "/api/uploads/image") return call("uploadImage", { image: await imageToBase64(body.get("file")) });
  if (parts[0] === "own") return call("ownList", { category: parts[1] });
  if (parts[0] === "rent") return call("rentList", { category: parts[1], ...Object.fromEntries(new URLSearchParams(qs || "")) });
  if ((x = m(/^\/api\/orders\/([^/]+)\/review$/))) return call("leaveReview", { publicId: x[1], ...body });
  if ((x = m(/^\/api\/installments\/(\d+)\/pay$/))) return call("payInstallment", { id: Number(x[1]), ...body });
  if (p === "/api/balance") {
    const b = await call("balance");
    return { ...b, instructions: b.warning,
      ledger: b.ledger.map((l) => ({ ...l, created_at: l.createdAt })), receipts: b.receipts.map((r) => ({ ...r, created_at: r.createdAt })) };
  }
  if ((x = m(/^\/api\/track\/(.+)$/))) return call("track", { publicId: x[1] });
  if (p === "/api/reviews") return call("reviews");
  throw { code: "UNKNOWN_ACTION", extra: {} };
}

function sheet(html) { $("#sheet").innerHTML = html; $("#modal").hidden = false; }
function closeSheet() { $("#modal").hidden = true; $("#sheet").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeSheet(); });

// ---------- kirish ----------
async function loadMe() {
  if (!S.token) return null;
  try { S.me = await api("/api/me"); } catch { S.me = null; }
  return S.me;
}
async function login() {
  if (S.me) return S.me;
  if (await loadMe()) return S.me;
  if (tg) {
    try {
      const r = await api("/api/auth/telegram", { body: { initData: tg.initData } });
      S.token = r.token; store.set("ng_token", r.token);
      await api("/api/me/lang", { body: { lang: S.lang } }).catch(() => {});
      return await loadMe();
    } catch (e) { toast(errText(e)); }
  }
  return null;
}
window.onTgAuth = async (user) => {
  try {
    const widget = {};
    for (const [k, v] of Object.entries(user)) widget[k] = String(v);
    const r = await api("/api/auth/telegram", { body: { widget } });
    S.token = r.token; store.set("ng_token", r.token);
    await api("/api/me/lang", { body: { lang: S.lang } }).catch(() => {});
    await loadMe();
    const back = store.get("ng_after_login") || "home";
    store.set("ng_after_login", null);
    location.hash = back;
    render();
  } catch (e) { toast(errText(e)); }
};
async function needLogin() {
  if (await login()) return true;
  store.set("ng_after_login", location.hash.slice(1) || "home");
  location.hash = "login";
  return false;
}
function viewLogin(v) {
  const bot = (window.NG_CONFIG || {}).botUsername;
  if (!tg) {
    v.innerHTML = `<div class="center"><img src="/assets/logo-mark.png" alt="" width="90"><h1>${esc(t("open_in_tg"))}</h1>
      <p class="hint">${esc(t("open_in_tg_text"))}</p>
      ${bot ? `<a class="btn btn-primary" href="https://t.me/${esc(bot)}?start=web">${esc(t("login_bot"))}</a>` : ""}</div>`;
    return;
  }
  v.innerHTML = `<div class="center">
      <img src="/assets/logo-mark.png" alt="" width="90">
      <h1>${esc(t("login_title"))}</h1>
      <p class="hint">${esc(t("login_text"))}</p>
      <div id="tgw"></div>
      ${bot ? `<a class="btn btn-ghost" href="https://t.me/${esc(bot)}?start=web" target="_blank" rel="noopener">${esc(t("login_bot"))}</a>` : `<p class="alert">${esc(t("login_unavailable"))}</p>`}
    </div>`;
  if (bot) {
    const s = document.createElement("script");
    s.async = true; s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.setAttribute("data-telegram-login", bot); s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "12"); s.setAttribute("data-onauth", "onTgAuth(user)"); s.setAttribute("data-request-access", "write");
    $("#tgw").appendChild(s);
  }
}

/** Telefon raqami bo'lmasa — ulashishni so'raydi. true: raqam bor. */
async function ensurePhone() {
  if (S.me && S.me.hasPhone) return true;
  const bot = (window.NG_CONFIG || {}).botUsername;
  return new Promise((resolve) => {
    sheet(`<h2>${esc(t("phone_title"))}</h2><p class="hint">${esc(t("phone_text"))}</p>
      ${tg ? `<button class="btn btn-primary" id="phShare" type="button">${esc(t("phone_share"))}</button>`
           : bot ? `<a class="btn btn-primary" href="https://t.me/${esc(bot)}?start=phone" target="_blank" rel="noopener">${esc(t("phone_bot"))}</a>` : ""}
      <button class="btn btn-ghost" id="phCheck" type="button">${esc(t("phone_check"))}</button>
      <p class="err" id="phErr" hidden></p>`);
    const check = async () => {
      await loadMe();
      if (S.me && S.me.hasPhone) { closeSheet(); resolve(true); return true; }
      return false;
    };
    const share = $("#phShare");
    if (share) share.onclick = () => tg.requestContact(async (ok) => {
      if (!ok) return;
      for (let i = 0; i < 10; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 1000)); }
    });
    $("#phCheck").onclick = async () => { if (!(await check())) { const e = $("#phErr"); e.textContent = t("phone_text"); e.hidden = false; } };
    $("#modal").addEventListener("click", function h(e) { if (e.target.id === "modal") { $("#modal").removeEventListener("click", h); resolve(false); } });
  });
}

/** Buyurtmani yuboradi. Naqd bo'lsa — avval tasdiqlash oynasi. */
async function placeOrder(body, cashAmount) {
  if (!(await needLogin())) return;
  if (!(await ensurePhone())) return;
  const go = async (btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await api("/api/orders", { body });
      closeSheet();
      S.lastOrder = r;
      S.drafts[body.service] = null;
      S.me = null;
      location.hash = "done";
    } catch (e) {
      if (btn) btn.disabled = false;
      if (e.code === "PHONE_REQUIRED") { S.me && (S.me.hasPhone = false); closeSheet(); return placeOrder(body, cashAmount); }
      if (e.code === "INSUFFICIENT_BALANCE") return insufficient(cashAmount);
      closeSheet(); toast(errText(e));
    }
  };
  if (body.paymentMethod !== "cash") return go();
  await loadMe();
  const bal = Number(S.me ? S.me.balance : 0);
  let toPay = cashAmount;
  const draw = (promoLine) => {
    sheet(`<h2>${esc(t("confirm_title"))}</h2>
      <div class="row2" style="grid-template-columns:1fr auto">
        <input class="input" id="promo" placeholder="${esc(t("promo_ph"))}" value="${esc(body.promoCode || "")}" autocapitalize="characters" autocomplete="off">
        <button class="btn btn-ghost btn-sm" id="promoBtn" type="button">${esc(t("apply"))}</button>
      </div>
      ${promoLine || ""}
      <p>${esc(t("confirm_debit", { a: money(toPay) }))}</p>
      <p class="hint">${esc(t("your_balance", { b: money(bal) }))}</p>
      ${bal < toPay ? `<p class="alert">${esc(t("insufficient"))}</p>${topupBtn()}`
                    : `<button class="btn btn-primary" id="cfOk" type="button">${esc(t("confirm"))}</button>`}
      <button class="btn btn-ghost" id="cfNo" type="button">${esc(t("cancel"))}</button>`);
    const ok = $("#cfOk"); if (ok) ok.onclick = (e) => go(e.currentTarget);
    const top = $("#goTop"); if (top) top.onclick = closeSheet;
    $("#cfNo").onclick = closeSheet;
    $("#promoBtn").onclick = async () => {
      const code = $("#promo").value.trim();
      if (!code) { delete body.promoCode; toPay = cashAmount; return draw(); }
      try {
        const r = await api("/api/promo/check", { body: { code, service: body.service, price: cashAmount } });
        body.promoCode = r.code; toPay = Number(r.finalPrice);
        draw(`<p class="hint" style="color:var(--ok);font-weight:800">${esc(t("promo_ok", { d: som(r.discount) }))}</p>`);
      } catch (e) {
        delete body.promoCode; toPay = cashAmount;
        draw(`<p class="err">${esc(errText(e))}</p>`);
      }
    };
  };
  draw();
}
/** "Balansni to'ldirish": admin username kiritilgan bo'lsa, to'g'ridan-to'g'ri admin chatini ochadi. */
function topupBtn() {
  const a = S.cfg && S.cfg.adminContact ? String(S.cfg.adminContact).replace(/^@/, "") : "";
  return a ? `<a class="btn btn-primary" href="https://t.me/${esc(a)}" target="_blank" rel="noopener" id="goTop">${esc(t("topup"))}</a>`
           : `<a class="btn btn-primary" href="#balance" id="goTop">${esc(t("topup"))}</a>`;
}
function insufficient(amount) {
  sheet(`<h2>${esc(t("insufficient"))}</h2>
    <p class="hint">${esc(t("your_balance", { b: money(S.me ? S.me.balance : 0) }))} · ${esc(t("total"))}: ${esc(som(amount))}</p>
    ${topupBtn()}
    <p class="hint" style="text-align:center">${esc(t("topup_contact"))}</p>
    <button class="btn btn-ghost" id="cfNo" type="button">${esc(t("cancel"))}</button>`);
  $("#goTop").onclick = closeSheet;
  $("#cfNo").onclick = closeSheet;
}

// ---------- umumiy bo'laklar ----------
const ICONS = {
  nft_gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M2 9h20M12 9v12M12 9C10 4 6 4 6 7s6 2 6 2zm0 0c2-5 6-5 6-2s-6 2-6 2z"/></svg>',
  gift_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  username_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
  number_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>',
  premium: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3 6.2 6.8.9-5 4.7 1.3 6.7L12 17.3 5.9 20.5l1.3-6.7-5-4.7 6.8-.9z"/></svg>',
  stars: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 6.2 6.8.9-5 4.7 1.3 6.7L12 17.3 5.9 20.5l1.3-6.7-5-4.7 6.8-.9z"/></svg>',
};
const ROUTE = { nft_gift: "nft", gift_rent: "rent-gifts", username_rent: "rent-usernames", number_rent: "rent-numbers", premium: "premium", stars: "stars" };

function opt(id, label, note, value, checked, group) {
  return `<button type="button" class="opt" role="radio" aria-checked="${checked}" data-g="${group}" data-v="${esc(id)}">
    <span class="dot"></span><span class="txt"><b>${esc(label)}</b>${note ? `<small>${esc(note)}</small>` : ""}</span>${value ? `<span class="val">${esc(value)}</span>` : ""}</button>`;
}
function stepHead(n, label) { return `<div class="step-h"><span class="step-n">${n}</span><h2>${esc(label)}</h2></div>`; }
function bindOpts(root, onPick) {
  root.querySelectorAll(".opt[data-g]").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.g, b.dataset.v)));
}

function recipientStep(n, d, selfOnly) {
  const noUser = S.me && !S.me.username;
  if (selfOnly) { d.rcp = "me"; return ""; }
  return `<section class="step">${stepHead(n, t("step_recipient"))}
    <div class="row2" role="radiogroup">
      ${opt("me", t("rcp_me"), "", "", d.rcp === "me", "rcp")}
      ${selfOnly ? "" : opt("other", t("rcp_other"), "", "", d.rcp === "other", "rcp")}
    </div>
    ${d.rcp === "other" ? `<input class="input" id="rcpUser" placeholder="${esc(t("rcp_placeholder"))}" value="${esc(d.rcpUser || "")}" autocomplete="off" autocapitalize="off" spellcheck="false">` : ""}
    ${d.rcp === "me" && noUser ? `<p class="alert">${esc(t("rcp_me_missing"))}</p>` : ""}
  </section>`;
}
function payStep(n, d, types) {
  return `<section class="step">${stepHead(n, t("step_pay"))}
    <div class="opts" role="radiogroup">
      ${opt("cash", t("pay_full"), t("pay_full_note"), "", d.pay === "cash", "pay")}
      ${opt("installment", t("pay_inst"), t("pay_inst_note"), "", d.pay === "installment", "pay")}
    </div>
    ${d.pay === "installment" && types ? `<div class="field"><label>${esc(t("inst_type"))}</label><div class="opts" role="radiogroup">
      ${types.map((ty) => opt(ty, t(ty), t(ty + "_desc"), "", d.itype === ty, "itype")).join("")}</div></div>` : ""}
    ${d.pay === "installment" ? instExtra(d) : ""}
  </section>`;
}

// --- Bo'lib to'lash: muddat (oy) va boshlang'ich to'lov ---
const WHEEL_H = 44, WHEEL_MAX = 240;
const needsDown = (ty) => ty === "plan2" || ty === "uzum";
function instExtra(d) {
  if (!d.itype) return "";
  let h = `<div class="field"><label>${esc(t("months_q"))}</label>`;
  if (d.itype === "uzum") {
    h += `<div class="chips">${[3, 6, 12].map((m) => `<button type="button" class="chip" data-g="months" data-v="${m}" aria-pressed="${Number(d.months) === m}">${m} ${esc(t("months_unit"))}</button>`).join("")}</div>`;
  } else {
    const items = Array.from({ length: WHEEL_MAX }, (_, i) => `<div class="wheel-i${i + 1 === Number(d.months) ? " on" : ""}">${i + 1} ${esc(t("months_unit"))}</div>`).join("");
    h += `<div class="wheel" id="mWheel"><div class="wheel-pad"></div>${items}<div class="wheel-pad"></div></div><p class="hint">${esc(t("months_pick"))}</p>`;
  }
  h += `</div>`;
  if (d.itype === "plan1") {
    const c = d._ctx ? d._ctx() : {};
    h += `<div class="field"><label>${esc(t("inst_down"))}</label><p class="alert" style="margin:0">${c.down1 != null ? esc(som(c.down1)) : esc(t("down_by_admin"))}</p></div>`;
  }
  if (needsDown(d.itype)) {
    h += `<div class="field"><label>${esc(t("down_q"))}</label><div class="row2" role="radiogroup">
      ${opt("no", t("dp_no"), "", "", d.dp === "no", "dp")}${opt("yes", t("dp_yes"), "", "", d.dp === "yes", "dp")}</div>
      ${d.dp === "yes" ? `<input class="input" id="dpAmt" type="number" inputmode="numeric" min="1" step="1" placeholder="${esc(t("down_ph"))}" value="${esc(d.dpAmt || "")}">` : ""}</div>`;
  }
  return h + `<div id="instSum">${instSummary(d)}</div>`;
}
/** Mijozga faqat boshlang'ich va oylik to'lov (taxminiy) ko'rsatiladi. */
function instSummary(d) {
  const c = d._ctx ? d._ctx() : {};
  const months = Number(d.months);
  if (!d.itype || !(months >= 1) || !(c.base > 0)) return "";
  const down = d.itype === "plan1" ? c.down1 : needsDown(d.itype) ? (d.dp === "yes" ? Number(d.dpAmt) || 0 : d.dp === "no" ? 0 : null) : 0;
  if (down == null || down >= c.base) return "";
  const yearPct = S.cfg && S.cfg.instMarkupYear != null ? Number(S.cfg.instMarkupYear) : 100;
  const monthly = Math.ceil(Math.ceil((c.base - down) * (1 + (months * yearPct) / 12 / 100)) / months);
  return `<div class="isum"><div><span>${esc(t("inst_down"))}</span><b>${esc(som(down))}</b></div>
    <div><span>${esc(t("inst_monthly"))}</span><b>${esc(som(monthly))}</b></div><small>${esc(t("approx"))}</small></div>`;
}
function instOk(d) {
  if (!d.itype || !(Number(d.months) >= 1)) return false;
  if (!needsDown(d.itype)) return true;
  return d.dp === "no" || (d.dp === "yes" && Number(d.dpAmt) > 0);
}
function instBody(d) {
  return { months: Number(d.months), downPayment: needsDown(d.itype) && d.dp === "yes" ? Number(d.dpAmt) : 0 };
}
function resetInst(d, ty) {
  d.months = ty === "uzum" ? null : 12; d.dp = null; d.dpAmt = "";
}
/** Baraban va boshlang'ich to'lov maydonini ulash; upd() "Davom etish" tugmasini yangilaydi. */
function bindInst(v, d, upd) {
  const w = $("#mWheel", v);
  if (w) {
    w.scrollTop = (Number(d.months || 12) - 1) * WHEEL_H;
    let tm;
    w.addEventListener("scroll", () => {
      clearTimeout(tm);
      tm = setTimeout(() => {
        const m = Math.min(WHEEL_MAX, Math.max(1, Math.round(w.scrollTop / WHEEL_H) + 1));
        d.months = m;
        w.querySelectorAll(".wheel-i").forEach((el, i) => el.classList.toggle("on", i + 1 === m));
        const sm = $("#instSum", v); if (sm) sm.innerHTML = instSummary(d);
        upd();
      }, 90);
    });
    w.querySelectorAll(".wheel-i").forEach((el, i) => el.addEventListener("click", () => w.scrollTo({ top: i * WHEEL_H, behavior: "smooth" })));
  }
  const a = $("#dpAmt", v);
  if (a) a.addEventListener("input", () => { d.dpAmt = a.value; const sm = $("#instSum", v); if (sm) sm.innerHTML = instSummary(d); upd(); });
}

// ---------- sahifalar ----------
const SVC_ICON = {
  nft_gift: '<img src="/assets/logo-mark.png" alt="">',
  gift_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  username_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
  number_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>',
  premium: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linejoin="round"><path d="M3 18 5 7l4.5 4L12 5l2.5 6L19 7l2 11z"/><path d="M3 21h18"/></svg>',
  stars: '<svg viewBox="0 0 24 24" fill="url(#sv)"><path d="M12 2l3 6.2 6.8.9-5 4.7 1.3 6.7L12 17.3 5.9 20.5l1.3-6.7-5-4.7 6.8-.9z"/></svg>',
};
const SILVER_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="sv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F3EF"/><stop offset=".5" stop-color="#A3A6A2"/><stop offset="1" stop-color="#E6E7E3"/></linearGradient></defs></svg>';
const HOME_ROUTE = { nft_gift: "nft", gift_rent: "rent", username_rent: "rent", number_rent: "rent", premium: "premium", stars: "stars" };
const RENT_TAB = { gift_rent: "gifts", username_rent: "usernames", number_rent: "numbers" };

async function viewHome(v) {
  const en = (S.cfg && S.cfg.services) || {};
  const list = ["stars", "premium", "gift_rent", "nft_gift", "username_rent", "number_rent"].filter((s) => en[s] !== false);
  v.innerHTML = `${SILVER_DEFS}
    ${S.me ? `<a class="balrow" href="#balance"><span>${esc(t("balance_short"))}</span><b>${esc(som(S.me.balance))}</b></a>` : ""}
    <h1 class="page-title">${esc(t("tg_services"))}</h1>
    <nav class="svc-list">${list.map((s) => `<a class="svc" href="#${HOME_ROUTE[s]}" data-svc="${s}">
        <span class="svc-ic${s === "nft_gift" ? " logo" : ""}">${SVC_ICON[s]}</span>
        <span class="svc-t"><b>${esc(t("svc_" + s))}</b><small>${esc(t("svcd_" + s))}</small></span>
        <span class="chev" aria-hidden="true">›</span></a>`).join("")}</nav>
    <div id="pop"></div>
    <p class="help"><a class="help-link" href="#help">${esc(t("help_link"))}</a></p>`;
  v.querySelectorAll(".svc[data-svc]").forEach((a) => a.addEventListener("click", () => { if (RENT_TAB[a.dataset.svc]) S.rentTab = RENT_TAB[a.dataset.svc]; }));
  if (en.gift_rent === false) return;
  try {
    const st = rentState("gifts");
    if (!st.loaded) {
      if (S.cfg && S.cfg.marketapp) { try { await loadRent("gifts"); } catch { await loadOwn("gifts"); } }
      else await loadOwn("gifts");
    }
    const pop = $("#pop", v);
    if (!pop || !(st.items.length || (st.own || []).length)) return;
    pop.innerHTML = `<div class="sect-h"><h2>${esc(t("popular"))}</h2><a href="#rent" class="link">${esc(t("see_all"))} ›</a></div>
      <div class="strip">${(st.own || []).concat(st.items).slice(0, 10).map((it) => giftCard("gifts", it, st.formula)).join("")}</div>`;
    pop.querySelectorAll(".gcard").forEach((c) => c.addEventListener("click", () => pickRent("gifts", c.dataset.a)));
  } catch { /* ixtiyoriy */ }
}

function viewPremium(v) {
  const d = S.drafts.premium ||= { plan: null, rcp: "me", rcpUser: "", pay: null, itype: null, key: key() };
  const p = S.cfg.premiumPrices;
  const plans = [["m1", "months_1", "m1_note"], ["m3", "months_3"], ["m6", "months_6"], ["m12_login", "months_12_login", "m12_login_note"], ["m12", "months_12"]];
  const cashPrice = d.plan ? p[d.plan] : null;
  d._ctx = () => ({ base: d.plan ? Number(p[d.plan]) : null });
  const isReady = () => d.plan && d.pay && (d.pay === "cash" || instOk(d)) && (d.rcp === "me" ? !S.me || Boolean(S.me.username) : true);
  const ready = isReady();
  v.innerHTML = `<h1 class="page-title">Telegram Premium</h1>
    <section class="step">${stepHead(1, t("step_plan"))}<div class="opts" role="radiogroup">
      ${plans.map(([id, l, note]) => opt(id, t(l), note ? t(note) : "", d.pay === "installment" ? "" : som(p[id]), d.plan === id, "plan")).join("")}
    </div></section>
    ${recipientStep(2, d, d.plan === "m1" || d.plan === "m12_login")}
    ${payStep(d.plan === "m1" || d.plan === "m12_login" ? 2 : 3, d, ["plan2", "uzum"])}
    <div class="cta">
      <div class="sum"><span>${esc(t("total"))}</span><b>${d.pay === "installment" ? esc(t("price_by_admin")) : cashPrice ? esc(som(cashPrice)) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ready ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  wireForm(v, d, "premium", () => placeOrder({
    service: "premium", plan: d.plan, paymentMethod: d.pay, installmentType: d.pay === "installment" ? d.itype : undefined,
    ...(d.pay === "installment" ? instBody(d) : {}),
    recipient: { self: d.rcp === "me", username: d.rcpUser }, idempotencyKey: d.key,
  }, cashPrice), isReady);
}

function viewStars(v) {
  const min = S.cfg.starsMin, price = S.cfg.starsPrice;
  const d = S.drafts.stars ||= { qty: Math.max(min, 100), rcp: "me", rcpUser: "", pay: null, itype: null, key: key() };
  const ok = Number.isInteger(d.qty) && d.qty >= min;
  const total = ok ? round2(d.qty * price) : 0;
  d._ctx = () => ({ base: Number.isInteger(d.qty) && d.qty >= min ? Math.ceil(d.qty * price) : null });
  const isReady = () => Number.isInteger(d.qty) && d.qty >= min && d.pay && (d.pay === "cash" || instOk(d));
  const ready = isReady();
  v.innerHTML = `<h1 class="page-title">Telegram Stars</h1>
    <section class="step">${stepHead(1, t("step_qty"))}
      <input class="input" id="qty" type="number" inputmode="numeric" min="${min}" step="1" value="${esc(d.qty)}">
      <div class="chips">${[50, 100, 250, 500, 1000, 2500].filter((x) => x >= min).map((x) => `<button type="button" class="chip" data-q="${x}" aria-pressed="${d.qty === x}">${x}</button>`).join("")}</div>
      <p class="hint">${esc(t("per_star", { p: money(price) }))} · ${esc(t("min_stars", { n: min }))}</p>
      <p class="err" id="qtyErr" ${ok ? "hidden" : ""}>${esc(t("err_STARS_MIN", { min }))}</p>
    </section>
    ${recipientStep(2, d)}
    ${payStep(3, d, ["plan2", "uzum"])}
    <div class="cta">
      <div class="sum"><span>${esc(t("total"))}</span><b id="starsTotal">${d.pay === "installment" ? esc(t("price_by_admin")) : ok ? esc(som(total)) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ready ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  const qty = $("#qty", v);
  qty.addEventListener("input", () => {
    d.qty = parseInt(qty.value, 10);
    const good = Number.isInteger(d.qty) && d.qty >= min;
    $("#qtyErr", v).hidden = good;
    $("#starsTotal", v).textContent = d.pay === "installment" ? t("price_by_admin") : good ? som(round2(d.qty * price)) : "—";
    $("#go", v).disabled = !isReady();
    const sm = $("#instSum", v); if (sm) sm.innerHTML = instSummary(d);
    v.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.q) === d.qty)));
  });
  v.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { d.qty = Number(c.dataset.q); render(); }));
  wireForm(v, d, "stars", () => placeOrder({
    service: "stars", quantity: d.qty, paymentMethod: d.pay, installmentType: d.pay === "installment" ? d.itype : undefined,
    ...(d.pay === "installment" ? instBody(d) : {}),
    recipient: { self: d.rcp === "me", username: d.rcpUser }, idempotencyKey: d.key,
  }, round2(d.qty * price)), isReady);
}

/** Umumiy: radio tanlovlar, username maydoni, "Davom etish" tugmasi */
function wireForm(v, d, _svc, submit, isReady) {
  bindOpts(v, (g, val) => {
    if (g === "pay" && val !== d.pay) d.itype = null;
    if (g === "itype" && val !== d.itype) resetInst(d, val);
    d[g] = val;
    render();
  });
  v.querySelectorAll(".chip[data-g='months']").forEach((c) => c.addEventListener("click", () => { d.months = Number(c.dataset.v); render(); }));
  bindInst(v, d, () => { if (isReady) $("#go", v).disabled = !isReady(); });
  const u = $("#rcpUser", v);
  if (u) u.addEventListener("input", () => (d.rcpUser = u.value));
  $("#go", v).addEventListener("click", () => {
    if (d.rcp === "other" && !(d.rcpUser || "").trim()) return toast(t("err_RECIPIENT_REQUIRED"));
    submit();
  });
}

// --- NFT sovg'a (maxsus so'rov, faqat bo'lib to'lash) ---
async function viewNft(v) {
  const d = S.drafts.nft_gift ||= { name: "", link: "", image: null, imageLabel: "", model: "any", backdrop: "any", itype: null, collection: null, attrs: null, key: key() };
  const attrList = (type) => {
    const a = d.attrs && d.attrs.find((x) => String(x.trait_type).toLowerCase() === type);
    return a ? a.values.map((x) => x.value) : null;
  };
  const sel = (id, label, type, cur) => {
    const vals = attrList(type);
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      ${vals ? `<select class="input" id="${id}"><option value="any">${esc(t("any"))}</option>${vals.map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`
             : `<div class="row2">${opt("any", t("any"), "", "", cur === "any", id)}${opt("custom", t(id === "model" ? "model_ph" : "backdrop_ph"), "", "", cur !== "any", id)}</div>
                ${cur !== "any" ? `<input class="input" id="${id}Txt" value="${esc(cur === "custom" ? "" : cur)}" placeholder="${esc(t(id === "model" ? "model_ph" : "backdrop_ph"))}">` : ""}`}
    </div>`;
  };
  const hasId = Boolean(d.name.trim() || d.link.trim() || d.image);
  d._ctx = () => ({ base: null, down1: null });
  v.innerHTML = `<h1 class="page-title">${esc(t("nft_title"))}</h1>
    <div id="ownSale"></div>
    <section class="step">${stepHead(1, t("gift_name"))}
      <p class="hint">${esc(t("nft_intro"))}</p>
      <div class="field"><label for="gName">${esc(t("gift_name"))}</label>
        <input class="input" id="gName" list="gCols" value="${esc(d.name)}" placeholder="${esc(t("gift_name_ph"))}" autocomplete="off"><datalist id="gCols"></datalist></div>
      <div class="field"><label for="gLink">${esc(t("gift_link"))}</label>
        <input class="input" id="gLink" value="${esc(d.link)}" placeholder="${esc(t("gift_link_ph"))}" inputmode="url" autocapitalize="off"></div>
      <div class="field"><label>${esc(t("gift_image"))}</label>
        <label class="btn btn-ghost" for="gImg">${esc(d.image ? t("file_chosen") + " ✓" : t("choose_file"))}</label>
        <input id="gImg" type="file" accept="image/jpeg,image/png,image/webp" hidden></div>
    </section>
    <section class="step">${stepHead(2, t("model") + " · " + t("backdrop"))}
      ${sel("model", t("model"), "model", d.model)}
      ${sel("backdrop", t("backdrop"), "backdrop", d.backdrop)}
    </section>
    <section class="step">${stepHead(3, t("inst_type"))}
      <div class="opts" role="radiogroup">${["plan1", "plan2", "uzum"].map((ty) => opt(ty, t(ty), t(ty + "_desc"), "", d.itype === ty, "itype")).join("")}</div>
      ${instExtra(d)}
      <p class="hint">${esc(t("pay_inst_note"))}</p>
    </section>
    <div class="cta">
      ${hasId ? "" : `<p class="hint" style="text-align:center">${esc(t("need_one"))}</p>`}
      <button class="btn btn-primary" id="go" type="button" ${hasId && instOk(d) ? "" : "disabled"}>${esc(t("send_request"))}</button>
    </div>`;

  const upd = () => { $("#go", v).disabled = !((d.name.trim() || d.link.trim() || d.image) && instOk(d)); };
  bindInst(v, d, upd);
  v.querySelectorAll(".chip[data-g='months']").forEach((c) => c.addEventListener("click", () => { d.months = Number(c.dataset.v); render(); }));
  const name = $("#gName", v);
  name.addEventListener("input", () => { d.name = name.value; upd(); });
  name.addEventListener("change", async () => {
    const cols = Array.isArray(S.giftCollections) ? S.giftCollections : [];
    const c = cols.find((x) => x.name.toLowerCase() === name.value.trim().toLowerCase());
    d.collection = c ? c.address : null; d.attrs = null; d.model = "any"; d.backdrop = "any";
    if (c) { try { d.attrs = (await api("/api/nft/collections/" + encodeURIComponent(c.address) + "/attributes")).attributes; } catch {} }
    render();
  });
  $("#gLink", v).addEventListener("input", (e) => { d.link = e.target.value; upd(); });
  $("#gImg", v).addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (!(await needLogin())) return;
    const fd = new FormData(); fd.append("file", f);
    try { d.image = (await api("/api/uploads/image", { body: fd })).file; render(); } catch (er) { toast(errText(er)); }
  });
  for (const id of ["model", "backdrop"]) {
    const s = $("#" + id, v);
    if (s && s.tagName === "SELECT") s.addEventListener("change", () => (d[id] = s.value));
    const tx = $("#" + id + "Txt", v);
    if (tx) tx.addEventListener("input", () => (d[id] = tx.value.trim() || "custom"));
  }
  bindOpts(v, (g, val) => {
    if (g === "itype") { if (val !== d.itype) resetInst(d, val); d.itype = val; }
    else if (g === "dp") d.dp = val;
    else if (g === "model" || g === "backdrop") d[g] = val === "any" ? "any" : (d[g] !== "any" ? d[g] : "custom");
    render();
  });
  $("#go", v).addEventListener("click", () => {
    const clean = (x) => (x === "custom" || !x ? "any" : x);
    placeOrder({
      service: "nft_gift", paymentMethod: "installment", installmentType: d.itype, ...instBody(d),
      giftName: d.name.trim() || undefined, giftLink: d.link.trim() || undefined, giftImage: d.image || undefined,
      collectionAddress: d.collection || undefined, model: clean(d.model), backdrop: clean(d.backdrop), idempotencyKey: d.key,
    });
  });
  // O'z sovg'alarimiz (sotuvda): har doim tepada
  const stG = rentState("gifts");
  if (!stG.ownLoaded) { await loadOwn("gifts"); stG.ownLoaded = true; }
  const sale = (stG.own || []).filter((x) => x.installment || x.cashPrice);
  const os = $("#ownSale", v);
  if (os && sale.length) {
    os.innerHTML = `<div class="sect-h"><h2>${esc(t("own_sale_title"))}</h2></div><div class="strip">${sale.map((it) => giftCard("gifts", { ...it, rent: false }, stG.formula)).join("")}</div>`;
    os.querySelectorAll(".gcard").forEach((c) => c.addEventListener("click", () => {
      const it = sale.find((x) => x.address === c.dataset.a);
      S.rentPick = { category: "gifts", service: "gift_rent", route: "nft", item: it, formula: stG.formula, days: it.minDays, pay: null, key: key(), mode: "buy", itype: null };
      location.hash = "rent-item";
    }));
  }
  if (!S.giftCollections) {
    try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; }
  }
  const dl = $("#gCols", v);
  if (dl && Array.isArray(S.giftCollections)) dl.innerHTML = S.giftCollections.map((c) => `<option value="${esc(c.name)}">`).join("");
}

// --- Ijara katalogi ---
const CAT = { "rent-gifts": ["gifts", "gift_rent"], "rent-usernames": ["usernames", "username_rent"], "rent-numbers": ["numbers", "number_rent"] };
function imgUrl(category, name) {
  if (category === "gifts") {
    const m = /^(.*?)\s*#\s*(\d+)$/.exec(name || "");
    return m ? `https://nft.fragment.com/gift/${m[1].replace(/[^A-Za-z0-9]/g, "").toLowerCase()}-${m[2]}.webp` : null;
  }
  if (category === "usernames") return `https://nft.fragment.com/username/${String(name).replace(/^@/, "").toLowerCase()}.webp`;
  if (category === "numbers") return `https://nft.fragment.com/number/${String(name).replace(/\D/g, "")}.webp`;
  return null;
}
function imgTag(category, name) {
  const u = imgUrl(category, name);
  return u ? `<img src="${esc(u)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:this.dataset.n}))" data-n="${esc(name)}">`
           : `<span class="ph">${esc(name)}</span>`;
}
const attrsOf = (it) => (it.attributes || []).filter((a) => a && a.trait_type && a.value != null).slice(0, 3);

const RENT_SVC = { gifts: "gift_rent", usernames: "username_rent", numbers: "number_rent" };
const TRAITS = { model: "model", backdrop: "backdrop", symbol: "symbol" };
function rentState(cat) {
  return (S.rent[cat] ||= { items: [], own: [], cursor: null, loaded: false, sort: "price_per_day", formula: null, error: null,
    f: { collection: null, model: null, backdrop: null, symbol: null }, attrs: null, cf: {}, q: "" });
}
/** Adminning o'z mahsulotini ijara kartochkasi ko'rinishiga keltirish. */
function normOwn(o) {
  return { own: true, id: o.id, address: "own" + o.id, name: o.name, image: o.image, kind: o.kind,
    attributes: [["Model", o.model], ["Backdrop", o.backdrop], ["Symbol", o.symbol]].filter((a) => a[1]).map(([trait_type, value]) => ({ trait_type, value })),
    rent: Boolean(o.rent), ppd: o.rent ? Number(o.rent.pricePerDay) : 0, minDays: o.rent ? o.rent.minDays : 1, maxDays: o.rent ? o.rent.maxDays : 1,
    installment: o.installment, cashPrice: o.cashPrice, salePrice: o.salePrice ?? null, down1: o.down1 ?? null };
}
async function loadOwn(cat) {
  const st = rentState(cat);
  try { st.own = (await api("/api/own/" + cat)).map(normOwn); } catch { st.own = st.own || []; }
}
async function loadRent(cat, more) {
  const st = rentState(cat);
  const qs = new URLSearchParams({ sort_by: st.sort });
  if (more && st.cursor) qs.set("cursor", st.cursor);
  if (cat === "gifts") {
    if (st.f.collection) qs.set("collection_address", st.f.collection.address);
    for (const k of Object.keys(TRAITS)) if (st.f[k]) qs.set(k, st.f[k]);
  }
  if (!more) await loadOwn(cat);
  const r = await api(`/api/rent/${cat}?${qs}`);
  st.formula = r.formula;
  st.items = more ? st.items.concat(r.items) : r.items;
  st.cursor = r.cursor; st.loaded = true; st.error = null;
}
const shortName = (name) => String(name).replace(/\s*#\s*\d+$/, "");
function priceLine(it, f) {
  if (it.own && !it.rent) return it.cashPrice ? `<b>${esc(money(it.cashPrice))}</b> ${esc(t("som"))}` : esc(t("own_inst_only"));
  const pre = t("from_pre");
  return `${pre ? esc(pre) + " " : ""}<b>${esc(money(bestPerDay(it, f)))}</b> ${esc(t("per_day_from"))}`;
}
function giftCard(cat, it, f) {
  const model = (it.attributes || []).find((a) => /model/i.test(a.trait_type));
  const img = it.own && it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : imgTag(cat, it.name);
  return `<button type="button" class="gcard${it.own ? " own" : ""}" data-a="${esc(it.address)}">
    <span class="gimg">${img}${it.own ? `<span class="adtag">${esc(t("ad_tag"))}</span>` : ""}</span>
    <span class="gb"><b>${esc(cat === "gifts" ? shortName(it.name) : it.name)}</b>
      ${model ? `<small>${esc(model.value)}</small>` : ""}
      <span class="gp">${priceLine(it, f)}</span></span></button>`;
}
function pickRent(cat, address) {
  const st = rentState(cat);
  const it = (st.own || []).find((x) => x.address === address) || st.items.find((x) => x.address === address);
  if (!it) return;
  S.rentPick = { category: cat, service: RENT_SVC[cat], route: "rent", item: it, formula: st.formula, days: it.minDays, pay: null, key: key(),
    mode: it.own && !it.rent ? "buy" : "rent", itype: null };
  location.hash = "rent-item";
}

/** Ro'yxatdan bitta qiymat tanlash oynasi (filtrlar uchun). */
function pickSheet(title, options, current, onPick) {
  const draw = (q = "") => {
    const ql = q.trim().toLowerCase();
    const list = options.filter((o) => !ql || o.label.toLowerCase().includes(ql)).slice(0, 200);
    sheet(`<h2>${esc(title)}</h2>
      ${options.length > 10 ? `<input class="input" id="pkQ" placeholder="${esc(t("search"))}" value="${esc(q)}" autocomplete="off">` : ""}
      <div class="pick">
        <button type="button" class="pk${current == null ? " on" : ""}" data-i="-1">${esc(t("f_all"))}</button>
        ${list.map((o) => `<button type="button" class="pk${current === o.value ? " on" : ""}" data-i="${options.indexOf(o)}"><span>${esc(o.label)}</span>${o.note ? `<small>${esc(o.note)}</small>` : ""}</button>`).join("")}
      </div>`);
    const qi = $("#pkQ"); if (qi) { qi.oninput = () => { const pos = qi.selectionStart; draw(qi.value); const n = $("#pkQ"); n.focus(); n.setSelectionRange(pos, pos); }; }
    $("#sheet").querySelectorAll(".pk").forEach((b) => (b.onclick = () => { closeSheet(); const i = Number(b.dataset.i); onPick(i < 0 ? null : options[i]); }));
  };
  draw();
}

async function viewRent(v) {
  const tab = S.rentTab || "gifts";
  const en = (S.cfg && S.cfg.services) || {};
  const tabs = [["gifts", "tab_gifts", "gift_rent"], ["numbers", "tab_numbers", "number_rent"], ["usernames", "tab_usernames", "username_rent"], ["mine", "tab_mine", null]]
    .filter(([, , svc]) => !svc || en[svc] !== false);
  const head = `<h1 class="page-title">${esc(t("store_title"))}</h1>
    <div class="seg" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="sg${tab === k ? " on" : ""}" data-tab="${k}">${esc(t(l))}</button>`).join("")}</div>`;
  const bindTabs = () => v.querySelectorAll(".sg").forEach((b) => (b.onclick = () => { S.rentTab = b.dataset.tab; render(); }));

  if (tab === "mine") {
    v.innerHTML = head + `<div class="spin"></div>`; bindTabs();
    if (!(await needLogin())) return;
    let data;
    try { data = await api("/api/orders"); } catch (e) { v.innerHTML = head + `<p class="alert">${esc(errText(e))}</p>`; bindTabs(); return; }
    const mine = data.orders.filter((o) => ["gift_rent", "username_rent", "number_rent"].includes(o.service));
    v.innerHTML = head + (mine.length ? `<div class="list">${mine.map((o) => `<article class="item">
        <div class="item-h"><b>${esc(o.title)}</b><span class="badge b-${esc(o.status)}">${esc(t("st_" + o.status))}</span></div>
        <div class="meta"><code>${esc(o.publicId)}</code><span>${esc(date(o.createdAt))}</span>${o.price != null ? `<span>${esc(som(o.price))}</span>` : ""}</div>
        ${o.rentEndsAt ? `<div class="kv"><span>${esc(t("rent_ends"))}</span><b>${esc(date(o.rentEndsAt))}</b></div>` : ""}</article>`).join("")}</div>`
      : `<p class="empty">${esc(t("no_rentals"))}</p>`);
    bindTabs(); return;
  }

  const cat = tab, st = rentState(cat);
  const chip = (k, label, val, disabled) => `<button type="button" class="fchip${val ? " on" : ""}" data-f="${k}" ${disabled ? "disabled" : ""}>${esc(val || label)}<span aria-hidden="true">⌄</span></button>`;
  const cfs = CF[cat] || [];
  const anyFilter = () => (cat === "gifts" ? Boolean(st.f.collection || st.f.model || st.f.backdrop || st.f.symbol) : Object.keys(st.cf).length > 0 || Boolean(st.q));
  const visible = () => st.items.filter((it) => cfs.every((c) => st.cf[c.k] == null || c.test(it, st.cf[c.k])) && (cat !== "usernames" || matchQuery(it.name, st.q)));
  const draw = () => {
    const shown = visible();
    v.innerHTML = head + `
      ${cat === "usernames" ? `<input class="input" id="uq" placeholder="${esc(t("search_user_ph"))}" value="${esc(st.q)}" autocomplete="off" autocapitalize="off" spellcheck="false" style="margin-top:12px">` : ""}
      <div class="filters">
        <button type="button" class="fchip ic" data-f="sort" aria-label="${esc(t("sort_title"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button>
        ${cat === "gifts" ? chip("collection", t("f_gift"), st.f.collection && st.f.collection.name)
          + chip("model", t("f_model"), st.f.model, !st.f.collection) + chip("backdrop", t("f_backdrop"), st.f.backdrop)
          + chip("symbol", t("f_symbol"), st.f.symbol, !st.f.collection) : ""}
        ${cfs.map((c) => chip("cf:" + c.k, t(c.label), st.cf[c.k] != null ? cfLabel(c, st.cf[c.k]) : "")).join("")}
        ${anyFilter() ? `<button type="button" class="fchip clr" data-f="clear">✕ ${esc(t("f_clear"))}</button>` : ""}
      </div>
      ${(st.own || []).length ? `<div class="grid3">${st.own.map((it) => giftCard(cat, it, st.formula)).join("")}</div>` : ""}
      ${st.error ? `<p class="alert">${esc(st.error)}</p><button class="btn btn-ghost" id="retry" type="button">${esc(t("retry"))}</button>` : ""}
      ${!st.loaded && !st.error ? `<div class="spin"></div>` : ""}
      ${st.loaded && !shown.length && !(st.own || []).length ? `<p class="empty">${esc(t("empty_catalog"))}</p>` : ""}
      <div class="grid3">${shown.map((it) => giftCard(cat, it, st.formula)).join("")}</div>
      ${st.cursor && st.loaded ? `<button class="btn btn-ghost more" id="more" type="button">${esc(t("load_more"))}</button>` : ""}`;
    bindTabs();
    v.querySelectorAll(".gcard").forEach((c) => c.addEventListener("click", () => pickRent(cat, c.dataset.a)));
    v.querySelectorAll(".fchip").forEach((b) => b.addEventListener("click", () => openFilter(b.dataset.f)));
    const more = $("#more", v); if (more) more.addEventListener("click", () => reload(true));
    const retry = $("#retry", v); if (retry) retry.addEventListener("click", () => reload());
    const uq = $("#uq", v);
    if (uq) uq.addEventListener("input", () => {
      st.q = uq.value; const pos = uq.selectionStart; draw();
      const n = $("#uq", v); n.focus(); n.setSelectionRange(pos, pos);
    });
  };
  const reload = async (more) => {
    if (!more) { st.loaded = false; st.items = []; }
    st.error = null; draw();
    try { await loadRent(cat, more); } catch (e) { st.error = t("catalog_error"); st.loaded = true; }
    if (location.hash.slice(1) === "rent" && (S.rentTab || "gifts") === cat) draw();
  };
  const openFilter = async (k) => {
    if (k === "clear") {
      if (cat === "gifts") { st.f = { collection: null, model: null, backdrop: null, symbol: null }; st.attrs = null; return reload(); }
      st.cf = {}; st.q = ""; return draw();
    }
    if (k.startsWith("cf:")) {
      const c = cfs.find((x) => x.k === k.slice(3));
      return pickSheet(t(c.label), c.opts(st.items), st.cf[c.k] ?? null, (o) => { if (o) st.cf[c.k] = o.value; else delete st.cf[c.k]; draw(); });
    }
    if (k === "sort") {
      return pickSheet(t("sort_title"), SORTS[cat].map((x) => ({ value: x, label: t("sort_" + x) })),
        st.sort, (o) => { st.sort = o ? o.value : "price_per_day"; reload(); });
    }
    if (k === "collection") {
      if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } }
      const cols = Array.isArray(S.giftCollections) ? S.giftCollections : [];
      return pickSheet(t("f_gift"), cols.map((c) => ({ value: c.address, label: c.name, c })), st.f.collection && st.f.collection.address, async (o) => {
        st.f = { collection: o ? { name: o.c.name, address: o.c.address } : null, model: null, backdrop: st.f.backdrop, symbol: null };
        st.attrs = null;
        if (o) { try { st.attrs = (await api("/api/nft/collections/" + encodeURIComponent(o.c.address) + "/attributes")).attributes; } catch { st.attrs = []; } }
        reload();
      });
    }
    if (k === "backdrop" && !st.f.collection) {
      // Fonlar hamma sovg'alarda bir xil: ro'yxat birinchi sovg'aning fonlaridan olinadi
      if (!S.allBackdrops) {
        if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } }
        const c0 = (S.giftCollections || [])[0];
        let vals = [];
        if (c0) { try { const at = (await api("/api/nft/collections/" + encodeURIComponent(c0.address) + "/attributes")).attributes || [];
          const b = at.find((x) => String(x.trait_type).toLowerCase() === "backdrop"); vals = b ? b.values.map((x) => x.value) : []; } catch {} }
        if (vals.length) S.allBackdrops = vals.sort();
      }
      return pickSheet(t("f_backdrop"), (S.allBackdrops || []).map((x) => ({ value: x, label: x })), st.f.backdrop, (o) => { st.f.backdrop = o ? o.value : null; reload(); });
    }
    if (!st.f.collection) return toast(t("f_pick_gift_first"));
    const a = (st.attrs || []).find((x) => String(x.trait_type).toLowerCase() === TRAITS[k]);
    const opts = a ? a.values.map((x) => ({ value: x.value, label: x.value, note: x.perc ? (Math.round(x.perc * 10) / 10) + "%" : "" })) : [];
    pickSheet(t("f_" + k), opts, st.f[k], (o) => { st.f[k] = o ? o.value : null; reload(); });
  };
  if (!st.loaded) reload(); else draw();
}

// --- Saralash va ilova ichidagi filtrlar (username va raqamlar) ---
const SORTS = {
  gifts: ["price_per_day", "min_price", "duration_asc", "duration_desc", "item_num_asc", "item_num_desc", "recently_touch"],
  usernames: ["price_per_day", "min_price", "duration_asc", "duration_desc", "recently_touch"],
  numbers: ["price_per_day", "min_price", "duration_asc", "duration_desc", "item_num_asc", "item_num_desc", "recently_touch"],
};
const uname = (n) => String(n || "").replace(/^@/, "");
const nbody = (n) => { const d = String(n || "").replace(/\D/g, ""); return d.startsWith("888") ? d.slice(3) : d; };
function matchQuery(name, q) {
  q = String(q || "").trim().replace(/^@/, "").toLowerCase();
  if (!q) return true;
  const u = uname(name).toLowerCase();
  if (!q.includes("*")) return u.includes(q);
  const re = new RegExp("^" + q.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(u);
}
const maskOf = (str) => { const m = {}; let n = 0; return [...str].map((c) => (m[c] ??= "ABCDEFGHIJ"[n++] || "?")).join(""); };
const maxRun = (str) => { let b = 0, r = 0, p = null; for (const c of str) { r = c === p ? r + 1 : 1; p = c; b = Math.max(b, r); } return b; };
const maxProg = (str) => {
  const d = [...str].map(Number); if (d.length < 2) return d.length;
  let b = 1, r = 1, diff = null;
  for (let i = 1; i < d.length; i++) { const x = d[i] - d[i - 1]; if (x !== 0 && x === diff) r++; else { r = x !== 0 ? 2 : 1; diff = x; } b = Math.max(b, r); }
  return b;
};
const halves = (b) => { const h = Math.floor(b.length / 2); return [b.slice(0, h), b.slice(b.length - h)]; };
const yesNo = [{ value: "yes", label: "cf_yes" }, { value: "no", label: "cf_no" }];
const tr = (arr) => arr.map((o) => ({ ...o, label: t(o.label) }));
const distinct = (items, f) => [...new Set(items.map(f))].sort((a, b) => (a > b ? 1 : -1));
const CF = {
  usernames: [
    { k: "digits", label: "cf_digits", opts: () => tr(yesNo), test: (it, v) => /\d/.test(uname(it.name)) === (v === "yes") },
    { k: "len", label: "cf_len", opts: () => [4, 5, 6, 7, 8, 9, 10, "11+"].map((n) => ({ value: String(n), label: t("cf_letters", { n }) })),
      test: (it, v) => (v === "11+" ? uname(it.name).length >= 11 : uname(it.name).length === Number(v)) },
    { k: "us", label: "cf_us", opts: () => tr(yesNo), test: (it, v) => uname(it.name).includes("_") === (v === "yes") },
    { k: "usstyle", label: "cf_usstyle", opts: () => tr([{ value: "edge", label: "cf_us_edge" }, { value: "mid", label: "cf_us_mid" }]),
      test: (it, v) => { const u = uname(it.name); const edge = /^_|_$/.test(u), mid = /[^_]_+[^_]/.test(u); return v === "edge" ? edge : mid; } },
    { k: "pattern", label: "cf_pattern", opts: () => tr([{ value: "l2d4", label: "cf_pat_l2d4" }]), test: (it) => /^[a-z]{2}(\d)\1{3}$/i.test(uname(it.name)) },
  ],
  numbers: [
    { k: "digit", label: "cf_digit", opts: () => [..."0123456789"].flatMap((d) => [{ value: "h" + d, label: t("cf_dig_has", { d }) }, { value: "n" + d, label: t("cf_dig_no", { d }) }]),
      test: (it, v) => nbody(it.name).includes(v[1]) === (v[0] === "h") },
    { k: "len", label: "cf_len", opts: (items) => distinct(items, (it) => nbody(it.name).length).map((n) => ({ value: n, label: t("cf_digits_n", { n }) })),
      test: (it, v) => nbody(it.name).length === v },
    { k: "run", label: "cf_run", opts: () => [2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: t("cf_atleast", { n }) })), test: (it, v) => maxRun(nbody(it.name)) >= v },
    { k: "uniq", label: "cf_uniq", opts: (items) => distinct(items, (it) => new Set(nbody(it.name)).size).map((n) => ({ value: n, label: String(n) })),
      test: (it, v) => new Set(nbody(it.name)).size === v },
    { k: "prog", label: "cf_prog", opts: () => [3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: t("cf_atleast", { n }) })), test: (it, v) => maxProg(nbody(it.name)) >= v },
    { k: "sym", label: "cf_sym", opts: () => tr([{ value: "eq", label: "cf_sym_eq" }, { value: "mir", label: "cf_sym_mir" }]),
      test: (it, v) => { const [l, r] = halves(nbody(it.name)); return l.length > 0 && (v === "eq" ? l === r : [...l].reverse().join("") === r); } },
    { k: "mask", label: "cf_mask", opts: (items) => {
        const o = [];
        for (const it of items) {
          const b = nbody(it.name), [l, r] = halves(b);
          o.push("L:" + maskOf(l), "R:" + maskOf(r));
          if (b.length <= 6) o.push("S:" + maskOf(b));
        }
        return [...new Set(o)].sort().map((x) => ({ value: x, label: t(x[0] === "L" ? "cf_mask_l" : x[0] === "R" ? "cf_mask_r" : "cf_mask_s") + ": " + x.slice(2) }));
      },
      test: (it, v) => { const b = nbody(it.name), [l, r] = halves(b); const m = v.slice(2);
        return v[0] === "L" ? maskOf(l) === m : v[0] === "R" ? maskOf(r) === m : b.length <= 6 && maskOf(b) === m; } },
  ],
};
function cfLabel(c, val) {
  const o = c.opts(rentState(c === CF.numbers.find((x) => x.k === c.k) ? "numbers" : "usernames").items).find((x) => x.value === val);
  return o ? o.label : String(val);
}

function viewRentItem(v) {
  const p = S.rentPick;
  if (!p) { location.hash = "home"; return; }
  const it = p.item;
  const canRent = !it.own || it.rent, canBuy = it.own && (it.installment || it.cashPrice);
  if (p.mode === "rent" && !canRent) p.mode = "buy";
  const title = `<div class="hero-img">${it.own && it.image ? `<img src="${esc(it.image)}" alt="">` : imgTag(p.category, it.name)}</div>
    <h1 class="page-title" style="text-align:center">${esc(p.category === "gifts" ? shortName(it.name) : it.name)}${p.category === "gifts" && /#\d+$/.test(it.name) ? ` <span class="num">#${esc(it.name.split("#").pop())}</span>` : ""}</h1>
    ${it.own ? `<p style="text-align:center"><span class="adtag inline">${esc(t("ad_tag"))}</span></p>` : ""}
    ${attrsOf(it).length ? `<div class="attrs" style="justify-content:center">${attrsOf(it).map((a) => `<span>${esc(a.trait_type)}: ${esc(a.value)}</span>`).join("")}</div>` : ""}
    ${canRent && canBuy ? `<section class="step"><div class="step-h"><h2>${esc(t("mode_q"))}</h2></div><div class="modes">
      <button type="button" class="mcard${p.mode === "rent" ? " on" : ""}" data-mode="rent"><i>⏳</i><b>${esc(t("mode_rent"))}</b><small>${esc(t("mode_rent_note"))}</small>
        <em>${esc(money(bestPerDay(it, p.formula)))} ${esc(t("per_day_from"))}</em></button>
      <button type="button" class="mcard${p.mode === "buy" ? " on" : ""}" data-mode="buy"><i>💎</i><b>${esc(t("mode_buy"))}</b><small>${esc(t("mode_buy_note"))}</small>
        <em>${it.cashPrice ? esc(som(it.cashPrice)) : esc(t("pay_inst"))}</em></button></div></section>` : ""}`;
  const bindMode = () => v.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { p.mode = b.dataset.mode; p.pay = null; p.itype = null; render(); }));

  if (p.mode === "buy") {
    p._ctx = () => ({ base: it.salePrice, down1: it.down1 });
    const opts = [];
    if (it.cashPrice) opts.push(opt("cash", t("pay_full"), t("pay_full_note"), som(it.cashPrice), p.pay === "cash", "pay"));
    if (it.installment) opts.push(opt("installment", t("pay_inst"), t("pay_inst_note"), "", p.pay === "installment", "pay"));
    if (opts.length === 1 && !p.pay) p.pay = it.cashPrice ? "cash" : "installment";
    const isReady = () => p.pay === "cash" || (p.pay === "installment" && instOk(p));
    v.innerHTML = title + `<section class="step">${stepHead(1, t("step_pay"))}<div class="opts" role="radiogroup">${opts.join("")}</div>
      ${p.pay === "installment" ? `<div class="field"><label>${esc(t("inst_type"))}</label><div class="opts" role="radiogroup">
        ${["plan1", "plan2", "uzum"].map((ty) => opt(ty, t(ty), t(ty + "_desc"), "", p.itype === ty, "itype")).join("")}</div></div>${instExtra(p)}` : ""}
      </section>
      <div class="cta">
        <div class="sum"><span>${esc(t("total"))}</span><b>${p.pay === "cash" ? esc(som(it.cashPrice)) : esc(t("price_by_admin"))}</b></div>
        <button class="btn btn-primary" id="go" type="button" ${isReady() ? "" : "disabled"}>${esc(t("next"))}</button>
      </div>`;
    bindMode();
    bindOpts(v, (g, val) => { if (g === "itype" && val !== p.itype) resetInst(p, val); if (g === "pay" && val !== p.pay) p.itype = null; p[g] = val; render(); });
    v.querySelectorAll(".chip[data-g='months']").forEach((c) => c.addEventListener("click", () => { p.months = Number(c.dataset.v); render(); }));
    bindInst(v, p, () => ($("#go", v).disabled = !isReady()));
    $("#go", v).addEventListener("click", () => placeOrder({
      service: "own", ownId: it.id, ownMode: "buy", paymentMethod: p.pay, installmentType: p.pay === "installment" ? p.itype : undefined,
      ...(p.pay === "installment" ? instBody(p) : {}), idempotencyKey: p.key,
    }, it.cashPrice));
    return;
  }

  const f = p.formula;
  const price = (d) => itemPrice(it, f, d);
  const max = it.maxDays, min = it.minDays;
  const preset = [3, 7, 15, 30].filter((x) => x >= min && x < max);
  if (!preset.length || preset[0] > min) preset.unshift(min);
  if (!preset.includes(max)) preset.push(max);
  const saving = max > min ? Math.floor((1 - (price(max) / max) / (price(min) / min)) * 100) : 0;
  const ok = (d) => Number.isInteger(d) && d >= min && d <= max;
  p._ctx = () => ({ base: ok(p.days) ? price(p.days) : null });
  const isReady = () => ok(p.days) && p.pay && (p.pay === "cash" || instOk(p));
  const perDayLine = (d) => (ok(d) ? t("per_day_is", { d: money(Math.ceil(price(d) / d)) }) : "");
  const upsell = (d) => (ok(d) && d !== max && max > min && p.pay !== "installment"
    ? `<div class="upsell" id="ups">💡 ${esc(t("upsell", { n: max, d: money(bestPerDay(it, f)), tot: money(price(max)) }))}
        <button type="button" class="btn btn-ghost btn-sm" id="upsBtn">${esc(t("upsell_btn", { n: max }))}</button></div>` : "");
  v.innerHTML = title + `
    <section class="step">${stepHead(1, t("rent_days"))}
      <div class="chips">${preset.map((x) => `<button type="button" class="chip" data-d="${x}" aria-pressed="${p.days === x}">${esc(t("days_n", { n: x }))}${x === max && saving >= 1 ? ` <span class="save">−${saving}%</span>` : ""}</button>`).join("")}</div>
      <input class="input" id="days" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(p.days)}">
      <p class="hint">${esc(t("days_range", { a: min, b: max }))}</p>
      <p class="hint" id="pdl">${esc(perDayLine(p.days))}</p>
      <div id="upsWrap">${upsell(p.days)}</div>
    </section>
    ${payStep(2, p, ["plan2", "uzum"])}
    <div class="cta">
      <div class="sum"><span id="lbl">${esc(t("rent_total", { n: ok(p.days) ? p.days : "—" }))}</span><b id="tot">${p.pay === "installment" ? esc(t("price_by_admin")) : ok(p.days) ? esc(som(price(p.days))) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${isReady() ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  bindMode();
  v.querySelectorAll(".chip[data-g='months']").forEach((c) => c.addEventListener("click", () => { p.months = Number(c.dataset.v); render(); }));
  bindInst(v, p, () => ($("#go", v).disabled = !isReady()));
  const bindUps = () => { const b = $("#upsBtn", v); if (b) b.onclick = () => { p.days = max; render(); }; };
  bindUps();
  v.querySelectorAll(".chip[data-d]").forEach((c) => c.addEventListener("click", () => { p.days = Number(c.dataset.d); render(); }));
  const di = $("#days", v);
  di.addEventListener("input", () => {
    p.days = parseInt(di.value, 10);
    const good = ok(p.days);
    $("#lbl", v).textContent = t("rent_total", { n: good ? p.days : "—" });
    $("#tot", v).textContent = p.pay === "installment" ? t("price_by_admin") : good ? som(price(p.days)) : "—";
    $("#pdl", v).textContent = perDayLine(p.days);
    $("#upsWrap", v).innerHTML = upsell(p.days); bindUps();
    $("#go", v).disabled = !isReady();
    const sm = $("#instSum", v); if (sm) sm.innerHTML = instSummary(p);
    v.querySelectorAll(".chip[data-d]").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.d) === p.days)));
  });
  bindOpts(v, (g, val) => { if (g === "pay" && val !== p.pay) p.itype = null; if (g === "itype" && val !== p.itype) resetInst(p, val); p[g] = val; render(); });
  const inst = () => (p.pay === "installment" ? { installmentType: p.itype, ...instBody(p) } : {});
  $("#go", v).addEventListener("click", () => placeOrder(it.own
    ? { service: "own", ownId: it.id, ownMode: "rent", days: p.days, paymentMethod: p.pay, idempotencyKey: p.key, ...inst() }
    : { service: p.service, address: it.address, days: p.days, paymentMethod: p.pay, idempotencyKey: p.key, ...inst() }, price(p.days)));
}

function viewDone(v) {
  const r = S.lastOrder;
  if (!r) { location.hash = "orders"; return; }
  const admin = S.cfg && S.cfg.adminContact ? S.cfg.adminContact.replace(/^@/, "") : "";
  const inst = r.paymentMethod === "installment";
  const msg = encodeURIComponent(`${r.publicId}`);
  v.innerHTML = `<div class="center">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3L17 9"/></svg>
    <h1>${esc(t("done_title"))}</h1>
    <p class="hint">${esc(t("done_id"))}</p>
    <div class="big">${esc(r.publicId)}</div>
    ${inst ? `<p class="alert" style="width:100%">${esc(t("done_inst"))}</p>
      ${admin ? `<a class="btn btn-primary" href="https://t.me/${esc(admin)}?text=${msg}" target="_blank" rel="noopener">${esc(t("write_admin"))}</a>` : ""}`
      : `<p class="hint">${esc(t("done_cash"))}</p>`}
    <a class="btn btn-ghost" href="#orders">${esc(t("to_orders"))}</a>
  </div>`;
}

async function viewOrders(v) {
  if (!(await needLogin())) return;
  v.innerHTML = `<h1 class="page-title">${esc(t("orders_title"))}</h1><div class="spin"></div>`;
  let data;
  try { data = await api("/api/orders"); } catch (e) { v.innerHTML = `<h1 class="page-title">${esc(t("orders_title"))}</h1><p class="alert">${esc(errText(e))}</p>`; return; }
  const instBlock = (i) => i ? `<div class="kv">
      <span>${esc(t("purchased_at"))}</span><b>${esc(date(i.purchasedAt))}</b>
      <span>${esc(t("monthly"))}</span><b>${esc(som(i.monthlyPayment))}</b>
      <span>${esc(t("final_date"))}</span><b>${esc(date(i.finalDate))}</b></div>
      ${i.active ? `<button class="btn btn-ghost btn-sm" type="button" data-pay="${i.id}">${esc(t("pay_monthly"))}</button>` : ""}` : "";
  const cards = data.orders.map((o) => `<article class="item">
      <div class="item-h"><b>${esc(o.title)}</b><span class="badge b-${esc(o.status)}">${esc(t("st_" + o.status))}</span></div>
      <div class="meta"><code>${esc(o.publicId)}</code><span>${esc(date(o.createdAt))}</span><span>${esc(t("pm_" + o.paymentMethod))}</span>
        ${o.price != null ? `<span>${esc(som(o.price))}</span>` : ""}${o.recipient ? `<span>@${esc(o.recipient)}</span>` : ""}</div>
      ${o.rentEndsAt ? `<div class="kv"><span>${esc(t("rent_ends"))}</span><b>${esc(date(o.rentEndsAt))}</b></div>` : ""}
      ${o.paymentMethod === "installment" ? (o.installment ? instBlock(o.installment) : `<p class="hint">${esc(t("inst_pending"))}</p>`) : ""}
      ${o.canReview ? `<button class="btn btn-ghost btn-sm" type="button" data-rev="${esc(o.publicId)}">${esc(t("leave_review"))}</button>`
        : o.reviewStatus === "pending" ? `<p class="hint">${esc(t("review_pending"))}</p>` : o.reviewStatus === "published" ? `<p class="hint">${esc(t("review_published"))}</p>` : ""}
    </article>`);
  const legacy = data.agreements.map((a) => `<article class="item">
      <div class="item-h"><b>${esc(a.title)}</b><span class="badge ${a.active ? "b-queued" : "b-completed"}">${esc(t("pm_installment"))}</span></div>
      ${instBlock({ ...a })}</article>`);
  const all = cards.concat(legacy);
  v.innerHTML = `<h1 class="page-title">${esc(t("orders_title"))}</h1>
    ${all.length ? `<div class="list">${all.join("")}</div>` : `<div class="empty"><p>${esc(t("no_orders"))}</p><p style="margin-top:14px"><a class="btn btn-primary" href="#home">${esc(t("choose_service"))}</a></p></div>`}`;
  v.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", () => {
    let rating = 5;
    const draw = () => {
      sheet(`<h2>${esc(t("review_title"))}</h2>
        <div class="chips" role="radiogroup">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="chip" data-r="${n}" aria-pressed="${n <= rating}">★</button>`).join("")}</div>
        <textarea class="input" id="rvText" rows="4" maxlength="1000" placeholder="${esc(t("review_ph"))}"></textarea>
        <button class="btn btn-primary" id="rvSend" type="button">${esc(t("send"))}</button>`);
      $("#sheet").querySelectorAll("[data-r]").forEach((c) => (c.onclick = () => { const txt = $("#rvText").value; rating = Number(c.dataset.r); draw(); $("#rvText").value = txt; }));
      $("#rvSend").onclick = async (e) => {
        const text = $("#rvText").value.trim();
        if (text.length < 2) return $("#rvText").focus();
        e.currentTarget.disabled = true;
        try { await api(`/api/orders/${b.dataset.rev}/review`, { body: { rating, text } }); closeSheet(); toast(t("review_sent")); render(); }
        catch (er) { e.currentTarget.disabled = false; toast(errText(er)); }
      };
    };
    draw();
  }));
  v.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.pay, k = key();
    sheet(`<h2>${esc(t("pay_monthly"))}</h2><p>${esc(t("pay_monthly_confirm"))}</p>
      <button class="btn btn-primary" id="pOk" type="button">${esc(t("confirm"))}</button>
      <button class="btn btn-ghost" id="pNo" type="button">${esc(t("cancel"))}</button>`);
    $("#pNo").onclick = closeSheet;
    $("#pOk").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api(`/api/installments/${id}/pay`, { body: { idempotencyKey: k } }); closeSheet(); toast(t("paid_ok", { a: money(r.amount) })); S.me = null; }
      catch (er) { closeSheet(); if (er.code === "INSUFFICIENT_BALANCE") insufficient(0); else toast(errText(er)); }
    };
  }));
}

async function viewBalance(v) {
  if (!(await needLogin())) return;
  v.innerHTML = `<div class="spin"></div>`;
  let b;
  try { b = await api("/api/balance"); } catch (e) { v.innerHTML = `<p class="alert">${esc(errText(e))}</p>`; return; }
  const admin = (b.adminContact || "").replace(/^@/, "");
  v.innerHTML = `<div class="balhero reveal"><span class="lbl">${esc(t("balance_short"))}</span><b>${esc(som(b.balance))}</b></div>
    <section class="box">
      <p>${esc(t("topup_contact"))}</p>
      ${admin ? `<a class="btn btn-primary" href="https://t.me/${esc(admin)}" target="_blank" rel="noopener">${esc(t("write_admin"))}</a>` : ""}
    </section>
    <section class="box"><h2>${esc(t("history"))}</h2>
      ${b.ledger.length ? b.ledger.map((l) => `<div class="led"><div>${esc(t("k_" + l.kind))}${l.note ? ` · ${esc(l.note)}` : ""}<small>${esc(date(l.created_at))}</small></div>
        <span class="${Number(l.amount) > 0 ? "p" : "m"}">${Number(l.amount) > 0 ? "+" : "−"}${esc(som(Math.abs(Number(l.amount))))}</span></div>`).join("") : `<p class="hint">${esc(t("no_history"))}</p>`}
    </section>`;
}

async function viewHelp(v) {
  const admin = S.cfg && S.cfg.adminContact ? S.cfg.adminContact.replace(/^@/, "") : "";
  v.innerHTML = `<h1 class="page-title">${esc(t("track_title"))}</h1>
    <form class="row2" id="trk" style="grid-template-columns:1fr auto" novalidate>
      <input class="input" id="trkId" placeholder="${esc(t("track_ph"))}" autocapitalize="characters" autocomplete="off">
      <button class="btn btn-primary btn-sm" type="submit">${esc(t("track_btn"))}</button>
    </form>
    <div id="trkRes"></div>
    <h1 class="page-title">${esc(t("help_title"))}</h1>
    <div class="list">${[2, 3, 4, 5].map((n) => `<details class="item"><summary style="cursor:pointer;font-weight:800">${esc(t("q" + n))}</summary><p class="hint" style="margin-top:8px">${esc(t("a" + n))}</p></details>`).join("")}</div>
    ${admin ? `<p style="margin-top:16px"><a class="btn btn-ghost" href="https://t.me/${esc(admin)}" target="_blank" rel="noopener">${esc(t("write_admin"))}</a></p>` : ""}
    <h1 class="page-title">${esc(t("reviews_title"))}</h1>
    <div class="list" id="revs"><div class="spin"></div></div>`;
  $("#trk", v).addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#trkId", v).value.trim().toUpperCase();
    const out = $("#trkRes", v);
    if (!/^NG-[A-Z0-9]{6}$/.test(id)) { out.innerHTML = `<p class="err">${esc(t("err_ORDER_NOT_FOUND"))}</p>`; return; }
    try {
      const r = await api("/api/track/" + id);
      out.innerHTML = `<article class="item" style="margin-top:10px"><div class="item-h"><b>${esc(r.title)}</b><span class="badge b-${esc(r.status)}">${esc(t("st_" + r.status))}</span></div>
        <div class="meta"><code>${esc(r.publicId)}</code><span>${esc(date(r.createdAt))}</span></div></article>`;
    } catch (er) { out.innerHTML = `<p class="err">${esc(errText(er))}</p>`; }
  });
  try {
    const rv = await api("/api/reviews");
    $("#revs", v).innerHTML = rv.length ? rv.map((r) => `<article class="item"><div class="item-h"><b>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</b><span class="hint">${esc(r.name)} · ${esc(date(r.createdAt))}</span></div><p>${esc(r.text)}</p></article>`).join("")
      : `<p class="empty">${esc(t("no_reviews"))}</p>`;
  } catch { $("#revs", v).innerHTML = ""; }
}

// ---------- marshrutlash ----------
const VIEWS = {
  home: viewHome, premium: viewPremium, stars: viewStars, nft: viewNft,
  rent: viewRent,
  "rent-gifts": (v) => { S.rentTab = "gifts"; location.replace("#rent"); }, "rent-usernames": (v) => { S.rentTab = "usernames"; location.replace("#rent"); }, "rent-numbers": (v) => { S.rentTab = "numbers"; location.replace("#rent"); },
  "rent-item": viewRentItem, orders: viewOrders, balance: viewBalance, done: viewDone, login: viewLogin, help: viewHelp,
};
const TOP = new Set(["home", "rent", "orders", "balance", "login", "done"]);
const PARENT = { "rent-item": () => "rent" };

function applyStatic() {
  document.documentElement.lang = S.lang === "zh" ? "zh-CN" : S.lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $("#lang").value = S.lang;
}
async function render() {
  if (!tg) { applyStatic(); viewLogin($("#view")); return; }
  const route = location.hash.slice(1) || "home";
  const fn = VIEWS[route] || viewHome;
  applyStatic();
  const tab = ["orders", "balance", "rent"].includes(route) ? route : route === "rent-item" ? "rent" : "home";
  document.querySelectorAll(".tab").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#backBtn").hidden = TOP.has(route);
  $("#brand").hidden = !TOP.has(route);
  const v = $("#view");
  if (S.lastRoute !== route) window.scrollTo(0, 0);
  S.lastRoute = route;
  if ((route === "premium" || route === "stars") && !S.me) await login();
  await fn(v);
}
$("#backBtn").addEventListener("click", () => { const r = location.hash.slice(1); location.hash = PARENT[r] ? PARENT[r]() : "home"; });
$("#lang").addEventListener("change", (e) => {
  S.lang = e.target.value; store.set("ng_lang", S.lang);
  if (S.token) api("/api/me/lang", { body: { lang: S.lang } }).catch(() => {});
  render();
});
window.addEventListener("hashchange", render);

(async () => {
  if (tg) S.token = "telegram";
  try { S.cfg = await api("/api/config"); } catch { S.cfg = { services: {}, premiumPrices: {}, starsPrice: 240, starsMin: 50 }; }
  if (tg) await login(); else await loadMe();
  render();
})();
})();
