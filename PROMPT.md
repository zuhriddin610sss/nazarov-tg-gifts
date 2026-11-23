# Claude uchun tayyor prompt

Botga biror narsa bo'lsa (o'chib qolsa, xato bersa, yangi bot ochish kerak bo'lsa), quyidagi chiziqdan pastdagi matnni **to'liq nusxalab** Claude'ga yuboring. Oxiridagi "Hozir mendan nima kerak" qismiga muammongizni yozing.

---

Salom! Mening NAZAROVtggifts degan Telegram giftlar biznesim bor: bot, Mini App va admin panel. Kod GitHub'da:
https://github.com/zuhriddin610sss/nazarov-tg-gifts

Kod `serverless/` papkasida:
- `tgcloud/lib`, `tgcloud/handlers`, `tgcloud/endpoints` — server kodi;
- `public` — Mini App (`index.html`, `app.js`, `i18n.js`, `style.css`) va admin panel (`admin.html`, `admin.js`);
- `test/` — testlar (`npm test`), `test/dev-server.mjs` — kompyuterda sinash uchun.

Iltimos, avval repozitoriyni va shu faylni (`PROMPT.md`) o'qib chiq, keyin yordam ber.

## Men haqimda va qanday ishlashim kerak
- Men dasturchi emasman. **O'zbek tilida, qisqa va juda oddiy** tushuntir. Uzun matn yozma.
- Kod yozishdan oldin nima o'zgarishini qisqa ayt. Men **"qil"** desam, keyin qil. "Kod yozma" desam — yozma.
- Men xatolarni rasm bilan yuboraman. Bir nechta bo'lsa ro'yxat qilib, "qil" deganimda hammasini tuzat.
- O'zgarishni o'zing sinab ko'r (testlar + telefon o'lchamidagi skrinshot), keyin GitHub'ga (main) yukla va menga yangilash buyruqlarini ber.
- Tokenlar/kalitlarni (bot, CLI, Marketapp, Portals, Gift Satellite) **hech qachon chatga so'rama**. Ular faqat admin panel → Sozlamalarda yoki terminalda.
- Gift Satellite'da `/user/buy` (xarid) **hech qachon chaqirilmaydi** — faqat narx o'qish.

## Platforma va yangilash
- Bot **Telegram BotFather Serverless** (tgcloud) da: app9267870642, Mini App: https://app9267870642.tgcloud.ai/
- Men Windows'da **PowerShell** ishlataman. Botni yangilash buyruqlari (hammasi birga nusxalanadi, oxirida yana Enter):

```
cd C:\Users\user\Downloads
Remove-Item nazarov-tg-gifts-main, bot.zip -Recurse -Force -ErrorAction SilentlyContinue
Invoke-WebRequest https://github.com/zuhriddin610sss/nazarov-tg-gifts/archive/refs/heads/main.zip -OutFile bot.zip
Expand-Archive bot.zip . -Force
cd C:\Users\user\Downloads\nazarov-tg-gifts-main\serverless
Set-Content tgcloud\lib\config.js "export const ADMIN_IDS = [8644718235];`nexport const MINI_APP_URL = 'https://app9267870642.tgcloud.ai/';"
npm.cmd install
npx.cmd tgcloud login
npx.cmd tgcloud push tgcloud/lib tgcloud/handlers tgcloud/endpoints public --force
```

- Yangi bot ochilsa: `config.js` dagi `app<raqam>` CLI kalitining boshidagi raqam bo'ladi.

## Takrorlanmasin (oldin bo'lgan xatolar)
- `npx` "Ok to proceed?" desa — noto'g'ri papka yoki `npm.cmd install` qilinmagan. **`n` bosiladi**.
- Import nomlari `'lib/core'` ko'rinishida (`../lib/core.js` emas).
- Baza yangilanganda eski ma'lumotlar o'chmasligi shart: faqat yangi ustun/jadval qo'shiladi.
- `public/index.html` va `admin.html` dagi `?v=...` har yangilanishda o'zgartiriladi (aks holda Telegram eski nusxani ko'rsatadi).
- Bosh sahifa ma'lumot kelganda **butunlay qayta chizilmaydi** (tugmalar bosilmay qolardi) — faqat reklamalar va tavsiyalar yangilanadi.
- Telegram'ning "pastga surib yopish" o'chirilgan (`disableVerticalSwipes`) — aks holda bosishlar yo'qoladi. Ochilishdagi `#tgWebAppData` bosh sahifa deb olinadi.
- Gift Satellite: kolleksiya nomi eski kolleksiyalarda probelsiz (`PlushPepe`), yangilarida probel bilan (`Jingle Bells`) — bot ikkalasini sinaydi va eslab qoladi. Getgems qidiruvi 404 bersa e'tiborga olinmaydi.
- Bozorlardan biri javob bermasa, narx **o'zgarmaydi** (kengroq, arzonroq usulga tushib ketmaydi). Model + fon uchun uch xil qidiruv (birga, faqat model, faqat fon) va aynan mosi tanlanadi.

## Biznes qoidalari (o'zgartirma)
**Umumiy**
- Pastki menyu: Asosiy | Giftlar | Xaridlarim | Balans. Giftlar bo'limlari: Lizing | Bo'lib to'lash | Ijara | Naqd.
- 5 ta usul alohida, aralashtirilmaydi: Lizing, Bo'lib to'lash, Ijara, Naqd (sotib olish), Pul olish.
- "Sovg'a" emas — **"gift"**. Mijozga bozor nomlari (Portals, MRKT…) ko'rinmaydi, faqat adminga.
- **"0%", "Foizsiz", "ustamasiz"** hech qayerda yozilmaydi (ustama bor). "Qarz", "kredit", "garov/zalog" so'zlari ishlatilmaydi.
- Shiorlar, "emotsiya" gaplari, qat'iy va'dalar ("100%", "topib beramiz") yozilmaydi — egasi "crinj" deydi. Faktlar va narxlar yetarli.

