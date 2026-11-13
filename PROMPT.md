# Claude uchun tayyor prompt

Bot o'chib ketsa yoki yangisini ochish kerak bo'lsa, quyidagi matnni **to'liq nusxalab** Claude'ga yuboring.

---

Salom! Men NAZAROVtggifts degan Telegram sovg'alar biznesim uchun bot va Mini App'ni qayta ishga tushirmoqchiman. Kod tayyor, GitHub'da turibdi:
https://github.com/zuhriddin610sss/nazarov-tg-gifts

Kod `serverless/` papkasida. Ichida:
- `tgcloud/lib`, `tgcloud/handlers`, `tgcloud/endpoints`: botning server kodi;
- `public`: Mini App sahifalari va admin panel.

Yo'riqnoma `QAYTA_QURISH.md` faylida. Iltimos, avval repozitoriyni ko'rib chiq, keyin menga yordam ber.

## Men haqimda va qanday ishlashim kerak
- Men dasturchi emasman. O'zbek tilida, juda oddiy tushuntir.
- Har safar **faqat bitta qadam** yoki **bitta buyruq** ber, men "bo'ldi" deb yozganimdan keyin keyingisini ber. Uzun matn yozma.
- Men Windows noutbukda **PowerShell** ishlataman, telefonda esa Telegram.
- Buyruqlarni `npm.cmd` va `npx.cmd` ko'rinishida yoz (`npm` emas).
- Tokenlarni (bot kaliti, CLI kaliti, Marketapp tokeni) **hech qachon chatga so'rama**. Ularni faqat terminalga yoki admin panelga qo'yaman.
- Kod yozishdan oldin nima o'zgarishini qisqa aytib ber. Men "qil" desam, keyin qil.
- Men xatolarni bittalab yuboraman. Sen ularni ro'yxatga yozib bor, "to'g'rila" deganimda hammasini birdaniga tuzat.

## Platforma
- Bot **Telegram BotFather Serverless** (tgcloud) da ishlaydi.
- Kod `@tgcloud/cli` orqali yuklanadi: `npx.cmd tgcloud login`, keyin `npx.cmd tgcloud push tgcloud/lib tgcloud/handlers tgcloud/endpoints public --force`.
- `tgcloud/lib/config.js` ichida mening Telegram ID'im (`ADMIN_IDS = [8644718235]`) va Mini App manzili (`https://app<raqam>.tgcloud.ai/`) bo'ladi. Raqam CLI kalitining boshida turadi (`app1234567890:...`).
- Kodni yangilash tartibi:
  1. GitHub'dan zip yuklab olinadi (`Invoke-WebRequest ... -OutFile bot.zip`).
  2. Zip ochiladi (`Expand-Archive bot.zip . -Force`).
  3. `config.js` yoziladi (`Set-Content`).
  4. `push` qilinadi.

## Oldin uchragan muammolar (takrorlanmasin)
- `npx` **"Need to install tgcloud... Ok to proceed?"** desa, men noto'g'ri papkadaman yoki `npm.cmd install` qilinmagan. **`n` bosish kerak**, hech qachon `y` emas.
- Serverless'da import nomlari `'lib/core'` ko'rinishida bo'lishi kerak (`../lib/core.js` emas).
- Serverless `db.run` bilan bajariladigan, hech narsani o'zgartirmaydigan `CREATE ... IF NOT EXISTS` so'rovini "o'qish" deb hisoblab, xato beradi ("Write query looks like a read one"). Sxema kodi mavjud jadvallarni qayta yaratmasligi kerak.
- Baza yangilanganda eski ma'lumotlar (mijozlar, balanslar, buyurtmalar) **o'chmasligi** shart: faqat yangi ustun yoki jadval qo'shiladi.
- Admin panelda xato xabari oyna ustida ko'rinishi kerak.

## Biznes qoidalari (kodda bor, o'zgartirma)
- Xizmatlar:
  - NFT sovg'ani bo'lib to'lashga olish;
  - NFT sovg'a ijarasi (Marketapp + o'z sovg'alarim, istalgan giftni rent (ijara)ga chiqarib beraman);
  - noyob username ijarasi;
  - anonim raqam (+888) ijarasi;
  - Telegram Premium;
  - Telegram Stars.
- Stars: 240 so'm, kamida 50 ta.
- Premium narxlari:
  - 1 oy: 42 000;
  - 3 oy: 171 600;
  - 6 oy: 231 000;
  - 12 oy, akkauntga kirib: 297 000;
  - 12 oy, kirmasdan: 418 000.
  - 1 oy va "12 oy akkauntga kirib" tariflarida "Kimga?" so'ralmaydi.
- Ijara narxi: (Marketapp narxi + 0,15) × 2 × 19 000 so'm.
  - Tiyinsiz, yuqoriga yaxlitlanadi.
  - Kartochkada eng uzoq muddat bo'yicha "… so'm / kun dan" ko'rinadi.
- Bo'lib to'lash turlari: 1-tur, Boshlang'ich to'lovsiz, Uzum Nasiya.
  - Muddat: 1–240 oy (barabanda), Uzum Nasiya'da 3 · 6 · 12 oy.
  - Ustama: oyiga 100% ÷ 12 (3 oy +25%, 6 oy +50%, 12 oy +100%). Boshlang'ich to'lov ayrilgandan keyin qolgan summaga qo'yiladi.
  - Mijozga faqat boshlang'ich to'lov va taxminiy oylik to'lov ko'rsatiladi.
- 1-tur boshlang'ich to'lovi: (Marketapp'dagi 45 kunlik ijara narxi + 0,1) × 17 000 × 3. Uni qo'lda ham yozish mumkin.
- O'z sovg'alarim ("Reklama" yorlig'i bilan har doim birinchi) narxi quyidagilardan biri:
  - Marketapp (model + fon, model yoki fon) × 17 000;
  - qo'lda TON;
  - qo'lda so'm.
- Hamma buyurtma navbatga tushadi, men ularni qo'lda bajaraman.
- Balansni faqat admin to'ldiradi (karta yoki chek yuklash yo'q).
- Referal va admin 2FA kerak emas.
- Bo'lib to'lashda oylik to'lov eslatmalari bor.
- Admin bot buyruqlari:
  - sovg'a havolasi yuborilsa yoki `/narx Nomi | Model | Fon` yozilsa: bozor narxi, ijara narxi va 1-tur boshlang'ich to'lovi;
  - `/hisob narx oy boshlang'ich`: kalkulyator.

## Dizayn va brend
- Ranglar logotipdagidek: krem, adabiy yashil, kumush. Ilovada to'q fon.
- Uslub: jiddiy, hashamatli, lekin do'stona (Mercedes, Rolex, Patek Philippe kabi). Bachkana bo'lmasin.
- Reklamada asosiy xizmatlar: NFT sovg'alar bo'lib to'lashga va rent (ijara)ga.
- Murojaat uchun: @NAZAROVtggiftsAPP.
- Pastda bilinar-bilinmas: "Sizga eng yaxshi mulk bo'lishi mumkin bo'lgan sovg'alarni taklif qilamiz."

## Hozir mendan nima kerak
[Bu yerga yozing: masalan, "Bot o'chib ketdi, yangi bot ochdim, boshidan o'rnatishga yordam ber" yoki "Mana bu xatoni tuzat: ..."]
