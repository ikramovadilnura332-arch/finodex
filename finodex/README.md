# Finodex — kichik biznes uchun moliya direktori

Haqiqiy ishlaydigan veb-ilova: bosh sahifa, ro'yxatdan o'tish, kirish, kabinet,
kirim-chiqim, doimiy to'lovlar, CSV import va 60 kunlik kassa prognozi.

## VS Code'da ishga tushirish

1. **Node.js 22.13 yoki yangi** (24 ham mos) o'rnating: https://nodejs.org (LTS). `node -v` bilan tekshiring.
2. Papkani VS Code'da oching: `File → Open Folder → finodex`.
3. Terminal oching (`Ctrl + ` `) va yozing:

```bash
npm install
cp .env.example .env      # Windows (cmd): copy .env.example .env
npm start
```

4. Brauzerda oching: http://localhost:3000

Kod o'zgartirganda avtomatik qayta ishga tushishi uchun: `npm run dev`.

`.env` ichida `JWT_SECRET` bo'sh qolsa, tizim uni o'zi yaratib `data/secret.key` ga saqlaydi.

## Sinab ko'rish

1. `/register` da hisob yarating.
2. Kabinetda **"Namuna ma'lumot qo'shish"** tugmasini bosing — 90 kunlik kirim-chiqim va doimiy to'lovlar
   yaratiladi va prognoz chiziladi. Keyin uni o'chirib, o'zingizniki bilan almashtirishingiz mumkin.
3. Yoki o'zingizniki: "Yangi yozuv", "Doimiy to'lovlar" yoki "CSV yuklash".

CSV format (`sana,turi,summa,toifa,izoh`), `turi` — `kirim` yoki `chiqim`. Sana `2026-09-01` yoki `01.09.2026`.

## Tuzilma

```
server.js        Express server, API, autentifikatsiya
db.js            SQLite (data/finodex.db, Node'ning o'rnatilgan node:sqlite moduli — kompilyatsiya kerak emas)
forecast.js      Prognoz mexanizmi (asosiy "aql")
public/
  index.html     Bosh sahifa (landing)
  register.html, login.html, dashboard.html, 404.html
  css/style.css
  js/            common.js, auth.js, dashboard.js, chart.js, landing.js
```

## Prognoz qanday hisoblanadi (forecast.js)

- Oxirgi 8 hafta kirimidan hafta kunlari bo'yicha o'rtacha kunlik tushum olinadi.
- Oxirgi 4 hafta oldingi 4 hafta bilan taqqoslanib, yumshatilgan trend qo'llanadi (6 haftalik ma'lumot kerak).
- O'zgaruvchan xarajatlar o'rtacha kunlik qiymat bilan olinadi.
- Ijara, ish haqi, soliq, kredit **"Doimiy to'lovlar"** ro'yxatidan aniq sanasi bilan qo'shiladi.
- Qoldiq kunma-kun hisoblanadi; nolga tushadigan birinchi kun sabab bilan ogohlantiriladi.

Hozircha **mavsumiylik (masalan, fevralda 20% pasayish)** hisobga olinmaydi — buning uchun kamida 12 oylik
ma'lumot kerak. Bu keyingi qadam.

## Xavfsizlik

Parollar bcrypt bilan, sessiya httpOnly cookie ichidagi JWT bilan, kirish/ro'yxatdan o'tishda urinishlar cheklangan,
`helmet` (CSP), barcha SQL so'rovlar parametrlangan, har bir foydalanuvchi faqat o'z ma'lumotini ko'radi.

## Internetga chiqarish (production)

- `.env`: `NODE_ENV=production`, uzun tasodifiy `JWT_SECRET`.
- HTTPS bo'lishi shart (Render, Railway, Fly.io yoki o'z VPS + Nginx/Caddy).
- SQLite fayli `data/` ichida — hosting'da **doimiy disk (volume)** ulang, aks holda qayta deploy'da ma'lumot yo'qoladi.
- Katta yuklama yoki bir nechta server kerak bo'lsa, PostgreSQL'ga o'ting.

## Hali qilinmagan (haqiqiy mahsulot uchun keyingi qadamlar)

1. **To'lov** ($25/oy): Payme / Click / Uzum integratsiyasi. Hozir faqat 14 kunlik sinov hisoblanadi, cheklov yo'q.
2. **Bank / onlayn-kassa / soliq ma'lumotini avtomatik o'qish**: bank API shartnomalari va ruxsatlari kerak;
   hozir qo'lda va CSV orqali.
3. Parolni tiklash (email yuborish), email tasdiqlash.
4. Telegram/SMS orqali ogohlantirish yuborish.
5. Mavsumiylik va aniqroq prognoz modeli.
