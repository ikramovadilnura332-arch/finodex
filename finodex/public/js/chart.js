// Kassa prognozi grafigi (tashqi kutubxonasiz, sof SVG)
const SHORT_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

function axisMoney(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(1).replace(/\.0$/, '') + ' mln';
  if (a >= 1e3) return sign + Math.round(a / 1e3) + ' ming';
  return sign + Math.round(a);
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-6; t += step) ticks.push(t);
  return ticks;
}

function renderForecastChart(box, tip, series) {
  const W = 860, H = 340, ml = 66, mr = 16, mt = 16, mb = 34;
  const iw = W - ml - mr, ih = H - mt - mb;
  const values = series.map((p) => p.balance);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  const pad = (max - min || 1) * 0.08;
  if (min < 0) min -= pad;
  max += pad;

  const x = (i) => ml + (i / (series.length - 1)) * iw;
  const y = (v) => mt + ((max - v) / (max - min)) * ih;
  const zeroY = y(0);

  const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ');
  const firstNeg = series.findIndex((p) => p.balance < 0);

  let grid = '';
  for (const t of niceTicks(min, max)) {
    grid += `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}" stroke="#d9e0dc" stroke-width="1"/>` +
            `<text x="${ml - 8}" y="${y(t) + 4}" text-anchor="end" font-size="12" fill="#4a5d68">${axisMoney(t)}</text>`;
  }
  let xl = '';
  for (let i = 0; i < series.length; i += 10) {
    const d = series[i].date;
    xl += `<text x="${x(i)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="12" fill="#4a5d68">${i === 0 ? 'Bugun' : Number(d.slice(8)) + '-' + SHORT_MONTHS[Number(d.slice(5, 7)) - 1]}</text>`;
  }

  const negZone = min < 0
    ? `<rect x="${ml}" y="${zeroY}" width="${iw}" height="${mt + ih - zeroY}" fill="url(#hatch2)"/>`
    : '';
  const marker = firstNeg > 0
    ? `<circle cx="${x(firstNeg)}" cy="${y(series[firstNeg].balance)}" r="6" fill="#d64933" stroke="#fff" stroke-width="2.5"/>`
    : '';

  box.querySelector('svg')?.remove();
  box.insertAdjacentHTML('afterbegin', `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="60 kunlik kassa qoldig'i prognozi grafigi">
      <defs>
        <pattern id="hatch2" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#fbe3de"/><line x1="0" y1="0" x2="0" y2="8" stroke="#d64933" stroke-width="1.3" opacity=".5"/>
        </pattern>
        <clipPath id="clip-pos"><rect x="${ml}" y="${mt}" width="${iw}" height="${Math.max(0, zeroY - mt)}"/></clipPath>
        <clipPath id="clip-neg"><rect x="${ml}" y="${zeroY}" width="${iw}" height="${Math.max(0, mt + ih - zeroY)}"/></clipPath>
      </defs>
      ${grid}
      ${negZone}
      <line x1="${ml}" x2="${W - mr}" y1="${zeroY}" y2="${zeroY}" stroke="#10232e" stroke-width="1.5"/>
      <path d="${line}" fill="none" stroke="#0e7c86" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#clip-pos)"/>
      <path d="${line}" fill="none" stroke="#d64933" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#clip-neg)"/>
      ${marker}
      ${xl}
      <line id="guide" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="#10232e" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
      <circle id="guide-dot" r="5" fill="#10232e" stroke="#fff" stroke-width="2" visibility="hidden"/>
      <rect id="hit" x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>`);

  const svg = box.querySelector('svg');
  const guide = svg.querySelector('#guide');
  const dot = svg.querySelector('#guide-dot');
  const hit = svg.querySelector('#hit');

  function show(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - ml) / iw) * (series.length - 1))));
    const p = series[i];
    guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.balance));
    guide.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
    tip.textContent = `${prettyDate(p.date)}: ${p.balance < 0 ? '−' : ''}${fmtSom(Math.abs(p.balance))}`;
    tip.style.display = 'block';
    tip.style.left = (x(i) / W) * rect.width + 'px';
    tip.style.top = (y(p.balance) / H) * rect.height + 'px';
  }
  function hide() {
    guide.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden');
    tip.style.display = 'none';
  }
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}
