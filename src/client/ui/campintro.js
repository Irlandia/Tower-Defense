// Campaign intro: a ~24 s story in six animated pixel scenes (game sprites), shown when the player
// switches to the campaign tile. Skippable (button, Esc, Space, click). Client-only, never touches the sim.
import { SPRITES, drawTower, drawFarmHouse, drawObstacle, ellipse, C } from '../../sprites.js';
import { mini, parse as parseAvatar } from '../../avatar.js';
import { avatarCode } from './wardrobe.js';
import { hero } from '../../say.js';
import { sfx } from '../app.js';

const W = 240, H = 110, SLIDE = 4; // canvas size (pixels), seconds per scene
export const SLIDES = [ // exported for the smoke test
  { title: 'Долина Піксельгай', text: 'Тиха долина. Дід Панас, пес Бровко і ти, {hero}, — молодий будівничий. Тут ніколи нічого не траплялося…', draw: valley },
  { title: 'Багато літ тому', text: 'Колись Дід Панас загатив струмок, щоб полити поле. Ніхто й не помітив, як за пагорбами почало висихати болото.', draw: dam },
  { title: 'Гнів із болота', text: 'У потрісканій твані прокинувся Король Слизу. Він памʼятає, хто забрав його воду. І присягся затопити долину.', draw: swamp },
  { title: 'Орда виступає', text: 'Дорогами котиться орда. Її ведуть генерали: Ґрок Гнилозуб, Мама Слизу, Барон Іржавий… і сам Король.', draw: map },
  { title: 'Остання лінія', text: 'Між ордою і долиною — лише ти, {hero}, і твої вежі.', draw: battle },
  { title: 'Останній прилив', text: '10 місій. 4 пори року. Одна долина. Чи встоїш?', draw: finale },
];

let el = null, raf = 0, t0 = 0;

function grass(g, top = 70) {
  g.fillStyle = '#41a6f6'; g.fillRect(0, 0, W, top); // sky
  g.fillStyle = '#73eff7'; g.fillRect(0, top - 14, W, 14);
  g.fillStyle = '#38b764'; g.fillRect(0, top, W, H - top);
  g.fillStyle = '#257179'; for (let x = 3; x < W; x += 9) g.fillRect(x, top + 6 + (x * 7) % 30, 1, 2);
}
function sun(g, t) { g.fillStyle = '#ffcd75'; g.fillRect(200, 12 + Math.round(Math.sin(t) * 1), 14, 14); g.fillStyle = '#fff4d6'; g.fillRect(203, 15 + Math.round(Math.sin(t)), 4, 4); }
const bob = (t, k = 1) => Math.round(Math.sin(t * 6 * k) * 1.5);

function valley(g, t) {
  grass(g); sun(g, t);
  drawObstacle(g, { kind: 'tree', v: 0 }, 10, 48, 'summer'); drawObstacle(g, { kind: 'tree', v: 1 }, 196, 50, 'summer');
  drawFarmHouse(g, 60, 52, 'summer', Math.floor(t * 20));
  // the hero (your avatar), Дід Панас and Бровко walk in
  const x = Math.min(98, 60 + t * 20); // walks in from the left and stops beside Дід Панас
  const me = mini(parseAvatar(avatarCode()));
  g.imageSmoothingEnabled = false;
  g.drawImage(me, Math.round(x), 74 + bob(t), 14, 22);
  g.fillStyle = '#ffcd75'; g.fillRect(118, 74 + bob(t, 0.8), 7, 3); g.fillStyle = '#f2c6a0'; g.fillRect(119, 77 + bob(t, 0.8), 5, 4); g.fillStyle = '#b13e53'; g.fillRect(118, 81, 7, 6); g.fillStyle = '#3b5dc9'; g.fillRect(119, 87, 5, 7); // Дід Панас
  g.fillStyle = '#a8805e'; g.fillRect(166, 88 + bob(t, 1.4), 9, 4); g.fillRect(173, 85 + bob(t, 1.4), 3, 3); g.fillRect(167, 92, 1, 2); g.fillRect(173, 92, 1, 2); // Бровко
  for (let i = 0; i < 4; i++) { g.fillStyle = '#f4b6d2'; g.fillRect(30 + i * 50 + Math.round(Math.sin(t + i) * 3), 96, 2, 2); }
}

