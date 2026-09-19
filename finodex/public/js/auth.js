// Kirish va ro'yxatdan o'tish formalari
const errBox = $('#form-error');

function showError(msg) {
  errBox.textContent = msg;
  errBox.scrollIntoView({ block: 'nearest' });
}

// Kirgan bo'lsa, to'g'ridan-to'g'ri kabinetga
api('/api/auth/me').then(() => { location.href = '/dashboard'; }).catch(() => {});

async function submitForm(form, url, getBody, validate) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const body = getBody();
    const problem = validate(body);
    if (problem) return showError(problem);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body });
      location.href = '/dashboard';
    } catch (err) {
      showError(err.message);
      btn.disabled = false;
    }
  });
}

const loginForm = $('#login-form');
if (loginForm) {
  submitForm(
    loginForm,
    '/api/auth/login',
    () => ({ email: $('#email').value.trim(), password: $('#password').value }),
    (b) => (!b.email || !b.password ? 'Email va parolni kiriting.' : '')
  );
}

const regForm = $('#register-form');
if (regForm) {
  submitForm(
    regForm,
    '/api/auth/register',
    () => ({
      name: $('#name').value.trim(),
      businessName: $('#businessName').value.trim(),
      businessType: $('#businessType').value,
      email: $('#email').value.trim(),
      password: $('#password').value,
      openingBalance: Number(($('#openingBalance').value || '0').replace(/[\s,]/g, '')),
    }),
    (b) => {
      if (b.name.length < 2) return 'Ismingizni kiriting.';
      if (b.businessName.length < 2) return 'Biznes nomini kiriting.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email)) return "Email manzili noto'g'ri.";
      if (b.password.length < 8) return "Parol kamida 8 belgidan iborat bo'lsin.";
      if (!Number.isFinite(b.openingBalance)) return "Qoldiqni raqam bilan kiriting (masalan: 15000000).";
      return '';
    }
  );
}
