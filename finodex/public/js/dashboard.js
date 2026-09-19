let CATEGORIES = { income: [], expense: [] };
const FIXED = ['Ijara', 'Ish haqi', 'Soliq', 'Kredit'];
const todayStr = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10); // Toshkent vaqti

// KPI uchun: raqam + kichik "so'm" (qatorga bo'linmaydi)
const kpiMoney = (n) => `<span class="nowrap">${n < 0 ? '−' : ''}${fmt(Math.abs(n))}</span> <small>so'm</small>`;
const parseAmount = (s) => Number(String(s).replace(/[\s,]/g, ''));

function setErr(id, msg) { $(id).textContent = msg || ''; }

// ---------- Boshlash ----------
async function init() {
  let me;
  try {
    me = await api('/api/auth/me');
  } catch {
    location.href = '/login';
    return;
  }
  CATEGORIES = me.categories;
  const u = me.user;

  $('#biz-name').textContent = u.businessName;
  $('#greet').textContent = `Salom, ${u.name}`;
  const pill = $('#trial-pill');
  pill.hidden = false;
  pill.textContent = u.trialDaysLeft > 0 ? `Sinov: ${u.trialDaysLeft} kun qoldi` : 'Sinov muddati tugadi';

  $('#tx-date').value = todayStr();
  fillCategories();
  await refreshAll();

  $('#loading').hidden = true;
  $('#app').hidden = false;
}

function fillCategories() {
  const type = $('input[name="type"]:checked').value;
  const sel = $('#tx-category');
  sel.innerHTML = CATEGORIES[type].map((c) => `<option>${esc(c)}</option>`).join('');
  updateHint();
}

function updateHint() {
  const type = $('input[name="type"]:checked').value;
  $('#fixed-hint').hidden = !(type === 'expense' && FIXED.includes($('#tx-category').value));
}

async function refreshAll() {
  const [fc, tx, rec] = await Promise.all([api('/api/forecast'), api('/api/transactions?limit=100'), api('/api/recurring')]);
  renderForecast(fc);
  renderTransactions(tx);
  renderRecurring(rec.recurring);
}

// ---------- Prognoz ----------
function renderForecast(fc) {
  const bal = $('#kpi-balance');
  bal.innerHTML = kpiMoney(fc.balance);
  bal.classList.toggle('neg', fc.balance < 0);

  $('#kpi-income').innerHTML = kpiMoney(fc.last30.income);
  $('#kpi-expense').innerHTML = kpiMoney(fc.last30.expense);
  $('#kpi-income-note').textContent = fc.enoughData ? `prognoz (30 kun): ${fmt(fc.next30.income)}` : '';
  $('#kpi-expense-note').textContent = fc.enoughData ? `prognoz (30 kun): ${fmt(fc.next30.expense)}` : '';

  const rw = $('#kpi-runway');
  if (!fc.enoughData) {
    rw.textContent = '—';
    $('#kpi-runway-note').textContent = "ma'lumot yetarli emas";
  } else if (fc.balance <= 0) {
    rw.textContent = '0 kun';
    $('#kpi-runway-note').textContent = 'qoldiq tugagan';
  } else if (fc.runwayDays === null) {
    rw.textContent = 'Barqaror';
    $('#kpi-runway-note').textContent = 'kirim xarajatdan kam emas';
  } else {
    rw.innerHTML = `${fc.runwayDays} <small>kun</small>`;
    $('#kpi-runway-note').textContent = "shu sur'atda";
  }

  const days = fc.historyDays;
  $('#fc-conf').textContent = fc.enoughData
    ? `Aniqlik: ${fc.confidence} · ${days} kunlik ma'lumot asosida`
    : "Prognoz uchun ma'lumot kiriting";

  renderForecastChart($('#chart-box'), $('#chart-tip'), fc.series);

  $('#insights').innerHTML = fc.insights
    .map((i) => `<div class="insight ${esc(i.level)}"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`)
    .join('');

  const hasIncome = fc.last30.income > 0 || fc.last30.expense > 0;
  $('#subtitle').textContent = hasIncome ? `Bugun: ${prettyDate(fc.today)}` : "Birinchi yozuvingizni qo'shing — prognoz shu yerda paydo bo'ladi.";
}