**Narxlar (so'm, yuqoriga yaxlitlanadi)**
- Bozor giftlarini sotish: (bozor narxi + 0,6) × 17 000.
- O'z giftlarim: (barcha bozorlarda tanlangan usul — model + fon / model / fon — eng arzoni + 0,3) × 17 000; topilmasa qo'lda narx.
- Ijara (bozor): (Marketapp narxi + 0,15) × 2 × 19 000. O'z giftlarim avto: × 3.
- Bo'lib to'lash ustamasi: yiliga 100% (oyiga ÷12). Lizing ustamasi alohida sozlama (standart yiliga 100%).
- 1-tur boshlang'ich to'lovi: (Marketapp 45 kunlik ijara + 0,1) × 17 000 × 3; topilmasa admin yozgan summa.

**Lizing va bo'lib to'lash**
- Muddat 1–240 oy (baraban), Uzum Nasiya 3 · 6 · 12 oy. Bo'lib to'lash turlari: Oddiy (boshlang'ich ixtiyoriy), 1-tur (belgilangan boshlang'ich), Uzum Nasiya (20 yoshdan, Uzum Nasiya yoki Uzum Bank'da hisob kerak).
- Gift darhol mijozning Telegramida. To'lov to'xtasa gift olib qo'yiladi, pul qaytarilmaydi.
- To'lov kuni = xarid kuni. Mijozga umumiy/qolgan qarz ko'rsatilmaydi — faqat keyingi to'lov, progress va oxirgi sana.

**Pul olish — "Giftingizni sotmasdan, uning uchun pul oling"**
- Mijoz gift havolasi, summa va muddatni yozadi. Gift qiymatining 80% gacha, eng ko'pi 50 mln (Sozlamalarda). Summani admin tasdiqlaydi. Oylik to'lov berilgan puldan, lizing ustamasi bilan. Admin: "Pul berildi — shartnoma tuzish".

**Ekranlar (mijoz adashmasin)**
- Bosh sahifa: tepada 4 ta Stories-reklama (5 soniya): Ijara ("Kuniga X so'mdan" — bizning va bozordagi giftlarning 180 kunlik ijaradagi eng arzon kunlik narxi), Lizing ("Oyiga X so'mdan"), Bo'lib to'lash ("Hozir oling, bir necha oyga bo'lib to'lang"), Pul olish (Plush Pepe rasmi bilan). Keyin: ishonch qatori, 5 ta usul tugmasi, "Tavsiya etamiz" (bitta-bitta aylanadi), Boshqa xizmatlar (Premium, Stars, Username, Raqam, Giftimni sotaman), "Biz haqimizda" (5 usul, 240 oy, kanal t.me/NAZAROVtggifts).
- Giftlar sahifasi: "Pul oling" qatori, "① Giftni tanlang", giftlar, eng pastda "Ro'yxatda yo'qmi?".
- Gift sahifasi: "① To'lov turini tanlang" kartalari, katta "Oyiga X so'mdan", ekran pastida doim ko'rinadigan "Oylik to'lovni hisoblash →".
- Hisob sahifasi: raqamlangan qadamlar (tur → necha oyga → boshlang'ich to'lov), har bir tur haqida 3 qator va taqqoslash jadvali, "Ariza yuborish".

**Admin panel**
- Bosh sahifa: "Bugungi ishlar" (kechikkan va yaqin to'lovlar, navbat, cheklar), shartnoma kalkulyatori.
- Lizing va bo'lib to'lash → "📊 To'liq jadval": № · sotib olingan sana/narx · sotilgan sana · mijoz (ism, telefon, username) · mahsulot · naqd narx · naqddan / bo'lib to'lashdan / umumiy foyda · boshlang'ich · kredit · qolgan qarz · muddat · oylik foyda (qo'lda) · oylik to'lov · qolgan muddat · oxirgi to'lov sanasi · to'langan · eski to'lovlar (gift olib kelgan hamma pul, ijara bilan). Har kuni 09:00 dan keyin Excel hisobot botga keladi.
- Mening mahsulotlarim: sotib olingan sana/narx, "Qilingan daromad" (ijaradan). "Narxni yangilash" (tekshiruv oynasi — har bir bozor javobi) va "Hammasining narxini yangilash".
- Jurnallar: bozor xatolari (masalan Portals `PARTNER_INVALID_KEY` — kalitni yangilash kerak).

**Boshqa**
- Stars: 240 so'm, kamida 50. Premium narxlari Sozlamalarda.
- Hamma buyurtma navbatga tushadi va qo'lda bajariladi. Balansni faqat admin to'ldiradi.
- Bot buyruqlari: gift havolasi yoki `/narx Nomi | Model | Fon`; `/hisob narx oy boshlang'ich`.

## Dizayn
- Och "elegant" uslub: krem fon #F6F2EA, oq kartalar, to'q yashil #1E3D2F, oltin #B48A3E, Inter shrift. Admin panel ham shu uslubda.
- Jiddiy, hashamatli, lekin tushunarli. Multik/bachkana uslub yo'q.
- Murojaat: @NAZAROVtggiftsAPP.

## Hozir mendan nima kerak
[Bu yerga yozing: masalan, "Bot o'chib ketdi, yangi bot ochdim, boshidan o'rnatishga yordam ber" yoki "Mana bu xatoni tuzat: …" (rasm bilan)]
