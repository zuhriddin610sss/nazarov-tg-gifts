# NAZAROVtggifts botini noldan qurish

Bu yo'riqnoma bilan yangi bot ochib, butun do'konni (bot, ilova, admin panel) 15–20 daqiqada qayta ishga tushirasiz.

Kod shu GitHub sahifada saqlanadi: https://github.com/zuhriddin610sss/nazarov-tg-gifts

> **Muhim:** mijozlar, buyurtmalar, balanslar va bo'lib to'lashlar har bir botning **o'z bazasida** turadi. Yangi bot ochsangiz, u bo'm-bo'sh bo'ladi: eski ma'lumotlar o'tmaydi. Shuning uchun har oy admin paneldan **⬇ Excel** hisobotni olib saqlab qo'ying.

---

## 1. Telegram'da (telefonda yoki noutbukda)

1. **@BotFather** ga `/newbot` yozing → botga nom bering → username bering (oxiri `bot` bilan tugashi kerak).
2. BotFather'da botingizni oching → **Serverless** bo'limini yoqing.
3. **Serverless → CLI Access** → kalitni nusxalab oling. Kalit `app1234567890:...` ko'rinishida bo'ladi.
   - Kalitni **hech kimga** bermang va chatga yozmang. Uni faqat 3-qismdagi terminalga qo'yasiz.
   - Kalitning boshidagi raqamni yozib qo'ying (masalan `app1234567890`). Bu ilovangiz manzili bo'ladi: `https://app1234567890.tgcloud.ai/`
4. O'zingizning Telegram ID raqamingizni bilib oling: **@userinfobot** ga `/start` yozing, u `Id: 8644718235` kabi raqam beradi.

## 2. Noutbukda: Node.js (bir marta)

1. https://nodejs.org/en/download sahifasini oching.
2. **Windows Installer (.msi)** ni yuklab oling → oching → **Next → Next → Install**.

Bu allaqachon o'rnatilgan bo'lsa, o'tkazib yuboring.

## 3. Noutbukda: botni yuklash

Istalgan papkada bo'sh joyga **o'ng tugma → Открыть в Терминале**. Har bir buyruqni **alohida** yozib, **Enter** bosing.

**1. Yuklanmalar papkasiga o'tish:**
```
cd C:\Users\user\Downloads
```

**2. Eski nusxani o'chirish (bo'lsa):**
```
Remove-Item nazarov-tg-gifts-main, bot.zip -Recurse -Force -ErrorAction SilentlyContinue
```

**3. Kodni yuklab olish:**
```
Invoke-WebRequest https://github.com/zuhriddin610sss/nazarov-tg-gifts/archive/refs/heads/main.zip -OutFile bot.zip
```

**4. Ochish:**
```
Expand-Archive bot.zip . -Force
```

**5. Papkaga kirish:**
```
cd C:\Users\user\Downloads\nazarov-tg-gifts-main\serverless
```

**6. O'z ID va manzilingizni yozish.** Ikki joyni o'zgartiring: `8644718235` o'rniga o'z ID'ingiz, `app9267870642` o'rniga kalitingiz boshidagi raqam:
```
Set-Content tgcloud\lib\config.js "export const ADMIN_IDS = [8644718235];`nexport const MINI_APP_URL = 'https://app9267870642.tgcloud.ai/';"
```
Bir nechta admin bo'lsa, vergul bilan yozing: `[8644718235, 123456789]`.

**7. Kerakli dasturni o'rnatish:**
```
npm.cmd install
```

**8. Botga ulanish.** Kalit so'raganda CLI kalitni **o'ng tugma** bilan qo'yib, **Enter** bosing (ekranda ko'rinmaydi, bu normal):
```
npx.cmd tgcloud login
```
`Synced` chiqsa, ulandi.

**9. Hammasini botga yuklash:**
```
npx.cmd tgcloud push tgcloud/lib tgcloud/handlers tgcloud/endpoints public --force
```
Oxirida `Done` va `Static: https://app....tgcloud.ai/` chiqadi.