// ---------- Yozuvlar ----------
function renderTransactions({ transactions, total }) {
  const box = $('#tx-list');
  if (!total) {
    box.innerHTML = `
      <div class="empty">
        <h3>Hozircha yozuv yo'q</h3>
        <p>Kunlik savdo va xarajatni yuqoridagi formadan kiriting yoki CSV fayl yuklang.<br>Finodex qanday ishlashini ko'rmoqchi bo'lsangiz, sinov uchun namuna ma'lumot qo'shing.</p>
        <button class="btn btn-ghost" id="sample-btn" type="button">Namuna ma'lumot qo'shish</button>
      </div>`;
    $('#sample-btn').addEventListener('click', addSample);
    return;
  }
  const rows = transactions
    .map((t) => `
      <tr>
        <td>${esc(prettyDate(t.date))} ${esc(t.date.slice(0, 4))}</td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.note)}</td>
        <td class="num ${t.type === 'income' ? 'amt-in' : 'amt-out'}">${t.type === 'income' ? '+' : '−'}${fmt(t.amount)}</td>
        <td class="num"><button class="btn-danger-link" data-del="${t.id}" type="button" aria-label="O'chirish">O'chirish</button></td>
      </tr>`)
    .join('');
  box.innerHTML = `
    <div class="table-wrap">
      <table class="tx">
        <thead><tr><th>Sana</th><th>Toifa</th><th>Izoh</th><th class="num">Summa (so'm)</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted">${total > transactions.length ? `Oxirgi ${transactions.length} ta yozuv ko'rsatilmoqda (jami ${total} ta).` : `Jami ${total} ta yozuv.`}</p>`;
}

// ---------- Doimiy to'lovlar ----------
function renderRecurring(list) {
  const ul = $('#rec-list');
  if (!list.length) {
    ul.innerHTML = `<li><span class="muted">Hali qo'shilmagan. Ijara, ish haqi, soliq va kredit sanasini qo'shsangiz, prognoz ancha aniqlashadi.</span></li>`;
    return;
  }
  ul.innerHTML = list
    .map((r) => `
      <li>
        <span><span class="day">har oy ${r.day_of_month}-kuni</span> ${esc(r.title)}</span>
        <span>
          <span class="${r.type === 'income' ? 'amt-in' : 'amt-out'}">${r.type === 'income' ? '+' : '−'}${fmt(r.amount)}</span>
          <button class="btn-danger-link" data-del-rec="${r.id}" type="button" aria-label="${esc(r.title)} to'lovini o'chirish">O'chirish</button>
        </span>
      </li>`)
    .join('');
}

// ---------- Hodisalar ----------
document.addEventListener('click', async (e) => {
  const delTx = e.target.closest('[data-del]');
  const delRec = e.target.closest('[data-del-rec]');
  try {
    if (delTx) {
      if (!confirm("Bu yozuvni o'chirasizmi?")) return;
      await api(`/api/transactions/${delTx.dataset.del}`, { method: 'DELETE' });
      await refreshAll();
      toast("Yozuv o'chirildi");
    } else if (delRec) {
      if (!confirm("Bu doimiy to'lovni o'chirasizmi?")) return;
      await api(`/api/recurring/${delRec.dataset.delRec}`, { method: 'DELETE' });
      await refreshAll();
      toast("To'lov o'chirildi");
    }
  } catch (err) {
    toast(err.message, true);
  }
});

document.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', fillCategories));
$('#tx-category').addEventListener('change', updateHint);

