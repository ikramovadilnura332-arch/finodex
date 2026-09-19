require('dotenv').config({ quiet: true });
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const { buildForecast } = require('./forecast');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- JWT secret: .env dan yoki data/secret.key faylidan ----------
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(__dirname, 'data', 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}
const JWT_SECRET = loadSecret();

// ---------- Konstantalar ----------
const BUSINESS_TYPES = ["Do'kon", 'Dorixona', 'Kafe / restoran', 'Xizmat ko\'rsatish', 'Boshqa'];
const CATEGORIES = {
  income: ['Savdo', 'Xizmat', 'Boshqa kirim'],
  expense: ['Tovar xaridi', 'Ijara', 'Ish haqi', 'Soliq', 'Kommunal', 'Kredit', 'Reklama', 'Boshqa chiqim'],
};
const MAX_AMOUNT = 1e13;

// Toshkent vaqti (UTC+5)
const todayTashkent = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- Auth yordamchilari ----------
function setSession(res, userId) {
  const token = jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('fd_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function requireAuth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.fd_token || '', JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    if (!user) throw new Error('no user');
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Avval tizimga kiring.' });
  }
}

const publicUser = (u) => {
  const trialDaysLeft = Math.max(0, Math.ceil((Date.parse(u.trial_ends) - Date.now()) / 86400000));
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    businessName: u.business_name,
    businessType: u.business_type,
    openingBalance: u.opening_balance,
    trialDaysLeft,
  };
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
});

// ---------- Auth marshrutlari ----------
app.post('/api/auth/register', authLimiter, (req, res) => {
  const b = req.body || {};
  const name = cleanText(b.name, 80);
  const businessName = cleanText(b.businessName, 100);
  const businessType = BUSINESS_TYPES.includes(b.businessType) ? b.businessType : 'Boshqa';
  const email = cleanText(b.email, 120).toLowerCase();
  const password = String(b.password || '');
  const opening = Number(b.openingBalance || 0);

  if (name.length < 2) return res.status(400).json({ error: 'Ismingizni kiriting.' });
  if (businessName.length < 2) return res.status(400).json({ error: 'Biznes nomini kiriting.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: "Email manzili noto'g'ri." });
  if (password.length < 8) return res.status(400).json({ error: "Parol kamida 8 belgidan iborat bo'lsin." });
  if (!Number.isFinite(opening) || opening < -MAX_AMOUNT || opening > MAX_AMOUNT) return res.status(400).json({ error: "Boshlang'ich qoldiq noto'g'ri." });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: "Bu email bilan ro'yxatdan o'tilgan. Tizimga kiring." });
  }

  const hash = bcrypt.hashSync(password, 11);
  const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString();
  const info = db
    .prepare('INSERT INTO users (email, name, business_name, business_type, password_hash, opening_balance, trial_ends) VALUES (?,?,?,?,?,?,?)')
    .run(email, name, businessName, businessType, hash, opening, trialEnds);

  setSession(res, info.lastInsertRowid);
  res.status(201).json({ ok: true });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const email = cleanText(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Vaqt bo'yicha farqni kamaytirish uchun har doim hash solishtiriladi
  const ok = bcrypt.compareSync(password, user ? user.password_hash : '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok) return res.status(401).json({ error: "Email yoki parol noto'g'ri." });
  setSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('fd_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), categories: CATEGORIES });
});

app.patch('/api/auth/opening-balance', requireAuth, (req, res) => {
  const v = Number(req.body?.openingBalance);
  if (!Number.isFinite(v) || Math.abs(v) > MAX_AMOUNT) return res.status(400).json({ error: "Qoldiq noto'g'ri." });
  db.prepare('UPDATE users SET opening_balance = ? WHERE id = ?').run(v, req.user.id);
  res.json({ ok: true });
});

// ---------- Tranzaksiyalar ----------
function validateTx(b) {
  const type = b.type;
  if (!['income', 'expense'].includes(type)) return { error: "Turi noto'g'ri (kirim yoki chiqim)." };
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return { error: "Summa musbat son bo'lishi kerak." };
  if (!isValidDate(b.date)) return { error: "Sana noto'g'ri (YYYY-MM-DD)." };
  const category = CATEGORIES[type].includes(b.category) ? b.category : type === 'income' ? 'Boshqa kirim' : 'Boshqa chiqim';
  return { value: { type, amount, date: b.date, category, note: cleanText(b.note, 200) } };
}

app.get('/api/transactions', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const rows = db
    .prepare('SELECT id, type, amount, category, note, date FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT ?')
    .all(req.user.id, limit);
  const total = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ?').get(req.user.id).c;
  res.json({ transactions: rows, total });
});

app.post('/api/transactions', requireAuth, (req, res) => {
  const v = validateTx(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const t = v.value;
  const info = db
    .prepare('INSERT INTO transactions (user_id, type, amount, category, note, date) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, t.type, t.amount, t.category, t.note, t.date);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/transactions/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Topilmadi.' });
  res.json({ ok: true });
});

// CSV import: brauzer CSV ni o'qib, qatorlarni shu yerga yuboradi
const TYPE_ALIASES = { kirim: 'income', income: 'income', daromad: 'income', chiqim: 'expense', expense: 'expense', xarajat: 'expense' };
app.post('/api/transactions/import', requireAuth, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: "Faylda qator topilmadi." });
  if (rows.length > 5000) return res.status(400).json({ error: 'Bir martada 5000 tadan ko\'p qator yuklab bo\'lmaydi.' });

  const insert = db.prepare('INSERT INTO transactions (user_id, type, amount, category, note, date) VALUES (?,?,?,?,?,?)');
  let imported = 0;
  const errors = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      const type = TYPE_ALIASES[String(r.type || '').toLowerCase().trim()];
      const v = validateTx({ ...r, type, amount: String(r.amount ?? '').replace(/[\s,]/g, '') });
      if (v.error) {
        if (errors.length < 5) errors.push(`${i + 2}-qator: ${v.error}`);
        return;
      }
      const t = v.value;
      insert.run(req.user.id, t.type, t.amount, t.category, t.note, t.date);
      imported++;
    });
  })();
  res.json({ imported, skipped: rows.length - imported, errors });
});

