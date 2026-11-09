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
  return round2((P + f.add) * f.mult * f.rate);
}

let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }
function errText(e) {
  const code = e && e.code;
  if (code && I18N.uz["err_" + code]) return t("err_" + code, e.extra || {});
  return t("err_generic");
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (S.token) headers.authorization = "Bearer " + S.token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers["content-type"] = "application/json"; body = JSON.stringify(body); }
  const res = await fetch(path, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && S.token) { S.token = null; S.me = null; store.set("ng_token", null); }
    const { error, ...extra } = data || {};
    throw { code: error || "HTTP_" + res.status, extra, status: res.status };
  }
  return data;
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
  const bot = S.cfg && S.cfg.botUsername;
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
  const bot = S.cfg && S.cfg.botUsername;
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
      ${bal < toPay ? `<p class="alert">${esc(t("insufficient"))}</p><a class="btn btn-primary" href="#balance" id="goTop">${esc(t("topup"))}</a>`
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
function insufficient(amount) {
  sheet(`<h2>${esc(t("insufficient"))}</h2>
    <p class="hint">${esc(t("your_balance", { b: money(S.me ? S.me.balance : 0) }))} · ${esc(t("total"))}: ${esc(som(amount))}</p>
    <a class="btn btn-primary" href="#balance" id="goTop">${esc(t("topup"))}</a>
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

function recipientStep(n, d) {
  const noUser = S.me && !S.me.username;
  return `<section class="step">${stepHead(n, t("step_recipient"))}
    <div class="row2" role="radiogroup">
      ${opt("me", t("rcp_me"), "", "", d.rcp === "me", "rcp")}
      ${opt("other", t("rcp_other"), "", "", d.rcp === "other", "rcp")}
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
  </section>`;
}

// ---------- sahifalar ----------
function viewHome(v) {
  const en = (S.cfg && S.cfg.services) || {};
  const list = ["nft_gift", "gift_rent", "username_rent", "number_rent", "premium", "stars"].filter((s) => en[s] !== false);
  v.innerHTML = `<h1 class="page-title">${esc(t("choose_service"))}</h1>
    <div class="tiles">${list.map((s) => `<a class="tile" href="#${ROUTE[s]}"><span class="ic metal">${ICONS[s]}</span><b>${esc(t("svc_" + s))}</b></a>`).join("")}</div>
    <p style="text-align:center;margin-top:22px"><a class="help-link" href="#help">${esc(t("help_link"))}</a></p>`;
}

function viewPremium(v) {
  const d = S.drafts.premium ||= { plan: null, rcp: "me", rcpUser: "", pay: null, itype: null, key: key() };
  const p = S.cfg.premiumPrices;
  const plans = [["m1", "months_1", "m1_note"], ["m3", "months_3"], ["m6", "months_6"], ["m12_login", "months_12_login", "m12_login_note"], ["m12", "months_12"]];
  const cashPrice = d.plan ? p[d.plan] : null;
  const ready = d.plan && d.pay && (d.pay === "cash" || d.itype) && (d.rcp === "me" ? !S.me || Boolean(S.me.username) : true);
  v.innerHTML = `<h1 class="page-title">Telegram Premium</h1>
    <section class="step">${stepHead(1, t("step_plan"))}<div class="opts" role="radiogroup">
      ${plans.map(([id, l, note]) => opt(id, t(l), note ? t(note) : "", d.pay === "installment" ? "" : som(p[id]), d.plan === id, "plan")).join("")}
    </div></section>
    ${recipientStep(2, d)}
    ${payStep(3, d, ["plan2", "uzum"])}
    <div class="cta">
      <div class="sum"><span>${esc(t("total"))}</span><b>${d.pay === "installment" ? esc(t("price_by_admin")) : cashPrice ? esc(som(cashPrice)) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ready ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  wireForm(v, d, "premium", () => placeOrder({
    service: "premium", plan: d.plan, paymentMethod: d.pay, installmentType: d.pay === "installment" ? d.itype : undefined,
    recipient: { self: d.rcp === "me", username: d.rcpUser }, idempotencyKey: d.key,
  }, cashPrice));
}

function viewStars(v) {
  const min = S.cfg.starsMin, price = S.cfg.starsPrice;
  const d = S.drafts.stars ||= { qty: Math.max(min, 100), rcp: "me", rcpUser: "", pay: null, itype: null, key: key() };
  const ok = Number.isInteger(d.qty) && d.qty >= min;
  const total = ok ? round2(d.qty * price) : 0;
  const ready = ok && d.pay && (d.pay === "cash" || d.itype);
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
    $("#go", v).disabled = !(good && d.pay && (d.pay === "cash" || d.itype));
    v.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.q) === d.qty)));
  });
  v.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { d.qty = Number(c.dataset.q); render(); }));
  wireForm(v, d, "stars", () => placeOrder({
    service: "stars", quantity: d.qty, paymentMethod: d.pay, installmentType: d.pay === "installment" ? d.itype : undefined,
    recipient: { self: d.rcp === "me", username: d.rcpUser }, idempotencyKey: d.key,
  }, round2(d.qty * price)));
}

