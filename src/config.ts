import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://ng:ng@localhost:5432/ng"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET kamida 32 belgi bo'lishi kerak"),
  BOT_TOKEN: z.string().optional(),
  BOT_USERNAME: z.string().optional(),
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  MARKETAPP_TOKEN: z.string().optional(),
  MARKETAPP_BASE_URL: z.string().url().default("https://api.marketapp.org"),
  UPLOAD_DIR: z.string().default("./uploads"),
  BOT_MODE: z.enum(["polling", "webhook", "off"]).default("polling"),
  WEBHOOK_SECRET: z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Muhit sozlamalarida xato:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const env = parsed.data;

export const config = {
  ...env,
  adminIds: new Set(
    env.ADMIN_TELEGRAM_IDS.split(",").map((s) => s.trim()).filter(Boolean).map(Number),
  ),
  isProd: env.NODE_ENV === "production",
};
