// The player's avatar: ten small choices assembled into a Stardew-style pixel character (16×24 with a 1-px outline)
// and a 7×11 miniature for the co-op roster. Cosmetic only: never reaches the simulation.
// Wire format: ten base-36 numbers joined by dots, e.g. "0.1.0.1.0.8.0.6.0.0" (≤ 24 chars, safe to validate).

export const SKIN = ['#f9dcc0', '#f2c6a0', '#e8b090', '#d19a73', '#a8705a', '#7a4a38'];
export const HAIR = ['#1a1c2c', '#5a3e2c', '#8a6248', '#e8b04a', '#b13e53', '#f4f4f4', '#3b5dc9', '#38b764'];
export const EYE = ['#1a1c2c', '#3b5dc9', '#38b764', '#8a6248'];
export const CLOTH = ['#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#41a6f6', '#3b5dc9', '#5d275d', '#f4f4f4', '#566c86'];

export const NAMES = {
  hair: ['Коротка', 'Кучері', 'Коса', 'Хвіст', 'Козацький чуб', 'Горщик'],
  shirt: ['Сорочка', 'Вишиванка', 'Жилет', 'Светр'],
  pants: ['Штани', 'Шаровари', 'Спідниця'],
  hat: ['Без убору', 'Солом’яний капелюх', 'Кепка', 'Вінок', 'Вушанка', 'Корона'],
  acc: ['Нічого', 'Окуляри', 'Вуса', 'Хустина', 'Квітка'],
};
/** Order of the ten fields in the code, and the size of each choice list. */
export const FIELDS = [
  ['hair', 6], ['hairC', HAIR.length], ['eyes', EYE.length], ['skin', SKIN.length], ['shirt', 4], ['shirtC', CLOTH.length],
  ['pants', 3], ['pantsC', CLOTH.length], ['hat', 6], ['acc', 5],
];
export const DEFAULT = { hair: 0, hairC: 1, eyes: 0, skin: 1, shirt: 0, shirtC: 8, pants: 0, pantsC: 6, hat: 0, acc: 0 };

/** Things earned by the story (the rest is open from the start). { lvl } = player level, { mission } = campaign mission won. */
export const LOCKS = {
  shirt: { 1: { mission: 3, text: 'пройди місію 3' } },
  hat: {
    1: { lvl: 3, text: 'рівень 3' }, 2: { lvl: 5, text: 'рівень 5' }, 3: { mission: 6, text: 'пройди місію 6' },
    4: { mission: 9, text: 'пройди місію 9' }, 5: { mission: 10, text: 'пройди місію 10' },
  },
};
/** progress = { campaign: {id: stars}, level }. Returns null when open, otherwise the hint to show. */
export function lockOf(key, v, progress) {
  const L = LOCKS[key] && LOCKS[key][v];
  if (!L) return null;
  const p = progress || {};
  if (L.lvl && (p.level | 0) >= L.lvl) return null;
  if (L.mission && p.campaign && (p.campaign[L.mission] | 0) > 0) return null;
  return L.text;
}