function swamp(g, t) {
  g.fillStyle = '#29366f'; g.fillRect(0, 0, W, H); // gloomy sky
  g.fillStyle = '#5d275d'; g.fillRect(0, 55, W, 15);
  g.fillStyle = '#257179'; g.fillRect(0, 70, W, H - 70); // swamp water
  if (t < 1.4) { // first the dried-up swamp: cracked mud, then the bog comes back to life
    g.globalAlpha = Math.min(1, (1.4 - t) / 0.4);
    g.fillStyle = '#8a6248'; g.fillRect(0, 70, W, H - 70);
    g.fillStyle = '#5a3e2c'; for (let i = 0; i < 18; i++) { const x = (i * 41) % W, y = 74 + (i * 13) % 32; g.fillRect(x, y, 9, 1); g.fillRect(x + 8, y, 1, 5); g.fillRect(x + 3, y - 4, 1, 4); }
    g.globalAlpha = 1;
  }
  for (let i = 0; i < 8; i++) { g.fillStyle = '#38b764'; g.fillRect((i * 37 + Math.round(t * 10)) % W, 72 + (i % 3) * 12, 6, 1); }
  // bubbles
  for (let i = 0; i < 6; i++) { const k = (t * 0.8 + i * 0.33) % 1; g.fillStyle = '#a7f070'; g.fillRect(20 + i * 38, Math.round(100 - k * 30), 2, 2); }
  // the King rises from the swamp, his slimes crawl out
  const rise = Math.max(0, Math.min(1, (t - 1.2) / 1.6)), k = SPRITES.king; // he rises once the bog is back
  g.drawImage(k, 0, 0, k.width, Math.round(k.height * rise), 100, Math.round(92 - k.height * rise), k.width, Math.round(k.height * rise));
  const s = SPRITES.slime;
  for (let i = 0; i < 5; i++) {
    const x = Math.round(30 + i * 40 + Math.sin(t * 2 + i) * 4 + (i < 2 ? -t * 6 : t * 6));
    ellipse(g, x + s.width / 2, 98, s.width / 2, 2, 'rgba(0,0,0,0.3)');
    g.drawImage(s, x, 98 - s.height + bob(t + i, 1.2));
  }
  if (Math.floor(t * 4) % 2) { g.fillStyle = '#f4f4f4'; g.fillRect(140, 30, 1, 10); g.fillRect(141, 40, 1, 8); } // a flash of lightning
}

