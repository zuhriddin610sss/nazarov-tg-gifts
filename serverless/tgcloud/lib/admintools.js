// Adminlar uchun bot buyruqlari: bozor narxi, ijara narxi, bo'lib to'lash kalkulyatori.
import { fetch } from 'sdk';
import { getSettings, logError } from 'lib/core';
import { money } from 'lib/texts';
import { marketappConfigured, listRent, giftOnSaleByNumber, toTon } from 'lib/marketapp';
import { rentTotalTon, rentPriceTiyin } from 'lib/pricing';
import { collectionByName, floorPrice, rentListingFor, downByFormula, monthlyPayment, markupPercent, splitGiftName } from 'lib/calc';

export const ADMIN_HELP = [
  'Admin buyruqlari:',
  '• Sovg\'a havolasini yuboring (t.me/nft/TrappedHeart-19604): bozor narxi, ijara narxi va 1-tur boshlang\'ich to\'lovi',
  '• /narx Trapped Heart | Crime Scene | Persimmon: nomi, model va fon bo\'yicha',
  '• /hisob 1000000 6 200000: narx, oy, boshlang\'ich to\'lov bo\'yicha oylik to\'lov',
].join('\n');

const num = (s) => Number(String(s).replace(/[\s,_']/g, ''));
const som = (x) => money(x) + " so'm";
const ton = (x) => (Math.round(Number(x) * 100) / 100).toLocaleString('ru-RU') + ' TON';
const attrOf = (it, t) => { const a = (it && it.attributes || []).find((x) => String(x.trait_type).toLowerCase() === t); return a ? String(a.value) : null; };

/** t.me/nft sahifasidan model, fon, belgini o'qishga urinish. */
async function attrsFromTelegram(slug, n) {
  try {
    const res = await fetch(`https://t.me/nft/${slug}-${n}`, { headers: { Accept: 'text/html' } });
    const html = await res.text();
    const pick = (label) => { const m = new RegExp(`<th>\\s*${label}\\s*</th>\\s*<td[^>]*>([^<]+)`, 'i').exec(html); return m ? m[1].trim() : null; };
    const a = { model: pick('Model'), backdrop: pick('Backdrop'), symbol: pick('Symbol') };
    return a.model || a.backdrop ? a : null;
  } catch (e) { return null; }
}

export function calcText(args, s) {
  const [p, m, d] = args.map(num);
  if (!(p > 0)) return "Masalan: /hisob 1000000 6 200000\n(narx, oy soni, boshlang'ich to'lov)";
  const down = d > 0 ? d : 0;
  if (down >= p) return "Boshlang'ich to'lov narxdan kichik bo'lishi kerak.";
  const months = m > 0 ? [Math.round(m)] : [3, 6, 12];
  const lines = [`Narx: ${som(p)}`, `Boshlang'ich to'lov: ${som(down)}`, `Qolgan summa: ${som(p - down)}`, ''];
  for (const mm of months) {
    const r = monthlyPayment(p, down, mm, s);
    lines.push(`${mm} oy (+${Math.round(markupPercent(mm, s) * 100) / 100}%): jami ${som(r.total)}, oyiga ${som(r.monthly)}`);
  }
  return lines.join('\n');
}

async function priceReport(name, attrs) {
  const s = await getSettings();
  if (!(await marketappConfigured())) return 'Marketapp tokeni kiritilmagan (Admin panel → Sozlamalar).';
  const { collection } = splitGiftName(name);
  const col = await collectionByName(collection);
  if (!col) return `"${collection}" kolleksiyasi topilmadi. Nomini tekshiring.`;
  const L = [`💎 ${name}`, [attrs.model && `Model: ${attrs.model}`, attrs.backdrop && `Fon: ${attrs.backdrop}`, attrs.symbol && `Belgi: ${attrs.symbol}`].filter(Boolean).join(' · ') || '(model va fon noma\'lum)', ''];
  L.push(`Sotuvdagi eng arzon narx (× ${money(s.sale_rate)}):`);
  for (const [by, label] of [['model_backdrop', 'Model + fon'], ['model', 'Model'], ['backdrop', 'Fon'], ['collection', 'Kolleksiya']]) {
    if (by !== 'collection' && ((by !== 'backdrop' && !attrs.model) || (by !== 'model' && !attrs.backdrop))) continue;
    const t = await floorPrice(col.address, attrs, by === 'collection' ? null : by);
    L.push(`• ${label}: ${t ? `${ton(t)} ≈ ${som(Math.ceil(t * Number(s.sale_rate)))}` : 'sotuvda yo\'q'}`);
  }
  L.push('');
  const own = await rentListingFor(col.address, name, attrs);
  const f = s.rent_formula;
  const rentLine = (it) => {
    const d1 = rentPriceTiyin(rentTotalTon(it.price_per_day, 1), f) / 100;
    const maxD = Math.max(1, Math.floor(Number(it.max_duration) / 86400));
    const best = Math.ceil(rentPriceTiyin(rentTotalTon(it.price_per_day, maxD), f) / 100 / maxD);
    return `${ton(toTon(it.price_per_day))}/kun → mijozga 1 kun ${som(d1)}, ${maxD} kunda kuniga ${som(best)}`;
  };
  L.push('Ijara (Marketapp):');
  if (own) L.push(`• Shu sovg'a: ${rentLine(own)}`);
  if (attrs.model && attrs.backdrop) {
    const r = await listRent('gifts', { collection_address: col.address, model: attrs.model, backdrop: attrs.backdrop, sort_by: 'price_per_day' });
    if (r.items[0]) L.push(`• Shu model + fonning eng arzoni: ${rentLine(r.items[0])}`);
  }
  const r2 = await listRent('gifts', { collection_address: col.address, sort_by: 'price_per_day' });
  if (r2.items[0]) L.push(`• Kolleksiyaning eng arzoni: ${rentLine(r2.items[0])}`);
  if (L[L.length - 1] === 'Ijara (Marketapp):') L.push('• ijarada yo\'q');
  L.push('');
  const fd = s.down_formula;
  L.push(own ? `1-tur boshlang'ich to'lovi (formula): ${som(downByFormula(own.price_per_day, s))}` : `1-tur boshlang'ich to'lovi: shu sovg'a ijarada yo'q, qo'lda belgilang`);
  L.push(`(formula: (kunlik × ${fd.days} + ${fd.add}) × ${money(fd.rate)} × ${fd.mult})`);
  return L.join('\n');
}

/** Admin matnini qayta ishlaydi. Javob matni yoki null (bu admin buyrug'i emas). */
export async function handleAdminText(text) {
  const t = String(text || '').trim();
  try {
    if (/^\/hisob\b/i.test(t)) return calcText(t.split(/\s+/).slice(1), await getSettings());
    const link = /t\.me\/nft\/([A-Za-z0-9]+)-(\d+)/i.exec(t);
    if (link) {
      const slug = link[1], n = Number(link[2]);
      const name = slug.replace(/([a-z])([A-Z])/g, '$1 $2') + ' #' + n;
      let attrs = await attrsFromTelegram(slug, n);
      if (!attrs && (await marketappConfigured())) {
        const col = await collectionByName(slug);
        const it = col ? await giftOnSaleByNumber(col.address, n) : null;
        if (it) attrs = { model: attrOf(it, 'model'), backdrop: attrOf(it, 'backdrop'), symbol: attrOf(it, 'symbol') };
      }
      if (!attrs) return `Model va fonni aniqlab bo'lmadi. Shunday yozing:\n/narx ${name} | Model | Fon`;
      return priceReport(name, attrs);
    }
    if (/^\/narx\b/i.test(t)) {
      const parts = t.replace(/^\/narx\s*/i, '').split('|').map((x) => x.trim()).filter(Boolean);
      if (!parts.length) return 'Masalan: /narx Trapped Heart | Crime Scene | Persimmon';
      const name = /#\d+$/.test(parts[0]) ? parts[0] : parts[0];
      return priceReport(name, { model: parts[1] || null, backdrop: parts[2] || null, symbol: parts[3] || null });
    }
    if (/^\/(yordam|buyruqlar)\b/i.test(t)) return ADMIN_HELP;
  } catch (e) {
    await logError('admintools', e && (e.stack || e.message));
    return 'Xato yuz berdi: Marketapp javob bermadi yoki ma\'lumot noto\'g\'ri. Birozdan keyin urinib ko\'ring.';
  }
  return null;
}
