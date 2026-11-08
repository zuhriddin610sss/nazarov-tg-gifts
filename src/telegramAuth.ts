import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

const MAX_AGE_SEC = 24 * 60 * 60;

function safeEq(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Telegram Mini App initData tekshiruvi.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyWebAppInitData(initData: string, botToken: string, now = Date.now()): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (!safeEq(calc, hash)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || now / 1000 - authDate > MAX_AGE_SEC) return null;
  const user = params.get("user");
  if (!user) return null;
  try {
    const u = JSON.parse(user);
    return typeof u.id === "number" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Telegram Login Widget tekshiruvi (oddiy brauzer uchun).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyLoginWidget(data: Record<string, string>, botToken: string, now = Date.now()): TgUser | null {
  const { hash, ...rest } = data;
  if (!hash) return null;
  const dataCheck = Object.keys(rest).sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const calc = createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (!safeEq(calc, hash)) return null;
  const authDate = Number(rest.auth_date);
  if (!authDate || now / 1000 - authDate > MAX_AGE_SEC) return null;
  const id = Number(rest.id);
  if (!Number.isSafeInteger(id)) return null;
  return { id, username: rest.username, first_name: rest.first_name, last_name: rest.last_name };
}
