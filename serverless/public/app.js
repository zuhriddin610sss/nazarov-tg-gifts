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
function itemPrice(it, f, d) {
  if (it.own) return it.ownPpdNano ? rentPrice(it.ownPpdNano, d, it.ownF) : Math.ceil(it.ppd * d);
  return rentPrice(it.pricePerDayNano, d, f);
}
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
      S.lastOrder = { ...r, service: body.service };
      S.drafts[body.service] = null;
      S.me = null;
      location.hash = "done";
    } catch (e) {
      if (btn) btn.disabled = false;
      if (e.code === "PHONE_REQUIRED") { S.me && (S.me.hasPhone = false); closeSheet(); return placeOrder(body, cashAmount); }
      if (e.code === "INSUFFICIENT_BALANCE") return insufficient(cashAmount);
      // Portals'da narx o'zgarsa: yangi narxni ko'rsatib, qayta tasdiqlashni so'raymiz
      if (e.code === "PRICE_CHANGED" && body.service === "portals" && S.salePick && e.extra && e.extra.price) {
        S.salePick.item.price = Number(e.extra.price); closeSheet(); toast(t("err_PRICE_CHANGED", { price: money(e.extra.price) })); render(); return;
      }
      if (e.code === "GIFT_SOLD" && S.sale) S.sale.loaded = false;
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
      ${opt("installment", t("pay_inst"), instNote(d), "", d.pay === "installment", "pay")}
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
/** Taxminiy hisob: { down, monthly } yoki null (ma'lumot yetarli bo'lmasa). */
function instCalc(d) {
  const c = d._ctx ? d._ctx() : {};
  const months = Number(d.months);
  if (!d.itype || !(months >= 1) || !(c.base > 0)) return null;
  // "Ha" tanlanib summa hali yozilmagan bo'lsa hisob ko'rsatilmaydi
  const down = d.itype === "plan1" ? c.down1 : needsDown(d.itype) ? (d.dp === "yes" ? (Number(d.dpAmt) > 0 ? Number(d.dpAmt) : null) : d.dp === "no" ? 0 : null) : 0;
  if (down == null || down >= c.base) return null;
  return { down, monthly: planMonthly(c.base, down, months, d.itype) };
}
/** "Bo'lib to'lash" tugmasi ostidagi izoh: narx ma'lum bo'lsa "oylik to'lov pastda ko'rsatiladi". */
function instNote(d) {
  const c = d._ctx ? d._ctx() : {};
  return t(c.base > 0 ? "pay_inst_note_est" : "pay_inst_note");
}
/** Pastki "Jami" qatori: hammasi tanlansa "Oyiga ≈ …", bo'lmasa nimani tanlash kerakligi. */
function instCta(d) {
  if (!d.pay) return t("cta_pay");
  if (!d.itype) return t("cta_itype");
  if (!(Number(d.months) >= 1)) return t("cta_months");
  if (needsDown(d.itype)) {
    if (!d.dp) return t("cta_dp");
    if (d.dp === "yes" && !(Number(d.dpAmt) > 0)) return t("cta_dp_amt");
  }
  const r = instCalc(d);
  if (r) return `${t("inst_monthly")} ≈ ${som(r.monthly)}`;
  const c = d._ctx ? d._ctx() : {};
  return d.itype === "plan1" && c.base > 0 && c.down1 == null ? t("down_by_admin") : t("price_by_admin");
}
/** Mijozga faqat boshlang'ich va oylik to'lov (taxminiy) ko'rsatiladi. */
function instSummary(d) {
  const r = instCalc(d);
  if (!r) return "";
  const { down, monthly } = r;
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
        refreshInst(v, d);
        upd();
      }, 90);
    });
    w.querySelectorAll(".wheel-i").forEach((el, i) => el.addEventListener("click", () => w.scrollTo({ top: i * WHEEL_H, behavior: "smooth" })));
  }
  const a = $("#dpAmt", v);
  if (a) a.addEventListener("input", () => { d.dpAmt = a.value; refreshInst(v, d); upd(); });
}
function refreshInst(v, d) {
  const sm = $("#instSum", v); if (sm) sm.innerHTML = instSummary(d);
  const cb = v.querySelector(".cta .sum b"); if (cb && d.pay === "installment") cb.textContent = instCta(d);
}

// ---------- sahifalar ----------
const SVC_ICON = {
  nft_gift: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="9" width="18" height="12" rx="2"/><path d="M2 9h20M12 9v12M12 9C10 4 6 4 6 7s6 2 6 2zm0 0c2-5 6-5 6-2s-6 2-6 2z"/></svg>',
  buy: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linejoin="round"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  gift_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  username_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
  number_rent: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10 18h4"/></svg>',
  premium: '<svg viewBox="0 0 24 24" fill="none" stroke="url(#sv)" stroke-width="1.8" stroke-linejoin="round"><path d="M3 18 5 7l4.5 4L12 5l2.5 6L19 7l2 11z"/><path d="M3 21h18"/></svg>',
  stars: '<svg viewBox="0 0 24 24" fill="url(#sv)"><path d="M12 2l3 6.2 6.8.9-5 4.7 1.3 6.7L12 17.3 5.9 20.5l1.3-6.7-5-4.7 6.8-.9z"/></svg>',
};
const SILVER_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="sv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F2F3EF"/><stop offset=".5" stop-color="#A3A6A2"/><stop offset="1" stop-color="#E6E7E3"/></linearGradient></defs></svg>';
const HOME_ROUTE = { nft_gift: "buy-nft", buy: "buy", gift_rent: "rent", username_rent: "rent", number_rent: "rent", premium: "premium", stars: "stars" };
const RENT_TAB = { gift_rent: "gifts", username_rent: "usernames", number_rent: "numbers" };