/** Umumiy: radio tanlovlar, username maydoni, "Davom etish" tugmasi */
function wireForm(v, d, _svc, submit) {
  bindOpts(v, (g, val) => {
    if (g === "pay" && val !== d.pay) d.itype = null;
    d[g] = val;
    render();
  });
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
  v.innerHTML = `<h1 class="page-title">${esc(t("nft_title"))}</h1>
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
      <p class="hint">${esc(t("pay_inst_note"))}</p>
    </section>
    <div class="cta">
      ${hasId ? "" : `<p class="hint" style="text-align:center">${esc(t("need_one"))}</p>`}
      <button class="btn btn-primary" id="go" type="button" ${hasId && d.itype ? "" : "disabled"}>${esc(t("send_request"))}</button>
    </div>`;

  const upd = () => { $("#go", v).disabled = !((d.name.trim() || d.link.trim() || d.image) && d.itype); };
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
    if (g === "itype") d.itype = val;
    else if (g === "model" || g === "backdrop") d[g] = val === "any" ? "any" : (d[g] !== "any" ? d[g] : "custom");
    render();
  });
  $("#go", v).addEventListener("click", () => {
    const clean = (x) => (x === "custom" || !x ? "any" : x);
    placeOrder({
      service: "nft_gift", paymentMethod: "installment", installmentType: d.itype,
      giftName: d.name.trim() || undefined, giftLink: d.link.trim() || undefined, giftImage: d.image || undefined,
      collectionAddress: d.collection || undefined, model: clean(d.model), backdrop: clean(d.backdrop), idempotencyKey: d.key,
    });
  });
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

async function viewRent(v, route) {
  const [category, service] = CAT[route];
  const st = S.rent[category] ||= { items: [], cursor: null, loaded: false, sort: "price_per_day", q: "", formula: null, error: null };
  const draw = () => {
    const ql = st.q.trim().toLowerCase();
    const items = st.items.filter((it) => !ql || it.name.toLowerCase().includes(ql) || attrsOf(it).some((a) => String(a.value).toLowerCase().includes(ql)));
    v.innerHTML = `<h1 class="page-title">${esc(t("svc_" + service))}</h1>
      <div class="cat-tools">
        <input class="input" id="q" type="search" placeholder="${esc(t("search"))}" value="${esc(st.q)}">
        <select class="input" id="sort" style="flex:0 1 auto">
          <option value="price_per_day" ${st.sort === "price_per_day" ? "selected" : ""}>${esc(t("sort_cheap"))}</option>
          <option value="recently_touch" ${st.sort === "recently_touch" ? "selected" : ""}>${esc(t("sort_new"))}</option>
        </select>
      </div>
      ${st.error ? `<p class="alert">${esc(st.error)}</p><button class="btn btn-ghost" id="retry" type="button">${esc(t("retry"))}</button>` : ""}
      ${!st.loaded && !st.error ? `<div class="spin"></div>` : ""}
      ${st.loaded && !items.length ? `<p class="empty">${esc(t("empty_catalog"))}</p>` : ""}
      <div class="cards">${items.map((it) => `<button type="button" class="card" data-a="${esc(it.address)}">
          <div class="img">${imgTag(category, it.name)}</div>
          <div class="b"><b>${esc(it.name)}</b>
            ${attrsOf(it).length ? `<div class="attrs">${attrsOf(it).map((a) => `<span>${esc(a.value)}</span>`).join("")}</div>` : ""}
            <small>${esc(t("rent_total", { n: it.minDays }))}: ${esc(som(rentPrice(it.pricePerDayNano, it.minDays, st.formula)))}</small>
          </div></button>`).join("")}</div>
      ${st.cursor && st.loaded ? `<div class="cta" style="position:static"><button class="btn btn-ghost" id="more" type="button">${esc(t("load_more"))}</button></div>` : ""}`;
    const q = $("#q", v);
    q.addEventListener("input", () => { st.q = q.value; const pos = q.selectionStart; draw(); const n = $("#q", v); n.focus(); n.setSelectionRange(pos, pos); });
    $("#sort", v).addEventListener("change", (e) => { st.sort = e.target.value; st.items = []; st.cursor = null; st.loaded = false; load(); });
    v.querySelectorAll(".card").forEach((c) => c.addEventListener("click", () => {
      const it = st.items.find((x) => x.address === c.dataset.a);
      S.rentPick = { category, service, route, item: it, formula: st.formula, days: it.minDays, pay: null, key: key() };
      location.hash = "rent-item";
    }));
    const more = $("#more", v); if (more) more.addEventListener("click", () => load(true));
    const retry = $("#retry", v); if (retry) retry.addEventListener("click", () => { st.error = null; load(); });
  };
  const load = async (more) => {
    draw();
    try {
      const qs = new URLSearchParams({ sort_by: st.sort });
      if (more && st.cursor) qs.set("cursor", st.cursor);
      const r = await api(`/api/rent/${category}?${qs}`);
      st.formula = r.formula;
      st.items = more ? st.items.concat(r.items) : r.items;
      st.cursor = r.cursor; st.loaded = true; st.error = null;
    } catch (e) { st.error = e.code && e.code.startsWith("MARKETAPP") ? errText(e) : t("catalog_error"); }
    if (location.hash.slice(1) === route) draw();
  };
  if (!st.loaded) load(); else draw();
}