// ---------- code <-> spec ----------
export function normalize(s) {
  const out = {};
  for (const [k, n] of FIELDS) { const v = Number.isInteger(s && s[k]) ? s[k] : DEFAULT[k]; out[k] = ((v % n) + n) % n; }
  return out;
}
export const serialize = (s) => FIELDS.map(([k]) => normalize(s)[k].toString(36)).join('.');
export const validCode = (c) => typeof c === 'string' && /^[0-9a-z]{1,2}(\.[0-9a-z]{1,2}){9}$/.test(c);
export function parse(code) {
  if (!validCode(code)) return { ...DEFAULT };
  const parts = code.split('.');
  return normalize(Object.fromEntries(FIELDS.map(([k], i) => [k, parseInt(parts[i], 36)])));
}
export function randomSpec(rnd = Math.random, progress = null) {
  const pick = (n) => Math.floor(rnd() * n);
  const s = {};
  for (const [k, n] of FIELDS) { let v = pick(n), g = 0; while (lockOf(k, v, progress) && g++ < 8) v = pick(n); s[k] = lockOf(k, v, progress) ? 0 : v; }
  if (rnd() < 0.5) s.hat = 0;
  if (rnd() < 0.6) s.acc = 0;
  return normalize(s);
}
/** A stable look for someone who never opened the wardrobe (old leaderboard rows, friends on old versions). */
export function specOfNick(nick) {
  let h = 7;
  for (const c of String(nick || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  const s = randomSpec(rnd, null);
  s.hat = 0;
  return normalize(s);
}

// ---------- drawing ----------
function paint(g, s) {
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const skin = SKIN[s.skin], hair = HAIR[s.hairC], eye = EYE[s.eyes], sh = CLOTH[s.shirtC], pa = CLOTH[s.pantsC], dark = '#1a1c2c', shoe = '#5a3e2c';
  if (s.pants === 2) { R(4, 17, 8, 5, pa); R(5, 22, 2, 1, skin); R(9, 22, 2, 1, skin); }
  else if (s.pants === 1) { R(3, 18, 4, 4, pa); R(9, 18, 4, 4, pa); R(4, 19, 2, 1, 'rgba(0,0,0,.15)'); }
  else { R(5, 18, 3, 4, pa); R(8, 18, 3, 4, pa); }
  R(4, 22, 4, 2, shoe); R(8, 22, 4, 2, shoe);
  R(4, 11, 8, 8, sh); R(2, 12, 2, 6, sh); R(12, 12, 2, 6, sh);
  R(2, 18, 2, 1, skin); R(12, 18, 2, 1, skin);
  if (s.shirt === 1) { R(6, 11, 4, 1, '#b13e53'); R(7, 12, 2, 1, dark); R(2, 17, 2, 1, '#b13e53'); R(12, 17, 2, 1, '#b13e53'); R(4, 18, 8, 1, '#b13e53'); R(5, 16, 1, 1, dark); R(8, 16, 1, 1, dark); R(10, 16, 1, 1, dark); }
  else if (s.shirt === 2) { R(5, 11, 6, 8, '#3d2a1c'); R(7, 11, 2, 8, sh); }
  else if (s.shirt === 3) { for (let y = 12; y < 19; y += 2) R(4, y, 8, 1, 'rgba(0,0,0,.25)'); }
  R(7, 10, 2, 1, skin);
  R(4, 2, 8, 9, skin); R(3, 6, 1, 3, skin); R(12, 6, 1, 3, skin);
  R(6, 7, 1, 2, eye); R(9, 7, 1, 2, eye); R(5, 9, 1, 1, '#f4b6d2'); R(10, 9, 1, 1, '#f4b6d2'); R(7, 9, 2, 1, '#8f2f44');
  const H = (x, y, w, h) => R(x, y, w, h, hair);
  if (s.hair === 0) { H(3, 1, 10, 3); H(3, 4, 1, 3); H(12, 4, 1, 3); }
  else if (s.hair === 1) { H(2, 0, 12, 4); H(2, 4, 2, 5); H(12, 4, 2, 5); H(4, 4, 2, 1); H(10, 4, 2, 1); }
  else if (s.hair === 2) { H(3, 1, 10, 3); H(3, 4, 2, 8); H(11, 4, 2, 8); H(12, 11, 2, 8); R(12, 14, 2, 1, '#b13e53'); }
  else if (s.hair === 3) { H(3, 1, 10, 3); H(3, 4, 1, 3); H(12, 4, 1, 3); H(13, 3, 2, 3); H(14, 6, 1, 4); }
  else if (s.hair === 4) { H(4, 2, 8, 2); H(6, 0, 3, 3); H(9, 1, 3, 1); H(11, 2, 2, 3); H(12, 5, 1, 4); }
  else { H(3, 1, 10, 4); H(3, 5, 2, 2); H(11, 5, 2, 2); }
  if (s.acc === 1) { R(5, 6, 3, 1, dark); R(5, 8, 3, 1, dark); R(5, 6, 1, 3, dark); R(7, 6, 1, 3, dark); R(8, 7, 1, 1, dark); R(9, 6, 3, 1, dark); R(9, 8, 3, 1, dark); R(9, 6, 1, 3, dark); R(11, 6, 1, 3, dark); }
  if (s.acc === 2) { R(5, 9, 6, 1, hair); R(4, 10, 2, 1, hair); R(10, 10, 2, 1, hair); }
  if (s.acc === 3) { R(5, 11, 6, 2, '#b13e53'); R(7, 13, 2, 1, '#b13e53'); R(6, 11, 1, 1, '#f4f4f4'); R(9, 12, 1, 1, '#f4f4f4'); }
  if (s.acc === 4) { R(11, 2, 3, 3, '#f4b6d2'); R(12, 3, 1, 1, '#ffcd75'); }
  if (s.hat === 1) { R(1, 2, 14, 2, '#e8b04a'); R(4, 0, 8, 3, '#ffcd75'); R(4, 2, 8, 1, '#b13e53'); }
  else if (s.hat === 2) { R(3, 1, 10, 3, sh === '#f4f4f4' ? '#41a6f6' : sh); R(3, 3, 12, 1, dark); }
  else if (s.hat === 3) { for (let i = 0; i < 5; i++) R(3 + i * 2, 1 + (i % 2), 2, 2, ['#f4b6d2', '#ffcd75', '#f4f4f4', '#c9a8ff', '#ef7d57'][i]); R(3, 2, 10, 1, '#38b764'); }
  else if (s.hat === 4) { R(3, 0, 10, 4, '#8a6248'); R(2, 4, 2, 5, '#8a6248'); R(12, 4, 2, 5, '#8a6248'); R(4, 0, 8, 1, '#c28569'); }
  else if (s.hat === 5) { R(4, 0, 8, 3, '#ffcd75'); R(4, -1, 1, 1, '#ffcd75'); R(7, -1, 2, 1, '#ffcd75'); R(11, -1, 1, 1, '#ffcd75'); R(7, 1, 2, 1, '#b13e53'); }
}

const cache = new Map();
const keep = (k, make) => { let c = cache.get(k); if (!c) { if (cache.size > 200) cache.clear(); c = make(); cache.set(k, c); } return c; };

/** 18×27 canvas: the portrait body with a dark outline. Shared: draw it, do not modify it. */
export function sprite(spec) {
  const s = normalize(spec);
  return keep('s' + serialize(s), () => {
    const a = document.createElement('canvas'); a.width = 16; a.height = 25;
    const g = a.getContext('2d'); g.translate(0, 1); paint(g, s);
    const d = g.getImageData(0, 0, 16, 25).data;
    const out = document.createElement('canvas'); out.width = 18; out.height = 27;
    const og = out.getContext('2d');
    const a8 = (x, y) => (x < 0 || y < 0 || x >= 16 || y >= 25 ? 0 : d[(y * 16 + x) * 4 + 3]);
    og.fillStyle = '#1a1c2c';
    for (let y = -1; y < 26; y++) for (let x = -1; x < 17; x++) if (!a8(x, y) && (a8(x - 1, y) || a8(x + 1, y) || a8(x, y - 1) || a8(x, y + 1))) og.fillRect(x + 1, y + 1, 1, 1);
    og.drawImage(a, 1, 1);
    return out;
  });
}
/** The same portrait scaled by an integer factor into a fresh canvas (DOM friendly). */
export function portrait(spec, k = 4) {
  const src = sprite(spec), c = document.createElement('canvas');
  c.width = src.width * k; c.height = src.height * k;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const MINI = ['..HHH..', '.HHHHH.', '..sss..', '..sks..', '.TTTTT.', 'TTTTTTT', 's.TTT.s', '..PPP..', '..P.P..', '..P.P..', '.kk.kk.'];
const MINI_SEAT = ['..HHH..', '.HHHHH.', '..sss..', '..sks..', '.TTTTT.', 'TTTTTTT', 's.TTT.s', '..TTT..', '.PPPPP.', '.kk.kk.'];
/** 7×11 (or 7×10 seated) miniature. Shared canvas. */
export function mini(spec, seated = false) {
  const s = normalize(spec);
  return keep((seated ? 'q' : 'm') + serialize(s), () => {
    const rows = seated ? MINI_SEAT : MINI;
    const c = document.createElement('canvas'); c.width = 7; c.height = rows.length;
    const g = c.getContext('2d');
    const hat = [null, '#ffcd75', CLOTH[s.shirtC] === '#f4f4f4' ? '#41a6f6' : CLOTH[s.shirtC], '#38b764', '#8a6248', '#ffcd75'][s.hat];
    const col = { H: hat || HAIR[s.hairC], s: SKIN[s.skin], k: '#1a1c2c', T: CLOTH[s.shirtC], P: CLOTH[s.pantsC] };
    rows.forEach((row, j) => [...row].forEach((ch, i) => { if (col[ch]) { g.fillStyle = col[ch]; g.fillRect(i, j, 1, 1); } }));
    return c;
  });
}