/** Lizing: eng kichik oylik to'lov (240 oy, boshlang'ich to'lovsiz, ustama bilan). */
const leaseMin = (price) => (price > 0 ? planMonthly(price, 0, WHEEL_MAX, "lease") : null);
const HIC = {
  lease: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  inst: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 11h20M6 15h4"/></svg>',
  rent: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5"/></svg>',
};
/** Bosh sahifa reklamalari (Stories uslubi): har biri 5 soniya, bosib ushlasa to'xtaydi, surib almashtiriladi. */
function startStories(v) {
  const st = $("#st", v); if (!st) return;
  const tr = $(".st-track", st), bars = [...st.querySelectorAll(".st-bars i")], n = bars.length;
  let i = 0, sx = null, moved = false;
  const go = (k) => {
    i = (k + n) % n;
    tr.style.transform = `translateX(${-i * 100}%)`;
    bars.forEach((b, j) => { b.className = j < i ? "done" : ""; const f = b.firstChild; f.style.animation = "none"; void f.offsetWidth; f.style.animation = ""; });
    bars[i].className = "on";
  };
  bars.forEach((b) => b.firstChild.addEventListener("animationend", () => { if (st.isConnected && b.className === "on") go(i + 1); }));
  const pause = (on) => st.classList.toggle("paused", on);
  st.addEventListener("pointerdown", (e) => { sx = e.clientX; moved = false; pause(true); });
  st.addEventListener("pointermove", (e) => { if (sx != null && Math.abs(e.clientX - sx) > 12) moved = true; });
  const up = (e) => {
    pause(false);
    if (sx != null && moved) { const dx = e.clientX - sx; if (Math.abs(dx) > 40) go(dx < 0 ? i + 1 : i - 1); }
    sx = null;
  };
  st.addEventListener("pointerup", up); st.addEventListener("pointercancel", () => { pause(false); sx = null; });
  st.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  go(0);
}
async function ownGifts() {
  if (!S.ownGifts) { try { S.ownGifts = (await api("/api/own/gifts")).map(normOwn); } catch { S.ownGifts = []; } }
  return S.ownGifts;
}
async function viewHome(v) {
  const en = (S.cfg && S.cfg.services) || {};
  const draw = (own) => {
    const buyable = own.filter((x) => x.installment && x.salePrice > 0);
    const hero = buyable.find((x) => x.image) || buyable[0] || null;
    const minLease = buyable.length ? Math.min(...buyable.map((x) => leaseMin(x.salePrice))) : null;
    // Ijara: bizning giftlar + bozordagi ijara ro'yxati (birinchi sahifa) — eng arzoni
    const hr = S.homeRent && S.homeRent.items ? S.homeRent : { items: [], formula: null };
    const rentable = own.filter((x) => x.rent).map((it) => ({ it, f: null })).concat(hr.items.map((it) => ({ it, f: hr.formula })));
    // Kunlik narx 180 kunlik ijara bo'yicha (gift 180 kunga berilmasa — eng uzun muddati bo'yicha)
    const d180 = (it) => Math.max(it.minDays || 1, Math.min(180, it.maxDays || 1));
    const ppdOf = (x) => Math.ceil(itemPrice(x.it, x.f, d180(x.it)) / d180(x.it));
    const minRent = rentable.length ? Math.min(...rentable.map(ppdOf)) : null;
    const way = (tab, ic, title, desc, right, main) => `<a class="way${main ? " main" : ""}" href="#gifts" data-gt="${tab}"><span class="ic">${ic}</span>
      <span><b>${title}</b><small>${esc(desc)}</small></span>${right || ""}</a>`;
    const rr = (lbl, val) => (val ? `<span class="r"><span>${esc(lbl)}</span><b>${esc(money(val))} ${esc(t("from_sfx"))}</b></span>` : "");
    const svcs = [["premium", "#premium", t("svc_premium"), ""], ["stars", "#stars", t("svc_stars"), ""],
      ["username_rent", "#gifts", t("svc_username_rent"), t("w_rent")], ["number_rent", "#gifts", t("svc_number_rent"), t("w_rent")], ["nft_gift", "#sell", t("sell_title"), ""]].filter(([k]) => en[k] !== false);
    // Ijara: eng arzon ijaradagi gift va uning 1 / 7 / 30 / 180 kunlik kunlik narxlari
    const rgx = rentable.length ? rentable.reduce((a, b) => (ppdOf(b) < ppdOf(a) ? b : a)) : null;
    const rg = rgx && rgx.it;
    const pic = (g) => (g ? (g.image ? `<img src="${esc(g.image)}" alt="">` : imgTag("gifts", g.name)) : "");
    const others = own.filter((x) => x.image);
    const minInst = buyable.length ? Math.min(...buyable.map((x) => minMonthly(x.salePrice))) : null;
    // Lizing va bo'lib to'lash reklamasida — narxi ko'rsatilgan eng arzon giftning o'zi
    const cheap = buyable.length ? buyable.reduce((a, b) => (b.salePrice < a.salePrice ? b : a)) : null;
    const PEPE = `<img src="https://nft.fragment.com/gift/plushpepe-1.webp" alt="Plush Pepe">`;
    const slides = [
      en.gift_rent !== false && { k: "rent", href: "#gifts", gt: "rent", kick: t("tab_rent"), h: minRent ? t("st_day", { a: money(minRent) }) : t("st_rent_h0"), p: t("st_rent_p"),
        extra: "",
        go: t("st_rent_go"), im: pic(rg || others[0]) },
      en.nft_gift !== false && { k: "lease", href: "#gifts", gt: "lease", kick: t("tab_lease"), h: minLease ? t("st_month", { a: money(minLease) }) : t("tab_lease"), p: t("st_lease_p"), go: t("hx_go"), im: pic(cheap) },
      en.nft_gift !== false && { k: "inst", href: "#gifts", gt: "inst", kick: t("tab_inst"), h: minInst ? t("st_month", { a: money(minInst) }) : t("tab_inst"), p: t("st_inst_p"), go: t("hx_go"), im: pic(cheap) },
      en.cashout !== false && { k: "cash", href: "#cashout", gt: "", kick: t("cx_short"), h: t("st_cash_h"), p: "", go: t("cx_btn"), im: PEPE, im2: pic(others[0]), coin: true },
    ].filter(Boolean);
    const ab = S.cfg && S.cfg.about;
    const way2 = (href, gt, ic, title, desc, main) => `<a class="way${main ? " main" : ""}" href="${href}"${gt ? ` data-gt="${gt}"` : ""}><span class="ic">${ic}</span><span><b>${title}</b><small>${esc(desc)}</small></span></a>`;
    v.innerHTML = `${SILVER_DEFS}
      ${slides.length ? `<section class="st" id="st"><div class="st-bars">${slides.map(() => "<i><b></b></i>").join("")}</div>
        <div class="st-track">${slides.map((x) => `<a class="st-s st-${x.k}" href="${x.href}"${x.gt ? ` data-gt="${x.gt}"` : ""}>
          <span class="k">${esc(x.kick)}</span><h1>${esc(x.h)}</h1>${x.p ? `<p>${esc(x.p)}</p>` : ""}${x.extra || ""}
          ${x.im2 ? `<span class="im im2">${x.im2}</span>` : ""}${x.im ? `<span class="im">${x.im}${x.coin ? `<span class="cxm">+ ${esc(t("som"))}</span><em class="stay">${esc(t("cx_stays"))}</em>` : ""}</span>` : ""}
          <span class="go">${esc(x.go)} →</span></a>`).join("")}</div></section>` : ""}
      <div class="trust"><div><b>${esc(t("trust_now_b"))}</b><small>${esc(t("trust_now"))}</small></div><div><b>240</b><small>${esc(t("trust_240"))}</small></div><div><b>${esc(t("trust_som_b"))}</b><small>${esc(t("trust_som"))}</small></div></div>
      ${S.me ? `<a class="balrow" href="#balance"><span>${esc(t("balance_short"))}</span><b>${esc(som(S.me.balance))}</b></a>` : ""}
      <h2 class="h2x">${esc(t("ways_title"))}</h2>
      <div class="ways2">
      ${en.nft_gift !== false ? way2("#gifts", "lease", HIC.lease, esc(t("w_lease")), t("w_lease_d"), true) : ""}
      ${en.nft_gift !== false ? way2("#gifts", "inst", HIC.inst, esc(t("w_inst")), t("w_inst_d")) : ""}
      ${en.gift_rent !== false ? way2("#gifts", "rent", HIC.rent, esc(t("w_rent")), t("w_rent_d")) : ""}
      ${en.nft_gift !== false ? way2("#gifts", "cash", HIC.cash, esc(t("w_cash")), t("w_cash_d")) : ""}
      ${en.cashout !== false ? way2("#cashout", "", HIC.coin, esc(t("cx_short")), t("w_cx_d")) : ""}
      </div>
      ${buyable.length ? `<div class="sect-h" style="padding-top:18px"><h2 class="h2x" style="margin:0">${esc(t("rec_title"))}</h2><a class="link" href="#gifts" data-gt="lease">${esc(t("see_all"))}</a></div>
        <div class="strip own-strip feat">${buyable.map((it) => giftCard("gifts", { ...it, rent: false, buyLine: buyPriceHtml(it.salePrice, "lease") }, null)).join("")}</div>${featNav(buyable.length)}` : ""}
      ${svcs.length ? `<h2 class="h2x">${esc(t("other_title"))}</h2><div class="more2">${svcs.map(([k, href, title, sub]) => `<a href="${href}" data-svc="${k}"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</a>`).join("")}</div>` : ""}
      <section class="about2"><div class="ab-wall" aria-hidden="true">${[PEPE, ...others.slice(0, 7).map((g) => pic(g))].map((x) => `<span>${x}</span>`).join("")}</div>
        <div class="ab-in"><div class="ab-h"><img src="/assets/logo-mark.png" alt="" width="36" height="36"><b>NAZAROV TG Gifts</b></div>
        <div class="ab-st2"><div><b>5</b><small>${esc(t("ab_ways"))}</small></div><div><b>240</b><small>${esc(t("ab_months"))}</small></div></div>
        ${ab && ab.channel ? `<a class="ab-ch" href="https://t.me/${esc(ab.channel)}" target="_blank" rel="noopener">${esc(t("ab_channel"))} ↗</a>` : ""}</div></section>
      <p class="help"><a class="help-link" href="#help">${esc(t("help_link"))}</a></p>`;
    startStories(v);
    v.querySelectorAll("[data-gt]").forEach((a) => a.addEventListener("click", () => { S.giftsTab = a.dataset.gt; }));
    v.querySelectorAll(".more2 a[data-svc]").forEach((a) => a.addEventListener("click", () => {
      if (RENT_TAB[a.dataset.svc]) { S.giftsTab = "rent"; S.rentTab = RENT_TAB[a.dataset.svc]; }
    }));
    v.querySelectorAll(".own-strip .gcard[data-a]").forEach((c) => c.addEventListener("click", () => {
      const it = own.find((x) => x.address === c.dataset.a);
      if (it) openOwnBuy(it, "lease");
    }));
  };
  draw(S.ownGifts || []);
  const rentP = en.gift_rent !== false && !S.homeRent ? api("/api/rent/gifts?sort_by=price_per_day").then((r) => { S.homeRent = r; }).catch(() => { S.homeRent = { items: [], formula: null }; }) : null;
  const own = await ownGifts();
  if ((location.hash.slice(1) || "home") === "home") draw(own);
  if (rentP) { await rentP; if ((location.hash.slice(1) || "home") === "home") draw(own); }
}
/** O'z giftini sotib olish sahifasini ochish (lizing / bo'lib to'lash / naqd). */
function openOwnBuy(it, mode) {
  S.rentPick = { category: "gifts", service: RENT_SVC.gifts, route: "gifts", item: it, formula: rentState("gifts").formula || (S.cfg && S.cfg.rentFormula),
    days: it.minDays, pay: mode === "cash" ? "cash" : "installment", key: key(), mode: "buy", itype: mode === "lease" ? "lease" : null, buyMode: mode };
  location.hash = "rent-item";
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
      <div class="sum"><span>${esc(t("total"))}</span><b>${d.pay === "installment" ? esc(instCta(d)) : cashPrice ? esc(som(cashPrice)) : "—"}</b></div>
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
      <div class="sum"><span>${esc(t("total"))}</span><b id="starsTotal">${d.pay === "installment" ? esc(instCta(d)) : ok ? esc(som(total)) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ready ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  const qty = $("#qty", v);
  qty.addEventListener("input", () => {
    d.qty = parseInt(qty.value, 10);
    const good = Number.isInteger(d.qty) && d.qty >= min;
    $("#qtyErr", v).hidden = good;
    $("#starsTotal", v).textContent = d.pay === "installment" ? instCta(d) : good ? som(round2(d.qty * price)) : "—";
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
    rent: Boolean(o.rent), ppd: o.rent && o.rent.pricePerDay != null ? Number(o.rent.pricePerDay) : 0, minDays: o.rent ? o.rent.minDays : 1, maxDays: o.rent ? o.rent.maxDays : 1,
    ownPpdNano: o.rent && o.rent.pricePerDayNano ? o.rent.pricePerDayNano : null, ownF: o.rent && o.rent.formula ? o.rent.formula : null,
    installment: o.installment, cashPrice: o.cashPrice, salePrice: o.salePrice ?? null, down1: o.down1 ?? null, isNew: Boolean(o.isNew) };
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
  // Ilovadagi narx (formula bilan) Marketapp'nikidan farq qiladi: shu narx bo'yicha arzonidan tartiblaymiz
  if (st.sort === "price_per_day") st.items.sort((a, b) => bestPerDay(a, st.formula) - bestPerDay(b, st.formula));
  if (st.sort === "min_price") st.items.sort((a, b) => itemPrice(a, st.formula, a.minDays) - itemPrice(b, st.formula, b.minDays));
  st.cursor = r.cursor; st.loaded = true; st.error = null;
}
const shortName = (name) => String(name).replace(/\s*#\s*\d+$/, "");
/** "Bizning giftlarimiz" bloki: sarlavha + gorizontal suriladigan qator. */
function ownSection(cat, list, f, sub, noAll) {
  if (!list.length) return "";
  return `<section class="ownsec"><div class="ownsec-h"><h2>⭐ ${esc(t("our_gifts"))}${sub ? ` <span>· ${esc(t(sub))}</span>` : ""}</h2></div>
    <div class="strip own-strip feat">${list.map((it) => giftCard(cat, it, f)).join("")}</div>${featNav(list.length)}</section>
    ${noAll ? "" : `<div class="sect-h"><h2>${esc(t("all_gifts"))}</h2></div>`}`;
}
/** Karusel pastidagi panel: "3 / 12", 4 soniyalik to'lib boruvchi chiziq va "Hammasi" tugmasi. */
function featNav(n) {
  if (n < 2) return "";
  return `<div class="fnav"><span class="fcnt"><b>1</b> / ${n}</span><span class="fbar"><i></i></span>
    <button type="button" class="fall" data-fall>${esc(t("feat_all"))}</button></div>`;
}
/** "Bizning giftlarimiz": giftlar birin-ketin (4 soniyada) almashadi. Mijoz tegsa — 8 soniya to'xtaydi.
 *  "Hammasi" bosilsa — hamma giftlar 2 ustunli ro'yxat bo'lib ochiladi. */
function startFeat() {
  clearInterval(S.featTimer);
  const step = (el) => (el.children[1] ? el.children[1].offsetLeft - el.children[0].offsetLeft : el.clientWidth);
  const idx = (el) => (el.scrollLeft >= el.scrollWidth - el.clientWidth - 2 ? el.children.length - 1 : Math.round(el.scrollLeft / Math.max(1, step(el))));
  const nav = (el) => el.parentElement && el.parentElement.querySelector(".fnav");
  const restartBar = (el) => {
    const b = nav(el) && nav(el).querySelector(".fbar i");
    if (!b) return;
    b.style.animation = "none"; void b.offsetWidth;
    b.style.animation = el.classList.contains("all") || el._hold > Date.now() ? "none" : "";
  };
  const show = (el, i) => { el._i = i; const n = nav(el); if (n) n.querySelector(".fcnt b").textContent = i + 1; restartBar(el); };
  const sync = (el) => { if (el._auto > Date.now()) return; const i = Math.min(el.children.length - 1, idx(el)); if (el._i !== i) show(el, i); };
  document.querySelectorAll(".feat").forEach((el) => {
    if (el.dataset.b) return;
    el.dataset.b = "1"; el._i = 0;
    el.addEventListener("scroll", () => sync(el), { passive: true });
    const hold = () => { el._hold = Date.now() + 8000; restartBar(el); clearTimeout(el._ht); el._ht = setTimeout(() => restartBar(el), 8100); };
    const bar = nav(el) && nav(el).querySelector(".fbar i");
    if (bar) bar.addEventListener("animationend", () => {
      if (!el.isConnected || el.classList.contains("all") || el._hold > Date.now()) return;
      const next = (el._i + 1) % el.children.length;
      el._auto = Date.now() + 900;
      el.scrollTo({ left: next * step(el), behavior: "smooth" });
      show(el, next);
    });
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("pointerdown", hold);
    const n = nav(el), btn = n && n.querySelector("[data-fall]");
    if (btn) btn.onclick = () => {
      const open = el.classList.toggle("all");
      n.classList.toggle("open", open);
      btn.textContent = t(open ? "feat_less" : "feat_all");
      if (!open) { el.scrollLeft = 0; show(el, 0); el.parentElement.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
      restartBar(el);
    };
    restartBar(el);
  });
  setTimeout(() => document.querySelectorAll(".feat").forEach((el) => { if (!el.dataset.b) startFeat(); }), 1500);
}
function priceLine(it, f) {
  if (it.buyLine) return it.buyLine;
  if (it.own && !it.rent) return it.cashPrice ? buyPriceHtml(it.cashPrice, "cash") : buyPriceHtml(it.salePrice, "inst");
  const pre = t("from_pre");
  return `<span class="gk">⏳ ${esc(t("kind_rent"))}</span>${pre ? esc(pre) + " " : ""}<b>${esc(money(bestPerDay(it, f)))}</b> ${esc(t("per_day_from"))}`;
}
/** Bo'lib to'lashda eng kichik oylik to'lov (240 oy, boshlang'ich to'lovsiz, admin ustamasi bilan). */
function minMonthly(price) {
  const m = WHEEL_MAX;
  const yearPct = S.cfg && S.cfg.instMarkupYear != null ? Number(S.cfg.instMarkupYear) : 100;
  return Math.ceil(Math.ceil(Number(price) * (1 + (m * yearPct) / 12 / 100)) / m);
}
/** Kartochkadagi narx: turi (💎 Sotib olish / ⏳ Ijara) va summa. mode: "inst" — faqat oylik, to'liq narx ko'rsatilmaydi. */
function buyPriceHtml(price, mode, from) {
  const kind = `<span class="gk">${esc(t(mode === "lease" ? "kind_lease" : mode === "inst" ? "kind_inst" : "kind_buy"))}</span>`;
  if (!(price > 0)) return kind + esc(t(mode === "inst" || mode === "lease" ? "own_inst_only" : "price_by_admin"));
  if (mode === "lease") return kind + `${esc(t("inst_monthly"))} ≈ <b>${esc(money(leaseMin(price)))}</b> ${esc(t("som_from"))}`;
  if (mode === "inst") return kind + `${esc(t("inst_monthly"))} ≈ <b>${esc(money(minMonthly(price)))}</b> ${esc(t("som_from"))}`;
  return kind + `<b>${esc(money(price))}</b> ${esc(t(from ? "som_from" : "som"))}`;
}
function giftCard(cat, it, f) {
  const model = (it.attributes || []).find((a) => /model/i.test(a.trait_type));
  const img = it.own && it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : imgTag(cat, it.name);
  return `<button type="button" class="gcard${it.own ? " own" : ""}" data-a="${esc(it.address)}">
    <span class="gimg">${img}${it.own ? `<span class="adtag">${esc(t("ad_tag"))}</span>` : ""}${it.isNew ? `<span class="newtag">${esc(t("new_tag"))}</span>` : ""}</span>
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

async function viewRent(v, outerHead, outerBind) {
  const tab = S.rentTab || "gifts";
  const en = (S.cfg && S.cfg.services) || {};
  const tabs = [["gifts", "tab_gifts", "gift_rent"], ["numbers", "tab_numbers", "number_rent"], ["usernames", "tab_usernames", "username_rent"], ["mine", "tab_mine", null]]
    .filter(([, , svc]) => !svc || en[svc] !== false);
  const head = (outerHead || `<h1 class="page-title">${esc(t("store_title"))}</h1>`) + `
    <div class="filters" role="tablist" style="padding-bottom:0">${tabs.map(([k, l]) => `<button type="button" role="tab" class="fchip sg${tab === k ? " on" : ""}" data-tab="${k}">${esc(t(l))}</button>`).join("")}</div>`;
  const bindTabs = () => { if (outerBind) outerBind(); v.querySelectorAll(".sg[data-tab]").forEach((b) => (b.onclick = () => { S.rentTab = b.dataset.tab; render(); })); };

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
      ${ownSection(cat, (st.own || []).filter((it) => it.rent), st.formula, "our_rent")}
      ${st.error ? `<p class="alert">${esc(st.error)}</p><button class="btn btn-ghost" id="retry" type="button">${esc(t("retry"))}</button>` : ""}
      ${!st.loaded && !st.error ? `<div class="spin"></div>` : ""}
      ${st.loaded && !shown.length ? `<p class="empty">${esc(t("empty_catalog"))}</p>` : ""}
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
    if (onGiftsTab("rent") && (S.rentTab || "gifts") === cat) draw();
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

// ---------- "Sotuvda": sotuvdagi giftlar va mijozlar e'lonlari ----------
const saleLabel = (it) => (it.num != null && !/#\d+$/.test(it.name) ? `${it.name} #${it.num}` : it.name);
const saleImg = (it) => (it.photo ? `<img src="${esc(it.photo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:this.dataset.n}))" data-n="${esc(saleLabel(it))}">` : imgTag("gifts", saleLabel(it)));
const SALE_SORTS = [["price asc", "sale_sort_cheap"], ["price desc", "sale_sort_exp"]];
const saleInstOk = (price) => Boolean(S.cfg && S.cfg.saleInst && price > 0 && price <= Number(S.cfg.saleInst.max));
async function loadSale(st, more) {
  const req = ++st.req;
  st.loading = true;
  try {
    const f = st.f;
    const r = await call("portalsSale", { offset: more ? st.next : 0, sort: st.sort, collection: f.collection || undefined, model: f.model || undefined,
      backdrop: f.backdrop || undefined, symbol: f.symbol || undefined, minPrice: f.min || undefined, maxPrice: f.max || undefined, num: st.num || undefined,
      inst: st.mode === "inst" || st.mode === "lease" || undefined });
    if (req !== st.req) return; // eskiroq so'rov javobi
    st.items = more ? st.items.concat(r.items) : r.items;
    st.next = r.next; st.loaded = true; st.error = null;
  } catch (e) { if (req === st.req) { st.error = errText(e); st.loaded = true; if (!more) st.items = []; } }
  if (req === st.req) st.loading = false;
}
/** Marketapp'dagi kolleksiya ro'yxatidan model, fon va belgilar (filtr uchun). */
async function saleAttrs(name) {
  if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } }
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  const c = (S.giftCollections || []).find((x) => norm(x.name) === norm(name));
  if (!c) return [];
  try { return (await api("/api/nft/collections/" + encodeURIComponent(c.address) + "/attributes")).attributes || []; } catch { return []; }
}
async function viewSale(v, head, bindTabs, mode, tail = "") {
  S.sales ||= {};
  const st = S.sales[mode] ||= { mode, items: [], next: null, loaded: false, error: null, cols: null, f: {}, sort: "price asc", num: "", attrs: null, req: 0, own: null };
  // O'z mahsulotlarim (Reklama): shu to'lov turida sotib olish mumkin bo'lganlari, ro'yxat boshida
  if (!st.own) st.own = (await ownGifts()).filter((it) => (mode === "cash" ? it.cashPrice : it.installment));
  const chip = (k, label, val, disabled) => `<button type="button" class="fchip${val ? " on" : ""}" data-f="${k}" ${disabled ? "disabled" : ""}>${esc(val || label)}<span aria-hidden="true">⌄</span></button>`;
  const priceLbl = () => (st.f.min || st.f.max ? `${st.f.min ? money(st.f.min) : "0"} – ${st.f.max ? money(st.f.max) : "∞"}` : "");
  const reload = async () => { st.loaded = false; st.items = []; st.next = null; st.error = null; draw(); if (st.f.collection) { await loadSale(st); draw(); } };
  const searching = `<div class="spin"></div><p class="hint" style="text-align:center">${esc(t("sale_searching"))}</p>`;
  const sortChip = `<button type="button" class="fchip ic" data-f="sort" aria-label="${esc(t("sort_title"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button>`;
  const ownLine = (it) => buyPriceHtml(mode === "cash" ? it.cashPrice : it.salePrice, mode);
  const ownGrid = () => ownSection("gifts", st.own.map((it) => ({ ...it, buyLine: ownLine(it) })), null, mode === "lease" ? "our_lease" : mode === "inst" ? "our_inst" : "our_cash", mode === "cash");
  // 1-ekran: kolleksiyalar (rasm, nom, "… so'mdan")
  const drawCols = () => {
    const q = String(st.colQ || "").trim().toLowerCase();
    let cols = (st.colList || []).filter((c) => !q || c.name.toLowerCase().includes(q));
    if (st.sort === "price desc") cols = [...cols].reverse();
    v.innerHTML = head + ownGrid() + `
      <input class="input" id="cQ" placeholder="${esc(t("col_search_ph"))}" value="${esc(st.colQ || "")}" autocomplete="off" style="margin-top:12px">
      <div class="filters">${sortChip}</div>
      ${st.colErr ? `<p class="alert">${esc(st.colErr)}</p><button class="btn btn-ghost" id="retry" type="button">${esc(t("retry"))}</button>` : ""}
      ${!st.colList && !st.colErr ? searching : ""}
      ${st.colList && !cols.length && !st.own.length ? `<p class="empty">${esc(t(mode !== "cash" ? "buy_inst_empty" : "sale_empty"))}</p>` : ""}
      <div class="grid3">${cols.map((c) => `<button type="button" class="gcard" data-col="${esc(c.name)}">
        <span class="gimg">${imgTag("gifts", c.name + " #1")}</span>
        <span class="gb"><b>${esc(c.name)}</b><span class="gp">${c.from ? buyPriceHtml(c.from, mode, true) : ""}</span></span></button>`).join("")}</div>` + tail;
    bindTabs();
    v.querySelectorAll(".gcard[data-col]").forEach((c) => c.addEventListener("click", async () => {
      st.f = { collection: c.dataset.col }; st.num = ""; st.attrs = null; window.scrollTo(0, 0);
      reload();
      st.attrs = await saleAttrs(c.dataset.col);
    }));
    bindOwn();
    const retry = $("#retry", v); if (retry) retry.onclick = () => { st.colErr = null; st.colList = null; loadCols(); };
    const cq = $("#cQ", v);
    cq.addEventListener("input", () => { st.colQ = cq.value; const pos = cq.selectionStart; drawCols(); const n = $("#cQ", v); n.focus(); n.setSelectionRange(pos, pos); });
    v.querySelectorAll(".fchip[data-f]").forEach((b) => b.addEventListener("click", () => openF(b.dataset.f)));
  };
  const loadCols = async () => {
    drawCols();
    try { st.colList = await call("saleCollections", { inst: mode !== "cash" }); } catch (e) { st.colErr = errText(e); }
    if (onGiftsTab(mode) && !st.f.collection) drawCols();
  };
  const bindOwn = () => v.querySelectorAll(".gcard[data-a]").forEach((c) => c.addEventListener("click", () => {
    const it = st.own.find((x) => x.address === c.dataset.a);
    if (!it) return;
    openOwnBuy(it, mode);
  }));
  function drawFind() {
    if (!onGiftsTab(mode)) return;
    const q = st.q ||= {};
    const fld = (k, label, val, disabled) => `<div class="field"><label>${esc(label)}</label>
      <button type="button" class="input pickbtn" data-q="${k}" ${disabled ? "disabled" : ""}>${esc(val || t(k === "collection" ? "find_pick" : "find_any"))}<span aria-hidden="true">⌄</span></button></div>`;
    v.innerHTML = head + ownGrid() + `
      <section class="step findbox"><div class="step-h"><h2>${esc(t("find_title"))}</h2></div>
        ${fld("collection", t("find_gift"), q.collection)}
        <div class="row2">${fld("model", t("f_model"), q.model, !q.collection)}${fld("backdrop", t("f_backdrop"), q.backdrop, !q.collection)}</div>
        ${fld("symbol", t("f_symbol"), q.symbol, !q.collection)}
        <div class="field"><label>${esc(t("find_budget"))}</label><input class="input" id="qMax" type="number" inputmode="numeric" min="1" value="${esc(q.max || "")}" placeholder="${esc(t("price_to"))}"></div>
        <button class="btn btn-primary" id="qGo" type="button" ${q.collection && !st.finding ? "" : "disabled"}>${esc(t("find_btn"))}</button>
      </section>
      ${st.finding ? searching : ""}
      ${st.findErr ? `<p class="alert">${esc(st.findErr)}</p>` : ""}
      ${st.found && !st.finding ? (st.found.length ? `<div class="sect-h findres"><h2>${esc(t("find_results"))}</h2></div>
        <div class="grid3">${st.found.map((it, i) => `<button type="button" class="gcard" data-fi="${i}">
          <span class="gimg">${saleImg(it)}</span>
          <span class="gb"><b>${esc(it.name.replace(/\s*#\s*\d+$/, ""))}${it.num != null ? ` <small>#${esc(it.num)}</small>` : ""}</b>
            ${it.model ? `<small>${esc(it.model)}</small>` : ""}
            <span class="gp">${buyPriceHtml(it.price, "cash")}</span></span></button>`).join("")}</div>`
        : `<p class="empty">${esc(t("find_none"))}</p>`) : ""}` + tail;
    bindTabs(); bindOwn();
    const mx = $("#qMax", v); mx.addEventListener("input", () => { q.max = Number(mx.value) || null; });
    v.querySelectorAll(".pickbtn[data-q]").forEach((b) => b.addEventListener("click", async () => {
      const k = b.dataset.q;
      if (k === "collection") {
        if (!st.cols) { try { st.cols = await call("portalsCollections"); } catch { st.cols = []; } }
        if (!st.cols.length) { if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } } st.cols = (S.giftCollections || []).map((c) => c.name); }
        return pickSheet(t("find_gift"), st.cols.map((n) => ({ value: n, label: n })), q.collection, async (o) => {
          st.q = { collection: o ? o.value : null, max: q.max }; st.found = null; st.qAttrs = null; drawFind();
          if (o) st.qAttrs = await saleAttrs(o.value);
        });
      }
      if (!st.qAttrs) st.qAttrs = await saleAttrs(q.collection);
      const a = (st.qAttrs || []).find((x) => String(x.trait_type).toLowerCase() === k);
      const opts = a ? a.values.map((x) => ({ value: x.value, label: x.value, note: x.perc ? (Math.round(x.perc * 10) / 10) + "%" : "" })) : [];
      pickSheet(t("f_" + k), opts, q[k] || null, (o) => { q[k] = o ? o.value : null; st.found = null; drawFind(); });
    }));
    $("#qGo", v).addEventListener("click", async () => {
      st.finding = true; st.findErr = null; st.found = null; drawFind();
      try {
        const r = await call("portalsSale", { collection: q.collection, model: q.model || undefined, backdrop: q.backdrop || undefined, symbol: q.symbol || undefined,
          maxPrice: q.max || undefined, sort: "price asc" });
        st.found = r.items.slice().sort((x, y) => x.price - y.price).slice(0, 5);
      } catch (e) { st.findErr = errText(e); }
      st.finding = false; drawFind();
      const res = v.querySelector(".findres, .empty"); if (res) res.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    v.querySelectorAll(".gcard[data-fi]").forEach((c) => c.addEventListener("click", () => {
      S.salePick = { item: st.found[Number(c.dataset.fi)], key: key(), pay: "cash", itype: null, mode: "cash" };
      location.hash = "sale-item";
    }));
  }
  const draw = () => {
    if (!onGiftsTab(mode)) return;
    if (!st.f.collection) return drawCols();
    v.innerHTML = head + `
      <div class="filters" style="margin-top:12px"><button type="button" class="fchip on" data-f="allcols">‹ ${esc(t("all_gifts"))}</button></div>
      <h2 style="margin:6px 0 0">${esc(st.f.collection)}</h2>
      <input class="input" id="sNum" placeholder="${esc(t("sale_num_ph"))}" value="${esc(st.num)}" inputmode="numeric" autocomplete="off" style="margin-top:12px">
      <div class="filters">
        <button type="button" class="fchip ic" data-f="sort" aria-label="${esc(t("sort_title"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></button>
        ${chip("price", t("f_price"), priceLbl())}
        ${chip("model", t("f_model"), st.f.model, !st.f.collection)}
        ${chip("backdrop", t("f_backdrop"), st.f.backdrop)}
        ${chip("symbol", t("f_symbol"), st.f.symbol, !st.f.collection)}
        ${st.f.model || st.f.backdrop || st.f.symbol || st.f.min || st.f.max || st.num ? `<button type="button" class="fchip clr" data-f="clear">✕ ${esc(t("f_clear"))}</button>` : ""}
      </div>
      ${st.error ? `<p class="alert">${esc(st.error)}</p><button class="btn btn-ghost" id="retry" type="button">${esc(t("retry"))}</button>` : ""}
      ${!st.loaded ? searching : ""}
      ${st.loaded && !st.error && !st.items.length ? `<p class="empty">${esc(t("sale_empty"))}</p>` : ""}
      <div class="grid3">${st.items.map((it, i) => `<button type="button" class="gcard" data-i="${i}">
        <span class="gimg">${saleImg(it)}</span>
        <span class="gb"><b>${esc(it.name.replace(/\s*#\s*\d+$/, ""))}${it.num != null ? ` <small>#${esc(it.num)}</small>` : ""}</b>
          ${it.model ? `<small>${esc(it.model)}</small>` : ""}
          <span class="gp">${buyPriceHtml(it.price, mode)}</span></span></button>`).join("")}</div>
      ${st.next != null && st.loaded ? `<button class="btn btn-ghost more" id="more" type="button">${esc(t("load_more"))}</button>` : ""}` + tail;
    bindTabs();
    v.querySelectorAll(".gcard[data-i]").forEach((c) => c.addEventListener("click", () => {
      S.salePick = { item: st.items[Number(c.dataset.i)], key: key(), pay: mode === "cash" ? "cash" : "installment", itype: mode === "lease" ? "lease" : null, mode };
      location.hash = "sale-item";
    }));
    const more = $("#more", v); if (more) more.onclick = async () => { more.disabled = true; await loadSale(st, true); draw(); };
    const retry = $("#retry", v); if (retry) retry.onclick = reload;
    const num = $("#sNum", v);
    let tm;
    num.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { st.num = num.value.replace(/\D/g, ""); reload().then(() => { const n = $("#sNum", v); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 600); });
    v.querySelectorAll(".fchip[data-f]").forEach((b) => b.addEventListener("click", () => openF(b.dataset.f)));
  };
  const openF = async (k) => {
    if (k === "allcols") { st.f = {}; st.num = ""; st.attrs = null; st.items = []; st.loaded = false; return drawCols(); }
    if (k === "clear") { st.f = { collection: st.f.collection }; st.num = ""; return reload(); }
    if (k === "sort") return pickSheet(t("sort_title"), SALE_SORTS.map(([x, l]) => ({ value: x, label: t(l) })), st.sort, (o) => { st.sort = o ? o.value : "price asc"; if (st.f.collection) reload(); else drawCols(); });
    if (k === "price") {
      sheet(`<h2>${esc(t("f_price"))}</h2>
        <div class="row2"><input class="input" id="pMin" type="number" inputmode="numeric" placeholder="${esc(t("price_from"))}" value="${esc(st.f.min || "")}">
          <input class="input" id="pMax" type="number" inputmode="numeric" placeholder="${esc(t("price_to"))}" value="${esc(st.f.max || "")}"></div>
        <button class="btn btn-primary" id="pOk" type="button">${esc(t("apply"))}</button>`);
      $("#pOk").onclick = () => { const a = Number($("#pMin").value) || null, b = Number($("#pMax").value) || null; st.f.min = a; st.f.max = b; closeSheet(); reload(); };
      return;
    }
    if (k === "collection") {
      if (!st.cols) { try { st.cols = await call("portalsCollections"); } catch { st.cols = []; } }
      if (!st.cols.length) { if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } } st.cols = (S.giftCollections || []).map((c) => c.name); }
      return pickSheet(t("f_gift"), st.cols.map((n) => ({ value: n, label: n })), st.f.collection, async (o) => {
        st.f = { ...st.f, collection: o ? o.value : null, model: null, symbol: null };
        st.attrs = null;
        reload();
        if (o) st.attrs = await saleAttrs(o.value);
      });
    }
    if (k === "backdrop" && !st.f.collection) {
      if (!S.allBackdrops) {
        if (!Array.isArray(S.giftCollections)) { try { S.giftCollections = await api("/api/nft/collections"); } catch { S.giftCollections = []; } }
        const c0 = (S.giftCollections || [])[0];
        const at = c0 ? await saleAttrs(c0.name) : [];
        const b = at.find((x) => String(x.trait_type).toLowerCase() === "backdrop");
        if (b) S.allBackdrops = b.values.map((x) => x.value).sort();
      }
      return pickSheet(t("f_backdrop"), (S.allBackdrops || []).map((x) => ({ value: x, label: x })), st.f.backdrop, (o) => { st.f.backdrop = o ? o.value : null; reload(); });
    }
    if (!st.f.collection) return toast(t("f_pick_gift_first"));
    if (!st.attrs) st.attrs = await saleAttrs(st.f.collection);
    const a = (st.attrs || []).find((x) => String(x.trait_type).toLowerCase() === k);
    const opts = a ? a.values.map((x) => ({ value: x.value, label: x.value, note: x.perc ? (Math.round(x.perc * 10) / 10) + "%" : "" })) : [];
    pickSheet(t("f_" + k), opts, st.f[k], (o) => { st.f[k] = o ? o.value : null; reload(); });
  };
  // "Naqd": katalog emas — mijoz talablarini kiritadi, bot eng arzon 5 ta mos giftni topadi
  if (mode === "cash") return drawFind();
  if (!st.f.collection) { if (!st.colList) await loadCols(); else drawCols(); return; }
  draw();
  if (!st.loaded && !st.loading) { await loadSale(st); draw(); }
}
// ---------- Gift sahifasi: Lizing · Bo'lib to'lash · Ijara · Naqd ----------
const yearPct = (itype) => (itype === "lease" && S.cfg && S.cfg.leaseMarkupYear != null ? Number(S.cfg.leaseMarkupYear) : S.cfg && S.cfg.instMarkupYear != null ? Number(S.cfg.instMarkupYear) : 100);
/** Oylik to'lov: lizingda lizing ustamasi, bo'lib to'lashda bo'lib to'lash ustamasi (oyiga qarab). */
function planMonthly(base, down, months, itype) {
  const pct = yearPct(itype);
  const rest = Math.max(0, Number(base) - Number(down || 0));
  return Math.ceil(Math.ceil(rest * (1 + (months * pct) / 12 / 100)) / months);
}
function productHead(img, name, num, attrs, ownTag) {
  return `<div class="pimg2">${img}${num != null ? `<span class="pnum">#${esc(num)}</span>` : ""}</div>
    ${ownTag ? `<div class="kick2">${esc(t("our_gift"))}</div>` : ""}
    <h1 class="ptitle">${esc(name)}</h1>
    ${attrs.length ? `<div class="pattrs">${attrs.map(([k, x]) => `<div><span>${esc(t(k))}</span><b>${esc(x)}</b></div>`).join("")}</div>` : ""}`;
}
/** To'lov turi: sarlavha + katta tanlov kartalari (belgi, nom, qisqa izoh). */
function payTabsHtml(avail, cur) {
  return `<div class="ptk"><div class="ptk-h"><span class="sn">1</span>${esc(t("pt_q"))}</div>
    <div class="ptk-g${avail.length === 3 ? " three" : ""}">${avail.map((k) => `<button type="button" class="ptc${k === cur ? " on" : ""}" data-pt="${k}" aria-pressed="${k === cur}">
      <span class="ic">${HIC[k]}</span><span class="tx"><b>${esc(t("tab_" + k))}</b><small>${esc(t("pt_" + k))}</small></span><span class="rd"></span></button>`).join("")}</div>
    ${avail.includes("lease") && avail.includes("inst") ? `<p class="hint ptk-d">${esc(t("pt_diff"))}</p>` : ""}</div>`;
}
/** Gift sahifasi (lizing / bo'lib to'lash): katta "Oyiga X so'mdan" va bitta tugma. Tafsilotlar hisob sahifasida. */
function planEntryHtml(p, base) {
  const m = base > 0 ? (p.tab === "lease" ? leaseMin(base) : minMonthly(base)) : null;
  const li = (k) => `<li><i>✓</i>${esc(t(k))}</li>`;
  const L = p.tab === "lease" ? ["pe_l3", "pe_l1", "pe_l2"] : ["pe_i1", "pe_i2", "pe_i3"];
  return `<div class="box pe pe-${p.tab}"><span class="pe-t">${HIC[p.tab]}${esc(t("tab_" + p.tab))}</span><span class="pe-k">${esc(t("per_month_up"))}</span><b class="pe-v">${m ? `${esc(money(m))} <em>${esc(t("som_from"))}</em>` : "—"}</b>
    <ul class="pe-l">${L.map(li).join("")}</ul></div>
    <div class="cta-sp"></div><div class="cta2 one"><button class="btn btn-primary" id="go" type="button">${esc(t("calc_btn"))} →</button></div>`;
}
function viewSaleItem(v) {
  const p = S.salePick;
  if (!p) { location.hash = "gifts"; return; }
  const it = p.item;
  const canInst = saleInstOk(it.price);
  const avail = canInst ? ["lease", "inst", "cash"] : ["cash"];
  if (!p.tab || !avail.includes(p.tab)) p.tab = avail.includes(p.mode) ? p.mode : avail[0];
  if (p.tab === "lease" && !["lease", "lease_dp"].includes(p.itype)) p.itype = "lease";
  if (p.tab === "inst" && !["plan1", "plan2", "uzum"].includes(p.itype)) p.itype = "plan2";
  if (canInst && it.down1 === undefined) {
    it.down1 = null;
    call("saleDown1", { name: saleLabel(it), model: it.model || undefined, backdrop: it.backdrop || undefined, symbol: it.symbol || undefined })
      .then((r) => { it.down1 = r.down1; if (r.down1 != null && S.salePick === p && location.hash.slice(1) === "sale-item") render(); }).catch(() => {});
  }
  const attrs = [["model", it.model], ["backdrop", it.backdrop], ["f_symbol", it.symbol]].filter(([, x]) => x);
  const head = productHead(saleImg(it), it.name.replace(/\s*#\s*\d+$/, ""), it.num, attrs, false) + payTabsHtml(avail, p.tab);
  const body = (extra) => ({ service: "portals", portalsId: it.id, expectedPrice: it.price, idempotencyKey: p.key, ...extra });
  if (p.tab === "cash") {
    v.innerHTML = head + cashBoxHtml(it.price) + `<div class="cta2"><div class="s"><span>${esc(t("total_up"))}</span><b>${esc(som(it.price))}</b></div>
      <button class="btn btn-primary" id="go" type="button">${esc(t("sale_buy"))}</button></div>`;
    bindPayTabs(v, p);
    $("#go", v).onclick = () => placeOrder(body({ paymentMethod: "cash" }), it.price);
    return;
  }
  v.innerHTML = head + planEntryHtml(p, it.price);
  bindPayTabs(v, p);
  $("#go", v).onclick = () => openPlan({ name: saleLabel(it), img: saleImg(it), base: it.price, itype: p.tab === "lease" ? "lease" : "plan2", down1: it.down1, key: p.key,
    build: (x) => body({ paymentMethod: "installment", ...x }) });
}
function cashBoxHtml(price) {
  return `<div class="box"><div class="big2"><span>${esc(t("price_up"))}</span><b>${esc(som(price))}</b></div>
    <div class="kv2"><span>${esc(t("pay_word"))}</span><b>${esc(t("pay_full_note"))}</b></div>
    <div class="kv2"><span>${esc(t("balance_short"))}</span><b>${esc(som(S.me ? S.me.balance : 0))}</b></div>
    <p class="hint">${esc(t("sale_hint"))}</p></div>`;
}
function bindPayTabs(v, p) {
  // Tanlangandan keyin "Oylik to'lovni hisoblash" tugmasigacha o'zi suriladi
  v.querySelectorAll("button[data-pt]").forEach((b) => (b.onclick = () => {
    p.tab = b.dataset.pt; p.itype = null;
    render().then(() => { const g = $("#go"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); });
  }));
}

// ---------- Hisob sahifasi (lizing / bo'lib to'lash): muddat barabani, boshlang'ich to'lov, jadval ----------
function openPlan(o) {
  const lease = o.itype === "lease" || o.itype === "lease_dp";
  S.plan = { ...o, itype: lease ? "lease" : o.itype, dp: o.itype === "lease_dp" ? "yes" : "no", dpAmt: "",
    months: o.itype === "uzum" ? 12 : lease ? 24 : 12, from: location.hash.slice(1) || "gifts" };
  location.hash = "plan";
}
function addMonths(d, n) { const x = new Date(d); const day = x.getDate(); x.setMonth(x.getMonth() + n); if (x.getDate() !== day) x.setDate(0); return x; }
function viewPlan(v) {
  const pl = S.plan;
  if (!pl) { location.hash = "gifts"; return; }
  const lease = pl.itype === "lease";
  const fixedDown = pl.itype === "plan1";
  const down = () => (fixedDown ? Number(pl.down1 || 0) : pl.dp === "yes" ? Number(pl.dpAmt) || 0 : 0);
  const monthly = (m) => (pl.base > 0 && !(fixedDown && pl.down1 == null) ? planMonthly(pl.base, down(), m, pl.itype) : null);
  const fmtD = (d) => `${d.getDate()} ${t("mon_" + d.getMonth())}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
  const title = pl.cash ? t("cx_short") : lease ? t("tab_lease") : t("tab_inst");
  const inst = !lease && !pl.cash;
  const sn = (n) => `<span class="sn">${n}</span>`;
  const TY = { plan2: [t("ty_plan2"), t("ty_plan2_d")], plan1: [t("plan1"), pl.down1 != null ? t("inst_p1_d", { d: money(pl.down1) }) : t("down_by_admin")], uzum: [t("uzum"), t("uzum_d2")] };
  // Har bir bo'lib to'lash turi haqida 3 qator va taqqoslash jadvali
  const tyInfo = (k) => k === "plan2" ? [t("ty2_1"), t("ty2_2"), t("ty2_3")]
    : k === "plan1" ? (pl.down1 != null ? [t("ty1_1", { d: money(pl.down1) }), t("ty1_2"), t("ty2_3")] : [t("down_by_admin"), t("ty1_3"), t("ty2_3")])
    : [t("tyu_1"), t("tyu_2"), t("tyu_3")];
  const cmpHtml = () => {
    const b = pl.base;
    const mm = { plan2: b > 0 ? minMonthly(b) : null, plan1: b > 0 && pl.down1 != null && pl.down1 < b ? planMonthly(b, pl.down1, WHEEL_MAX, "plan1") : null, uzum: b > 0 ? planMonthly(b, 0, 12, "uzum") : null };
    const dn = { plan2: t("cmp_opt"), plan1: pl.down1 != null ? money(pl.down1) : t("cmp_admin"), uzum: t("cmp_opt") };
    const tr = { plan2: t("cmp_240"), plan1: t("cmp_240"), uzum: "3 · 6 · 12" };
    const K = ["plan2", "plan1", "uzum"];
    return `<table><thead><tr><th></th>${K.map((k) => `<th${pl.itype === k ? ' class="on"' : ""}>${esc(TY[k][0])}</th>`).join("")}</tr></thead><tbody>
      <tr><td>${esc(t("cmp_down"))}</td>${K.map((k) => `<td${pl.itype === k ? ' class="on"' : ""}>${esc(dn[k])}</td>`).join("")}</tr>
      <tr><td>${esc(t("cmp_term"))}</td>${K.map((k) => `<td${pl.itype === k ? ' class="on"' : ""}>${esc(tr[k])}</td>`).join("")}</tr>
      <tr><td>${esc(t("cmp_month"))}</td>${K.map((k) => `<td${pl.itype === k ? ' class="on"' : ""}>${mm[k] ? esc(money(mm[k])) + "+" : "—"}</td>`).join("")}</tr></tbody></table>
      <p class="hint" style="margin:6px 0 0">${esc(t("cmp_note"))}</p>`;
  };
  const typeHtml = inst ? `<div class="box"><div class="fh"><span>${sn(1)}${esc(t("ty_q"))}</span></div>
      <div class="seg4" style="grid-template-columns:1fr 1fr 1fr;margin:0">${Object.keys(TY).map((k) => `<button type="button" class="${pl.itype === k ? "on" : ""}" data-ty="${k}">${esc(TY[k][0])}</button>`).join("")}</div>
      <ul class="pe-l ty-l">${tyInfo(pl.itype).map((x) => `<li><i>✓</i>${esc(x)}</li>`).join("")}</ul>
      <details class="cmp"><summary>${esc(t("cmp_title"))}</summary>${cmpHtml()}</details></div>` : "";

  const wheelHtml = () => pl.itype === "uzum"
    ? `<div class="chips">${[3, 6, 12].map((m) => `<button type="button" class="chip" data-mo="${m}" aria-pressed="${pl.months === m}">${m} ${esc(t("months_unit"))}</button>`).join("")}</div>`
    : `<div class="wheel wheel2" id="pWheel"><div class="wheel-pad"></div>${Array.from({ length: WHEEL_MAX }, (_, i) => {
        const m = i + 1, mm = monthly(m);
        return `<div class="wheel-i${m === pl.months ? " on" : ""}"><span>${m} ${esc(t("months_unit"))}</span><span>${mm ? esc(money(mm)) : ""}</span></div>`;
      }).join("")}<div class="wheel-pad"></div></div>`;
  const dyn = () => {
    const m = monthly(pl.months), d = down();
    const today = new Date();
    const rows = [];
    if (pl.cash) rows.push([t("today"), "+" + som(pl.base), "on"]);
    if (d > 0) rows.push([t("today"), som(d), "on"]);
    rows.push([fmtD(addMonths(today, 1)), m ? som(m) : "—", ""]);
    if (pl.months > 2) rows.push([fmtD(addMonths(today, 2)), m ? som(m) : "—", ""], ["…", "", ""]);
    if (pl.months > 1) rows.push([fmtD(addMonths(today, pl.months)), t("last_pay"), "end"]);
    return {
      res: `<div class="t"><span>${esc(t("monthly_up"))}</span></div>
        <b>${m ? esc(money(m)) : "—"} <em>${esc(t("som"))}</em></b>
        <div class="m">${esc(pl.months)} ${esc(t("months_unit"))} · ${esc(t("pay_day", { d: today.getDate() }))}${d > 0 ? ` · ${esc(t("today_pay", { a: money(d) }))}` : ""}</div>`,
      tl: rows.map(([a, b, c]) => `<div><i class="${c}"></i><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join(""),
      cta: `<span>${esc(t("per_month_up"))} · ${esc(pl.months)} ${esc(t("months_unit"))}</span><b>${m ? esc(som(m)) : "—"}</b>`,
      ok: !(pl.dp === "yes" && !fixedDown && !(Number(pl.dpAmt) > 0)) && !(Number(pl.dpAmt) >= pl.base && pl.base > 0),
    };
  };
  const D = dyn();
  v.innerHTML = `<div class="plan-h"><span class="pthumb">${pl.img}</span><span><small>${esc(title)}</small><b>${esc(pl.name)}</b></span></div>
    <div class="res" id="pRes">${D.res}</div>${typeHtml}
    <div class="box"><div class="fh"><span>${sn(inst ? 2 : 1)}${esc(t("months_q"))}</span><span class="hint">${pl.itype === "uzum" ? "" : esc(t("wheel_hint"))}</span></div>${wheelHtml()}</div>
    ${pl.cash ? `<div class="box"><div class="kv2"><span>${esc(t("cx_you_get"))}</span><b>${esc(som(pl.base))}</b></div><p class="hint" style="margin:6px 0 0">${esc(t("cx_plan_note"))}</p></div>` : `<div class="box"><div class="fh"><span>${sn(inst ? 3 : 2)}${esc(t("inst_down"))}</span></div>
      ${fixedDown ? `<p class="alert" style="margin:0">${pl.down1 != null ? esc(som(pl.down1)) : esc(t("down_by_admin"))}</p>`
        : `<div class="row2"><button type="button" class="ynb${pl.dp === "no" ? " on" : ""}" data-dp="no">${esc(t("dp_no"))}</button><button type="button" class="ynb${pl.dp === "yes" ? " on" : ""}" data-dp="yes">${esc(t("dp_yes"))}</button></div>
          ${pl.dp === "yes" ? `<div class="amt"><input id="dpIn" type="number" inputmode="numeric" min="1" value="${esc(pl.dpAmt)}" placeholder="0"><em>${esc(t("som"))}</em></div>` : ""}`}</div>`}
    <div class="box"><div class="fh"><span>${esc(t("schedule"))}</span></div><div class="tl" id="pTl">${D.tl}</div></div>
    <div class="cta2"><div class="s" id="pCta">${D.cta}</div><button class="btn btn-primary" id="go" type="button" ${D.ok ? "" : "disabled"}>${esc(t("confirm_btn"))}</button></div>`;
  const refresh = () => { const x = dyn(); $("#pRes", v).innerHTML = x.res; $("#pTl", v).innerHTML = x.tl; $("#pCta", v).innerHTML = x.cta; $("#go", v).disabled = !x.ok; };
  const w = $("#pWheel", v);
  if (w) {
    w.scrollTop = (pl.months - 1) * WHEEL_H;
    let tm;
    w.addEventListener("scroll", () => {
      clearTimeout(tm);
      tm = setTimeout(() => {
        const m = Math.min(WHEEL_MAX, Math.max(1, Math.round(w.scrollTop / WHEEL_H) + 1));
        pl.months = m;
        w.querySelectorAll(".wheel-i").forEach((el, i) => el.classList.toggle("on", i + 1 === m));
        refresh();
      }, 90);
    });
    w.querySelectorAll(".wheel-i").forEach((el, i) => el.addEventListener("click", () => w.scrollTo({ top: i * WHEEL_H, behavior: "smooth" })));
  }
  v.querySelectorAll(".chip[data-mo]").forEach((c) => (c.onclick = () => { pl.months = Number(c.dataset.mo); render(); }));
  v.querySelectorAll("[data-dp]").forEach((b) => (b.onclick = () => { pl.dp = b.dataset.dp; render(); }));
  v.querySelectorAll("[data-ty]").forEach((b) => (b.onclick = () => {
    pl.itype = b.dataset.ty;
    if (pl.itype === "uzum" && ![3, 6, 12].includes(pl.months)) pl.months = 12;
    render();
  }));
  const di = $("#dpIn", v);
  if (di) di.addEventListener("input", () => {
    pl.dpAmt = di.value;
    // barabandagi oylik summalar ham yangilanadi
    if (w) w.querySelectorAll(".wheel-i").forEach((el, i) => { const mm = monthly(i + 1); el.lastElementChild.textContent = mm ? money(mm) : ""; });
    refresh();
  });
  $("#go", v).onclick = () => placeOrder(pl.build({ installmentType: pl.itype, months: pl.months, downPayment: fixedDown ? 0 : down() }), null);
}

// ---------- "Sotib olish" bo'limi ----------
/** Ega bo'lgan o'z mahsulotlarim (username / +888) bormi: shu bo'yicha "Sotib olish" ro'yxatiga qo'shiladi. */
async function ownBuyable(kind) {
  S.ownBuy ||= {};
  if (!S.ownBuy[kind]) { try { S.ownBuy[kind] = (await api("/api/own/" + kind)).map(normOwn).filter((x) => x.installment || x.cashPrice); } catch { S.ownBuy[kind] = []; } }
  return S.ownBuy[kind];
}
async function viewBuy(v) {
  const en = (S.cfg && S.cfg.services) || {};
  const card = (href, ic, title, desc, data = "") => `<a class="svc" href="${href}" ${data}><span class="svc-ic">${ic}</span><span class="svc-t"><b>${esc(title)}</b><small>${esc(desc)}</small></span><span class="chev" aria-hidden="true">›</span></a>`;
  const draw = (un, nu) => {
    v.innerHTML = `${SILVER_DEFS}<h1 class="page-title">${esc(t("buy_title"))}</h1>
      <nav class="svc-list">
        ${en.nft_gift !== false ? card("#buy-pay", SVC_ICON.nft_gift, t("buy_nft"), t("buy_nft_d")) : ""}
        ${en.premium !== false ? card("#premium", SVC_ICON.premium, t("svc_premium"), t("svcd_premium")) : ""}
        ${en.stars !== false ? card("#stars", SVC_ICON.stars, t("svc_stars"), t("svcd_stars")) : ""}
        ${un.length ? card("#buy-own", SVC_ICON.username_rent, t("buy_username"), t("buy_username_d"), 'data-k="usernames"') : ""}
        ${nu.length ? card("#buy-own", SVC_ICON.number_rent, t("buy_number"), t("buy_number_d"), 'data-k="numbers"') : ""}
      </nav>`;
    v.querySelectorAll("[data-k]").forEach((a) => a.addEventListener("click", () => { S.buyOwnKind = a.dataset.k; }));
  };
  draw([], []);
  const [un, nu] = await Promise.all([ownBuyable("usernames"), ownBuyable("numbers")]);
  if (location.hash.slice(1) === "buy") draw(un, nu);
}
function viewBuyPay(v) {
  v.innerHTML = `<h1 class="page-title">${esc(t("buy_nft"))}</h1>
    <section class="step"><div class="step-h"><h2>${esc(t("buy_pay_q"))}</h2></div><div class="modes">
      <button type="button" class="mcard" data-m="inst"><i>📅</i><b>${esc(t("buy_inst"))}</b><small>${esc(t("buy_inst_d"))}</small></button>
      <button type="button" class="mcard" data-m="cash"><i>💳</i><b>${esc(t("buy_cash"))}</b><small>${esc(t("buy_cash_d"))}</small></button></div></section>`;
  v.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { S.buyMode = b.dataset.m; location.hash = "buy-nft"; }));
}
async function viewBuyNft(v) {
  const mode = S.buyMode === "cash" ? "cash" : "inst";
  S.buyMode = mode;
  const head = `<h1 class="page-title">${esc(t("buy_nft"))}</h1>
    <div class="seg" role="tablist">${[["inst", "buy_inst"], ["cash", "buy_cash"]].map(([k, l]) => `<button type="button" role="tab" class="sg${mode === k ? " on" : ""}" data-mode="${k}">${esc(t(l))}</button>`).join("")}</div>
    ${mode === "inst" ? `<a class="svc" href="#nft" style="margin-top:12px"><span class="svc-ic">✍️</span><span class="svc-t"><b>${esc(t("buy_custom"))}</b><small>${esc(t("buy_custom_d"))}</small></span><span class="chev" aria-hidden="true">›</span></a>` : ""}`;
  const bindTabs = () => v.querySelectorAll(".sg[data-mode]").forEach((b) => (b.onclick = () => { S.buyMode = b.dataset.mode; render(); }));
  return viewSale(v, head, bindTabs, mode);
}
function viewBuyOwn(v) {
  const kind = S.buyOwnKind === "numbers" ? "numbers" : "usernames";
  const list = (S.ownBuy && S.ownBuy[kind]) || [];
  if (!list.length) { location.hash = "buy"; return; }
  v.innerHTML = `<h1 class="page-title">${esc(t(kind === "numbers" ? "buy_number" : "buy_username"))}</h1>
    <div class="grid3">${list.map((it) => giftCard(kind, it, null)).join("")}</div>`;
  v.querySelectorAll(".gcard[data-a]").forEach((c) => c.addEventListener("click", () => {
    const it = list.find((x) => x.address === c.dataset.a);
    S.rentPick = { category: kind, service: RENT_SVC[kind], route: "buy-own", item: it, formula: S.cfg && S.cfg.rentFormula, days: it.minDays, pay: null, key: key(), mode: "buy", itype: null };
    location.hash = "rent-item";
  }));
}

// ---------- "Giftlar": Lizing · Bo'lib to'lash · Ijara · Naqd ----------
const GIFT_ROUTES = new Set(["gifts", "rent", "buy-nft"]);
function onGiftsTab(tab) { return GIFT_ROUTES.has(location.hash.slice(1)) && (S.giftsTab || "lease") === tab; }
async function viewGifts(v) {
  const en = (S.cfg && S.cfg.services) || {};
  const all = [["lease", "tab_lease"], ["inst", "tab_inst"], ["rent", "tab_rent"], ["cash", "tab_cash"]].filter(([k]) =>
    k === "rent" ? en.gift_rent !== false || en.username_rent !== false || en.number_rent !== false : en.nft_gift !== false);
  if (!all.length) { v.innerHTML = `<p class="empty">${esc(t("empty_catalog"))}</p>`; return; }
  let tab = S.giftsTab || "lease";
  if (!all.some(([k]) => k === tab)) tab = all[0][0];
  S.giftsTab = tab;
  const head = `<h1 class="page-title">${esc(t("nav_gifts"))}</h1>
    <div class="seg4" role="tablist" style="grid-template-columns:${all.map(([k]) => (k === "inst" ? "1.35fr" : k === "lease" ? ".9fr" : ".85fr")).join(" ")}">${all.map(([k, l]) => `<button type="button" role="tab" class="${tab === k ? "on" : ""}" data-gt="${k}">${esc(t(l))}</button>`).join("")}</div>`;
  const bindTop = () => v.querySelectorAll(".seg4 button[data-gt]").forEach((b) => (b.onclick = () => { S.giftsTab = b.dataset.gt; window.scrollTo(0, 0); render(); }));
  if (tab === "rent") return viewRent(v, head, bindTop);
  const tail = tab === "inst" || tab === "lease" ? `<a class="svc" href="#nft" style="margin-top:18px"><span class="svc-ic">${HIC.cash.replace("<svg", '<svg fill="none" stroke="#1E3D2F" stroke-width="1.8"')}</span><span class="svc-t"><b>${esc(t("buy_custom"))}</b><small>${esc(t("buy_custom_d"))}</small></span><span class="chev" aria-hidden="true">›</span></a>` : "";
  const cxStrip = en.cashout !== false ? `<a class="cxs" href="#cashout"><span class="ic">${HIC.coin}</span><span><b>${esc(t("cxs_t"))}</b><small>${esc(t("cxs_d"))}</small></span><span class="chev" aria-hidden="true">›</span></a>` : "";
  const hint = `<p class="pick-h"><span class="sn">1</span>${esc(t("pick_gift"))}</p>`;
  return viewSale(v, head + cxStrip + hint, bindTop, tab, tail);
}

/** "Giftimni sotaman": havola va narx. Admin tasdiqlagach "Sotuvda" bo'limida chiqadi. */
/** "Giftni sotmang. Ijaraga bermang. Pul oling.": gift havolasi + kerakli summa → muddat (baraban) → ariza. Summani admin tasdiqlaydi. */
function viewCashout(v) {
  const d = S.drafts.cashout ||= { link: "", amount: "" };
  const m = () => /t\.me\/nft\/([A-Za-z0-9]+)-(\d+)/i.exec(d.link);
  const max = Number((S.cfg && S.cfg.cashoutMax) || 50000000), pct = Number((S.cfg && S.cfg.cashoutPct) || 80);
  const ready = () => Boolean(m()) && Number(d.amount) >= 10000 && Number(d.amount) <= max;
  const steps = ["cx_s1", "cx_s2", "cx_s3", "cx_s4"];
  v.innerHTML = `<div class="cxh"><span class="k">${esc(t("cx_k"))}</span><h1>${esc(t("cx_t"))}</h1><p>${esc(t("cx_d"))}</p></div>
    <div class="how">${steps.map((k, i) => `<div><i>0${i + 1}</i><span><b>${esc(t(k))}</b><small>${esc(t(k + "d"))}</small></span></div>`).join("")}</div>
    <div class="box"><div class="fh"><span>${esc(t("gift_link"))}</span></div>
      <input class="input" id="cLink" value="${esc(d.link)}" placeholder="t.me/nft/SnoopDogg-1203" inputmode="url" autocapitalize="off" autocomplete="off">
      <div id="cPrev"></div></div>
    <div class="box"><div class="fh"><span>${esc(t("cx_amount"))}</span></div>
      <div class="amt"><input id="cAmt" type="number" inputmode="numeric" min="10000" max="${max}" value="${esc(d.amount)}" placeholder="0"><em>${esc(t("som"))}</em></div>
      <p class="hint" id="cHint" style="margin:6px 0 0">${esc(t("cx_amount_hint", { p: pct, a: money(max) }))}</p></div>
    <div class="cta2"><div class="s"><span>${esc(t("cx_get_up"))}</span><b id="cSum">${Number(d.amount) > 0 ? esc(som(Number(d.amount))) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ready() ? "" : "disabled"}>${esc(t("next"))}</button></div>`;
  const prev = () => {
    const x = m();
    $("#cPrev", v).innerHTML = x ? `<div class="plan-h" style="margin:10px 0 0"><span class="pthumb"><img src="https://nft.fragment.com/gift/${esc(x[1].toLowerCase())}-${esc(x[2])}.webp" alt=""></span><span><small>${esc(t("cx_short"))}</small><b>${esc(x[1].replace(/([a-z])([A-Z])/g, "$1 $2"))} #${esc(x[2])}</b></span></div>`
      : d.link ? `<p class="hint" style="margin:6px 0 0">${esc(t("sell_link_hint"))}</p>` : "";
  };
  prev();
  const upd = () => {
    $("#go", v).disabled = !ready(); $("#cSum", v).textContent = Number(d.amount) > 0 ? som(Number(d.amount)) : "—";
    const h = $("#cHint", v); h.classList.toggle("bad", Number(d.amount) > max);
  };
  $("#cLink", v).addEventListener("input", (e) => { d.link = e.target.value.trim(); prev(); upd(); });
  $("#cAmt", v).addEventListener("input", (e) => { d.amount = e.target.value; upd(); });
  $("#go", v).onclick = () => {
    const x = m(); if (!x) return;
    const k = key(), amount = Math.round(Number(d.amount));
    openPlan({ name: `${x[1].replace(/([a-z])([A-Z])/g, "$1 $2")} #${x[2]}`, img: `<img src="https://nft.fragment.com/gift/${esc(x[1].toLowerCase())}-${esc(x[2])}.webp" alt="">`,
      base: amount, itype: "lease", cash: true, key: k,
      build: (p) => ({ service: "cashout", giftLink: d.link, amount, paymentMethod: "installment", installmentType: "cashout", months: p.months, idempotencyKey: k }) });
  };
}
function viewSell(v) {
  const d = S.drafts.sell ||= { link: "", price: "" };
  const okLink = () => /t\.me\/nft\/[A-Za-z0-9]+-\d+/i.test(d.link);
  const ready = () => okLink() && Number(d.price) >= 1000;
  v.innerHTML = `<h1 class="page-title">${esc(t("sell_title"))}</h1>
    <p class="hint">${esc(t("sell_intro"))}</p>
    <section class="step">${stepHead(1, t("gift_link"))}
      <input class="input" id="sLink" value="${esc(d.link)}" placeholder="t.me/nft/TrappedHeart-19604" inputmode="url" autocapitalize="off" autocomplete="off">
      <p class="hint">${esc(t("sell_link_hint"))}</p></section>
    <section class="step">${stepHead(2, t("sell_price"))}
      <input class="input" id="sPrice" type="number" inputmode="numeric" min="1000" value="${esc(d.price)}" placeholder="${esc(t("down_ph"))}"></section>
    <div class="cta"><button class="btn btn-primary" id="go" type="button" ${ready() ? "" : "disabled"}>${esc(t("sell_send"))}</button></div>`;
  const upd = () => ($("#go", v).disabled = !ready());
  $("#sLink", v).addEventListener("input", (e) => { d.link = e.target.value.trim(); upd(); });
  $("#sPrice", v).addEventListener("input", (e) => { d.price = e.target.value; upd(); });
  $("#go", v).addEventListener("click", async (e) => {
    if (!(await needLogin())) return;
    if (!(await ensurePhone())) return;
    e.target.disabled = true;
    try { await call("sellGift", { link: d.link, price: Number(d.price) }); S.drafts.sell = null; toast(t("sell_sent")); location.hash = "gifts"; }
    catch (er) { e.target.disabled = false; toast(errText(er)); }
  });
}

function viewRentItem(v) {
  const p = S.rentPick;
  if (!p) { location.hash = "home"; return; }
  const it = p.item;
  const canRent = !it.own || it.rent;
  // O'z giftlari: Lizing · Bo'lib to'lash · Ijara · Naqd (bor bo'lganlari)
  const avail = it.own ? [...(it.installment ? ["lease", "inst"] : []), ...(canRent ? ["rent"] : []), ...(it.cashPrice ? ["cash"] : [])] : ["rent"];
  if (!p.tab || !avail.includes(p.tab)) p.tab = avail.includes(p.buyMode) ? p.buyMode : p.mode === "rent" && canRent ? "rent" : avail[0];
  p.mode = p.tab === "rent" ? "rent" : "buy";
  if (p.tab === "lease" && !["lease", "lease_dp"].includes(p.itype)) p.itype = "lease";
  if (p.tab === "inst" && !["plan1", "plan2", "uzum"].includes(p.itype)) p.itype = "plan2";
  const img = it.own && it.image ? `<img src="${esc(it.image)}" alt="">` : imgTag(p.category, it.name);
  const nm = p.category === "gifts" ? shortName(it.name) : it.name;
  const num = p.category === "gifts" && /#\d+$/.test(it.name) ? it.name.split("#").pop() : null;
  const attrs = attrsOf(it).map((a) => [/model/i.test(a.trait_type) ? "model" : /backdrop/i.test(a.trait_type) ? "backdrop" : "f_symbol", a.value]);
  const title = productHead(img, nm, num, attrs, it.own) + (avail.length > 1 ? payTabsHtml(avail, p.tab) : "");
  const bindMode = () => bindPayTabs(v, p);

  if (p.tab === "cash") {
    v.innerHTML = title + cashBoxHtml(it.cashPrice) + `<div class="cta2"><div class="s"><span>${esc(t("total_up"))}</span><b>${esc(som(it.cashPrice))}</b></div>
      <button class="btn btn-primary" id="go" type="button">${esc(t("sale_buy"))}</button></div>`;
    bindMode();
    $("#go", v).onclick = () => placeOrder({ service: "own", ownId: it.id, ownMode: "buy", paymentMethod: "cash", idempotencyKey: p.key }, it.cashPrice);
    return;
  }
  if (p.tab === "lease" || p.tab === "inst") {
    v.innerHTML = title + planEntryHtml(p, it.salePrice);
    bindMode();
    $("#go", v).onclick = () => openPlan({ name: it.name, img, base: it.salePrice, itype: p.tab === "lease" ? "lease" : "plan2", down1: it.down1, key: p.key,
      build: (x) => ({ service: "own", ownId: it.id, ownMode: "buy", paymentMethod: "installment", idempotencyKey: p.key, ...x }) });
    return;
  }

  const f = p.formula;
  const price = (d) => itemPrice(it, f, d);
  const max = it.maxDays, min = it.minDays;
  const so = avail.length > 1 ? 1 : 0; // tepada "1. To'lov turini tanlang" bo'lsa, qadamlar 2 dan boshlanadi
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
    <section class="step">${stepHead(1 + so, t("rent_days"))}
      <div class="chips">${preset.map((x) => `<button type="button" class="chip" data-d="${x}" aria-pressed="${p.days === x}">${esc(t("days_n", { n: x }))}${x === max && saving >= 1 ? ` <span class="save">−${saving}%</span>` : ""}</button>`).join("")}</div>
      <input class="input" id="days" type="number" inputmode="numeric" min="${min}" max="${max}" value="${esc(p.days)}">
      <p class="hint">${esc(t("days_range", { a: min, b: max }))}</p>
      <p class="hint" id="pdl">${esc(perDayLine(p.days))}</p>
      <div id="upsWrap">${upsell(p.days)}</div>
    </section>
    ${payStep(2 + so, p, ["plan2", "uzum"])}
    <div class="cta2">
      <div class="s"><span id="lbl">${esc(t("rent_total", { n: ok(p.days) ? p.days : "—" }))}</span><b id="tot">${p.pay === "installment" ? esc(instCta(p)) : ok(p.days) ? esc(som(price(p.days))) : "—"}</b></div>
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
    $("#tot", v).textContent = p.pay === "installment" ? instCta(p) : good ? som(price(p.days)) : "—";
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
    ${inst ? `<p class="alert" style="width:100%">${esc(t(r.service === "cashout" ? "done_cash" : "done_inst"))}</p>
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
  // Lizing / bo'lib to'lash: progress (necha oy to'langan) va keyingi to'lov
  const instBlock = (i) => {
    if (!i) return "";
    const pct = i.months ? Math.max(0, Math.min(100, Math.round(((i.paidMonths || 0) / i.months) * 100))) : 0;
    return `${i.months ? `<div class="prog"><div style="width:${pct}%"></div></div>
        <div class="fh"><span>${esc(t("paid_months", { a: i.paidMonths || 0, b: i.months }))}</span><span>${esc(t("final_date"))}: ${esc(date(i.finalDate))}</span></div>` : ""}
      ${i.active && i.nextDueDate ? `<div class="paybox${i.overdue ? " late" : ""}"><div><span>${esc(t(i.overdue ? "overdue_pay" : "next_pay"))} · ${esc(date(i.nextDueDate))}</span><b>${esc(som(i.monthlyPayment))}</b></div>
        <button class="btn btn-primary btn-sm" type="button" data-pay="${i.id}">${esc(t("pay_now"))}</button></div>` : ""}`;
  };
  const nameOf = (title) => String(title || "").split(" — ")[0];
  const kindLine = (o) => (o.plan ? `${t(o.plan.type === "lease" ? "tab_lease" : o.plan.type === "cashout" ? "cx_short" : o.plan.type || "pay_inst")}${o.plan.months ? ` · ${o.plan.months} ${t("months_unit")}` : ""}` : "");
  const cards = data.orders.map((o) => `<article class="item">
      <div class="ord-h"><span class="othumb">${imgTag("gifts", nameOf(o.title))}</span><span class="ot"><b>${esc(nameOf(o.title))}</b>${o.plan ? `<small>${esc(kindLine(o))}</small>` : ""}</span>
        <span class="badge b-${esc(o.status)}">${esc(t("st_" + o.status))}</span></div>
      <div class="meta"><code>${esc(o.publicId)}</code><span>${esc(date(o.createdAt))}</span>${o.plan ? "" : `<span>${esc(t("pm_" + o.paymentMethod))}</span>`}
        ${o.price != null ? `<span>${esc(som(o.price))}</span>` : ""}${o.recipient ? `<span>@${esc(o.recipient)}</span>` : ""}</div>
      ${o.rentEndsAt ? `<div class="kv"><span>${esc(t("rent_ends"))}</span><b>${esc(date(o.rentEndsAt))}</b></div>` : ""}
      ${o.paymentMethod === "installment" ? (o.installment ? instBlock(o.installment) : `<p class="hint">${esc(t("inst_pending"))}${o.plan && o.plan.estMonthly ? ` · ${esc(t("inst_monthly"))} ≈ ${esc(som(o.plan.estMonthly))}` : ""}</p>`) : ""}
      ${o.canReview ? `<button class="btn btn-ghost btn-sm" type="button" data-rev="${esc(o.publicId)}">${esc(t("leave_review"))}</button>`
        : o.reviewStatus === "pending" ? `<p class="hint">${esc(t("review_pending"))}</p>` : o.reviewStatus === "published" ? `<p class="hint">${esc(t("review_published"))}</p>` : ""}
    </article>`);
  const legacy = data.agreements.map((a) => `<article class="item">
      <div class="item-h"><b>${esc(a.title)}</b><span class="badge ${a.active ? "b-queued" : "b-completed"}">${esc(t("pm_installment"))}</span></div>
      ${instBlock({ ...a })}</article>`);
  const instIdx = new Set(data.orders.map((o, i) => (o.paymentMethod === "installment" ? i : -1)).filter((i) => i >= 0));
  const otab = S.ordersTab || (instIdx.size || legacy.length ? "inst" : "other");
  const all = otab === "inst" ? cards.filter((_, i) => instIdx.has(i)).concat(legacy) : cards.filter((_, i) => !instIdx.has(i));
  v.innerHTML = `<h1 class="page-title">${esc(t("orders_title"))}</h1>
    <div class="seg4" style="grid-template-columns:1.4fr 1fr;margin-bottom:12px">${[["inst", "orders_inst"], ["other", "orders_other"]].map(([k, l]) => `<button type="button" class="${otab === k ? "on" : ""}" data-ot="${k}">${esc(t(l))}</button>`).join("")}</div>
    ${all.length ? `<div class="list">${all.join("")}</div>` : `<div class="empty"><p>${esc(t("no_orders"))}</p><p style="margin-top:14px"><a class="btn btn-primary" href="#home">${esc(t("choose_service"))}</a></p></div>`}`;
  v.querySelectorAll("[data-ot]").forEach((b) => (b.onclick = () => { S.ordersTab = b.dataset.ot; render(); }));
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
  v.innerHTML = `<h1 class="page-title">${esc(t("balance_short"))}</h1>
    <div class="balhero reveal"><span class="lbl">${esc(t("balance_up"))}</span><b>${esc(som(b.balance))}</b>
      <p class="bh">${esc(t("topup_contact"))}</p>
      ${admin ? `<a class="bhb" href="https://t.me/${esc(admin)}" target="_blank" rel="noopener">${esc(t("write_admin"))}</a>` : ""}</div>
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
  gifts: viewGifts,
  rent: (v) => { S.giftsTab = "rent"; return viewGifts(v); },
  "buy-nft": (v) => { S.giftsTab = S.buyMode === "cash" ? "cash" : S.buyMode === "lease" ? "lease" : "inst"; return viewGifts(v); },
  "rent-gifts": (v) => { S.rentTab = "gifts"; location.replace("#rent"); }, "rent-usernames": (v) => { S.rentTab = "usernames"; location.replace("#rent"); }, "rent-numbers": (v) => { S.rentTab = "numbers"; location.replace("#rent"); },
  "rent-item": viewRentItem, "sale-item": viewSaleItem, plan: viewPlan, cashout: viewCashout, sell: viewSell, buy: viewBuy, "buy-pay": viewBuyPay, "buy-own": viewBuyOwn, orders: viewOrders, balance: viewBalance, done: viewDone, login: viewLogin, help: viewHelp,
};
const TOP = new Set(["home", "gifts", "rent", "buy-nft", "orders", "balance", "login", "done"]);
const PARENT = { "rent-item": () => (S.rentPick && S.rentPick.route === "buy-own" ? "buy-own" : "gifts"), "sale-item": () => "gifts", sell: () => "gifts", "buy-pay": () => "gifts", "buy-own": () => "buy", nft: () => "gifts", plan: () => (S.plan && S.plan.from) || "gifts", cashout: () => "home" };

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
  const GIFTS = ["gifts", "rent", "buy", "buy-pay", "buy-nft", "buy-own", "sale-item", "sell", "rent-item", "nft", "plan"];
  const tab = ["orders", "balance"].includes(route) ? route : route === "plan" && S.plan && S.plan.cash ? "home" : GIFTS.includes(route) ? "gifts" : "home";
  document.querySelectorAll(".tab").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#backBtn").hidden = TOP.has(route);
  $("#brand").hidden = !TOP.has(route);
  const v = $("#view");
  if (S.lastRoute !== route) window.scrollTo(0, 0);
  S.lastRoute = route;
  if ((route === "premium" || route === "stars") && !S.me) await login();
  await fn(v);
  startFeat();
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