// «Багато літ тому», read left to right: a stream fills the pond, a channel waters the field; Дід Панас
// stands by the dam he is building; a path runs under a big green hill; beyond it the swamp has dried into
// cracked mud with dead reeds and a puzzled slime. The right side fades to a dry, yellow haze.
function dam(g, t) {
  const k = Math.min(1, t / 3); // 0 → 1: the dam goes up, the swamp dries
  const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const ell = (cx, cy, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2); g.fill(); };
  // banded sky
  const SKY = ['#3b8fd9', '#41a6f6', '#5ab4f4', '#6fc2f2', '#86cff0', '#9fdcef', '#b5e6ef', '#c9eeee'];
  SKY.forEach((c, i) => P(0, i * 7, W, 7, c));
  // the sun with a glow
  g.globalAlpha = 0.35; ell(24, 22, 13, 13, '#fff4d6'); g.globalAlpha = 1;
  ell(24, 22, 9, 9, '#ffcd75'); ell(23, 21, 6, 6, '#ffe9a8'); ell(22, 20, 3, 3, '#fff4d6');
  // clouds drifting
  for (const [cx, cy, w] of [[62, 10, 14], [130, 8, 16], [98, 20, 10]]) {
    const x = cx + ((t * 3) % 12); P(x, cy, w, 3, '#f4f4f4'); P(x + 2, cy - 2, w - 6, 2, '#f4f4f4'); P(x, cy + 3, w, 1, '#c9eeee');
  }
  // far hills
  g.fillStyle = '#7cc48c'; g.beginPath(); g.moveTo(0, 54); g.quadraticCurveTo(25, 44, 50, 52); g.quadraticCurveTo(80, 40, 110, 52); g.quadraticCurveTo(150, 42, 190, 52); g.quadraticCurveTo(215, 44, 240, 50); g.lineTo(240, 60); g.lineTo(0, 60); g.fill();
  // the meadow
  P(0, 58, W, H - 58, '#4fc26a'); P(0, 58, W, 1, '#a7f070');
  for (let i = 0; i < 40; i++) P((i * 47) % 170, 62 + (i * 13) % 40, 1, 2, '#38b764'); // grass blades
  // the stream winds in from the left into the pond
  g.strokeStyle = '#3b5dc9'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 59); g.quadraticCurveTo(14, 58, 20, 62); g.quadraticCurveTo(26, 65, 34, 65); g.stroke(); g.lineWidth = 1;
  P(4, 59, 5, 1, '#73eff7');
  // the pond fills as the dam rises
  const pr = 15 + k * 4;
  ell(50, 67, pr + 1, 7.5 + k, '#29366f'); ell(50, 66, pr, 7 + k, '#3b5dc9');
  for (let i = 0; i < 4; i++) P(40 + i * 6 + Math.round(Math.sin(t * 2 + i) * 2), 63 + (i % 2) * 4, 4, 1, '#73eff7');
  // a channel from the pond waters the field
  P(39, 73, 2, 9, '#3b5dc9'); P(39, 73, 1, 9, '#73eff7');
  P(0, 82, 66, H - 82, '#5a3e2c'); // tilled field
  for (let r = 0; r < 5; r++) for (let i = 0; i < 11; i++) {
    const x = 3 + i * 6, y = 86 + r * 5, h = 1 + Math.round(k * 2);
    P(x - 1, y + 1, 5, 1, '#3d2a1e');
    P(x, y - h, 1, h + 1, '#a7f070'); P(x + 2, y - h, 1, h + 1, k > 0.5 && (i + r) % 3 === 0 ? '#ffcd75' : '#38b764');
  }
  // the dam: a bundle of upright logs with two bands, growing from the bank
  const dh = Math.round(6 + 15 * k), dx = 70, base = 78;
  for (let i = 0; i < 4; i++) { P(dx + i * 2, base - dh, 2, dh, i % 2 ? '#8a6248' : '#a8805e'); P(dx + i * 2, base - dh, 2, 1, '#e0b089'); }
  P(dx, base - dh + 3, 8, 1, '#5a3e2c'); if (dh > 12) P(dx, base - 4, 8, 1, '#5a3e2c');
  P(dx - 1, base, 10, 1, '#3d2a1e');
  // the dirt path from the dam towards the swamp, under the hill
  P(78, 76, 110, 3, '#a8805e'); P(78, 79, 110, 1, '#8a6248');
  for (let i = 0; i < 8; i++) P(84 + i * 13, 77, 1, 1, '#94b0c2'); // pebbles
  // Дід Панас: straw hat, white beard, embroidered shirt, a shovel
  const fx = 82, fy = 48, dig = Math.floor(t * 3) % 2;
  P(fx - 3, fy + 2, 13, 2, '#e8b04a'); P(fx, fy - 1, 7, 3, '#ffcd75'); P(fx, fy + 1, 7, 1, '#b13e53'); // hat with a band
  P(fx, fy + 4, 7, 4, '#f2c6a0'); P(fx + 1, fy + 5, 1, 1, '#1a1c2c'); P(fx + 5, fy + 5, 1, 1, '#1a1c2c');
  P(fx, fy + 7, 7, 4, '#f4f4f4'); P(fx + 2, fy + 11, 3, 1, '#f4f4f4'); // beard
  P(fx - 1, fy + 11, 9, 8, '#f4f4f4'); P(fx - 1, fy + 13, 9, 1, '#b13e53'); P(fx + 3, fy + 11, 1, 8, '#b13e53'); // вишиванка
  P(fx - 2, fy + 12, 1, 5, '#f2c6a0'); // arm
  P(fx, fy + 19, 3, 7, '#29366f'); P(fx + 4, fy + 19, 3, 7, '#29366f'); P(fx - 1, fy + 26, 4, 2, '#1a1c2c'); P(fx + 4, fy + 26, 4, 2, '#1a1c2c');
  const sy = dig ? 2 : 0; // the shovel bobs as he digs
  P(fx + 10, fy + 2 + sy, 1, 22, '#8a6248'); P(fx + 8, fy + 13 + sy, 3, 2, '#f2c6a0');
  P(fx + 9, fy + 24 + sy, 3, 4, '#94b0c2'); P(fx + 9, fy + 27 + sy, 3, 1, '#566c86');
  if (dig && k < 1) P(fx + 13, fy + 26, 2, 1, '#8a6248'); // a clod of earth
  // the big green hill in the middle, drawn column by column so it reads as pixel art standing on the ground:
  // a grassy, uneven top edge, a sunlit left slope with a rim light, a dithered shadow on the right, bushes at its foot
  const HX0 = 102, HX1 = 184, HB = 78, HTOP = 34;
  ell((HX0 + HX1) / 2, HB, (HX1 - HX0) / 2 + 4, 3, '#2f9e57'); // its shadow on the meadow
  for (let x = HX0; x <= HX1; x++) {
    const u = (x - HX0) / (HX1 - HX0); // 0 at the left foot, 1 at the right foot
    const top = Math.round(HB - (HB - HTOP) * Math.pow(Math.sin(Math.PI * u), 0.75) + ((x * 7) % 3 === 0 ? 1 : 0)); // tufty edge
    for (let y = top; y < HB; y++) {
      const shade = u + (y - top) / 160; // further right and lower = darker
      let c = shade < 0.42 ? '#6fd67a' : shade < 0.62 ? '#4fc26a' : shade < 0.78 ? ((x + y) % 2 ? '#4fc26a' : '#38b764') : '#38b764';
      if (shade > 0.9 && (x + y) % 2) c = '#2f9e57';
      P(x, y, 1, 1, c);
    }
    P(x, top, 1, 1, u < 0.55 ? '#a7f070' : '#4fc26a'); // rim light on the sunny side
    P(x, top - 1, 1, 1, '#257179'); // a dark outline
  }
  for (const [x, y] of [[118, 58], [128, 48], [137, 44], [150, 50], [164, 58], [124, 68], [158, 66]]) { P(x, y, 2, 1, '#38b764'); P(x, y - 1, 1, 1, '#a7f070'); } // grass tufts
  for (const [x, y, c] of [[124, 52, '#ffcd75'], [133, 46, '#f4f4f4'], [147, 56, '#ef7d57'], [156, 49, '#ffcd75'], [141, 64, '#f4f4f4'], [116, 66, '#ef7d57']]) P(x, y, 1, 1, c); // flowers
  for (const bx of [100, 108, 176, 186]) { ell(bx, HB - 2, 5, 3, '#2f9e57'); ell(bx - 1, HB - 3, 3, 2, '#38b764'); } // bushes at its foot
  // the path passes in front of the hill
  P(78, 76, 110, 3, '#a8805e'); P(78, 79, 110, 1, '#8a6248');
  for (let i = 0; i < 8; i++) P(84 + i * 13, 77, 1, 1, '#94b0c2');
  // the dried swamp on the right
  ell(206, 82, 33, 10, '#6b4a36'); ell(206, 81, 32, 9, '#8a6248');
  for (let i = 0; i < 14; i++) { const x = 180 + (i * 17) % 52, y = 76 + (i * 7) % 11; P(x, y, 5, 1, '#5a3e2c'); P(x + 4, y, 1, 2, '#5a3e2c'); P(x + 2, y - 2, 1, 2, '#5a3e2c'); }
  const wet = 1 - k; // the last puddle shrinks
  ell(214, 86, 9 * wet + 1, 2 * wet + 0.5, '#257179'); ell(213, 85.5, 6 * wet, 1 * wet, '#38b764');
  for (const [x, h] of [[184, 14], [190, 10], [222, 16], [228, 11], [234, 13]]) { P(x, 82 - h, 1, h, '#5a3e2c'); P(x - 1, 82 - h, 3, 4, '#8a6248'); } // dead cattails
  P(236, 56, 1, 24, '#5a3e2c'); P(232, 60, 4, 1, '#5a3e2c'); P(231, 58, 1, 2, '#5a3e2c'); P(237, 64, 3, 1, '#5a3e2c'); P(239, 62, 1, 2, '#5a3e2c'); // a dead tree
  const s = SPRITES.slime, sx = 194, sy2 = 84 - s.height;
  g.drawImage(s, sx, sy2 + (k > 0.6 ? 1 : bob(t)));
  if (k > 0.4) { P(sx + 6, sy2 - 9, 4, 1, '#f4f4f4'); P(sx + 9, sy2 - 8, 1, 2, '#f4f4f4'); P(sx + 7, sy2 - 6, 2, 1, '#f4f4f4'); P(sx + 7, sy2 - 4, 2, 1, '#f4f4f4'); } // «?»
  if (k > 0.7) P(sx + 15, sy2 + 1 + (Math.floor(t * 5) % 3), 1, 2, '#73eff7'); // a drop of sweat
  // the dry haze over the right side
  const hz = g.createLinearGradient(165, 0, 240, 0); hz.addColorStop(0, 'rgba(201,160,70,0)'); hz.addColorStop(1, `rgba(201,160,70,${(0.2 + 0.25 * k).toFixed(2)})`);
  g.fillStyle = hz; g.fillRect(165, 0, 75, H);
}

