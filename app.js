// NazzGab Bikes storefront.
//
// The browser keeps the basket locally and NEVER calculates money: it sends the
// basket to the API and displays whatever the COBOL backend returns.
// If there is no API (GitHub Pages, or index.html opened directly) it shows a
// labelled browser-only preview with checkout disabled.

const peso = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
const $ = id => document.getElementById(id);
const STORE_KEY = 'nazzgab-bikes-basket';

// Used ONLY by the browser-only preview, when the API is not reachable.
// (The real catalogue lives in server.js.)  [id, name, category, priceCents, stock]
const PREVIEW_ROWS = [
  ['roadster-pro', 'Roadster Pro 700c', 'Road', 3850000, 8],
  ['aero-carbon-r9', 'Aero Carbon R9', 'Road', 8990000, 3],
  ['trailblazer-29', 'Trailblazer 29er', 'Mountain', 4290000, 6],
  ['summit-full-sus', 'Summit Full-Sus 27.5', 'Mountain', 7650000, 4],
  ['cityline-commuter', 'Cityline Commuter', 'City', 1890000, 12],
  ['foldie-compact', 'Foldie Compact 20in', 'City', 2350000, 9],
  ['voltride-e-city', 'Voltride E-City', 'Electric', 6990000, 5],
  ['e-trail-mid-drive', 'E-Trail Mid-Drive', 'Electric', 12490000, 2],
  ['aero-helmet', 'Aero Helmet', 'Gear', 285000, 25],
  ['led-light-set', 'LED Light Set (F+R)', 'Gear', 125000, 40],
  ['u-lock', 'Heavy-Duty U-Lock', 'Gear', 165000, 30],
  ['padded-gloves', 'Padded Gloves', 'Gear', 89000, 35],
  ['inner-tube-700c', 'Inner Tube 700c', 'Parts', 28000, 90],
  ['chain-lube', 'Chain Lube 120ml', 'Parts', 42000, 60],
  ['floor-pump', 'Floor Pump w/ Gauge', 'Parts', 148000, 20],
  ['disc-brake-pads', 'Disc Brake Pads', 'Parts', 75000, 45],
];

const state = {
  products: [],
  preview: false,
  category: 'All',
  search: '',
  sort: 'featured',
  cart: new Map(),     // id -> quantity in the basket
  pending: new Map(),  // id -> quantity chosen on the product card
  promo: '',
  quote: null,         // last good answer from COBOL
  error: null,
};

const SORTS = {
  'price-asc': (a, b) => a.priceCents - b.priceCents,
  'price-desc': (a, b) => b.priceCents - a.priceCents,
  name: (a, b) => a.name.localeCompare(b.name),
};

// ---------- tiny DOM helper -------------------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

// ---------- basket kept in this browser (survives a page refresh) --------
function saveBasket() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ items: [...state.cart], promo: state.promo })); } catch { /* storage may be blocked */ }
}

function restoreBasket() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!saved) return;
    for (const [id, qty] of saved.items || []) {
      if (state.products.some(p => p.id === id) && Number.isInteger(qty) && qty > 0) state.cart.set(id, qty);
    }
    state.promo = typeof saved.promo === 'string' ? saved.promo.slice(0, 12) : '';
    $('promo').value = state.promo;
  } catch { /* ignore a corrupted or blocked store */ }
}

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- artwork: original SVG illustrations, one per product ----------
// Drawn in code (no image files), so they stay sharp on every screen and load instantly.
const BG = { Road: '#dfe9e3', Mountain: '#f3e1d2', City: '#e6e2f1', Electric: '#fbefc9', Gear: '#f6e3d6', Parts: '#e3e9ee' };
const INK = '#1c2b25';
const SHADOW = w => `<ellipse cx="120" cy="141" rx="${w}" ry="4.5" fill="#000" opacity=".09"/>`;
const pt = (cx, cy, rad, deg) => [cx + rad * Math.cos(deg * Math.PI / 180), cy + rad * Math.sin(deg * Math.PI / 180)];
const arc = (cx, cy, rad, d1, d2) => {
  const [x1, y1] = pt(cx, cy, rad, d1), [x2, y2] = pt(cx, cy, rad, d2);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${rad} ${rad} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};

