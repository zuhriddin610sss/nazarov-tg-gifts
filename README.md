# NAZAROVtggifts

Telegram sovg'alari: sayt, Telegram bot (Mini App) va admin panel. Hammasi bitta backend va bitta bazada ishlaydi.

- **Sayt / Mini App:** `/`. Birinchi ekranda xizmatlar, har bir xizmat alohida sahifada, pastda Xizmatlar, Xaridlarim va Balans menyusi. 4 til: o'zbek, rus, ingliz, xitoy.
- **Admin panel:** `/admin/`. Navbat, buyurtmalar, cheklar, mijozlar, bo'lib to'lash, sozlamalar, jurnallar.
- **Bot:** `/start`, `/balance`, `/orders`, `/admin`. Telefon raqamini ulashish, adminga yangi buyurtma va chek xabarlari (chekni bot ichida tasdiqlash mumkin).

Kelishilgan biznes qoidalari: [`docs/TALABLAR.md`](docs/TALABLAR.md).

## Texnologiyalar

Node.js 22 + TypeScript, Fastify, PostgreSQL 16, grammY (Telegram bot), oddiy HTML/JS frontend (yig'ish bosqichi yo'q). Docker Compose va Caddy (avtomatik HTTPS).

## Serverga joylash

Serverda Docker va Docker Compose o'rnatilgan bo'lishi kerak. Domen server IP manziliga yo'naltirilgan bo'lsin.

**1. Kodni yuklab oling**

```bash
git clone https://github.com/zuhriddin610sss/nazarov-tg-gifts.git /opt/nazarov-tg-gifts
```

```bash
cd /opt/nazarov-tg-gifts
```

**2. Bot yarating.** @BotFather'da `/newbot`. Keyin u yerda `/setdomain` buyrug'i bilan domeningizni kiriting, bu Telegram orqali kirish tugmasi uchun kerak.

**3. Sozlamalar fayli**

```bash
cp .env.example .env
```

```bash
nano .env
```

To'ldiriladigan maydonlar:

| Maydon | Nima yoziladi |
|---|---|
| `PUBLIC_URL` | `https://domeningiz.uz` |
| `JWT_SECRET` | `openssl rand -hex 32` buyrug'i natijasi |
| `BOT_TOKEN`, `BOT_USERNAME` | @BotFather bergan token va bot nomi (`@` siz) |
| `ADMIN_TELEGRAM_IDS` | Sizning Telegram ID raqamingiz (@userinfobot orqali bilib olasiz) |
| `MARKETAPP_TOKEN` | marketapp.org/api-token sahifasidagi token |
| `DB_PASSWORD` | Ma'lumotlar bazasi uchun kuchli parol |

**4. Domen.** `Caddyfile` ichida `example.uz` o'rniga o'z domeningizni yozing.

**5. Ishga tushirish**

```bash
docker compose up -d --build
```

Baza jadvallari birinchi ishga tushishda avtomatik yaratiladi.

**6. Admin panel.** `https://domeningiz.uz/admin/` sahifasini oching va Telegram orqali kiring. **Sozlamalar** bo'limida karta raqami, karta egasi va admin username'ini kiriting.

**7. Botda Mini App tugmasi.** @BotFather → `/mybots` → botingiz → Bot Settings → Menu Button: manzil `https://domeningiz.uz/`.

### Yangilash

```bash
git pull && docker compose up -d --build
```

### Zaxira nusxa

```bash
./scripts/backup.sh
```

Har kuni avtomatik zaxira olish uchun `crontab -e` buyrug'ini bering va quyidagi qatorni qo'shing:

```
0 3 * * * cd /opt/nazarov-tg-gifts && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Zaxirani qaytarish:

```bash
docker compose exec -T db pg_restore -U ng -d ng --clean < backups/db-SANA.dump
```

## Ishlab chiqish

```bash
npm install
```

```bash
npm test
```

`npm test` uchun lokal PostgreSQL kerak: `postgres://ng:ng@localhost:5432/ng_test`.

## Hozirgi holat

Ishlaydi:
- Telegram orqali kirish (Mini App va Login Widget, imzo serverda tekshiriladi), telefon raqami bot orqali.
- Yagona balans: chek yuklash, admin tasdig'i (sayt yoki bot), tarix, ikki marta yechilmasligi kafolatlangan.
- Barcha buyurtmalar umumiy navbatda. Navbat raqami faqat adminga ko'rinadi va avtomatik suriladi. Doimiy ID: `NG-XXXXXX`.
- Naqd buyurtmada pul darhol yechiladi, bekor qilinsa avtomatik qaytadi.
- Premium (qat'iy narxlar), Stars (240 so'm, kamida 50), NFT sovg'a so'rovi, ijara katalogi (Marketapp, formula bilan).
- Xaridlarim: bo'lib to'lashda faqat 3 ta ma'lumot ko'rsatiladi. Oylik to'lovni mijoz o'zi tasdiqlab balansdan to'laydi.
- Admin: statistika, navbat, buyurtmalar, cheklar, mijozlar va balans tuzatish, bo'lib to'lash (eski shartnomalar ham), promo-kodlar, sharhlar, sozlamalar, jurnallar.
- Promo-kodlar (foiz yoki summa, muddat, ishlatish limiti, xizmat bo'yicha cheklov; faqat naqd buyurtmalar uchun).
- Ijara tugashidan 72 va 24 soat oldin mijozga va adminga eslatma.
- Bo'lib to'lash: oylik to'lovdan 3 kun oldin, to'lov kuni va kechikkanda (ertasi kuni) eslatma, Toshkent vaqti 09:00–21:00 oralig'ida. To'lov kuni va kechikish haqida adminga ham xabar keladi.
- Savollar sahifasi, buyurtmani ID orqali tekshirish, mijoz sharhlari (admin tasdiqlagach ko'rinadi).

Hali qilinmagan:
- **Naqd buyurtmani Marketapp'ga avtomatik yuborish.** Buning uchun alohida TON hamyon va tranzaksiyani imzolash kerak. Hozircha naqd buyurtmalar ham navbatda turadi va admin qo'lda bajaradi.
- Ijara narxida Marketapp'ning kunlik chegirmasi (`discount_per_day`) hisobga olinmagan: haqiqiy ma'lumot bilan tekshirish kerak.
- Admin panel hozircha faqat o'zbek tilida.