**10. Bot xabarlarni qabul qilyaptimi, tekshirish:**
```
npx.cmd tgcloud webhook
```
`✓ in sync` chiqsa, hammasi joyida. `OUT OF SYNC` chiqsa, mana buni yozing:
```
npx.cmd tgcloud webhook sync
```

## 4. BotFather'da tugma

BotFather → botingiz → **Bot Settings → Menu Button** → manzil: `https://app<raqam>.tgcloud.ai/`, nomi: **Do'kon**.

## 5. Admin panelni sozlash

1. Botga `/start` yozing. "Siz adminsiz." va **Admin panel** tugmasi chiqadi.
2. **Admin panel → ☰ Menyu → Sozlamalar**:
   - **Admin username:** o'z username'ingiz, `@` belgisisiz. Mijozlar "Adminga yozish" bosganda sizga tushadi.
   - **Marketapp API tokeni:** https://marketapp.org/api-token dan nusxalab qo'ying. Ijara katalogi shu bilan ishlaydi.
   - Narxlar o'zi to'g'ri turadi: Stars 240 so'm (kamida 50), Premium 42 000 / 171 600 / 231 000 / 297 000 / 418 000, ijara formulasi (P + 0,15) × 2 × 19 000. Kerak bo'lsa o'zgartiring.
   - **Saqlash** ni bosing.
3. Kerak bo'lsa: **Mening mahsulotlarim** bo'limida o'z mahsulotlaringizni qayta qo'shing.

Tayyor! Ilovani ochib sinab ko'ring.

---

## Keyinchalik yangilash (kod o'zgarganda)

3-qismdagi **1, 3, 4, 5, 6, 9** buyruqlarni qayta yozasiz. `login` qayta shart emas: u shu papkada saqlanadi. Agar 2-buyruq bilan papkani o'chirgan bo'lsangiz, 7 va 8 ham kerak bo'ladi.

## Kunlik ishlar

- **Balans to'ldirish:** Admin panel → Mijozlar → mijoz → **Balansni o'zgartirish** → summa va sabab → Saqlash. Yoki Navbat → buyurtma → **Balansni to'ldirish**. Yechish uchun summa oldiga minus qo'ying: `-50000`.
- **Buyurtmalar:** Navbat → buyurtma → **Amalga oshirildi** yoki **Bekor qilish** (naqd bo'lsa pul balansga qaytadi).
- **Bo'lib to'lash:** buyurtma ichida **Shartnoma tuzish**. Oylik to'lov eslatmalari o'zi boradi.
- **Hisobot:** Boshqaruv paneli → **⬇ Excel**. Fayl botdagi chatingizga keladi.

## Muammo bo'lsa

| Belgi | Nima qilish kerak |
|---|---|
| `npx` "Need to install tgcloud... Ok to proceed?" deb so'rasa | **`n`** bosing! Siz noto'g'ri papkadasiz. 5-buyruq bilan to'g'ri papkaga o'ting. |
| `Token format looks wrong` | Kalit to'liq nusxalanmagan. BotFather'dan qayta nusxalab, `login` ni takrorlang. |
| Bot `/start` ga javob bermaydi | `npx.cmd tgcloud run handlers/message "{chat:{id:ID,type:'private'},from:{id:ID,first_name:'Test'},text:'/start'}"` (ID o'rniga o'z ID'ingiz). Chiqqan qizil xatoni saqlang. |
| Ijara bo'limi bo'sh yoki xato | Sozlamalardagi Marketapp tokenini qaytadan qo'ying (marketapp.org/api-token). |
| Admin panel "admin huquqi berilmagan" desa | 6-buyruqdagi ID noto'g'ri. To'g'rilab, 9-buyruqni qayta yozing. |
| Bot boshqa tilda yozsa | Ilovada til tugmasidan UZ ni tanlang. |
| Kalit begona odamga ketib qolsa | BotFather → Serverless → CLI Access → **Revoke**, keyin `login` ni yangi kalit bilan takrorlang. |