function wheel(cx, cy, r, o = {}) {
  const tire = o.tire || 4, rimW = o.rimW || 2;
  let spokes = '';
  for (let i = 0; i < 12; i++) {
    const [x, y] = pt(cx, cy, r - tire / 2 - 2, i * 30);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#aeb7b2" stroke-width=".9"/>`;
  }
  const knobs = o.knobby
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="${tire + 3}" stroke-dasharray="2.2 2.6" opacity=".5"/>` : '';
  return `${knobs}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="${tire}"/>
    <circle cx="${cx}" cy="${cy}" r="${r - tire / 2 - 1.5}" fill="none" stroke="${o.rim || '#9aa5a0'}" stroke-width="${rimW}"/>
    ${spokes}<circle cx="${cx}" cy="${cy}" r="3.4" fill="${INK}"/>`;
}

// Diamond-frame bike (road, mountain, city, electric). Options pick the details.
function bike(o) {
  const c = o.color, a = o.accent || '#e8590c', r = o.r || 37, fw = o.fw || 5;
  const R = [56, 100], F = [184, 100], BB = [112, 102], ST = [97, 56], HT = [160, 50], HB = [165, 63];
  const P = p => p.join(' ');
  let s = SHADOW(86);
  s += wheel(R[0], R[1], r, o.wheel) + wheel(F[0], F[1], r, o.wheel);

  if (o.fenders) {
    s += `<path d="${arc(R[0], R[1], r + 5, -165, -25)}" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>
          <path d="${arc(F[0], F[1], r + 5, -155, -15)}" fill="none" stroke="${a}" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  if (o.rack) s += `<path d="M38 63 H82 M45 63 L56 100" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;

  // chain and chainring
  s += `<path d="M${BB[0]} ${BB[1] - 11} L${R[0]} ${R[1] - 4} M${BB[0]} ${BB[1] + 11} L${R[0]} ${R[1] + 4}" stroke="${INK}" stroke-width="1.6" opacity=".55" fill="none"/>
        <circle cx="${R[0]}" cy="${R[1]}" r="6" fill="none" stroke="${INK}" stroke-width="2" opacity=".5"/>`;

  // frame: chainstay + seat tube + seatstay, then down tube + head tube + top tube
  s += `<g fill="none" stroke="${c}" stroke-width="${fw}" stroke-linecap="round" stroke-linejoin="round">
          <path d="M${P(R)} L${P(BB)} L${P(ST)} Z"/>
          <path d="M${P(BB)} L${P(HB)} L${P(HT)} L${P(ST)}"/>
          <path d="M${HT[0]} ${HT[1] - 1} L${HB[0] + 1} ${HB[1] + 1}" stroke-width="${fw + 4}"/>
        </g>`;

  if (o.susp === 'full') {
    s += `<line x1="103" y1="66" x2="86" y2="95" stroke="${a}" stroke-width="7" stroke-linecap="round"/>
          <line x1="103" y1="66" x2="86" y2="95" stroke="${INK}" stroke-width="2" stroke-dasharray="2 2.4"/>
          <circle cx="100" cy="71" r="2.6" fill="${INK}"/>`;
  }
  // fork
  if (o.susp) {
    s += `<line x1="${HT[0] + 1}" y1="${HT[1] + 4}" x2="176" y2="84" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
          <line x1="176" y1="84" x2="${F[0]}" y2="${F[1]}" stroke="${a}" stroke-width="5" stroke-linecap="round"/>`;
  } else {
    s += `<path d="M${HT[0] + 1} ${HT[1] + 4} L${F[0]} ${F[1]}" stroke="${o.forkColor || c}" stroke-width="${fw - 1}" stroke-linecap="round" fill="none"/>`;
  }

  // battery and motor (electric bikes)
  if (o.battery) {
    s += `<g transform="translate(138 83) rotate(-36)"><rect x="-19" y="-6" width="38" height="12" rx="5" fill="${INK}"/>
          <rect x="-13" y="-2" width="14" height="4" rx="2" fill="#6be08f"/></g>`;
  }
  if (o.motor === 'bb') s += `<circle cx="${BB[0]}" cy="${BB[1]}" r="9" fill="${a}" stroke="${INK}" stroke-width="2.5"/>`;
  if (o.motor === 'hub') s += `<circle cx="${R[0]}" cy="${R[1]}" r="8" fill="${a}" stroke="${INK}" stroke-width="2.5"/>`;
  if (o.bottle) s += `<rect x="106" y="68" width="7.5" height="15" rx="3" fill="${a}" transform="rotate(14 110 76)"/>`;

  // crank
  s += `<circle cx="${BB[0]}" cy="${BB[1]}" r="11" fill="none" stroke="${INK}" stroke-width="2.4"/>
        <circle cx="${BB[0]}" cy="${BB[1]}" r="3.5" fill="${INK}"/>
        <line x1="${BB[0]}" y1="${BB[1]}" x2="${BB[0] - 7}" y2="${BB[1] + 15}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <rect x="${BB[0] - 15}" y="${BB[1] + 13}" width="15" height="4" rx="2" fill="${INK}"/>`;

  // seatpost + saddle
  s += `<line x1="${ST[0]}" y1="${ST[1]}" x2="${ST[0] - 1.5}" y2="${ST[1] - 13}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <rect x="${ST[0] - 17}" y="${ST[1] - 19}" width="29" height="7" rx="3.5" fill="${INK}"/>`;

  // handlebars
  const stem = (x, y) => `<path d="M${HT[0] - 1} ${HT[1] - 4} L${x} ${y}" stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  if (o.bars === 'drop') {
    s += stem(165, 41) + `<path d="M165 41 H176 q9 0 9 9 q0 7 -7 8" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  } else if (o.bars === 'upright') {
    s += stem(152, 30) + `<path d="M141 30 Q152 22 164 28" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
          <path d="M141 30 L146 27 M160 26 L164 28" stroke="${a}" stroke-width="6" stroke-linecap="round"/>`;
  } else {
    s += stem(160, 38) + `<path d="M149 38 H173" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
          <path d="M148 38 H155 M167 38 H174" stroke="${a}" stroke-width="6" stroke-linecap="round"/>`;
  }
  if (o.basket) {
    s += `<g fill="none" stroke="${a}" stroke-width="2.4" stroke-linecap="round">
            <path d="M166 24 H198 L194 44 H170 Z"/><path d="M175 24 V44 M184 24 V44 M192 24 V44 M168 34 H196"/></g>`;
  }
  return s;
}

