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

- Stars: 1 star = 250 so'm, eng kamida 50 star.
- Premium narxi (3/6/12 oy): `(Marketapp narxi + 0.1) × 2 × 19000` so'm, Marketapp narxi TON'da. Qiymatlar admin sozlamalarida.
- Premium 1 oy: narxni admin belgilaydi.

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
