import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { migrate } from "./migrate.js";
import { AppError } from "./errors.js";
import { logError } from "./audit.js";
import customerRoutes from "./routes/customer.js";
import adminRoutes from "./routes/admin.js";
import { bot } from "./bot.js";
import { pool } from "./db.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildApp() {
  const app = Fastify({ logger: { level: config.isProd ? "info" : "warn" }, trustProxy: true, bodyLimit: 1024 * 1024 });

  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 5 } });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    return payload;
  });

  app.setErrorHandler(async (err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, ...err.extra });
    if (err instanceof ZodError) return reply.status(400).send({ error: "VALIDATION", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
    if (err.statusCode === 429) return reply.status(429).send({ error: "RATE_LIMITED" });
    if (err.code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: "FILE_TOO_LARGE" });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: "BAD_REQUEST" });
    await logError("http", `${req.method} ${req.url}: ${err?.message}`, { stack: String(err?.stack).slice(0, 2000) });
    return reply.status(500).send({ error: "INTERNAL" });
  });

  await app.register(customerRoutes);
  await app.register(adminRoutes);

  if (bot && config.BOT_MODE === "webhook") {
    const { webhookCallback } = await import("grammy");
    app.post("/telegram/webhook", webhookCallback(bot, "fastify", { secretToken: config.WEBHOOK_SECRET }));
  }

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  await app.register(fastifyStatic, { root: path.join(root, "web"), prefix: "/", index: ["index.html"] });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await migrate();
  const app = await buildApp();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  console.log(`Server: ${config.PUBLIC_URL} (port ${config.PORT})`);
  if (bot) {
    await bot.api.setMyCommands([
      { command: "start", description: "Xizmatlar" },
      { command: "balance", description: "Balans" },
      { command: "orders", description: "Xaridlarim" },
      { command: "admin", description: "Admin bilan bog'lanish" },
    ]).catch((e) => logError("bot", e.message));
    if (config.BOT_MODE === "polling") void bot.start({ drop_pending_updates: false });
    else if (config.BOT_MODE === "webhook") {
      await bot.api.setWebhook(`${config.PUBLIC_URL}/telegram/webhook`, { secret_token: config.WEBHOOK_SECRET });
    }
    console.log(`Bot ishga tushdi (${config.BOT_MODE})`);
  } else {
    console.warn("BOT_TOKEN berilmagan: bot va Telegram orqali kirish o'chirilgan");
  }
  const stop = async () => { await bot?.stop().catch(() => {}); await app.close(); await pool.end(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
