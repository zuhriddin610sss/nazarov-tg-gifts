import { z } from "zod";
import { pool, one } from "./db.js";

const L = z.object({ uz: z.string(), ru: z.string(), en: z.string(), zh: z.string() });

export const SettingsSchema = z.object({
  card_number: z.string().max(40),
  card_holder: z.string().max(80),
  payment_instructions: L,
  admin_contact: z.string().max(64),            // Telegram username, @ belgisisiz
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
  card_holder: "",
  payment_instructions: {
    uz: "Kartaga pul o'tkazing va chek rasmini yuklang. Admin tekshirgach, summa balansingizga tushadi.",
    ru: "Переведите деньги на карту и загрузите фото чека. После проверки сумма поступит на баланс.",
    en: "Transfer money to the card and upload a photo of the receipt. Once checked, the amount is added to your balance.",
    zh: "请转账至该银行卡并上传收据截图。审核通过后金额将计入您的余额。",
  },
  admin_contact: "",
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