function viewRentItem(v) {
  const p = S.rentPick;
  if (!p) { location.hash = "home"; return; }
  const it = p.item;
  const preset = [1, 3, 7, 14, 30, 60, 90].filter((x) => x >= it.minDays && x <= it.maxDays);
  if (!preset.includes(it.minDays)) preset.unshift(it.minDays);
  const ok = Number.isInteger(p.days) && p.days >= it.minDays && p.days <= it.maxDays;
  const price = ok ? rentPrice(it.pricePerDayNano, p.days, p.formula) : null;
  v.innerHTML = `<div class="hero-img">${imgTag(p.category, it.name)}</div>
    <h1 class="page-title" style="text-align:center">${esc(it.name)}</h1>
    ${attrsOf(it).length ? `<div class="attrs" style="justify-content:center">${attrsOf(it).map((a) => `<span>${esc(a.trait_type)}: ${esc(a.value)}</span>`).join("")}</div>` : ""}
    <section class="step">${stepHead(1, t("rent_days"))}
      <div class="chips">${preset.map((x) => `<button type="button" class="chip" data-d="${x}" aria-pressed="${p.days === x}">${esc(t("days_n", { n: x }))}</button>`).join("")}</div>
      <input class="input" id="days" type="number" inputmode="numeric" min="${it.minDays}" max="${it.maxDays}" value="${esc(p.days)}">
      <p class="hint">${esc(t("days_range", { a: it.minDays, b: it.maxDays }))}</p>
    </section>
    ${payStep(2, p, null)}
    <div class="cta">
      <div class="sum"><span id="lbl">${esc(t("rent_total", { n: ok ? p.days : "—" }))}</span><b id="tot">${p.pay === "installment" ? esc(t("price_by_admin")) : price != null ? esc(som(price)) : "—"}</b></div>
      <button class="btn btn-primary" id="go" type="button" ${ok && p.pay ? "" : "disabled"}>${esc(t("next"))}</button>
    </div>`;
  v.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { p.days = Number(c.dataset.d); render(); }));
  const di = $("#days", v);
  di.addEventListener("input", () => {
    p.days = parseInt(di.value, 10);
    const good = Number.isInteger(p.days) && p.days >= it.minDays && p.days <= it.maxDays;
    $("#lbl", v).textContent = t("rent_total", { n: good ? p.days : "—" });
    $("#tot", v).textContent = p.pay === "installment" ? t("price_by_admin") : good ? som(rentPrice(it.pricePerDayNano, p.days, p.formula)) : "—";
    $("#go", v).disabled = !(good && p.pay);
    v.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.d) === p.days)));
  });
  bindOpts(v, (g, val) => { p[g] = val; render(); });
  $("#go", v).addEventListener("click", () => placeOrder({
    service: p.service, address: it.address, days: p.days, paymentMethod: p.pay, idempotencyKey: p.key,
  }, rentPrice(it.pricePerDayNano, p.days, p.formula)));
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
  v.innerHTML = `<h1 class="page-title">${esc(t("balance_title"))}</h1><div class="spin"></div>`;
  let b;
  try { b = await api("/api/balance"); } catch (e) { v.innerHTML = `<p class="alert">${esc(errText(e))}</p>`; return; }
  const admin = (b.adminContact || "").replace(/^@/, "");
  v.innerHTML = `<div class="bal"><small>${esc(t("balance_title"))}</small><b>${esc(som(b.balance))}</b></div>
    <section class="box">
      <h2>${esc(t("topup_title"))}</h2>
      ${b.card.number ? `<div class="cardno"><div><small class="hint">${esc(t("card"))}</small><br><code id="cardNo">${esc(b.card.number)}</code>
          ${b.card.holder ? `<br><small class="hint">${esc(t("card_holder"))}: ${esc(b.card.holder)}</small>` : ""}</div>
          <button class="btn btn-ghost btn-sm" id="copy" type="button">${esc(t("copy"))}</button></div>`
        : `<p class="alert">${esc(t("card_missing"))}</p>`}
      ${b.instructions ? `<p class="warnbox">${esc(b.instructions)}</p>` : ""}
      <p class="rc-line">${esc(t("upload_below"))}</p>
      <form id="rcForm" class="opts" novalidate>
        <div class="field"><label for="amt">${esc(t("amount"))}</label><input class="input" id="amt" inputmode="numeric" autocomplete="off"></div>
        <div class="field"><label>${esc(t("receipt"))}</label>
          <label class="btn btn-ghost" for="rcFile" id="rcLbl">${esc(t("choose_file"))}</label>
          <input id="rcFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></div>
        <button class="btn btn-primary" type="submit" id="rcSend">${esc(t("send_receipt"))}</button>
      </form>
      ${admin ? `<p class="hint">${esc(t("cant_pay"))} <a href="https://t.me/${esc(admin)}" target="_blank" rel="noopener">${esc(t("write_admin"))}</a></p>` : ""}
    </section>
    ${b.receipts.length ? `<section class="box"><h2>${esc(t("receipts"))}</h2>${b.receipts.map((r) => `<div class="led"><div>${esc(som(r.amount))}<small>${esc(date(r.created_at))}</small></div><span class="badge ${r.status === "approved" ? "b-completed" : r.status === "rejected" ? "b-cancelled" : "b-queued"}">${esc(t("rc_" + r.status))}</span></div>`).join("")}</section>` : ""}
    <section class="box"><h2>${esc(t("history"))}</h2>
      ${b.ledger.length ? b.ledger.map((l) => `<div class="led"><div>${esc(t("k_" + l.kind))}${l.note ? ` · ${esc(l.note)}` : ""}<small>${esc(date(l.created_at))}</small></div>
        <span class="${Number(l.amount) > 0 ? "p" : "m"}">${Number(l.amount) > 0 ? "+" : "−"}${esc(som(Math.abs(Number(l.amount))))}</span></div>`).join("") : `<p class="hint">${esc(t("no_history"))}</p>`}
    </section>`;
  const cp = $("#copy", v);
  if (cp) cp.addEventListener("click", () => {
    const txt = b.card.number.replace(/\s/g, "");
    const sel = () => { const r = document.createRange(); r.selectNodeContents($("#cardNo")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    try { navigator.clipboard.writeText(txt).then(() => toast(t("copied")), sel); } catch { sel(); }
  });
  $("#rcFile", v).addEventListener("change", (e) => { if (e.target.files[0]) $("#rcLbl", v).textContent = t("file_chosen") + " ✓"; });
  $("#rcForm", v).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = $("#rcFile", v).files[0];
    const amount = $("#amt", v).value.replace(/[\s,]/g, "");
    if (!f) return toast(t("err_FILE_REQUIRED"));
    if (!(Number(amount) >= 1000)) return toast(t("err_BAD_AMOUNT"));
    const fd = new FormData(); fd.append("amount", amount); fd.append("file", f);
    const btn = $("#rcSend", v); btn.disabled = true;
    try { await api("/api/balance/receipts", { body: fd }); toast(t("receipt_sent")); render(); }
    catch (er) { btn.disabled = false; toast(errText(er)); }
  });
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
    <div class="list">${[1, 2, 3, 4, 5, 6].map((n) => `<details class="item"><summary style="cursor:pointer;font-weight:800">${esc(t("q" + n))}</summary><p class="hint" style="margin-top:8px">${esc(t("a" + n))}</p></details>`).join("")}</div>
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
  "rent-gifts": (v) => viewRent(v, "rent-gifts"), "rent-usernames": (v) => viewRent(v, "rent-usernames"), "rent-numbers": (v) => viewRent(v, "rent-numbers"),
  "rent-item": viewRentItem, orders: viewOrders, balance: viewBalance, done: viewDone, login: viewLogin, help: viewHelp,
};
const TOP = new Set(["home", "orders", "balance", "login", "done"]);
const PARENT = { "rent-item": () => (S.rentPick ? S.rentPick.route : "home") };

function applyStatic() {
  document.documentElement.lang = S.lang === "zh" ? "zh-CN" : S.lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $("#lang").value = S.lang;
}
async function render() {
  const route = location.hash.slice(1) || "home";
  const fn = VIEWS[route] || viewHome;
  applyStatic();
  const tab = route === "orders" || route === "balance" ? route : "home";
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
  try { S.cfg = await api("/api/config"); } catch { S.cfg = { services: {}, premiumPrices: {}, starsPrice: 240, starsMin: 50 }; }
  if (tg) await login(); else await loadMe();
  render();
})();
})();