// Folding bike: small wheels, a hinge in the frame and a tall handlepost.
function folding(o) {
  const c = o.color, a = o.accent, R = [76, 112], F = [172, 112], r = 26;
  return `${SHADOW(80)}${wheel(R[0], R[1], r, { tire: 4.5 })}${wheel(F[0], F[1], r, { tire: 4.5 })}
    <path d="${arc(R[0], R[1], r + 4, -160, -30)}" fill="none" stroke="${a}" stroke-width="3" stroke-linecap="round"/>
    <path d="M${R[0]} ${R[1]} L112 100 L146 66 M112 100 L100 62 M146 66 L${F[0]} ${F[1]}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="129" cy="83" r="6" fill="${a}" stroke="${INK}" stroke-width="2"/>
    <line x1="148" y1="62" x2="150" y2="26" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M139 26 H162" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M138 26 H145 M157 26 H163" stroke="${a}" stroke-width="6" stroke-linecap="round"/>
    <line x1="100" y1="62" x2="99" y2="49" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <rect x="85" y="43" width="28" height="7" rx="3.5" fill="${INK}"/>
    <path d="M112 91 L${R[0]} ${R[1] - 4} M112 109 L${R[0]} ${R[1] + 4}" stroke="${INK}" stroke-width="1.5" opacity=".55" fill="none"/>
    <circle cx="112" cy="100" r="9" fill="none" stroke="${INK}" stroke-width="2.4"/><circle cx="112" cy="100" r="3" fill="${INK}"/>
    <line x1="112" y1="100" x2="106" y2="113" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <rect x="95" y="111" width="14" height="4" rx="2" fill="${INK}"/>`;
}

