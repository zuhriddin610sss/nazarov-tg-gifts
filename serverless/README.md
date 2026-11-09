# NAZAROVtggifts — Telegram Serverless versiyasi

Bot, Mini App (mijoz ilovasi) va admin panel Telegram'ning o'z serverlarida ishlaydi ([Telegram Serverless](https://core.telegram.org/bots/serverless), beta). Server sotib olish shart emas.

## Tuzilishi

| Joy | Nima |
|---|---|
| `tgcloud/endpoints/app.js` | Mijoz ilovasi backendi (`Telegram.WebApp.Serverless.call('app', { action })`) |
| `tgcloud/endpoints/admin.js` | Admin panel backendi (faqat `lib/config.js` dagi `ADMIN_IDS`) |
| `tgcloud/handlers/message.js` | Bot: `/start`, `/balance`, `/orders`, `/admin`, telefon raqamini ulashish |
| `tgcloud/handlers/callback_query.js` | Botda chekni tasdiqlash / rad etish tugmalari |
| `tgcloud/lib/ddl.js` | Baza sxemasi (SQLite) va pul xavfsizligi triggerlari |
| `tgcloud/lib/shop.js` | Balans, buyurtmalar, navbat, bo'lib to'lash, promo-kodlar, sharhlar |
| `tgcloud/lib/marketapp.js` | Marketapp: ijara katalogi va filtrlar, kolleksiyalar, qabul qiluvchini tekshirish |
| `tgcloud/lib/jobs.js` | Ijara va oylik to'lov eslatmalari |
| `public/` | Mini App sahifalari: `index.html` (mijoz), `admin.html` (admin) |

## Muhim farqlar (Serverless sababli)

- **Faqat Telegram ichida ochiladi.** Oddiy brauzerda "Telegram ichida oching" sahifasi chiqadi.
- **Jadval (cron) yo'q.** Eslatmalar botga yoki Mini App'ga har qanday murojaatda ko'pi bilan 30 daqiqada bir marta tekshiriladi. Admin panelda "Eslatmalarni hozir yuborish" tugmasi bor.
- **Fayllar Telegram'da saqlanadi.** Chek va sovg'a rasmlari adminning chatiga yuboriladi, bazada faqat `file_id` turadi. Faqat rasm (JPEG/PNG/WEBP), PDF emas.
- **Marketapp tokeni** admin panelning Sozlamalar bo'limida kiritiladi va bazada saqlanadi (kodda emas).

## Pul xavfsizligi

Balans faqat `ledger` jadvaliga yozuv qo'shish orqali o'zgaradi. SQLite triggeri shu bitta amalda balansni, buyurtma, chek yoki to'lov holatini yangilaydi; tekshiruv yiqilsa, hammasi bekor bo'ladi. `idem_key` takrorlanmas: pul ikki marta yechilmaydi va qaytarilmaydi; balans manfiy bo'la olmaydi (`CHECK (balance >= 0)`).

## Joylash

1. `tgcloud/lib/config.js`: `ADMIN_IDS` ga admin Telegram ID'sini yozing.
2. `public/config.js`: `botUsername` ga bot nomini yozing (`@` siz).
3. O'rnating:
   ```bash
   npm install
   ```
4. Bog'lang (BotFather → bot → Serverless → **CLI Access** tokeni):
   ```bash
   npx tgcloud login
   ```
5. Yuklang:
   ```bash
   npx tgcloud push
   ```
6. `push` chiqargan Mini App manzilini (`https://app<id>.tgcloud.ai/`) `tgcloud/lib/config.js` dagi `MINI_APP_URL` ga yozing va 5-qadamni qaytaring.
7. Botga `/start` yozing. Admin: `/admin` → **Admin panel** → **Sozlamalar**: karta raqami, admin username'i, Marketapp tokeni.

## Sinov

```bash
npm test
```

Testlar haqiqiy SQLite bazasida ishlaydi (`node:sqlite`); Telegram va Marketapp soxta.

Brauzerda qo'lda sinash uchun mahalliy server (soxta Telegram bilan):

```bash
node --no-warnings --import ./test/register.mjs test/dev-server.mjs
```
