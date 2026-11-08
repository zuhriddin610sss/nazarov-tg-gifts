# NAZAROVtggifts — kelishilgan talablar va qarorlar

Asosiy promt (spetsifikatsiya) va egasi bilan kelishilgan o'zgarishlar.
Bu fayl promtdan ustun turadi: farq bo'lsa, shu yerdagi qaror amal qiladi.

## Xizmatlar

| Xizmat | Naqd | Bo'lib to'lash | Manba |
|---|---|---|---|
| NFT sovg'a (sotib olish) | yo'q | bor (3 tur) | Katalogda yo'q bo'lsa maxsus so'rov; narxni admin kiritadi |
| NFT username (sotib olish) | yo'q | bor (3 tur) | Admin qo'lda |
| NFT sovg'a ijarasi | bor | bor | Marketapp `/v1/rent/gifts/` |
| User raqamlar ijarasi | bor | bor | Marketapp `/v1/rent/usernames/` |
| Anonim raqamlar ijarasi | bor | bor | Marketapp `/v1/rent/numbers/` |
| Telegram Premium 3/6/12 oy | bor | bor (2 tur) | Marketapp `/v1/fragment/premium/` |
| Telegram Premium 1 oy | bor | bor (2 tur) | Marketapp'da yo'q, admin qo'lda bajaradi |
| Telegram Stars | bor | bor (2 tur) | Marketapp `/v1/fragment/stars/` |

- Stars: 1 star = 240 so'm, eng kamida 50 star.
- Premium naqd narxlari (qat'iy, admin sozlamalarida o'zgartiriladi):
  - 1 oy — 42 000 so'm (admin qo'lda)
  - 3 oy — 171 600 so'm
  - 6 oy — 231 000 so'm
  - 12 oy, akkauntga kirib — 297 000 so'm (admin mijoz akkauntiga kirib faollashtiradi, qo'lda)
  - 12 oy, akkauntga kirmasdan — 418 000 so'm
- Premium bo'lib to'lash: saytda narx ko'rsatilmaydi, "Narxni admin aytadi"; admin mijoz bilan kelishadi.
- Avvalgi Premium formulasi `(P + 0.1) × 2 × 19000` bekor qilindi.
- "Narx Marketapp asosida" degan yozuv saytda ko'rsatilmaydi.

## Sayt tuzilishi

- Birinchi ekranda faqat xizmatlar (katta tugmalar): NFT sovg'a sotib olish, NFT sovg'a ijarasi, Username ijarasi, Anonim raqam ijarasi, Telegram Premium, Telegram Stars.
- Pastda doimiy menyu: Xizmatlar, Xaridlarim, Balans.
- Har bir xizmat alohida sahifada ochiladi, bitta sahifada hamma narsa pastga cho'zilmaydi (Marketapp kabi).
- Xizmat sahifasida qadamma-qadam: har qadamda bitta savol, pastda bitta asosiy tugma.
- To'lov tugmalari oddiy so'z bilan: "Hozir to'liq to'layman" va "Oyma-oy bo'lib to'layman".

## Bo'lib to'lash turlari

NFT sovg'a va NFT username:
1. Banksiz, hujjatsiz, yosh chegarasiz, garovsiz, kafilsiz.
2. Banksiz, hujjatsiz, yosh chegarasiz, kafilsiz, boshlang'ich to'lovsiz.
3. Uzum Nasiya (kamida 20 yosh), boshlang'ich to'lovsiz, garovsiz, kafilsiz.

Telegram Stars va Premium:
1. Banksiz, hujjatsiz, yosh chegarasiz, kafilsiz, boshlang'ich to'lovsiz.
2. Uzum Nasiya (kamida 20 yosh).