// ----- gear -----
const helmet = () => `${SHADOW(66)}
  <path d="M56 100 C54 56 86 32 122 32 C160 32 188 58 188 100 Z" fill="#e8590c"/>
  <path d="M84 70 Q92 50 110 44 M112 66 Q118 50 132 46 M140 68 Q148 54 162 54" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".85"/>
  <path d="M150 99 H198 Q203 99 200 104 Q190 113 150 109 Z" fill="${INK}"/>
  <rect x="50" y="98" width="142" height="9" rx="4.5" fill="${INK}"/>
  <path d="M86 107 Q82 128 98 133 M152 107 Q158 128 142 133 M98 133 H142" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <rect x="109" y="127" width="22" height="11" rx="3" fill="#c9d1cc" stroke="${INK}" stroke-width="2"/>`;

const lights = () => `${SHADOW(90)}
  <path d="M30 58 L8 48 M30 72 L6 72 M30 86 L8 96" stroke="#ffb703" stroke-width="3" stroke-linecap="round"/>
  <rect x="34" y="52" width="68" height="42" rx="13" fill="${INK}"/>
  <circle cx="68" cy="73" r="15" fill="#ffd24a"/><circle cx="68" cy="73" r="7.5" fill="#fff4c2"/>
  <rect x="58" y="94" width="20" height="11" rx="3" fill="#667269"/><rect x="52" y="104" width="32" height="7" rx="3.5" fill="${INK}"/>
  <rect x="138" y="58" width="64" height="36" rx="12" fill="#b3261e"/>
  <rect x="148" y="66" width="44" height="20" rx="7" fill="#ff6b5e"/><circle cx="170" cy="76" r="3.6" fill="#fff"/>
  <rect x="160" y="94" width="20" height="11" rx="3" fill="#667269"/><rect x="154" y="104" width="32" height="7" rx="3.5" fill="${INK}"/>
  <path d="M212 66 q9 10 0 20" fill="none" stroke="#e24b3f" stroke-width="3" stroke-linecap="round"/>`;

const ulock = () => `${SHADOW(70)}
  <path d="M84 98 V64 a36 36 0 0 1 72 0 V98" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
  <path d="M84 98 V64 a36 36 0 0 1 72 0 V98" fill="none" stroke="#667269" stroke-width="3" stroke-linecap="round" opacity=".7" transform="translate(-3 -1)"/>
  <rect x="62" y="94" width="116" height="42" rx="11" fill="#1f5c46"/>
  <rect x="72" y="101" width="96" height="9" rx="4.5" fill="#fff" opacity=".18"/>
  <circle cx="120" cy="118" r="7.5" fill="${INK}"/><path d="M116.5 120 h7 l2 11 h-11z" fill="${INK}"/>`;

const gloves = () => `${SHADOW(60)}
  ${[0, 1, 2, 3].map(i => `<rect x="${82 + i * 19}" y="${[44, 36, 38, 48][i]}" width="17" height="${[40, 48, 46, 38][i] + 12}" rx="8.5" fill="#e8590c"/>`).join('')}
  <rect x="56" y="84" width="17" height="46" rx="8.5" fill="#e8590c" transform="rotate(-28 64 106)"/>
  <rect x="80" y="72" width="78" height="56" rx="17" fill="#e8590c"/>
  <path d="M99 62 V86 M118 56 V86 M137 60 V86" stroke="#c44a08" stroke-width="2" opacity=".7"/>
  <rect x="94" y="90" width="50" height="22" rx="9" fill="${INK}" opacity=".28"/>
  <rect x="86" y="124" width="66" height="17" rx="6" fill="${INK}"/><rect x="92" y="129" width="54" height="3" rx="1.5" fill="#fff" opacity=".35"/>`;

// ----- parts -----
const tube = () => `${SHADOW(64)}
  <circle cx="120" cy="82" r="42" fill="none" stroke="${INK}" stroke-width="19"/>
  <path d="M86 62 A42 42 0 0 1 108 44" fill="none" stroke="#8a948f" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <rect x="115" y="14" width="10" height="20" rx="3" fill="#c9d1cc" stroke="${INK}" stroke-width="2"/>
  <rect x="116" y="9" width="8" height="8" rx="2" fill="#1f5c46"/>`;