// The valley from above, drawn like a little game map: the swamp and its King on the left, two winding roads,
// the farm in the middle, the castle on the right. The horde marches along the roads; the generals pop up one by one.
const ROADS = [[[30, 28], [70, 28], [70, 50], [120, 50], [120, 34], [214, 34]], [[30, 86], [96, 86], [96, 70], [170, 70], [170, 44], [214, 44]]];
function along(r, f) { // point at fraction f of a road polyline
  const segs = r.slice(1).map((p, i) => [r[i], p, Math.hypot(p[0] - r[i][0], p[1] - r[i][1])]), total = segs.reduce((a, s) => a + s[2], 0);
  let d = f * total;
  for (const [a, b, l] of segs) { if (d <= l) return [a[0] + (b[0] - a[0]) * d / l, a[1] + (b[1] - a[1]) * d / l]; d -= l; }
  return r[r.length - 1];
}
function map(g, t) {
  g.fillStyle = '#38b764'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#2f9e57'; for (let i = 0; i < 26; i++) g.fillRect((i * 53) % W, (i * 37) % H, 9, 5); // patches
  g.fillStyle = '#a7f070'; for (let i = 0; i < 60; i++) g.fillRect((i * 41) % W, (i * 23) % H, 1, 2); // grass tufts
  // trees
  for (const [x, y] of [[140, 10], [150, 14], [60, 64], [190, 82], [205, 86], [128, 90], [40, 52]]) {
    g.fillStyle = '#1a1c2c'; g.fillRect(x + 2, y + 6, 2, 3); g.fillStyle = '#257179'; g.fillRect(x, y, 6, 7); g.fillStyle = '#38b764'; g.fillRect(x + 1, y + 1, 3, 3);
  }
  // the swamp with reeds and bubbles
  g.fillStyle = '#5d275d'; g.fillRect(0, 14, 32, 84); g.fillStyle = '#257179'; g.fillRect(2, 18, 28, 76);
  for (let i = 0; i < 7; i++) { g.fillStyle = '#5a3e2c'; g.fillRect(4 + (i * 9) % 24, 20 + i * 11, 1, 5); }
  for (let i = 0; i < 4; i++) { const f = (t * 0.7 + i * 0.25) % 1; g.fillStyle = '#a7f070'; g.fillRect(8 + i * 6, Math.round(90 - f * 60), 2, 2); }
  // roads: dirt with a light rim
  for (const r of ROADS) for (let f = 0; f <= 1; f += 0.003) { const [x, y] = along(r, f); g.fillStyle = '#c29a6b'; g.fillRect(Math.round(x) - 3, Math.round(y) - 3, 7, 7); }
  for (const r of ROADS) for (let f = 0; f <= 1; f += 0.003) { const [x, y] = along(r, f); g.fillStyle = '#8a6248'; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5); }
  // the farm (field + house) and the castle
  g.fillStyle = '#5a3e2c'; g.fillRect(132, 56, 18, 10); g.fillStyle = '#a7f070'; for (let i = 0; i < 4; i++) g.fillRect(134 + i * 4, 58, 2, 6);
  g.fillStyle = '#c28569'; g.fillRect(118, 58, 10, 8); g.fillStyle = '#b13e53'; g.fillRect(116, 54, 14, 4); g.fillStyle = '#5a3e2c'; g.fillRect(122, 62, 2, 4);
  g.fillStyle = '#1a1c2c'; g.fillRect(213, 25, 26, 28); g.fillStyle = '#94b0c2'; g.fillRect(214, 26, 24, 26); g.fillStyle = '#566c86'; g.fillRect(214, 44, 24, 8);
  g.fillStyle = '#94b0c2'; g.fillRect(213, 20, 6, 7); g.fillRect(233, 20, 6, 7); g.fillStyle = '#1a1c2c'; g.fillRect(223, 44, 6, 8);
  g.fillStyle = '#b13e53'; g.fillRect(225, 10, 1, 12); g.fillRect(226, 10 + (Math.floor(t * 5) % 2), 6, 4); // flag
  // the horde: little slimes march along both roads; the front creeps towards the castle
  const m = SPRITES.mini;
  for (const r of ROADS) for (let i = 0; i < 9; i++) {
    const f = Math.min(0.82, (t * 0.07 + i * 0.075) % 0.82);
    const [x, y] = along(r, f);
    g.drawImage(m, Math.round(x - m.width / 2), Math.round(y - m.height / 2) + (Math.floor(t * 6 + i) % 2));
  }
  // the generals light up one by one: a red ring, the boss sprite (small) and a name plate
  const gens = [['Ґрок', ROADS[0], 0.32], ['Мама Слизу', ROADS[1], 0.28], ['Барон', ROADS[1], 0.58], ['КОРОЛЬ', null, 0]];
  gens.forEach(([name, r, f], i) => {
    const appear = t - (0.5 + i * 0.75);
    if (appear < 0) return;
    const [x, y] = r ? along(r, f) : [16, 50];
    const pop = Math.min(1, appear / 0.25), size = Math.round((i === 3 ? 18 : 12) * pop);
    g.strokeStyle = Math.floor(t * 5) % 2 ? '#b13e53' : '#ef7d57'; g.beginPath(); g.arc(x + 0.5, y + 0.5, size / 2 + 3, 0, Math.PI * 2); g.stroke();
    const spr = i === 3 ? SPRITES.king : SPRITES.boss;
    g.drawImage(spr, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
    if (pop >= 1) {
      g.font = 'bold 7px monospace';
      const w = Math.ceil(g.measureText(name).width) + 4, lx = Math.min(W - w - 2, Math.round(x - w / 2)), ly = Math.round(y - size / 2 - 11);
      g.fillStyle = '#1a1c2c'; g.fillRect(lx, ly, w, 9); g.fillStyle = i === 3 ? '#ffcd75' : '#f4f4f4'; g.fillText(name, lx + 2, ly + 7);
    }
  });
}


