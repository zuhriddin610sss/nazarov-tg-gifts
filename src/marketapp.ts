/**
 * Marketapp API mijozi. Faqat hujjatda bor endpointlar ishlatiladi:
 * https://api.marketapp.org/docs/ (openapi.json)
 * Token faqat serverda: Authorization: <token> (prefikssiz).
 */
import { config } from "./config.js";
import { logError } from "./audit.js";
import { AppError } from "./errors.js";

export type RentCategory = "gifts" | "usernames" | "numbers";

export interface RentItem {
  nft_address: string;
  nft_name: string;
  owner: string;
  attributes: { trait_type?: string; value?: string; [k: string]: unknown }[];
  min_duration: number;
  max_duration: number;
  price_per_day: string; // nanoGRAM
  discount_per_day: number;
  listed_at: number | null;
  is_sellable_during_rent?: boolean;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(path, config.MARKETAPP_BASE_URL);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.MARKETAPP_TOKEN) headers.authorization = config.MARKETAPP_TOKEN;
  if (body) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  } catch (e: any) {
    await logError("marketapp", `${method} ${path}: ${e?.message}`);
    throw new AppError("MARKETAPP_UNAVAILABLE", 502);
  }
  const text = await res.text();
  if (!res.ok) {
    await logError("marketapp", `${method} ${path} -> ${res.status}`, { body: text.slice(0, 1000) });
    throw new AppError("MARKETAPP_ERROR", 502, { status: res.status });
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    await logError("marketapp", `${method} ${path}: JSON emas`, { body: text.slice(0, 500) });
    throw new AppError("MARKETAPP_ERROR", 502);
  }
}

// --- Ijara katalogi (keshi bilan) ---
const TTL_MS = 60_000;
const listCache = new Map<string, { at: number; data: { cursor: string | null; items: RentItem[] } }>();
/** Buyurtma paytida narxni tekshirish uchun: nft_address -> oxirgi ko'rilgan e'lon. */
const seen = new Map<string, { at: number; category: RentCategory; item: RentItem }>();
const SEEN_TTL_MS = 15 * 60_000;

export async function listRent(category: RentCategory, opts: {
  cursor?: string; sort_by?: string; limit?: number; collection_address?: string; model?: string; symbol?: string; backdrop?: string;
} = {}) {
  const key = category + JSON.stringify(opts);
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await call<{ cursor: string | null; items: RentItem[] }>("GET", `/v1/rent/${category}/`, undefined, {
    limit: opts.limit ?? 24, cursor: opts.cursor, sort_by: opts.sort_by,
    ...(category === "gifts" ? { collection_address: opts.collection_address, model: opts.model, symbol: opts.symbol, backdrop: opts.backdrop } : {}),
  });
  const now = Date.now();
  listCache.set(key, { at: now, data });
  for (const it of data.items) seen.set(it.nft_address, { at: now, category, item: it });
  return data;
}

/** Mijoz ko'rgan e'lonni qaytaradi; eskirgan bo'lsa — xato (narx o'zgargan bo'lishi mumkin). */
export function getSeenRentItem(category: RentCategory, nftAddress: string): RentItem {
  const s = seen.get(nftAddress);
  if (!s || s.category !== category || Date.now() - s.at > SEEN_TTL_MS) throw new AppError("RENT_ITEM_STALE", 409);
  return s.item;
}

// --- Kolleksiyalar (maxsus NFT sovg'a so'rovi uchun model/fon ro'yxati) ---
let giftCollections: { at: number; data: unknown } | null = null;
export async function listGiftCollections() {
  if (giftCollections && Date.now() - giftCollections.at < 60 * 60_000) return giftCollections.data;
  const data = await call<unknown>("GET", "/v1/collections/gifts/");
  giftCollections = { at: Date.now(), data };
  return data;
}

const attrCache = new Map<string, { at: number; data: unknown }>();
export async function collectionAttributes(address: string) {
  if (!/^[A-Za-z0-9_\-:]{20,80}$/.test(address)) throw new AppError("BAD_COLLECTION");
  const hit = attrCache.get(address);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.data;
  const data = await call<unknown>("GET", `/v1/collections/${encodeURIComponent(address)}/attributes/`);
  attrCache.set(address, { at: Date.now(), data });
  return data;
}

// --- Fragment xizmatlari (Stars, Premium) ---
export async function searchStarsRecipient(username: string) {
  return call<{ photo: string; name: string }>("POST", "/v1/fragment/stars/recipient/", { username });
}
export async function searchPremiumRecipient(username: string) {
  return call<{ photo: string; name: string }>("POST", "/v1/fragment/premium/recipient/", { username });
}

export const marketappConfigured = () => Boolean(config.MARKETAPP_TOKEN);
