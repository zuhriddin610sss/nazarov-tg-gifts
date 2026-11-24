// Mijoz Mini App'i uchun amallar (endpoints/app.js orqali chaqiriladi).
import { api, InputFile } from 'sdk';
import { all, get, run, fail, getSettings, toSom, toTiyin, nowMs, int, str, idemKey, USERNAME_RE, cleanUser, adminIds, logError } from 'lib/core';
import { listRent, seenRentItem, giftCollections, collectionAttributes, searchRecipient, marketappConfigured } from 'lib/marketapp';
import { PREMIUM_PLANS, PREMIUM_LABEL, rentTotalTon, rentPriceTiyin, rentCostTiyin, starsPriceTiyin } from 'lib/pricing';
import { createOrder, createReceipt, payInstallment, checkPromo, leaveReview, summarize, listAgreements } from 'lib/shop';
import { notifyNewOrder, receiptButtons, notifyNewListing } from 'lib/notify';
import { attrsFromTelegram } from 'lib/admintools';
import { decode, imageType } from 'lib/b64';
import { fmt } from 'lib/core';
import { ownSaleQuote, refreshOneStale, monthlyPayment, markupFor, giftDown1, ownRentPpd, ownRentFormula } from 'lib/calc';
import { portalsConfigured, portalsMarket, portalsSaleItem, portalsCollectionNames, portalsCollectionFloors } from 'lib/portals';
import { satelliteConfigured, satMarket, satSaleItem, satCollectionNames, satCachedFloors, normName, MARKET_NAME } from 'lib/satellite';

