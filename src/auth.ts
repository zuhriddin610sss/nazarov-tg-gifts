import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { one } from "./db.js";
import type { TgUser } from "./telegramAuth.js";

const key = new TextEncoder().encode(config.JWT_SECRET);

export interface Session { cid: number; tid: number; admin: boolean }

export async function issueToken(s: Session) {
  return new SignJWT({ cid: s.cid, tid: s.tid, admin: s.admin })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(s.admin ? "12h" : "7d")
    .sign(key);
}

export async function readSession(req: FastifyRequest): Promise<Session | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(h.slice(7), key, { algorithms: ["HS256"] });
    const s = { cid: Number(payload.cid), tid: Number(payload.tid), admin: payload.admin === true };
    // Admin huquqi har so'rovda ro'yxatdan qayta tekshiriladi (ro'yxatdan chiqarilsa, darhol kuchini yo'qotadi)
    s.admin = s.admin && config.adminIds.has(s.tid);
    return s;
  } catch {
    return null;
  }
}

export async function requireCustomer(req: FastifyRequest): Promise<Session> {
  const s = await readSession(req);
  if (!s) throw new AppError("UNAUTHORIZED", 401);
  return s;
}

export async function requireAdmin(req: FastifyRequest): Promise<Session> {
  const s = await readSession(req);
  if (!s || !s.admin) throw new AppError("FORBIDDEN", 403);
  return s;
}

/** Telegram foydalanuvchisini topadi yoki yaratadi va ma'lumotlarini yangilaydi. */
export async function upsertCustomer(u: TgUser) {
  const lang = ["uz", "ru", "en", "zh"].includes(String(u.language_code).slice(0, 2)) ? String(u.language_code).slice(0, 2) : null;
  return one<{ id: number; lang: string }>(
    `INSERT INTO customers (telegram_id, username, first_name, last_name, lang)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'uz'))
     ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name, last_seen_at = now()
     RETURNING id, lang`,
    [u.id, u.username ?? null, u.first_name ?? null, u.last_name ?? null, lang],
  );
}