// closing card: sunrise over the castle, the hero on the wall, the title
function finale(g, t) {
  const k = Math.min(1, t / 3);
  g.fillStyle = '#29366f'; g.fillRect(0, 0, W, H);
  // a banded dawn sky: night blue at the top warming to orange at the horizon (warmer as the sun rises)
  const DAWN = ['#29366f', '#33397a', '#4a3f84', '#6a4886', '#8f5482', '#b2617a', '#d27270', '#ea8466'];
  DAWN.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * 10, W, 10); });
  g.fillStyle = `rgba(41,54,111,${(0.45 * (1 - k)).toFixed(2)})`; g.fillRect(0, 0, W, 80); // still dark before the sun is up
  // a big sunset sun rising clear of the wall: a soft glow, a two-tone disc and the classic pixel stripes
  const sx = 186, sy = 86 - k * 34, R = 15;
  const glow = g.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 2.6);
  glow.addColorStop(0, 'rgba(255,205,117,0.55)'); glow.addColorStop(1, 'rgba(239,125,87,0)');
  g.fillStyle = glow; g.fillRect(sx - R * 3, sy - R * 3, R * 6, R * 6);
  g.save(); g.beginPath(); g.arc(sx, sy, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#ffcd75'; g.fillRect(sx - R, sy - R, R * 2, R * 2);
  g.fillStyle = '#ffe9a8'; g.fillRect(sx - R, sy - R, R * 2, R * 0.7); // a brighter top
  g.fillStyle = '#ef7d57'; g.fillRect(sx - R, sy + R * 0.35, R * 2, R); // warmer bottom
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(177,62,83,0.9)'; g.fillRect(sx - R, Math.round(sy + R * 0.25 + i * 3.5), R * 2, 1 + (i >> 1)); } // stripes
  g.restore();
  g.fillStyle = '#1a1c2c'; g.fillRect(0, 78, W, H - 78); // the castle wall in silhouette
  for (let x = 0; x < W; x += 12) g.fillRect(x, 74, 7, 4);
  g.fillRect(100, 52, 40, 30); g.fillRect(96, 46, 8, 10); g.fillRect(136, 46, 8, 10);
  const me = mini(parseAvatar(avatarCode()));
  g.save(); g.globalAlpha = 0.9; g.drawImage(me, 113, 30 + bob(t), 14, 22); g.restore(); // you, on the tower
  g.fillStyle = '#b13e53'; g.fillRect(140, 30, 1, 16); g.fillRect(141, 30 + (Math.floor(t * 6) % 2), 8, 5); // a flag in the wind
}