// ---------- Doimiy to'lovlar ----------
app.get('/api/recurring', requireAuth, (req, res) => {
  res.json({ recurring: db.prepare('SELECT id, title, type, amount, day_of_month FROM recurring WHERE user_id = ? ORDER BY day_of_month').all(req.user.id) });
});

app.post('/api/recurring', requireAuth, (req, res) => {
  const b = req.body || {};
  const title = cleanText(b.title, 60);
  const type = ['income', 'expense'].includes(b.type) ? b.type : 'expense';
  const amount = Number(b.amount);
  const day = Number(b.dayOfMonth);
  if (title.length < 2) return res.status(400).json({ error: "Nomini kiriting (masalan: Ijara)." });
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return res.status(400).json({ error: "Summa musbat son bo'lishi kerak." });
  if (!Number.isInteger(day) || day < 1 || day > 31) return res.status(400).json({ error: "Oy kuni 1 dan 31 gacha bo'lsin." });
  const info = db.prepare('INSERT INTO recurring (user_id, title, type, amount, day_of_month) VALUES (?,?,?,?,?)').run(req.user.id, title, type, amount, day);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/recurring/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  if (!r.changes) return res.status(404).json({ error: 'Topilmadi.' });
  res.json({ ok: true });
});

// ---------- Prognoz ----------
app.get('/api/forecast', requireAuth, (req, res) => {
  const txs = db.prepare('SELECT type, amount, category, date FROM transactions WHERE user_id = ?').all(req.user.id);
  const recurring = db.prepare('SELECT title, type, amount, day_of_month FROM recurring WHERE user_id = ?').all(req.user.id);
  const result = buildForecast({
    opening: req.user.opening_balance,
    txs,
    recurring,
    today: todayTashkent(),
    horizon: 60,
  });
  res.json(result);
});

// ---------- Sinov uchun namuna ma'lumot (faqat o'z hisobingizga) ----------
app.post('/api/sample-data', requireAuth, (req, res) => {
  const has = db.prepare('SELECT COUNT(*) c FROM transactions WHERE user_id = ?').get(req.user.id).c;
  if (has > 0) return res.status(409).json({ error: "Hisobingizda allaqachon ma'lumot bor." });

  const today = todayTashkent();
  const dayMs = 86400000;
  const ins = db.prepare('INSERT INTO transactions (user_id, type, amount, category, note, date) VALUES (?,?,?,?,?,?)');
  const weekdayFactor = [0.8, 0.9, 0.9, 1.0, 1.0, 1.35, 1.5]; // yakshanba..shanba
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  db.transaction(() => {
    for (let i = 89; i >= 1; i--) {
      const d = new Date(Date.parse(today + 'T00:00:00Z') - i * dayMs);
      const date = d.toISOString().slice(0, 10);
      const wd = d.getUTCDay();
      const decline = i <= 28 ? 0.9 : 1; // oxirgi oyda savdo biroz pasaygan
      const sales = Math.round((2_400_000 * weekdayFactor[wd] * decline * (0.85 + rnd() * 0.3)) / 1000) * 1000;
      ins.run(req.user.id, 'income', sales, 'Savdo', 'Kunlik tushum', date);
      if (wd === 2 || wd === 5) {
        const goods = Math.round((6_300_000 * (0.8 + rnd() * 0.4)) / 1000) * 1000;
        ins.run(req.user.id, 'expense', goods, 'Tovar xaridi', 'Yetkazib beruvchidan', date);
      }
      if (d.getUTCDate() === 5) ins.run(req.user.id, 'expense', 4_500_000, 'Ijara', 'Oylik ijara', date);
      if (d.getUTCDate() === 25) ins.run(req.user.id, 'expense', 6_000_000, 'Ish haqi', 'Xodimlar maoshi', date);
      if (d.getUTCDate() === 12) ins.run(req.user.id, 'expense', 900_000, 'Kommunal', 'Elektr, suv, internet', date);
    }
    db.prepare('INSERT INTO recurring (user_id, title, type, amount, day_of_month) VALUES (?,?,?,?,?)').run(req.user.id, 'Ijara', 'expense', 4_500_000, 5);
    db.prepare('INSERT INTO recurring (user_id, title, type, amount, day_of_month) VALUES (?,?,?,?,?)').run(req.user.id, 'Ish haqi', 'expense', 6_000_000, 25);
  })();
  res.json({ ok: true });
});

// ---------- Sahifalar va xatolar ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Topilmadi.' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api')) return res.status(err.status || 500).json({ error: 'Server xatosi. Qayta urinib ko\'ring.' });
  res.status(500).send('Server xatosi');
});

app.listen(PORT, () => console.log(`Finodex ishga tushdi: http://localhost:${PORT}`));
