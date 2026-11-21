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
- Mening botim: app9267870642 (Mini App: https://app9267870642.tgcloud.ai/).
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
**Ilova tuzilishi**
- Pastki menyu: Asosiy · Ijara · Sotib olish · Xaridlarim · Balans.
- Bosh sahifa: brend kartochkasi ("NFT giftlar bo'lib to'lashga va rent (ijara)ga"), keyin xizmatlar: NFT bo'lib to'lash, ijara, NFT gift sotib olish, Premium, Stars, username va +888 ijarasi.
- Ilovada "sovg'a" o'rniga "gift" so'zi. Mijozga bozor nomlari (Portals, MRKT va h.k.) hech qayerda ko'rinmaydi, faqat adminga.
- Kartochkalarda narx turi yoziladi: "💎 Sotib olish" yoki "⏳ Ijara".
- O'z giftlarim "⭐ Bizning giftlarimiz · ijaraga / bo'lib to'lashga / naqd sotuvda" blokida, oltin "Reklama" yorlig'i bilan, gorizontal qatorda.

**Ijara**
- Bozor giftlari (Marketapp): (Marketapp narxi + 0,15) × 2 × 19 000 so'm, yuqoriga yaxlitlanadi. Kartochkada "… so'm / kun dan" (eng uzoq muddat bo'yicha).
- O'z giftlarim (avto tanlansa): Marketapp ijarasidagi model + fon / model / fon eng arzoni bo'yicha (P + 0,15) × 3 × 19 000; topilmasa qo'lda kunlik narx.
- Ijara bo'limida faqat ijaraga beriladigan o'z giftlarim chiqadi.

**Sotib olish**
- Avval "Nimani?": NFT gift, Premium, Stars (o'z username/+888 bo'lsa ular ham).
- NFT gift → "Bo'lib to'lab" yoki "Naqd":
  - Bo'lib to'lab: avval kolleksiyalar (rasm, nom, "oyiga ≈ … so'mdan"), bosilganda giftlar (narx, model, fon, belgi filtrlari, raqam qidiruvi). Faqat admin chegarasidan ("… so'mgacha") arzon giftlar. To'liq narx ko'rsatilmaydi, faqat "Oyiga ≈ …" (240 oyga hisob).
  - Naqd: katalog yo'q. Mijoz talab kiritadi (gift turi, model, fon, belgi, byudjet), "Topish" → eng arzon 5 ta mos gift.
- Bozor giftlari narxi: (bozordagi narx + qo'shimcha) × 17 000; qo'shimcha sozlamalarda (hozir 0,6).
- O'z giftlarim narxi: (barcha bozorlardagi model + fon / model / fon eng arzoni + 0,3) × 17 000; topilmasa qo'lda narx. Butun kolleksiyaning eng arzoniga tushilmaydi.
- Buyurtmada narx qayta tekshiriladi; gift sotilgan bo'lsa yoki narx o'zgarsa, mijozga aytiladi. Giftni admin qo'lda sotib oladi.
- "Giftimni sotaman": egasi havola va narxni yozadi, admin "E'lonlar"da tasdiqlaydi. Sotilsa, adminga sotuvchining username'i keladi. Pulni admin o'zi hal qiladi.

**Bo'lib to'lash**
- Turlari: 1-tur, Boshlang'ich to'lovsiz, Uzum Nasiya. Muddat 1–240 oy (barabanda), Uzum'da 3 · 6 · 12 oy.
- Ustama: oyiga 100% ÷ 12, boshlang'ich to'lov ayrilgan qolgan summaga.
- Mijozga faqat boshlang'ich to'lov va taxminiy oylik to'lov ko'rsatiladi. Pastki yozuv nimani tanlash kerakligini aytadi.
- 1-tur boshlang'ich to'lovi: (Marketapp 45 kunlik ijara narxi + 0,1) × 17 000 × 3. Qaysi ijaradan (aynan gift / model + fon / model / fon) admin tanlaydi. Topilmasa admin yozgan summa, u ham bo'lmasa "admin aytadi".
- Oylik to'lov eslatmalari bor.

**Boshqa xizmatlar**
- Stars: 240 so'm, kamida 50 ta.
- Premium: 1 oy 42 000; 3 oy 171 600; 6 oy 231 000; 12 oy akkauntga kirib 297 000; 12 oy kirmasdan 418 000. 1 oy va "12 oy kirib"da "Kimga?" so'ralmaydi.

**Admin**
- Hamma buyurtma navbatga tushadi, qo'lda bajariladi. Balansni faqat admin to'ldiradi. Referal va 2FA yo'q.
- Har dushanba 09:00 dan keyin o'tgan hafta Excel hisoboti botga keladi.
- Bot buyruqlari: gift havolasi yoki `/narx Nomi | Model | Fon` → narxlar va 1-tur to'lovi; `/hisob narx oy boshlang'ich` → kalkulyator.

**Tashqi API'lar** (kalitlar faqat admin panel → Sozlamalarda, chatga hech qachon yozilmaydi)
- Gift Satellite (gift-satellite.dev/api, `Authorization: Token <kalit>`): 5 bozor (Telegram Market, Portals, Tonnel, MRKT, Getgems) narxlari. Faqat o'qish; `/user/buy` hech qachon chaqirilmaydi. Kolleksiya nomi probelsiz (`BallsIceCream`).
- Portals Partner API (portal-market.com/partners, `Authorization: partners <kalit>`): zaxira, sekundiga 1 ta so'rov.
- Marketapp: faqat ijara (bepul). Sotuv narxlari (onsale) pullik — 402.

**Lizing**
- Ustama bo'lib to'lash bilan bir xil (admin "12 oylik ustama"), 1–240 oy, 2 turi: boshlang'ich to'lovsiz va boshlang'ich to'lovli (mijoz summani o'zi yozadi). Muddat barabanda tanlanadi.
- Gift darhol mijozga beriladi. To'lov to'xtasa gift qaytarib olinadi, to'langan pul qaytarilmaydi (bo'lib to'lashda ham). Zalog haqida botda yozilmaydi.
- To'lov kuni = xarid kuni, mijoz tanlay olmaydi. Mijozga umumiy/qolgan qarz ko'rsatilmaydi — faqat keyingi to'lov, progress va oxirgi sana.
- Bo'lib to'lashda "0% boshlang'ich" deb halol yoziladi.

## Texnik eslatma
- `public/index.html` va `public/admin.html` dagi `?v=...` raqamini har yangilanishda o'zgartiring, aks holda Telegram eski nusxani ko'rsatadi.

## Dizayn va brend
- Mini App: och "elegant" uslub — krem fon #F6F2EA, oq kartalar, to'q yashil #1E3D2F, oltin #B48A3E aksent, Inter shrift. Emoji/multik uslub yo'q. Admin panel to'q fonda qoladi.
- Pastki menyu: Asosiy | Giftlar | Xaridlarim | Balans. Giftlar bo'limlari: Lizing | Bo'lib to'lash | Ijara | Naqd ("Oyma-oy" demang).
- "Bizning giftlarimiz" — bitta-bitta aylanib turadigan karusel (4 soniya), tartibi admin "Tartib" bo'yicha. Gift sahifasida rasm to'liq (kvadrat) ko'rinadi.
- "Boshqa xizmatlar" (Premium, Stars) da narx yozilmaydi.
- Uslub: jiddiy, hashamatli, lekin do'stona (Mercedes, Rolex, Patek Philippe kabi). Bachkana bo'lmasin.
- Reklamada asosiy xizmatlar: NFT sovg'alar bo'lib to'lashga va rent (ijara)ga.
- Murojaat uchun: @NAZAROVtggiftsAPP.
- Pastda bilinar-bilinmas: "Sizga eng yaxshi mulk bo'lishi mumkin bo'lgan sovg'alarni taklif qilamiz."

## Hozir mendan nima kerak
[Bu yerga yozing: masalan, "Bot o'chib ketdi, yangi bot ochdim, boshidan o'rnatishga yordam ber" yoki "Mana bu xatoni tuzat: ..."]
