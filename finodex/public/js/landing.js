document.getElementById('year').textContent = new Date().getFullYear();

// Agar foydalanuvchi allaqachon kirgan bo'lsa, navigatsiyada "Kabinet" ko'rsatiladi
fetch('/api/auth/me')
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => {
    if (!data) return;
    const box = document.getElementById('nav-actions');
    box.innerHTML = '<a class="btn btn-primary btn-small" href="/dashboard">Kabinetga o\'tish</a>';
  })
  .catch(() => {});