function battle(g, t) {
  grass(g, 60); sun(g, t * 0.5);
  g.fillStyle = '#8a6248'; g.fillRect(0, 80, W, 14); g.fillStyle = '#a8805e'; g.fillRect(0, 80, W, 2); // the road
  const tick = Math.floor(t * 20);
  drawTower(g, 'arrow', 30, 54, 3, 0, tick, tick % 10 < 2);
  drawTower(g, 'frost', 70, 54, 2, 0, tick);
  drawTower(g, 'cannon', 110, 54, 3, 0.3, tick, tick % 14 < 2);
  // slimes come along the road; one gets hit now and then
  const s = SPRITES.slime, r = SPRITES.runner;
  for (let i = 0; i < 4; i++) {
    const x = Math.round(W - ((t * 28 + i * 34) % (W + 30)) + 10), spr = i % 2 ? r : s;
    g.drawImage(spr, x, 94 - spr.height + bob(t + i, 1.5));
  }
  if (tick % 10 < 3) { g.fillStyle = C.yellow; g.fillRect(160 + (tick % 10) * 6, 70, 4, 1); } // an arrow flying
  const me = mini(parseAvatar(avatarCode()));
  g.drawImage(me, 150, 52 + bob(t), 14, 22); // you, cheering on
}

function frame(now) {
  if (!el) return;
  const t = Math.max(0, (now - t0) / 1000), i = Math.min(SLIDES.length - 1, Math.floor(t / SLIDE)), lt = t - i * SLIDE; // the first rAF stamp can be a bit earlier than t0
  if (t >= SLIDE * SLIDES.length) { close(); return; }
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, W, H);
  SLIDES[i].draw(g, lt);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 7); g.fillRect(0, H - 7, W, 7); // cinema bars
  if (lt < 0.35) { g.fillStyle = `rgba(26,28,44,${(1 - lt / 0.35).toFixed(2)})`; g.fillRect(0, 0, W, H); } // fade in
  if (lt > SLIDE - 0.3) { g.fillStyle = `rgba(26,28,44,${((lt - SLIDE + 0.3) / 0.3).toFixed(2)})`; g.fillRect(0, 0, W, H); } // fade out
  if (el.dataset.slide !== String(i)) {
    el.dataset.slide = i;
    el.querySelector('.ci-title').textContent = SLIDES[i].title;
    el.querySelectorAll('.ci-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
  }
  // the caption types itself out, like an old storybook narrator
  const full = hero(SLIDES[i].text), n = Math.min(full.length, Math.floor(lt * 45));
  const txt = el.querySelector('.ci-text');
  if (txt.dataset.n !== String(n) || txt.dataset.slide !== String(i)) { txt.dataset.n = n; txt.dataset.slide = i; txt.textContent = full.slice(0, n); }
  el.querySelector('.ci-bar i').style.width = Math.min(100, (100 * t) / (SLIDE * SLIDES.length)) + '%';
  raf = requestAnimationFrame(frame);
}

function close() {
  cancelAnimationFrame(raf);
  if (el) el.remove();
  el = null;
  document.removeEventListener('keydown', onKey, true);
}
function onKey(ev) {
  if (ev.key === 'Escape' || ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); close(); }
}

/** Play the campaign story (about 9 s). Any click, Esc, Space or «Пропустити» ends it. */
export function showCampaignIntro() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'campIntro';
  el.innerHTML = `<div class="ci-box"><canvas width="${W}" height="${H}"></canvas>
    <div class="ci-title"></div><div class="ci-text"></div>
    <div class="ci-foot"><span class="ci-dots">${SLIDES.map(() => '<i></i>').join('')}</span><span class="ci-bar"><i></i></span><button class="ci-skip">Пропустити ⏭</button></div></div>`;
  el.addEventListener('click', close);
  document.getElementById("stage").append(el); // above the menu
  document.addEventListener('keydown', onKey, true);
  sfx.play('wave');
  t0 = performance.now();
  raf = requestAnimationFrame(frame);
}