const lube = () => `${SHADOW(48)}
  <path d="M92 64 Q92 55 101 53 H139 Q148 55 148 64 V128 Q148 137 139 137 H101 Q92 137 92 128 Z" fill="#1f5c46"/>
  <rect x="108" y="38" width="24" height="17" rx="3" fill="#164634"/>
  <path d="M114 38 V30 L129 17 H141" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="100" y="76" width="40" height="42" rx="7" fill="#f5efe3"/>
  <path d="M120 84 C111 97 111 106 120 111 C129 106 129 97 120 84Z" fill="#e8590c"/>
  <path d="M100 66 H140" stroke="#fff" stroke-width="2.5" opacity=".25"/>`;

const pump = () => `${SHADOW(60)}
  <rect x="70" y="128" width="100" height="11" rx="5" fill="${INK}"/>
  <rect x="110" y="46" width="20" height="84" rx="5" fill="#1f5c46"/><rect x="114" y="50" width="4" height="76" rx="2" fill="#fff" opacity=".25"/>
  <rect x="117" y="20" width="6" height="30" fill="#c9d1cc"/>
  <rect x="84" y="11" width="72" height="12" rx="6" fill="${INK}"/>
  <circle cx="120" cy="108" r="16" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <path d="M120 108 L128 99" stroke="#b3261e" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M108 112 a12 12 0 0 1 3 -9" fill="none" stroke="#1f5c46" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M136 112 C168 114 172 98 176 80" fill="none" stroke="#e8590c" stroke-width="5" stroke-linecap="round"/>
  <rect x="169" y="62" width="15" height="20" rx="4" fill="${INK}"/>`;

