// Umumiy yordamchilar
const $ = (sel, root = document) => root.querySelector(sel);

async function api(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* bo'sh javob */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Xatolik yuz berdi.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const nf = new Intl.NumberFormat('en-US');
const fmt = (n) => nf.format(Math.round(n)).replace(/,/g, ' ');
const fmtSom = (n) => fmt(n) + " so'm";
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const prettyDate = (s) => `${Number(s.slice(8))}-${MONTHS[Number(s.slice(5, 7)) - 1]}`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}
