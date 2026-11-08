import type { Tx } from "./db.js";
import { pool } from "./db.js";

export async function audit(c: Tx | typeof pool, actor: string, action: string, target: string | null, data?: unknown) {
  await c.query("INSERT INTO audit_log (actor, action, target, data) VALUES ($1,$2,$3,$4)", [actor, action, target, data ?? null]);
}

export async function logError(source: string, message: string, data?: unknown) {
  try {
    await pool.query("INSERT INTO error_log (source, message, data) VALUES ($1,$2,$3)", [source, message.slice(0, 2000), data ?? null]);
  } catch (e) {
    console.error("error_log yozilmadi", e);
  }
  console.error(`[${source}]`, message);
}