/** Portals narxidan mijoz narxi (so'm): (TON + add) × rate, yuqoriga yaxlitlanadi. */
/** Mijoz e'lonini ilova ko'rinishiga keltiradi. */
export function listingOut(l) {
  const m = /#\s*(\d+)\s*$/.exec(l.name);
  return { id: 'u' + l.id, listing: true, name: l.name.replace(/\s*#\s*\d+$/, ''), num: m ? Number(m[1]) : null, photo: l.image || null,
    model: l.model || null, backdrop: l.backdrop || null, symbol: l.symbol || null, price: toSom(l.price) };
}
export const portalsSom = (ton, s) => Math.ceil((Number(ton) + Number(s.portals_sale.add)) * Number(s.portals_sale.rate));

const LANGS = ['uz', 'ru', 'en', 'zh'];
const RENT = { gift_rent: 'gifts', username_rent: 'usernames', number_rent: 'numbers' };
const OWN_RENT = { gifts: 'gift_rent', usernames: 'username_rent', numbers: 'number_rent' };
/** ppd — avtomatik ijara uchun Marketapp kunlik narxi (nanoTON) yoki null; s — sozlamalar (formula uchun). */
export function ownOut(p, ppd = null, s = null) {
  const rent = !p.rent_enabled ? null
    : ppd && s ? { pricePerDayNano: String(ppd), formula: ownRentFormula(s), minDays: p.rent_min, maxDays: p.rent_max }
    : p.rent_price ? { pricePerDay: toSom(p.rent_price), minDays: p.rent_min, maxDays: p.rent_max } : null;
  return {
    id: p.id, kind: p.kind, name: p.name, image: p.image || null, model: p.model || null, backdrop: p.backdrop || null, symbol: p.symbol || null,
    rent,
    installment: Boolean(p.inst_enabled), cashPrice: p.cash_enabled && p.cash_price ? toSom(p.cash_price) : null,
    isNew: Number(p.created_at) > Date.now() - 7 * 86400000,
  };
}

/** Telegram tekshirgan foydalanuvchini topadi yoki yaratadi. */
export async function upsertCustomer(user) {
  const lc = String(user.language_code || '').slice(0, 2);
  await run(`INSERT INTO customers (telegram_id, username, first_name, last_name, lang, last_seen_at)
             VALUES (:tid, :u, :f, :l, :lang, :now)
             ON CONFLICT (telegram_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name,
               last_name = excluded.last_name, last_seen_at = excluded.last_seen_at`,
    { tid: user.id, u: user.username ?? null, f: user.first_name ?? null, l: user.last_name ?? null, lang: LANGS.includes(lc) ? lc : 'uz', now: nowMs() });
  return get('SELECT * FROM customers WHERE telegram_id = :tid', { tid: user.id });
}

/** Rasmni adminning chatiga jo'natib, Telegram file_id sini oladi (fayllar Telegram'da saqlanadi). */
async function storeImage(base64, caption, withButtonsFor) {
  const bytes = decode(base64);
  if (bytes.length === 0) throw fail('FILE_REQUIRED');
  if (bytes.length > 8 * 1024 * 1024) throw fail('FILE_TOO_LARGE');
  const type = imageType(bytes);
  if (!type) throw fail('FILE_TYPE_NOT_ALLOWED');
  const admins = adminIds();
  if (!admins.length) throw fail('ADMIN_NOT_CONFIGURED');
  const name = 'image.' + type.split('/')[1];
  let fileId = null;
  for (const id of admins) {
    try {
      const m = await api.sendPhoto({ chat_id: id, photo: fileId || new InputFile(bytes, name, { type }), caption,
        ...(withButtonsFor ? { reply_markup: receiptButtons(withButtonsFor) } : { disable_notification: true }) });
      if (!fileId && m && Array.isArray(m.photo)) fileId = m.photo[m.photo.length - 1].file_id;
      // Buyurtma rasmi alohida xabar bo'lib qolmasin: file_id olingach o'chiriladi (rasm buyurtma xabari bilan birga keladi)
      if (!withButtonsFor && m && m.message_id) { try { await api.deleteMessage({ chat_id: id, message_id: m.message_id }); } catch (e) {} }
      if (!withButtonsFor && fileId) break;
    } catch (e) {
      await logError('upload', e && (e.description || e.message));
    }
  }
  if (!fileId) throw fail('UPLOAD_FAILED');
  return fileId;
}

export const actions = {
  async config() {
    const s = await getSettings();
    return {
      about: { channel: s.about_channel || null },
      services: s.services_enabled, starsPrice: s.stars_price, starsMin: s.stars_min, premiumPrices: s.premium_prices,
      rentFormula: s.rent_formula, adminContact: s.admin_contact, marketapp: await marketappConfigured(),
      instMarkupYear: s.inst_markup_year,
      leaseMarkupYear: s.lease_markup_year,
      cashoutPct: s.cashout_pct, cashoutMax: s.cashout_max,
      portalsSale: Boolean(s.services_enabled.nft_gift),
      saleInst: s.sale_inst.enabled ? { max: Number(s.sale_inst.max) } : null,
    };
  },

  async me(_i, c) {
    return { id: c.id, username: c.username, firstName: c.first_name, phone: c.phone, hasPhone: Boolean(c.phone), lang: c.lang, balance: toSom(c.balance) };
  },

  async setLang(i, c) {
    if (!LANGS.includes(i.lang)) throw fail('VALIDATION');
    await run('UPDATE customers SET lang = :l WHERE id = :id', { l: i.lang, id: c.id });
    return { ok: true };
  },

  /** Telefon raqamini Telegram kontakti orqali olish: Mini App requestContact -> botga kontakt keladi. Bu yerda faqat holat. */
  async phoneStatus(_i, c) {
    return { hasPhone: Boolean(c.phone) };
  },

  async rentList(i) {
    const category = ['gifts', 'usernames', 'numbers'].includes(i.category) ? i.category : null;
    if (!category) throw fail('VALIDATION', { field: 'category' });
    const s = await getSettings();
    const data = await listRent(category, i);
    return {
      cursor: data.cursor, formula: s.rent_formula,
      items: data.items.map((it) => ({
        address: it.nft_address, name: it.nft_name, attributes: it.attributes || [],
        minDays: Math.max(1, Math.ceil(Number(it.min_duration) / 86400)), maxDays: Math.floor(Number(it.max_duration) / 86400),
        pricePerDayNano: String(it.price_per_day),
      })),
    };
  },

  async ownList(i) {
    const kind = ['gifts', 'usernames', 'numbers'].includes(i.category) ? i.category : null;
    const rows = await all(`SELECT * FROM own_products WHERE visible = 1 AND (:k IS NULL OR kind = :k) ORDER BY position, id DESC LIMIT 100`, { k: kind });
    const s = await getSettings();
    const out = [];
    await refreshOneStale(rows, s);
    for (const p of rows) {
      const o = ownOut(p, await ownRentPpd(p, { cached: true }), s);
      if (p.inst_enabled) { const q = await ownSaleQuote(p, s, { cached: true }); o.salePrice = q.price; o.down1 = q.down1; }
      out.push(o);
    }
    return out;
  },

  /**
   * "Sotuvda" bo'limi: mijozlar e'lonlari (birinchi sahifada, tepada) + Portals'dagi sotuvdagi giftlar.
   * Filtrlar: collection, model, backdrop, symbol, minPrice/maxPrice (so'm), num (gift raqami), sort.
   */
  async portalsSale(i) {
    const s = await getSettings();
    if (!s.services_enabled.nft_gift) throw fail('SERVICE_DISABLED');
    const offset = i.offset ? int(i.offset, { min: 0, max: 100000, name: 'offset' }) : 0;
    const sort = ['price asc', 'price desc', 'listed_at desc'].includes(i.sort) ? i.sort : 'price asc';
    const f = { collection: str(i.collection, 80) || null, model: str(i.model, 80) || null, backdrop: str(i.backdrop, 80) || null, symbol: str(i.symbol, 80) || null };
    const minSom = Number(i.minPrice) > 0 ? Number(i.minPrice) : null, maxSom = Number(i.maxPrice) > 0 ? Number(i.maxPrice) : null;
    const numStr = String(i.num || '').trim().replace(/^#/, '');
    const num = /^\d{1,9}$/.test(numStr) ? Number(numStr) : null;
    // So'mdan TON'ga: narx = (TON + add) × rate  =>  TON = so'm / rate − add
    const toTon = (x) => (x != null ? Math.max(0.001, x / Number(s.portals_sale.rate) - Number(s.portals_sale.add)) : null);
    let items = [], total = 0, failed = false;
    const instOnly = i.inst === true || i.inst === 'true' || i.inst === 1;
    let usedSat = false;
    if (await satelliteConfigured()) {
      // Gift Satellite: 5 ta bozor bitta ro'yxatda (bozor nomi mijozga berilmaydi)
      const r = await satMarket({ ...f, num });
      if (r) {
        usedSat = true; failed = false;
        let all = r.items.map((x) => ({ id: x.id, name: x.name, num: x.num, photo: null, model: x.model, backdrop: x.backdrop, symbol: x.symbol, price: portalsSom(x.ton, s) }));
        if (sort === 'price desc') all.reverse();
        all = all.filter((x) => (minSom == null || x.price >= minSom) && (maxSom == null || x.price <= maxSom)
          && (!instOnly || (s.sale_inst.enabled && x.price <= Number(s.sale_inst.max))));
        total = all.length;
        items = all.slice(offset, offset + 30);
      } else failed = true;
    }
    // Zaxira: Gift Satellite ulanmagan yoki javob bermagan bo'lsa — Portals
    if (!usedSat && (await portalsConfigured())) {
      failed = false;
      const r = await portalsMarket({ ...f, minTon: toTon(minSom), maxTon: toTon(maxSom), num, offset, sort });
      if (r) { items = r.items.map((x) => ({ ...x, price: portalsSom(x.ton, s), ton: undefined })); total = r.total; } else failed = true;
    }
    let mine = [];
    if (offset === 0) {
      const low = (x) => String(x || '').trim().toLowerCase();
      mine = (await all("SELECT * FROM sell_listings WHERE status = 'active' ORDER BY id DESC LIMIT 100")).map(listingOut).filter((x) =>
        (!f.collection || low(x.name) === low(f.collection)) && (!f.model || low(x.model) === low(f.model))
        && (!f.backdrop || low(x.backdrop) === low(f.backdrop)) && (!f.symbol || low(x.symbol) === low(f.symbol))
        && (minSom == null || x.price >= minSom) && (maxSom == null || x.price <= maxSom) && (num == null || String(x.num || '').startsWith(String(num))));
    }
    if (failed && !mine.length && offset === 0) throw fail('MARKET_UNAVAILABLE');
    // Narx so'mga aylantirilganda yaxlitlanadi: chegaradan chiqqanlarini olib tashlaymiz
    const instOk = (x) => !instOnly || (s.sale_inst.enabled && x.price <= Number(s.sale_inst.max));
    items = items.filter((x) => (minSom == null || x.price >= minSom) && (maxSom == null || x.price <= maxSom) && instOk(x));
    mine = mine.filter(instOk);
    return { items: mine.concat(items), total, next: !failed && offset + 30 < total ? offset + 30 : null };
  },
  /** "Giftimni sotaman": e'lon admin tasdig'iga tushadi. */
  async sellGift(i, c) {
    const m = /t\.me\/nft\/([A-Za-z0-9]+)-(\d+)/i.exec(String(i.link || ''));
    if (!m) throw fail('BAD_LINK');
    const price = int(i.price, { min: 1000, max: 100000000000, name: 'price' });
    const pending = await get("SELECT COUNT(*) AS n FROM sell_listings WHERE customer_id = :c AND status = 'pending'", { c: c.id });
    if (Number(pending.n) >= 5) throw fail('TOO_MANY_LISTINGS');
    const slug = m[1], n = Number(m[2]);
    const name = slug.replace(/([a-z])([A-Z])/g, '$1 $2') + ' #' + n;
    const a = (await attrsFromTelegram(slug, n)) || {};
    const r = await run(`INSERT INTO sell_listings (customer_id, name, link, image, model, backdrop, symbol, price, status, created_at)
      VALUES (:c, :name, :link, :img, :model, :backdrop, :symbol, :price, 'pending', :now) RETURNING id`,
      { c: c.id, name, link: `https://t.me/nft/${slug}-${n}`, img: `https://nft.fragment.com/gift/${slug.toLowerCase()}-${n}.webp`,
        model: a.model || null, backdrop: a.backdrop || null, symbol: a.symbol || null, price: toTiyin(price), now: nowMs() });
    await notifyNewListing(Number((r.rows && r.rows[0] && r.rows[0].id) ?? r.lastInsertRowid));
    return { ok: true };
  },
  /** "Sotuvda" gift uchun 1-tur boshlang'ich to'lovi (formula). Topilmasa null: admin yozadi. */
  async saleDown1(i) {
    const s = await getSettings();
    const name = str(i.name, 120, { required: true });
    return { down1: await giftDown1(name, { model: str(i.model, 80) || null, backdrop: str(i.backdrop, 80) || null, symbol: str(i.symbol, 80) || null }, s) };
  },
  /**
   * "Sotib olish → NFT gift" bosh ekrani: kolleksiyalar va "… so'mdan" narxi (Portals'dagi eng arzoni asosida).
   * inst: faqat bo'lib to'lashga mumkin bo'lganlari (eng arzoni chegaradan oshmasa).
   */
  async saleCollections(i) {
    const s = await getSettings();
    if (!s.services_enabled.nft_gift) throw fail('SERVICE_DISABLED');
    const inst = i.inst === true || i.inst === 'true';
    let list = [];
    if (await portalsConfigured()) list = (await portalsCollectionFloors()).map((c) => ({ name: c.name, from: c.floor ? portalsSom(c.floor, s) : null }));
    if (!list.length && (await satelliteConfigured())) list = (await satCollectionNames()).map((name) => ({ name, from: null }));
    // Barcha bozorlar: kolleksiya ochilganda topilgan eng arzoni Portals'nikidan arzon bo'lsa, o'shani ko'rsatamiz
    if (await satelliteConfigured()) {
      const fl = await satCachedFloors();
      list = list.map((c) => { const t = fl[normName(c.name)]; const som = t ? portalsSom(t, s) : null; return som && (c.from == null || som < c.from) ? { ...c, from: som } : c; });
    }
    if (inst) list = list.filter((c) => s.sale_inst.enabled && c.from != null && c.from <= Number(s.sale_inst.max));
    return list.sort((a, b) => (a.from ?? Infinity) - (b.from ?? Infinity) || a.name.localeCompare(b.name));
  },
  async portalsCollections() {
    if (await satelliteConfigured()) return satCollectionNames();
    if (!(await portalsConfigured())) return [];
    return portalsCollectionNames();
  },
  async giftCollections() { return giftCollections(); },
  async collectionAttributes(i) { return collectionAttributes(i.address); },

  async checkRecipient(i) {
    const u = cleanUser(i.username);
    if (!USERNAME_RE.test(u)) throw fail('BAD_USERNAME');
    if (!(await marketappConfigured())) return { username: u, verified: false };
    const r = await searchRecipient(i.service, u);
    return { username: u, verified: true, name: r.name, photo: r.photo };
  },

  async uploadImage(i, c) {
    const fileId = await storeImage(i.image, `Mijoz rasm yukladi: ${c.username ? '@' + c.username : c.telegram_id}`, null);
    return { file: fileId };
  },

  async checkPromo(i, c) {
    const price = toTiyin(i.price);
    if (!(price > 0)) throw fail('VALIDATION');
    const r = await checkPromo(str(i.code, 32, { required: true }), c.id, String(i.service), price);
    return { code: r.code, discount: toSom(r.discount), finalPrice: toSom(r.finalPrice) };
  },

  async createOrder(i, c) {
    const s = await getSettings();
    const service = i.service;
    if (service !== 'own' && service !== 'own_multi' && service !== 'portals' && !s.services_enabled[service]) throw fail(service in s.services_enabled ? 'SERVICE_DISABLED' : 'VALIDATION');
    const method = i.paymentMethod === 'cash' ? 'cash' : i.paymentMethod === 'installment' ? 'installment' : null;
    if (!method) throw fail('VALIDATION', { field: 'paymentMethod' });
    const key = idemKey(i.idempotencyKey);

    const recipient = (r) => {
      const u = r && r.self ? c.username : cleanUser(r && r.username);
      if (!u) throw fail(r && r.self ? 'SELF_USERNAME_MISSING' : 'RECIPIENT_REQUIRED');
      if (!USERNAME_RE.test(u)) throw fail('BAD_USERNAME');
      return u;
    };
    const itype = (allowed) => {
      if (method !== 'installment') return null;
      if (!allowed.includes(i.installmentType)) throw fail('INSTALLMENT_TYPE_REQUIRED');
      return i.installmentType;
    };

    let o;
    if (service === 'own') {
      // Adminning o'z mahsuloti ("Reklama"): ijara yoki sotuv
      const p = await get('SELECT * FROM own_products WHERE id = :id AND visible = 1', { id: int(i.ownId, { min: 1, name: 'ownId' }) });
      if (!p) throw fail('NOT_FOUND');
      if (i.ownMode === 'rent') {
        const ppd = await ownRentPpd(p);
        if (!p.rent_enabled || !(ppd || p.rent_price)) throw fail('VALIDATION', { field: 'ownMode' });
        const days = int(i.days, { min: 1, max: 3650, name: 'days' });
        if (days < p.rent_min || days > p.rent_max) throw fail('BAD_DURATION', { minDays: p.rent_min, maxDays: p.rent_max });
        // Avtomatik: (Marketapp ijara narxi × kun + add) × 3 × kurs; aks holda qo'lda kunlik narx × kun
        const price = ppd ? rentPriceTiyin(rentTotalTon(ppd, days), ownRentFormula(s)) : Number(p.rent_price) * days;
        o = { service: OWN_RENT[p.kind], title: `${p.name} — ${days} kun`, installmentType: itype(['plan2', 'uzum']), price: method === 'cash' ? price : null, estBase: price,
          details: { own: p.id, name: p.name, days, ...(method === 'installment' ? { quotedPrice: price } : {}) } };
      } else if (i.ownMode === 'buy') {
        if (method === 'cash' && !(p.cash_enabled && p.cash_price)) throw fail('VALIDATION', { field: 'paymentMethod' });
        if (method === 'installment' && !p.inst_enabled) throw fail('VALIDATION', { field: 'paymentMethod' });
        const q = method === 'installment' ? await ownSaleQuote(p, s) : null;
        o = { service: 'nft_gift', title: `${p.name} — sotib olish`, installmentType: itype(['lease', 'plan1', 'plan2', 'uzum']),
          estBase: q && q.price ? toTiyin(q.price) : null, down1: q ? q.down1 : null,
          price: method === 'cash' ? Number(p.cash_price) : null,
          details: { own: p.id, sale: true, kind: p.kind, name: p.name, model: p.model || undefined, backdrop: p.backdrop || undefined } };
      } else throw fail('VALIDATION', { field: 'ownMode' });
    } else if (service === 'own_multi') {
      // Bir nechta bizning giftimiz birga (lizing / bo'lib to'lash): narxlar qo'shiladi, bitta oylik to'lov
      if (method !== 'installment') throw fail('VALIDATION', { field: 'paymentMethod' });
      const ids = [...new Set((Array.isArray(i.ownIds) ? i.ownIds : []).map((x) => int(x, { min: 1, name: 'ownIds' })))].slice(0, 20);
      if (ids.length < 2) throw fail('VALIDATION', { field: 'ownIds' });
      const items = [];
      for (const id of ids) {
        const p = await get('SELECT * FROM own_products WHERE id = :id AND visible = 1 AND inst_enabled = 1', { id });
        if (!p) throw fail('NOT_FOUND');
        const q = await ownSaleQuote(p, s, { cached: true });
        if (!q.price) throw fail('VALIDATION', { field: 'price' });
        items.push({ own: p.id, name: p.name, model: p.model || undefined, backdrop: p.backdrop || undefined, price: q.price, down1: q.down1 });
      }
      const total = items.reduce((t2, x) => t2 + x.price, 0);
      if (i.expectedTotal != null && Math.abs(Number(i.expectedTotal) - total) > 1) throw fail('PRICE_CHANGED', { price: total });
      o = { service: 'nft_gift', title: `${items.length} ta gift — sotib olish`, installmentType: itype(['lease', 'plan1', 'plan2', 'uzum']),
        estBase: toTiyin(total), down1: items.every((x) => x.down1 != null) ? items.reduce((t2, x) => t2 + x.down1, 0) : null, price: null,
        details: { multi: items, sale: true, kind: 'gifts', name: items.map((x) => x.name).join(', ') } };
    } else if (service === 'portals') {
      // "Sotuvda" bo'limidagi gift: Portals'dagi yoki mijoz e'loni ("u123"). Narx buyurtma paytida qayta tekshiriladi.
      if (!s.services_enabled.nft_gift) throw fail('SERVICE_DISABLED');
      const id = str(i.portalsId, 64, { required: true });
      let it, listing = null;
      if (/^u\d+$/.test(id)) {
        listing = await get("SELECT * FROM sell_listings WHERE id = :id AND status = 'active'", { id: Number(id.slice(1)) });
        it = listing ? listingOut(listing) : null;
        if (it && listing.customer_id === c.id) throw fail('OWN_LISTING');
      } else if (/^gs\d:/.test(id)) {
        try { it = await satSaleItem(id); } catch (e) { throw fail('MARKET_UNAVAILABLE'); }
        if (it) it.price = portalsSom(it.ton, s);
      } else {
        try { it = await portalsSaleItem(id); } catch (e) { throw fail('MARKET_UNAVAILABLE'); }
        if (it) it.price = portalsSom(it.ton, s);
      }
      if (!it) throw fail('GIFT_SOLD');
      const price = it.price;
      if (i.expectedPrice != null && Number(i.expectedPrice) !== price) throw fail('PRICE_CHANGED', { price });
      // Bo'lib to'lash: admin yoqqan bo'lsa va narx chegaradan oshmasa
      if (method === 'installment' && !(s.sale_inst.enabled && price <= Number(s.sale_inst.max))) throw fail('VALIDATION', { field: 'paymentMethod' });
      const label = `${it.name}${it.num != null && !/#\d+$/.test(it.name) ? ' #' + it.num : ''}`;
      const seller = listing ? await get('SELECT username, phone FROM customers WHERE id = :id', { id: listing.customer_id }) : null;
      const ty = itype(['lease', 'plan1', 'plan2', 'uzum']);
      o = { service: 'nft_gift', title: `${label} — sotib olish`, installmentType: ty,
        price: method === 'cash' ? toTiyin(price) : null, estBase: toTiyin(price),
        down1: ty === 'plan1' || (ty === 'lease' && i.leaseType === 'plan1') ? await giftDown1(label, { model: it.model, backdrop: it.backdrop, symbol: it.symbol }, s) : null,
        details: { ...(listing ? { listing: listing.id, seller: seller && seller.username ? '@' + seller.username : (seller && seller.phone) || `mijoz #${listing.customer_id}`, link: listing.link }
          : it.market ? { market: MARKET_NAME[it.market] || it.market, ton: it.ton, link: it.link || undefined, slug: String(id).split(':').slice(2).join(':') }
          : { portals: it.id, ton: it.ton }), name: label, model: it.model || undefined, backdrop: it.backdrop || undefined, symbol: it.symbol || undefined, sale: true,
          ...(method === 'installment' ? { quotedPrice: toTiyin(price) } : {}) } };
      if (listing) o.afterCreate = async () => run("UPDATE sell_listings SET status = 'sold', updated_at = :t WHERE id = :id AND status = 'active'", { t: nowMs(), id: listing.id });
    } else if (service === 'premium') {
      if (!PREMIUM_PLANS.includes(i.plan)) throw fail('VALIDATION', { field: 'plan' });
      o = { service, title: `Telegram Premium — ${PREMIUM_LABEL[i.plan]}`, details: { plan: i.plan }, recipient: recipient(i.recipient),
        installmentType: itype(['plan2', 'uzum']), price: method === 'cash' ? toTiyin(s.premium_prices[i.plan]) : null, estBase: toTiyin(s.premium_prices[i.plan]) };
    } else if (service === 'stars') {
      const q = int(i.quantity, { min: 1, max: 1000000, name: 'quantity' });
      if (q < s.stars_min) throw fail('STARS_MIN', { min: s.stars_min });
      o = { service, title: `Telegram Stars — ${q} ta`, details: { quantity: q }, recipient: recipient(i.recipient),
        installmentType: itype(['plan2', 'uzum']), price: method === 'cash' ? starsPriceTiyin(q, s) : null, estBase: starsPriceTiyin(q, s) };
    } else if (service === 'nft_gift') {
      if (method !== 'installment') throw fail('VALIDATION', { field: 'paymentMethod' });
      const name = str(i.giftName, 120), link = str(i.giftLink, 300), image = str(i.giftImage, 300);
      if (!name && !link && !image) throw fail('GIFT_IDENTIFICATION_REQUIRED');
      if (link && !/^https?:\/\/\S+$/i.test(link)) throw fail('BAD_LINK');
      o = { service, title: name ? `NFT sovg'a — ${name}` : "NFT sovg'a (maxsus so'rov)", installmentType: itype(['plan1', 'plan2', 'uzum']), price: null,
        details: { name, link, image, collectionAddress: str(i.collectionAddress, 80), model: str(i.model, 80) || 'any', backdrop: str(i.backdrop, 80) || 'any' } };
    } else if (service === 'cashout') {
      // "Giftni sotmang. Ijaraga bermang. Pul oling.": mijoz gift havolasi va kerakli summani yozadi, summani admin tasdiqlaydi.
      if (s.services_enabled.cashout === false) throw fail('SERVICE_DISABLED');
      if (method !== 'installment') throw fail('VALIDATION', { field: 'paymentMethod' });
      const m = /t\.me\/nft\/([A-Za-z0-9]+)-(\d+)/i.exec(String(i.giftLink || ''));
      if (!m) throw fail('BAD_LINK');
      const amount = int(i.amount, { min: 10000, max: 10000000000, name: 'amount' });
      if (amount > Number(s.cashout_max)) throw fail('VALIDATION', { field: 'amount', max: Number(s.cashout_max) });
      const slug = m[1], n = Number(m[2]);
      const name = slug.replace(/([a-z])([A-Z])/g, '$1 $2') + ' #' + n;
      const a = (await attrsFromTelegram(slug, n)) || {};
      i.installmentType = 'cashout'; i.downPayment = 0;
      o = { service: 'nft_gift', title: `${name} — pul olish`, installmentType: 'cashout', price: null, estBase: toTiyin(amount),
        details: { cashout: true, name, amount, link: `https://t.me/nft/${slug}-${n}`, image: `https://nft.fragment.com/gift/${slug.toLowerCase()}-${n}.webp`,
          model: a.model || undefined, backdrop: a.backdrop || undefined, symbol: a.symbol || undefined } };
    } else if (RENT[service]) {
      const item = await seenRentItem(RENT[service], str(i.address, 100, { required: true }));
      const minDays = Math.max(1, Math.ceil(Number(item.min_duration) / 86400)), maxDays = Math.floor(Number(item.max_duration) / 86400);
      const days = int(i.days, { min: 1, max: 3650, name: 'days' });
      if (days < minDays || days > maxDays) throw fail('BAD_DURATION', { minDays, maxDays });
      const P = rentTotalTon(item.price_per_day, days);
      const price = rentPriceTiyin(P, s.rent_formula);
      o = { service, title: `${item.nft_name} — ${days} kun`, installmentType: itype(['plan2', 'uzum']), cost: rentCostTiyin(P, s.rent_formula), estBase: price,
        price: method === 'cash' ? price : null,
        details: { address: item.nft_address, name: item.nft_name, days, pricePerDayNano: String(item.price_per_day), marketappTotalTon: P,
          attributes: item.attributes, formula: s.rent_formula, ...(method === 'installment' ? { quotedPrice: price } : {}) } };
    } else throw fail('VALIDATION', { field: 'service' });

    if (method === 'installment' && o.installmentType) {
      const months = int(i.months, { min: 1, max: 240, name: 'months' });
      // Lizingda ham tur tanlanadi: Oddiy (plan2), 1-tur (plan1), Uzum — ustama lizingniki
      const leaseType = o.installmentType === 'lease' && ['plan2', 'plan1'].includes(i.leaseType) ? i.leaseType : null; // lizingda Uzum yo'q
      const sub = leaseType || o.installmentType;
      if (sub === 'uzum' && ![3, 6, 12].includes(months)) throw fail('VALIDATION', { field: 'months' });
      o.details = { ...(o.details || {}), months, ...(leaseType ? { leaseType } : {}) };
      // Lizing: ustama 0%, boshlang'ich to'lov ixtiyoriy (bo'lsa — mijoz yozgan summa)
      if (['plan2', 'uzum', 'lease', 'cashout'].includes(o.installmentType)) {
        const dp = Number(i.downPayment || 0);
        if (!Number.isFinite(dp) || dp < 0 || dp > 1000000000) throw fail('VALIDATION', { field: 'downPayment' });
        o.details.downPayment = Math.round(dp);
      }
      if (sub === 'plan1') o.details.downPayment = o.down1 != null ? o.down1 : null;
      // Taxminiy oylik to'lov (narxi ma'lum bo'lsa)
      if (o.estBase && o.details.downPayment != null) {
        const base = Math.ceil(Number(o.estBase) / 100);
        if (o.details.downPayment < base) {
          const m = monthlyPayment(base, o.details.downPayment, months, markupFor(s, o.installmentType));
          o.details.estPrice = base; o.details.estMonthly = m.monthly;
        }
      }
    }
    const afterCreate = o.afterCreate;
    delete o.estBase; delete o.down1; delete o.afterCreate;

    const r = await createOrder({ ...o, customerId: c.id, paymentMethod: method, idempotencyKey: key,
      promoCode: method === 'cash' && i.promoCode ? String(i.promoCode).trim().slice(0, 32) : null });
    if (!r.duplicate && afterCreate) await afterCreate();
    if (!r.duplicate) await notifyNewOrder(r.id);
    return { publicId: r.publicId, duplicate: r.duplicate, paymentMethod: method };
  },

  /** Xaridlarim: navbat raqami va ichki hisob ko'rsatilmaydi. */
  async myOrders(_i, c) {
    const rows = await all(`SELECT o.*, a.id AS agreement_id, a.start_date, a.monthly_payment, a.final_date, a.status AS agreement_status, rv.status AS review_status
        FROM orders o LEFT JOIN agreements a ON a.order_id = o.id LEFT JOIN reviews rv ON rv.order_id = o.id
        WHERE o.customer_id = :c AND o.status NOT IN ('pending','failed') ORDER BY o.created_at DESC LIMIT 200`, { c: c.id });
    const legacy = await all(`SELECT id, product_name, start_date, monthly_payment, final_date, status FROM agreements
        WHERE customer_id = :c AND order_id IS NULL ORDER BY start_date DESC`, { c: c.id });
    const DAY = 86400000;
    // To'lov holati (progress, keyingi to'lov) — shartnomalar bo'yicha
    const sums = new Map((await listAgreements({ customerId: c.id })).map((a) => [a.id, a]));
    const prog = (id) => {
      const a = sums.get(id);
      if (!a) return {};
      const sm = a.summary, monthly = Number(a.monthly_payment), down = Number(a.down_payment);
      const months = monthly > 0 ? Math.round((Number(a.total_price) - down) / monthly) : null;
      // Mijozga umumiy va qolgan qarz summasi aytilmaydi: faqat necha oy to'langani va keyingi to'lov sanasi
      return { nextDueDate: sm.nextDueDate, overdue: sm.overdue, months, paidMonths: monthly > 0 ? Math.min(months || 0, Math.floor((sm.paid - down) / monthly)) : null };
    };
    return {
      orders: rows.map((r) => {
        const det = JSON.parse(r.details || '{}');
        const rent = RENT[r.service] && r.status === 'completed' && r.closed_at ? Number(r.closed_at) + Number(det.days || 0) * DAY : null;
        return {
          publicId: r.public_id, service: r.service, title: r.title, paymentMethod: r.payment_method, status: r.status,
          price: r.payment_method === 'cash' ? toSom(r.price) : null, recipient: r.recipient, createdAt: Number(r.created_at), rentEndsAt: rent,
          canReview: r.status === 'completed' && !r.review_status, reviewStatus: r.review_status || null,
          installment: r.agreement_id ? { id: r.agreement_id, purchasedAt: r.start_date, monthlyPayment: toSom(r.monthly_payment), finalDate: r.final_date, active: r.agreement_status === 'active', ...prog(r.agreement_id) } : null,
          plan: r.payment_method === 'installment' ? { type: r.installment_type || null, months: det.months || null, estMonthly: det.estMonthly || null, downPayment: det.downPayment ?? null } : null,
        };
      }),
      agreements: legacy.map((a) => ({ id: a.id, title: a.product_name, purchasedAt: a.start_date, monthlyPayment: toSom(a.monthly_payment), finalDate: a.final_date, active: a.status === 'active', ...prog(a.id) })),
    };
  },

  async track(i) {
    const id = String(i.publicId || '').trim().toUpperCase();
    if (!/^NG-[A-Z0-9]{6}$/.test(id)) throw fail('ORDER_NOT_FOUND');
    const o = await get(`SELECT public_id, title, status, created_at FROM orders WHERE public_id = :p AND status NOT IN ('pending','failed')`, { p: id });
    if (!o) throw fail('ORDER_NOT_FOUND');
    return { publicId: o.public_id, title: o.title, status: o.status, createdAt: Number(o.created_at) };
  },

  async balance(_i, c) {
    const s = await getSettings();
    const ledger = await all('SELECT amount, kind, note, created_at FROM ledger WHERE customer_id = :c ORDER BY id DESC LIMIT 100', { c: c.id });
    const receipts = await all('SELECT id, amount, status, created_at FROM receipts WHERE customer_id = :c ORDER BY id DESC LIMIT 20', { c: c.id });
    return {
      balance: toSom(c.balance),
      ledger: ledger.map((l) => ({ amount: toSom(l.amount), kind: l.kind, note: l.note, createdAt: Number(l.created_at) })),
      receipts: receipts.map((r) => ({ id: r.id, amount: toSom(r.amount), status: r.status, createdAt: Number(r.created_at) })),
      adminContact: s.admin_contact,
    };
  },



  async payInstallment(i, c) {
    const r = await payInstallment(int(i.id, { min: 1 }), c.id, idemKey(i.idempotencyKey));
    return { amount: toSom(r.amount) };
  },

  async leaveReview(i, c) {
    const rating = int(i.rating, { min: 1, max: 5, name: 'rating' });
    const text = str(i.text, 1000, { required: true, name: 'text' });
    if (text.length < 2) throw fail('VALIDATION', { field: 'text' });
    await leaveReview(c.id, String(i.publicId || ''), rating, text);
    return { ok: true };
  },

  async reviews() {
    const rows = await all(`SELECT r.rating, r.text, r.created_at, c.first_name FROM reviews r JOIN customers c ON c.id = r.customer_id
        WHERE r.status = 'published' ORDER BY r.id DESC LIMIT 30`);
    return rows.map((r) => ({ rating: r.rating, text: r.text, createdAt: Number(r.created_at), name: r.first_name ? String(r.first_name).slice(0, 1).toUpperCase() + '***' : '***' }));
  },
};

export { summarize };
