# Telefonda joylash (BotFather → Serverless)

Har bir faylni havola orqali oching → hammasini belgilang → nusxalang → kerakli bo'limda shu **nom** bilan yangi fayl yaratib, qo'ying.

Tartib muhim emas, lekin hammasi qo'yilgandan keyingina bot ishlaydi.

## 1. Library — 12 ta fayl

Nomni `lib/` siz yozing (masalan `core`). Agar oyna to'liq yo'l so'rasa, `lib/core` deb yozing.

| # | Nom | Nima uchun | Kod |
|---|---|---|---|
| 1 | `config` | admin ID va Mini App manzili (o'zingiz to'ldirasiz) | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/config.js) |
| 2 | `core` | baza, xatolar, sozlamalar | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/core.js) |
| 3 | `ddl` | jadvallar va pul xavfsizligi | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/ddl.js) |
| 4 | `texts` | bot xabarlari (4 til) | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/texts.js) |
| 5 | `b64` | rasmlar bilan ishlash | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/b64.js) |
| 6 | `pricing` | narx formulalari | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/pricing.js) |
| 7 | `marketapp` | Marketapp ulanishi | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/marketapp.js) |
| 8 | `shop` | balans, navbat, bo'lib to'lash, promo | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/shop.js) |
| 9 | `notify` | Telegram xabarnomalari | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/notify.js) |
| 10 | `jobs` | eslatmalar | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/jobs.js) |
| 11 | `customer` | mijoz ilovasi amallari | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/customer.js) |
| 12 | `admin` | admin panel amallari | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/lib/admin.js) |

**`config` faylida** `ADMIN_IDS = []` qavsiga Telegram ID raqamingizni yozing. `MINI_APP_URL` ni Mini App Files yuklangach to'ldirasiz (pastda).

## 2. Handlers — 2 ta fayl

| Nom | Nima uchun | Kod |
|---|---|---|
| `message` | /start, /balance, /orders, /admin, telefon raqami | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/handlers/message.js) |
| `callback_query` | tugmalar | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/handlers/callback_query.js) |

## 3. Endpoints — 2 ta fayl

| Nom | Nima uchun | Kod |
|---|---|---|
| `app` | mijoz ilovasi | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/endpoints/app.js) |
| `admin` | admin panel | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/tgcloud/endpoints/admin.js) |

## 4. Database

Hech narsa qo'shmang: jadvallar birinchi ishga tushishda o'zi yaratiladi.

## 5. Mini App Files — 8 ta fayl

| Fayl nomi | Kod |
|---|---|
| `index.html` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/index.html) |
| `admin.html` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/admin.html) |
| `app.js` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/app.js) |
| `admin.js` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/admin.js) |
| `i18n.js` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/i18n.js) |
| `style.css` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/style.css) |
| `config.js` | [ochish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/config.js) |
| `assets/logo-mark.png` (rasm) | [yuklab olish](https://raw.githubusercontent.com/zuhriddin610sss/nazarov-tg-gifts/main/serverless/public/assets/logo-mark.png) |

**`config.js` faylida** `botUsername: ""` qo'shtirnog'i ichiga botingiz nomini `@` siz yozing.

## 6. Oxirgi qadam

1. Mini App Files yuklangach, Telegram ilovaning manzilini ko'rsatadi (`https://app…tgcloud.ai/`). Uni Library'dagi `config` faylida `MINI_APP_URL = '…'` ga yozing (oxirida `/` bilan).
2. BotFather → botingiz → Bot Settings → Menu Button: shu manzilni qo'ying.
3. Botga `/start` yozing. Keyin `/admin` → **Admin panel** → **Sozlamalar**: admin username'ingiz va Marketapp tokeni.