const pads = () => `${SHADOW(80)}
  <circle cx="92" cy="76" r="50" fill="#cfd6d2" stroke="${INK}" stroke-width="4"/>
  <circle cx="92" cy="76" r="24" fill="#e9eeeb" stroke="${INK}" stroke-width="3"/>
  ${Array.from({ length: 10 }, (_, i) => { const [x, y] = pt(92, 76, 37, i * 36); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#fffdf8" stroke="${INK}" stroke-width="1.6"/>`; }).join('')}
  ${Array.from({ length: 6 }, (_, i) => { const [x, y] = pt(92, 76, 14, i * 60 + 15); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${INK}"/>`; }).join('')}
  <circle cx="92" cy="76" r="5" fill="${INK}"/>
  <g><rect x="150" y="48" width="38" height="62" rx="9" fill="#6b7a73"/></g>
  <g><rect x="164" y="40" width="38" height="62" rx="9" fill="${INK}"/><rect x="171" y="48" width="24" height="46" rx="6" fill="#e8590c"/>
     <path d="M176 58 H190 M176 68 H190 M176 78 H190" stroke="#fff" stroke-width="2" opacity=".45"/></g>`;

const ART_BY_ID = {
  'roadster-pro':      () => bike({ color: '#1f5c46', accent: '#e8590c', bars: 'drop', bottle: true, r: 37 }),
  'aero-carbon-r9':    () => bike({ color: '#1c2b25', accent: '#e8590c', bars: 'drop', r: 37, fw: 6, forkColor: '#1c2b25', wheel: { tire: 4, rim: '#e8590c', rimW: 5 } }),
  'trailblazer-29':    () => bike({ color: '#b4501a', accent: '#1c2b25', bars: 'flat', susp: 'front', r: 40, wheel: { tire: 7, knobby: true } }),
  'summit-full-sus':   () => bike({ color: '#7a2e12', accent: '#e8590c', bars: 'flat', susp: 'full', r: 40, wheel: { tire: 7, knobby: true } }),
  'cityline-commuter': () => bike({ color: '#4b3f8f', accent: '#e8590c', bars: 'upright', fenders: true, basket: true, rack: true, r: 37, wheel: { tire: 5 } }),
  'foldie-compact':    () => folding({ color: '#2b7a78', accent: '#e8590c' }),
  'voltride-e-city':   () => bike({ color: '#c98a00', accent: '#1f5c46', bars: 'upright', fenders: true, rack: true, battery: true, motor: 'hub', r: 37, wheel: { tire: 5 } }),
  'e-trail-mid-drive': () => bike({ color: '#6b4f00', accent: '#e8590c', bars: 'flat', susp: 'front', battery: true, motor: 'bb', r: 40, wheel: { tire: 7, knobby: true } }),
  'aero-helmet': helmet,
  'led-light-set': lights,
  'u-lock': ulock,
  'padded-gloves': gloves,
  'inner-tube-700c': tube,
  'chain-lube': lube,
  'floor-pump': pump,
  'disc-brake-pads': pads,
};

function artSvg(p) {
  const make = ART_BY_ID[p.id] || (() => bike({ color: '#1f5c46', bars: 'drop' }));
  return `<svg viewBox="0 0 240 150" role="img" aria-label="${p.name}">${make()}</svg>`;
}

function artBox(p, cls) {
  const box = h('div', { class: cls, style: `background:${BG[p.category] || '#ece6d6'}` });
  box.innerHTML = artSvg(p);
  return box;
}

// ---------- API (relative URLs so it also works from a sub-path) ----------
async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  let data;
  try { data = await res.json(); } catch { throw new Error('The server did not return JSON.'); }
  return { ok: res.ok, data };
}

function setMode(preview) {
  state.preview = preview;
  $('banner').hidden = !preview;
  $('reset').hidden = preview;
  if (preview) setPill('Preview mode', 'warn');
}

function setPill(text, kind) {
  const pill = $('pill');
  pill.textContent = text;
  pill.className = 'pill ' + (kind || '');
}

// GET /api/status -> server.js asks the COBOL program to answer "STATUS".
async function refreshStatus() {
  try {
    const { ok, data } = await api('api/status');
    if (ok && data.cobolConnected) { setPill('COBOL connected', 'good'); $('status').hidden = true; return; }
    setPill('COBOL not connected', 'bad');
    $('status').hidden = false;
    $('status').textContent = (data.error || 'The COBOL program is not available.') + ' ' + (data.help || '');
  } catch {
    setPill('API unreachable', 'bad');
  }
}

// GET /api/products -> catalogue + live stock from server.js.
async function loadProducts() {
  try {
    const { ok, data } = await api('api/products');
    if (!ok || !data.products) throw new Error('No API');
    state.products = data.products;
    setMode(false);
    refreshStatus();
  } catch {
    state.products = PREVIEW_ROWS.map(([id, name, category, priceCents, stock]) => ({ id, name, category, priceCents, stock }));
    setMode(true);
  }
  restoreBasket();
  renderChips();
  renderGrid();
  renderCart();
  if (!state.preview && state.cart.size) requestQuote();
}

// POST /api/quote -> COBOL prices the basket; nothing is changed.
let quoteSeq = 0;
async function requestQuote() {
  if (state.preview || state.cart.size === 0) {
    state.quote = null; state.error = null; renderCart(); return;
  }
  const seq = ++quoteSeq;
  const items = [...state.cart].map(([id, quantity]) => ({ id, quantity }));
  let result;
  try { result = await api('api/quote', { items, promo: state.promo }); }
  catch (e) { result = { ok: false, data: { error: 'Cannot reach the server.' } }; }
  if (seq !== quoteSeq) return; // a newer request superseded this one
  if (result.ok) { state.quote = result.data; state.error = null; }
  else { state.quote = null; state.error = result.data.error; }
  renderCart();
}

// POST /api/checkout -> COBOL validates and prices; Node then deducts stock.
async function checkout() {
  const btn = $('checkout');
  btn.disabled = true; btn.textContent = 'Processing…';
  const items = [...state.cart].map(([id, quantity]) => ({ id, quantity }));
  let result;
  try { result = await api('api/checkout', { items, promo: state.promo }); }
  catch (e) { result = { ok: false, data: { error: 'Cannot reach the server.' } }; }
  btn.textContent = 'Place order';
  if (!result.ok) {
    state.error = result.data.error; state.quote = null;
    if (result.data.code === 'E06') await refreshProducts(); // stock changed under us
    renderCart();
    return;
  }
  showReceipt(result.data);
  state.products = result.data.products;
  state.cart.clear(); state.promo = ''; $('promo').value = '';
  state.quote = null; state.error = null;
  saveBasket();
  renderGrid(); renderCart();
}

async function refreshProducts() {
  const { ok, data } = await api('api/products');
  if (ok) { state.products = data.products; renderGrid(); }
}

// POST /api/reset -> server.js restores the starting stock.
async function resetStock() {
  const { ok, data } = await api('api/reset', {});
  if (!ok) return;
  state.products = data.products;
  renderGrid();
  toast('Stock restored to starting levels');
  requestQuote();
}

// ---------- rendering -------------------------------------------------------
function renderChips() {
  const cats = ['All', ...new Set(state.products.map(p => p.category))];
  $('chips').replaceChildren(...cats.map(c =>
    h('button', { class: 'chip' + (c === state.category ? ' active' : ''), role: 'tab',
      onclick: () => { state.category = c; renderChips(); renderGrid(); } }, c)));
}

function renderGrid() {
  const q = state.search.trim().toLowerCase();
  const list = state.products.filter(p =>
    (state.category === 'All' || p.category === state.category) &&
    (!q || p.name.toLowerCase().includes(q)));
  if (SORTS[state.sort]) list.sort(SORTS[state.sort]);
  if (!list.length) {
    $('grid').replaceChildren(h('p', { class: 'empty' }, 'No products match your search.'));
    return;
  }
  $('grid').replaceChildren(...list.map(productCard));
}

function productCard(p) {
  const out = p.stock === 0;
  const low = p.stock > 0 && p.stock <= 3;
  const maxQty = Math.max(1, Math.min(p.stock, 50));
  const input = h('input', { type: 'number', min: 1, max: maxQty, value: state.pending.get(p.id) || 1,
    'aria-label': 'Quantity for ' + p.name, disabled: out });
  const clamp = v => Math.max(1, Math.min(maxQty, Math.floor(Number(v)) || 1));
  const set = v => { input.value = clamp(v); state.pending.set(p.id, Number(input.value)); };
  input.addEventListener('change', () => set(input.value));

  const art = artBox(p, 'art');

  return h('article', { class: 'card' },
    art,
    h('div', { class: 'info' },
      h('span', { class: 'tag' }, p.category),
      h('h3', {}, p.name),
      h('div', { class: 'price' }, peso(p.priceCents)),
      h('div', { class: 'stock' + (out ? ' out' : low ? ' low' : '') },
        out ? 'Sold out' : low ? `Only ${p.stock} left` : `${p.stock} in stock`),
      h('div', { class: 'buy' },
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': 'Decrease', disabled: out, onclick: () => set(Number(input.value) - 1) }, '−'),
          input,
          h('button', { type: 'button', 'aria-label': 'Increase', disabled: out, onclick: () => set(Number(input.value) + 1) }, '+')),
        h('button', { class: 'btn', disabled: out, onclick: () => addToCart(p, clamp(input.value)) }, 'Add'))));
}

function addToCart(p, qty) {
  state.cart.set(p.id, (state.cart.get(p.id) || 0) + qty);
  toast(`Added ${qty} × ${p.name}`);
  saveBasket();
  requestQuote(); renderCart();
}

function setCartQty(id, qty) {
  if (!Number.isFinite(qty) || qty < 1) state.cart.delete(id);
  else state.cart.set(id, Math.floor(qty));
  saveBasket();
  requestQuote(); renderCart();
}

function renderCart() {
  const lines = $('cartLines');
  const find = id => state.products.find(p => p.id === id) || { name: id, priceCents: 0 };
  const cobolLine = id => state.quote && state.quote.items.find(l => l.id === id);

  const count = [...state.cart.values()].reduce((a, b) => a + b, 0);
  $('cartCount').textContent = count;
  $('cartCount').hidden = count === 0;

  $('promoRow').hidden = state.cart.size === 0 || state.preview;
  $('cartError').hidden = !state.error;
  $('cartError').textContent = state.error || '';
  $('checkout').disabled = !(state.quote && !state.error) || state.preview;

  if (state.cart.size === 0) {
    lines.replaceChildren(h('p', { class: 'empty' }, 'Your cart is empty. Add something shiny.'));
    $('summary').hidden = true;
    return;
  }

  lines.replaceChildren(...[...state.cart].map(([id, qty]) => {
    const cl = cobolLine(id);
    const input = h('input', { type: 'number', min: 1, value: qty, 'aria-label': 'Quantity for ' + find(id).name });
    input.addEventListener('change', () => setCartQty(id, Number(input.value)));
    return h('div', { class: 'line' },
      h('div', { class: 'who' },
        artBox(find(id), 'thumb'),
        h('div', {},
          h('div', { class: 'name' }, find(id).name),
          h('div', { class: 'sub' }, peso(find(id).priceCents) + ' each'))),
      h('div', {},
        h('div', { class: 'tot' }, cl ? peso(cl.lineTotalCents) : (state.preview ? '' : '…')),
        cl && cl.discountCents > 0 ? h('div', { class: 'disc' }, 'bulk saving −' + peso(cl.discountCents)) : ''),
      h('div', { class: 'ctrl' },
        h('div', { class: 'qty' },
          h('button', { type: 'button', 'aria-label': 'Decrease', onclick: () => setCartQty(id, qty - 1) }, '−'),
          input,
          h('button', { type: 'button', 'aria-label': 'Increase', onclick: () => setCartQty(id, qty + 1) }, '+'))),
      h('div', {}, h('button', { class: 'remove', onclick: () => setCartQty(id, 0) }, 'Remove')));
  }));

  const s = state.quote && state.quote.summary;
  $('summary').hidden = !s;
  if (s) {
    const rows = [['Subtotal', peso(s.subtotalCents)]];
    if (s.promoDiscountCents > 0) rows.push([`Promo (${state.promo.toUpperCase()})`, '−' + peso(s.promoDiscountCents)]);
    rows.push(['VAT (12%)', peso(s.vatCents)]);
    rows.push(['Shipping', s.shippingCents === 0 ? h('span', { class: 'free' }, 'FREE') : peso(s.shippingCents)]);
    $('summary').replaceChildren(
      ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
      h('dt', { class: 'grand' }, 'Total'), h('dd', { class: 'grand' }, peso(state.quote.totalCents)));
  }
}

function showReceipt(data) {
  const s = data.summary;
  const rows = data.items.map(l =>
    h('tr', {}, h('td', {}, `${l.quantity} × ${l.name}`), h('td', {}, peso(l.lineTotalCents))));
  const extra = [['Subtotal', peso(s.subtotalCents)]];
  if (s.promoDiscountCents > 0) extra.push(['Promo discount', '−' + peso(s.promoDiscountCents)]);
  extra.push(['VAT (12%)', peso(s.vatCents)], ['Shipping', s.shippingCents === 0 ? 'FREE' : peso(s.shippingCents)]);
  $('receiptBody').replaceChildren(
    h('h2', {}, 'Thanks for riding with us!'),
    h('div', { class: 'oid' }, 'Order ' + data.orderId),
    h('table', {},
      ...rows,
      ...extra.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v))),
      h('tr', { class: 'total' }, h('td', {}, 'Total paid'), h('td', {}, peso(data.totalCents)))));
  $('receipt').showModal();
}

// ---------- wiring --------------------------------------------------------
$('search').addEventListener('input', e => { state.search = e.target.value; renderGrid(); });
$('sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });

let promoTimer;
function setPromo(code) {
  state.promo = code.trim();
  saveBasket();
  clearTimeout(promoTimer);
  promoTimer = setTimeout(requestQuote, 350);
}
$('promo').addEventListener('input', e => setPromo(e.target.value));
document.querySelectorAll('.hint').forEach(b => b.addEventListener('click', () => {
  $('promo').value = b.dataset.code;
  setPromo(b.dataset.code);
}));

$('checkout').addEventListener('click', checkout);
$('reset').addEventListener('click', resetStock);

loadProducts();
