import { z } from "zod";
import { pool, one } from "./db.js";

const L = z.object({ uz: z.string(), ru: z.string(), en: z.string(), zh: z.string() });

export const SettingsSchema = z.object({
  card_number: z.string().max(40),
  card_holder: z.string().max(80),
  payment_instructions: L,
  admin_contact: z.string().max(64),            // Telegram username, @ belgisisiz
  receipt_contact: z.string().max(64),          // chek yuboriladigan Telegram username
  stars_price: z.number().positive(),           // 1 star narxi, so'm
  stars_min: z.number().int().min(1),
  premium_prices: z.object({                    // naqd narxlar, so'm
    m1: z.number().positive(),
    m3: z.number().positive(),
    m6: z.number().positive(),
    m12_login: z.number().positive(),
    m12: z.number().positive(),
  }),
  rent_formula: z.object({ add: z.number(), mult: z.number().positive(), rate: z.number().positive() }),
  services_enabled: z.object({
    nft_gift: z.boolean(), gift_rent: z.boolean(), username_rent: z.boolean(),
    number_rent: z.boolean(), premium: z.boolean(), stars: z.boolean(),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  card_number: "",
  card_holder: "Nazarov Z",
  payment_instructions: {
    uz: "CLICK (Click ilovasi, Click bot va boshqa Click), ALIF, PAYME va 3-shaxsdan pul qabul qilinmaydi!!! Tashlangan pul qaytarilmaydi.",
    ru: "Переводы через CLICK (приложение Click, Click-бот и другие сервисы Click), ALIF, PAYME и от третьих лиц не принимаются!!! Отправленные деньги не возвращаются.",
    en: "Payments via CLICK (Click app, Click bot or any other Click service), ALIF, PAYME or from third parties are not accepted!!! Money sent this way is not refunded.",
    zh: "不接受通过 CLICK（Click 应用、Click 机器人及其他 Click 服务）、ALIF、PAYME 或第三方的付款！！！已转出的款项不予退还。",
  },
  admin_contact: "",
  receipt_contact: "chat_bilan",
  stars_price: 240,
  stars_min: 50,
  premium_prices: { m1: 42000, m3: 171600, m6: 231000, m12_login: 297000, m12: 418000 },
  rent_formula: { add: 0.15, mult: 2, rate: 19000 },
  services_enabled: { nft_gift: true, gift_rent: true, username_rent: true, number_rent: true, premium: true, stars: true },
};

export async function getSettings(): Promise<Settings> {
  const row = await one<{ value: unknown }>("SELECT value FROM settings WHERE key = 'main'");
  const merged = { ...DEFAULT_SETTINGS, ...(row?.value as object | undefined) };
  return SettingsSchema.parse(merged);
}

export async function saveSettings(s: Settings) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('main', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SettingsSchema.parse(s)],
  );
}