$('#tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setErr('#tx-error', '');
  const body = {
    type: $('input[name="type"]:checked').value,
    amount: parseAmount($('#tx-amount').value),
    date: $('#tx-date').value,
    category: $('#tx-category').value,
    note: $('#tx-note').value,
  };
  if (!Number.isFinite(body.amount) || body.amount <= 0) return setErr('#tx-error', 'Summani musbat son bilan kiriting.');
  if (!body.date) return setErr('#tx-error', 'Sanani tanlang.');
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await api('/api/transactions', { method: 'POST', body });
    $('#tx-amount').value = '';
    $('#tx-note').value = '';
    await refreshAll();
    toast("Yozuv qo'shildi");
  } catch (err) {
    setErr('#tx-error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#rec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setErr('#rec-error', '');
  const body = {
    title: $('#rec-title').value,
    amount: parseAmount($('#rec-amount').value),
    dayOfMonth: Number($('#rec-day').value),
    type: $('#rec-type').value,
  };
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await api('/api/recurring', { method: 'POST', body });
    e.target.reset();
    await refreshAll();
    toast("Doimiy to'lov qo'shildi");
  } catch (err) {
    setErr('#rec-error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
});

$('#adjust-balance').addEventListener('click', async () => {
  const me = await api('/api/auth/me');
  const input = prompt("Boshlang'ich qoldiq (so'm). Bu — yozuvlar kiritilishidan oldingi kassa va bank qoldig'i:", String(me.user.openingBalance));
  if (input === null) return;
  const v = parseAmount(input);
  if (!Number.isFinite(v)) return toast('Raqam kiriting.', true);
  try {
    await api('/api/auth/opening-balance', { method: 'PATCH', body: { openingBalance: v } });
    await refreshAll();
    toast('Qoldiq yangilandi');
  } catch (err) {
    toast(err.message, true);
  }
});

async function addSample() {
  try {
    await api('/api/sample-data', { method: 'POST' });
    await refreshAll();
    toast("Namuna ma'lumot qo'shildi. Uni o'chirib, o'zingiznikini kiritishingiz mumkin.");
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- CSV ----------
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normDate(s) {
  s = String(s || '').trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("Faylda sarlavha va kamida bitta qator bo'lishi kerak.");
  const delim = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const head = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const find = (names) => head.findIndex((h) => names.includes(h));
  const idx = {
    date: find(['sana', 'date']),
    type: find(['turi', 'type']),
    amount: find(['summa', 'amount']),
    category: find(['toifa', 'category']),
    note: find(['izoh', 'note']),
  };
  if (idx.date < 0 || idx.type < 0 || idx.amount < 0) {
    throw new Error('Sarlavhada kamida "sana, turi, summa" ustunlari bo\'lishi kerak. "CSV namunasi" tugmasini bosing.');
  }
  return lines.slice(1).map((line) => {
    const c = splitCsvLine(line, delim);
    return {
      date: normDate(c[idx.date]),
      type: c[idx.type],
      amount: c[idx.amount],
      category: idx.category >= 0 ? c[idx.category] : '',
      note: idx.note >= 0 ? c[idx.note] : '',
    };
  });
}

$('#csv-btn').addEventListener('click', () => $('#csv-file').click());
$('#csv-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const rows = parseCsv(await file.text());
    const r = await api('/api/transactions/import', { method: 'POST', body: { rows } });
    await refreshAll();
    toast(`${r.imported} ta yozuv yuklandi` + (r.skipped ? `, ${r.skipped} tasi o'tkazib yuborildi. ${r.errors[0] || ''}` : ''), r.imported === 0);
  } catch (err) {
    toast(err.message, true);
  }
});

$('#csv-template').addEventListener('click', () => {
  const csv = 'sana,turi,summa,toifa,izoh\n2026-09-01,kirim,2500000,Savdo,Kunlik tushum\n2026-09-01,chiqim,900000,Tovar xaridi,Yetkazib beruvchi\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'finodex-namuna.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

init();
