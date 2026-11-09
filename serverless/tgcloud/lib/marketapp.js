// Marketapp API (https://api.marketapp.org/docs/). Faqat hujjatdagi endpointlar.
// Token admin panel orqali kiritiladi va bazada saqlanadi; mijozga hech qachon qaytarilmaydi.
import { fetch } from 'sdk';
import { getSecret, logError, fail, run, get, nowMs } from './core.js';

const BASE = 'https://api.marketapp.org';

async function call(method, path, { body, query } = {}) {
  const token = await getSecret('marketapp_token');
  if (!token) throw fail('MARKETAPP_NOT_CONFIGURED');
  const qs = Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  const url = BASE + path + (qs ? '?' + qs : '');
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    await logError('marketapp', `${method} ${path}: ${e && e.message}`);
    throw fail('MARKETAPP_UNAVAILABLE');
  }
  const text = await res.text();
  if (!res.ok) {
    await logError('marketapp', `${method} ${path} -> ${res.status}`, { body: text.slice(0, 800) });
    throw fail('MARKETAPP_ERROR', { status: res.status });
  }
  try { return JSON.parse(text); } catch {
    await logError('marketapp', `${method} ${path}: JSON emas`, { body: text.slice(0, 300) });
    throw fail('MARKETAPP_ERROR');
  }
}

const CATS = ['gifts', 'usernames', 'numbers'];
const SORTS = ['price_per_day', 'min_price', 'duration_asc', 'duration_desc', 'item_num_asc', 'item_num_desc', 'recently_touch'];

/** Ijara katalogi. Ko'rilgan e'lonlar bazaga yoziladi: buyurtma paytida narx shu yozuvdan tekshiriladi. */
export async function listRent(category, opts = {}) {
  if (!CATS.includes(category)) throw fail('VALIDATION', { field: 'category' });
  const q = { limit: 24 };
  if (opts.cursor) q.cursor = String(opts.cursor).slice(0, 200);
  if (SORTS.includes(opts.sort_by)) q.sort_by = opts.sort_by;
  if (category === 'gifts') for (const k of ['collection_address', 'model', 'backdrop', 'symbol']) if (opts[k]) q[k] = String(opts[k]).slice(0, 100);
  const data = await call('GET', `/v1/rent/${category}/`, { query: q });
  const items = Array.isArray(data.items) ? data.items : [];
  const now = nowMs();
  for (const it of items) {
    if (!it || typeof it.nft_address !== 'string') continue;
    await run(`INSERT INTO rent_seen (address, category, item, seen_at) VALUES (:a, :c, :i, :t)
               ON CONFLICT (address) DO UPDATE SET category = excluded.category, item = excluded.item, seen_at = excluded.seen_at`,
      { a: it.nft_address, c: category, i: JSON.stringify(it), t: now });
  }
  return { cursor: data.cursor ?? null, items };
}

/** Mijoz ko'rgan e'lon (15 daqiqadan eski bo'lmasin: narx o'zgargan bo'lishi mumkin). */
export async function seenRentItem(category, address) {
  const r = await get('SELECT item, category, seen_at FROM rent_seen WHERE address = :a', { a: String(address) });
  if (!r || r.category !== category || nowMs() - Number(r.seen_at) > 15 * 60_000) throw fail('RENT_ITEM_STALE');
  return JSON.parse(r.item);
}

export async function giftCollections() {
  return call('GET', '/v1/collections/gifts/');
}
export async function collectionAttributes(address) {
  if (!/^[A-Za-z0-9_\-:]{20,80}$/.test(String(address))) throw fail('VALIDATION', { field: 'address' });
  return call('GET', `/v1/collections/${encodeURIComponent(address)}/attributes/`);
}
export async function searchRecipient(service, username) {
  return call('POST', `/v1/fragment/${service === 'stars' ? 'stars' : 'premium'}/recipient/`, { body: { username } });
}
export async function marketappConfigured() {
  return Boolean(await getSecret('marketapp_token'));
}
