/**
 * Finodex prognoz mexanizmi.
 *
 * Usul (ataylab sodda va tushuntirib bo'ladigan):
 *  1. Oxirgi 8 hafta kirimidan hafta kunlari bo'yicha o'rtacha kunlik tushum olinadi
 *     (ma'lumot kam bo'lsa - oddiy o'rtacha).
 *  2. Oxirgi 4 hafta bilan undan oldingi 4 hafta taqqoslanib, yumshatilgan trend qo'llanadi.
 *  3. O'zgaruvchan xarajatlar (tovar, kommunal, reklama...) o'rtacha kunlik qiymat bilan olinadi.
 *  4. Doimiy to'lovlar (ijara, ish haqi, soliq, kredit) "Doimiy to'lovlar" ro'yxatidan,
 *     aniq sanasi bilan qo'shiladi.
 *  5. Kunma-kun qoldiq hisoblanadi, qoldiq nolga tushadigan birinchi kun topiladi.
 */

const DAY = 86400000;
const FIXED_CATEGORIES = new Set(['Ijara', 'Ish haqi', 'Soliq', 'Kredit']);

const toDate = (s) => new Date(s + 'T00:00:00Z');
const fmtD = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => fmtD(new Date(toDate(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (arr) => arr.reduce((s, v) => s + v, 0);
const money = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') + " so'm";
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const prettyDate = (s) => `${Number(s.slice(8))}-${MONTHS[Number(s.slice(5, 7)) - 1]}`;

function recurringHitsOn(item, dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.min(item.day_of_month, lastDay) === Number(dateStr.slice(8));
}

function buildForecast({ opening, txs, recurring, today, horizon = 60 }) {
  const past = txs.filter((t) => t.date <= today);
  const balance = opening + sum(past.map((t) => (t.type === 'income' ? t.amount : -t.amount)));

  // ---- tarix oynasi ----
  const firstDate = past.length ? past.reduce((m, t) => (t.date < m ? t.date : m), past[0].date) : today;
  const histDays = clamp(diffDays(today, firstDate) + 1, 1, 56);
  const windowStart = addDays(today, -(histDays - 1));
  const inWindow = past.filter((t) => t.date >= windowStart);

  const incomeByDay = {};
  for (const t of inWindow) if (t.type === 'income') incomeByDay[t.date] = (incomeByDay[t.date] || 0) + t.amount;

  const totalIncome = sum(Object.values(incomeByDay));
  const flatIncome = totalIncome / histDays;

  // hafta kunlari bo'yicha o'rtacha
  const wdSum = Array(7).fill(0);
  const wdCnt = Array(7).fill(0);
  for (let i = 0; i < histDays; i++) {
    const d = addDays(windowStart, i);
    const wd = toDate(d).getUTCDay();
    wdSum[wd] += incomeByDay[d] || 0;
    wdCnt[wd] += 1;
  }
  const useWeekday = histDays >= 21;

  // trend: oxirgi 28 kun / undan oldingi (kamida 42 kun ma'lumot bo'lsa)
  let trend = 1;
  let trendRatio = null;
  if (histDays >= 42) {
    let recent = 0;
    let earlier = 0;
    for (let i = 0; i < histDays; i++) {
      const d = addDays(windowStart, i);
      if (i >= histDays - 28) recent += incomeByDay[d] || 0;
      else earlier += incomeByDay[d] || 0;
    }
    const earlierDays = histDays - 28;
    if (earlier > 0) {
      trendRatio = recent / 28 / (earlier / earlierDays);
      trend = clamp(1 + (trendRatio - 1) * 0.5, 0.85, 1.15);
    }
  }

  // o'zgaruvchan xarajat (doimiy toifalar prognozda alohida qo'shiladi)
  const varExpense = sum(inWindow.filter((t) => t.type === 'expense' && !FIXED_CATEGORIES.has(t.category)).map((t) => t.amount)) / histDays;

  // ---- kunma-kun prognoz ----
  const series = [{ date: today, balance: Math.round(balance) }];
  let bal = balance;
  let predIncome30 = 0;
  let predExpense30 = 0;
  const events = [];

  for (let i = 1; i <= horizon; i++) {
    const date = addDays(today, i);
    const wd = toDate(date).getUTCDay();
    const base = useWeekday && wdCnt[wd] ? wdSum[wd] / wdCnt[wd] : flatIncome;
    let inc = base * trend;
    let exp = varExpense;
    for (const r of recurring) {
      if (recurringHitsOn(r, date)) {
        if (r.type === 'income') inc += r.amount;
        else exp += r.amount;
        events.push({ date, title: r.title, type: r.type, amount: r.amount });
      }
    }
    bal += inc - exp;
    if (i <= 30) {
      predIncome30 += inc;
      predExpense30 += exp;
    }
    series.push({ date, balance: Math.round(bal) });
  }

  // ---- oxirgi 30 kun haqiqiy ----
  const l30Start = addDays(today, -29);
  const last30 = past.filter((t) => t.date >= l30Start);
  const last30Income = sum(last30.filter((t) => t.type === 'income').map((t) => t.amount));
  const last30Expense = sum(last30.filter((t) => t.type === 'expense').map((t) => t.amount));

  // ---- yetarlilik va ishonchlilik ----
  const confidence = histDays >= 42 ? 'yuqori' : histDays >= 21 ? "o'rta" : 'past';
  const enough = past.length >= 8 && histDays >= 7;

  // ---- runway ----
  const recurringMonthly = sum(recurring.filter((r) => r.type === 'expense').map((r) => r.amount)) - sum(recurring.filter((r) => r.type === 'income').map((r) => r.amount));
  const dailyBurn = varExpense + recurringMonthly / 30 - flatIncome * trend;
  let runwayDays = enough && dailyBurn > 0 && balance > 0 ? Math.floor(balance / dailyBurn) : null;
  if (runwayDays !== null && runwayDays > 365) runwayDays = null; // 1 yildan ko'p — "barqaror" deb hisoblanadi

  // ---- maslahatlar ----
  const insights = [];
  if (!enough) {
    insights.push({
      level: 'info',
      title: "Prognoz uchun ma'lumot yetarli emas",
      text: "Kamida 1-2 haftalik kirim va chiqimni kiriting (yoki CSV yuklang). Ma'lumot ko'paygan sari prognoz aniqlashadi.",
    });
  } else {
    const gap = series.find((p) => p.balance < 0);
    if (gap) {
      const minPoint = series.reduce((m, p) => (p.balance < m.balance ? p : m), series[0]);
      const cause = events.filter((e) => e.date === gap.date && e.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
      insights.push({
        level: 'danger',
        title: `${prettyDate(gap.date)} kuni kassada pul yetmay qolishi mumkin`,
        text:
          `Prognoz bo'yicha ${prettyDate(gap.date)} kuni qoldiq nolga tushadi` +
          (cause ? ` (shu kuni "${cause.title}" — ${money(cause.amount)} to'lovi bor)` : '') +
          `. Eng past nuqtada taxminan ${money(Math.abs(minPoint.balance))} yetishmaydi. ` +
          `Hozirdan tovar buyurtmasini kamaytiring, to'lovni muzokara qilib suring yoki bank bilan aylanma mablag' uchun kredit liniyasi shartlarini oldindan aniqlab qo'ying.`,
        date: gap.date,
      });
    } else {
      const next30 = series.slice(0, 31);
      const low = next30.reduce((m, p) => (p.balance < m.balance ? p : m), next30[0]);
      const monthlyCost = predExpense30;
      if (monthlyCost > 0 && low.balance < monthlyCost * 0.15) {
        insights.push({
          level: 'warn',
          title: 'Kassa zaxirasi juda kam bo\'lib qoladi',
          text: `${prettyDate(low.date)} kuni qoldiq ${money(low.balance)} ga tushadi — bu bir oylik xarajatning 15% idan kam. Kutilmagan xarajat bo'lsa, kassa uzilishi mumkin.`,
          date: low.date,
        });
      }
    }

    if (last30Income > 0 && histDays >= 28) {
      const change = (predIncome30 - last30Income) / last30Income;
      if (change <= -0.1) {
        insights.push({
          level: 'warn',
          title: `Keyingi 30 kunda savdo ~${Math.round(-change * 100)}% pasayishi kutilmoqda`,
          text: `Oxirgi 30 kunda kirim ${money(last30Income)} bo'ldi, keyingi 30 kun uchun prognoz ${money(predIncome30)}. Buyurtma hajmini shunga moslang.`,
        });
      } else if (change >= 0.1) {
        insights.push({
          level: 'ok',
          title: `Savdo ~${Math.round(change * 100)}% o'sishi kutilmoqda`,
          text: `Keyingi 30 kun uchun prognoz kirim ${money(predIncome30)}. Ortiqcha tushumni zaxira sifatida ushlab turing.`,
        });
      }
    }

    if (last30Income > 0 && last30Expense / last30Income > 0.9) {
      insights.push({
        level: 'warn',
        title: 'Xarajatlar kirimning 90% idan oshgan',
        text: `Oxirgi 30 kunda xarajat ${money(last30Expense)}, kirim ${money(last30Income)}. Foyda deyarli qolmayapti — eng katta xarajat toifalarini ko'rib chiqing.`,
      });
    }

    if (!insights.some((i) => i.level === 'danger' || i.level === 'warn')) {
      insights.push({
        level: 'ok',
        title: 'Keyingi 60 kunda kassa uzilishi ko\'rinmayapti',
        text: 'Joriy kirim-chiqim sur\'atida qoldiq musbat qoladi. Har kuni ma\'lumot kiritib borsangiz, prognoz aniq bo\'lib turadi.',
      });
    }
  }

  if (confidence === 'past' && enough) {
    insights.push({
      level: 'info',
      title: 'Prognoz aniqligi hozircha past',
      text: "Hozircha 3 haftadan kam ma'lumot bor. 6 haftadan keyin trend, 12 oydan keyin mavsumiylik hisobga olinadi.",
    });
  }

  return {
    today,
    balance: Math.round(balance),
    last30: { income: Math.round(last30Income), expense: Math.round(last30Expense) },
    next30: { income: Math.round(predIncome30), expense: Math.round(predExpense30) },
    runwayDays,
    enoughData: enough,
    confidence,
    historyDays: histDays,
    trendRatio: trendRatio ? Number(trendRatio.toFixed(2)) : null,
    upcoming: events.slice(0, 8),
    series,
    insights,
  };
}

module.exports = { buildForecast, FIXED_CATEGORIES };