- Oylik to'lov, boshlang'ich to'lov va garov ma'lumotlarini admin har bir shartnomada o'zi kiritadi (maydonlar ixtiyoriy).
- Uzum Nasiya bilan avtomatik ulanish yo'q: buyurtma qayd qilinadi, qolgani admin orqali.
- Bo'lib to'lash buyurtmasidan keyin mijozga: "Admin bilan bog'laning, admin sizni kutmoqda" + "Adminga yozish" tugmasi (buyurtma ID'si bilan). Tekshiruv yo'q, buyurtma darhol navbatga tushadi.

## Navbat

- **Barcha buyurtmalar** (naqd ham, bo'lib to'lash ham) bitta umumiy navbatga tushadi. Promtning 6-qoidasi shu bilan bekor qilingan.
- Navbat raqami saqlanmaydi, navbatga tushgan vaqt bo'yicha `ROW_NUMBER()` bilan hisoblanadi: bo'shliq va takror bo'lmaydi.
- Doimiy ID: `NG-XXXXXX`, hech qachon o'zgarmaydi. Mijoz navbat raqamini ko'rmaydi.

## Naqd buyurtmalar

1. Pul balansdan atomik yechiladi, buyurtma navbatga tushadi.
2. Marketapp'ga avtomatik yuboriladi; Marketapp qaytargan TON tranzaksiyasini server alohida "aylanma" hamyon bilan imzolab yuboradi (A varianti).
3. Muvaffaqiyat: "Amalga oshirildi", navbatdan chiqadi.
4. Xato: navbatda qoladi, adminga Telegram xabar; admin qayta yuboradi yoki bekor qiladi. Bekor qilinsa pul balansga qaytadi.
5. Marketapp'da yo'q mahsulotlar (masalan, 1 oylik Premium) admin tomonidan qo'lda bajariladi.

Hamyon xavfsizligi: alohida hamyon, faqat bir necha kunlik aylanma mablag', kalit shifrlangan holda serverda, kunlik sarf limiti (oshsa admin tasdig'i).

## Qabul qiluvchi akkaunt

Faqat Telegram Premium va Stars'da: "O'zimga" yoki "Boshqa odamga" (username). Marketapp `recipient` endpointi bilan tekshiriladi.

## Ijara narxi

- Formula: `Mijoz narxi = (P + 0.15) × 2 × 19000` so'm. Qiymatlar admin sozlamalarida.
- Natija **yaxlitlanmaydi**.
- Marketapp narxi kunlik (nanoGRAM) va muddatga qarab chegirma bor (`discount_per_day`). Saytda har bir kun soni uchun narx ko'rsatiladi; P = tanlangan muddatning umumiy narxi (TON).
- Chegirma formulasi haqiqiy ma'lumot bilan tekshirilishi kerak.

## Mijozni aniqlash

- Telegram Mini App `initData` / Login Widget, serverda HMAC tekshiruvi.
- Telefon raqami buyurtma oxirida so'raladi (Telegram kontakt ulashish).

## Tillar

O'zbek, rus, ingliz, xitoy. Xitoycha tarjimani ona tilida so'zlashuvchi tekshirishi kerak.

## Marketapp API

- Hujjat: https://api.marketapp.org/docs/ (OpenAPI: `/docs/openapi.json`).
- Avtorizatsiya: `Authorization: <token>` (prefikssiz).
- Tarif: bepul. Bepul: `fragment`, `rent`, `collections`, `vpn`. Pullik: `gifts`, `nfts` (ko'pi).
- Xarid/ijara endpointlari imzolanmagan TON tranzaksiyasini qaytaradi; u API tokeni olingan hamyondan yuborilishi shart.
- Ijaraga olingan sovg'a va username Fragment'ga TonConnect orqali ulanadi (`/v1/rent/{nft_address}/tonconnect/`); anonim raqam uchun kirish kodi `/v1/rent/{nft_address}/login-code/`.
- Raqam ijarasi tugashi haqida mijozni bir necha kun oldin ogohlantirish shart (Marketapp talabi).

## Infratuzilma

Server va domen bor. Kod: GitHub `zuhriddin610sss/nazarov-tg-gifts`.

## Balansni to'ldirish

- Karta raqami ostida: karta egasi "Nazarov Z" va qizil ogohlantirish: "CLICK (Click ilovasi, Click bot va boshqa Click), ALIF, PAYME va 3-shaxsdan pul qabul qilinmaydi!!! Tashlangan pul qaytarilmaydi." (admin sozlamalarida o'zgartiriladi).
- Chek **faqat sayt orqali** yuklanadi (C varianti); @chat_bilan tugmasi olib tashlangan.

## Promo-kodlar, sharhlar, eslatmalar

- Promo-kod faqat naqd buyurtmalarga; foiz yoki qat'iy summa; muddat, ishlatish limiti, xizmat bo'yicha cheklov. Bitta mijoz bitta kodni bir marta ishlatadi. Narx kamida 1 so'm qoladi.
- Sharh faqat bajarilgan buyurtmaga, bitta buyurtmaga bitta; admin tasdiqlagach "Savollar" sahifasida ko'rinadi (ism qisqartiriladi).
- Ijara admin "Amalga oshirildi" qilgan paytdan hisoblanadi; tugashidan 72 va 24 soat oldin eslatma.
