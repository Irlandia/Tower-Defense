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

// Left: the farm, Дід Панас carries logs and builds a dam across the stream; a pond fills, the field greens.
// A hill in the middle. Right: past the hill the stream runs dry, the swamp shrinks to cracked mud, a sad slime.
function dam(g, t) {
  const k = Math.min(1, t / 3); // how far the dam is built
  // sky and far hills
  g.fillStyle = '#73eff7'; g.fillRect(0, 0, W, 60);
  g.fillStyle = '#ffcd75'; g.fillRect(24, 10, 12, 12); g.fillStyle = '#fff4d6'; g.fillRect(26, 12, 4, 4);
  g.fillStyle = '#38b764'; g.fillRect(0, 56, W, H - 56); // ground
  // the hill in the middle that hides the swamp from the farm
  g.fillStyle = '#257179'; g.beginPath(); g.moveTo(126, 84); g.quadraticCurveTo(151, 22, 176, 84); g.closePath(); g.fill();
  g.fillStyle = '#2f9e57'; g.beginPath(); g.moveTo(130, 84); g.quadraticCurveTo(151, 30, 172, 84); g.closePath(); g.fill();
  g.fillStyle = '#a7f070'; for (let i = 0; i < 6; i++) g.fillRect(138 + i * 5, 62 + Math.abs(i - 2.5) * 4, 2, 1); // grass on the hill
  // ---- left: the stream comes from the left edge to the dam at x=96 ----
  g.fillStyle = '#3b5dc9'; g.fillRect(0, 84, 96, 10);
  g.fillStyle = '#41a6f6'; for (let i = 0; i < 6; i++) g.fillRect(((i * 17 + Math.floor(t * 20)) % 90), 87, 5, 1); // ripples
  // the pond grows behind the dam
  const pond = Math.round(4 + k * 10);
  g.fillStyle = '#3b5dc9'; g.fillRect(60, 84 - pond, 36, pond);
  g.fillStyle = '#41a6f6'; g.fillRect(62, 84 - pond, 30, 1);
  // the field: wheat that grows as the water arrives
  for (let i = 0; i < 9; i++) {
    const h = 3 + Math.round(k * 6), x = 8 + i * 6;
    g.fillStyle = '#5a3e2c'; g.fillRect(x - 1, 79, 4, 2);
    g.fillStyle = k > 0.5 ? '#a7f070' : '#c9a046'; g.fillRect(x, 79 - h, 2, h);
    if (k > 0.7) { g.fillStyle = '#ffcd75'; g.fillRect(x, 78 - h, 2, 2); }
  }
  // the dam: logs stacked one by one
  const logs = Math.min(5, Math.floor(k * 5.99));
  for (let i = 0; i < logs; i++) { g.fillStyle = '#8a6248'; g.fillRect(94, 92 - i * 5, 8, 4); g.fillStyle = '#5a3e2c'; g.fillRect(94, 95 - i * 5, 8, 1); g.fillStyle = '#c28569'; g.fillRect(94, 92 - i * 5, 2, 4); }
  // Дід Панас (big, straw hat, white beard) carries a log towards the dam, then stands proud
  const carry = k < 1, px = carry ? 108 + Math.round(Math.sin(t * 3) * 5) : 106, py = 61 + (carry ? bob(t, 1.2) : 0); // on the bank right of the dam
  const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(px + x, py + y, w, h); };
  P(-1, 0, 12, 2, '#e8b04a'); P(2, -3, 6, 3, '#ffcd75'); // straw hat
  P(2, 2, 6, 5, '#f2c6a0'); P(3, 4, 1, 1, '#1a1c2c'); P(6, 4, 1, 1, '#1a1c2c'); // face, eyes
  P(2, 6, 6, 3, '#f4f4f4'); // white beard
  P(1, 9, 8, 7, '#b13e53'); P(3, 9, 4, 7, '#3b5dc9'); // red shirt, blue overalls
  P(2, 16, 2, 5, '#3b5dc9'); P(6, 16, 2, 5, '#3b5dc9'); P(1, 21, 3, 1, '#5a3e2c'); P(6, 21, 3, 1, '#5a3e2c'); // legs, boots
  if (carry) { P(-4, 7, 18, 3, '#8a6248'); P(-4, 7, 2, 3, '#c28569'); } // the log on his shoulder
  else if (Math.floor(t * 3) % 2) P(10, 6, 2, 3, '#f2c6a0'); // waving: done!
  // ---- right: beyond the hill the stream dries out, the swamp turns to cracked mud ----
  const dry = k;
  g.fillStyle = '#a8805e'; g.fillRect(172, 84, 68, 10); // the dry stream bed
  g.globalAlpha = 1 - dry; g.fillStyle = '#3b5dc9'; g.fillRect(172, 84, 68, 10); g.globalAlpha = 1;
  const sw = Math.round(46 * (1 - dry * 0.75)); // the swamp shrinks
  g.fillStyle = '#8a6248'; g.fillRect(182, 66, 54, 18); // mud
  g.fillStyle = '#5a3e2c'; for (let i = 0; i < 9; i++) { const x = 184 + (i * 13) % 48, y = 68 + (i * 7) % 14; g.fillRect(x, y, 6, 1); g.fillRect(x + 5, y, 1, 3); } // cracks
  g.fillStyle = '#257179'; g.fillRect(209 - sw / 2, 70, sw, 10); g.fillStyle = '#5d275d'; g.fillRect(209 - sw / 2, 70, sw, 2);
  g.fillStyle = '#1a1c2c'; g.fillRect(186, 58, 1, 8); g.fillRect(232, 60, 1, 6); g.fillStyle = '#5a3e2c'; g.fillRect(185, 56, 3, 3); g.fillRect(231, 58, 3, 3); // dry reeds
  // a sad slime looking at the mud, with a question mark
  const s = SPRITES.slime;
  g.drawImage(s, 200, 82 - s.height + (dry > 0.6 ? 1 : bob(t)));
  if (dry > 0.5) { g.fillStyle = '#f4f4f4'; g.fillRect(212, 58, 4, 1); g.fillRect(215, 59, 1, 2); g.fillRect(213, 61, 2, 1); g.fillRect(213, 63, 2, 2); } // «?»
  if (dry > 0.8) { g.fillStyle = '#73eff7'; g.fillRect(203, 74 + Math.floor(t * 6) % 4, 1, 2); } // a tear
  // the old-photo look: sepia wash, a frame and grain
  g.fillStyle = 'rgba(194,133,105,0.22)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(26,28,44,0.45)'; g.fillRect(0, 0, W, 9); g.fillRect(0, H - 9, W, 9); g.fillRect(0, 0, 4, H); g.fillRect(W - 4, 0, 4, H);
  g.fillStyle = 'rgba(244,244,244,0.12)'; for (let i = 0; i < 18; i++) g.fillRect((i * 97 + Math.floor(t * 30) * 13) % W, (i * 61 + Math.floor(t * 30) * 7) % H, 1, 1);
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
  g.fillStyle = `rgba(239,125,87,${(0.25 + 0.5 * k).toFixed(2)})`; g.fillRect(0, 40, W, 40); // dawn
  g.fillStyle = '#ffcd75'; g.beginPath(); g.arc(186, 80 - k * 16, 16, Math.PI, 0); g.fill(); // the sun rises beside the castle
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
