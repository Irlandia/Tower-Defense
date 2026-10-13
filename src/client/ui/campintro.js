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

// flashback in sepia: Дід Панас rolls logs into the stream, the water stops, the field turns green
function dam(g, t) {
  grass(g, 60); sun(g, t);
  const stop = Math.min(1, t / 2.5); // how far the dam is built
  g.fillStyle = '#3b5dc9'; g.fillRect(0, 70, 120, 10); // the stream from the hills…
  g.fillStyle = '#3b5dc9'; g.globalAlpha = 1 - stop; g.fillRect(120, 70, 120, 10); g.globalAlpha = 1; // …that dries up beyond the dam
  g.fillStyle = '#a8805e'; g.globalAlpha = stop; g.fillRect(120, 70, 120, 10); g.globalAlpha = 1;
  for (let i = 0; i < Math.round(stop * 4); i++) { g.fillStyle = '#8a6248'; g.fillRect(114, 64 + i * 4, 10, 3); g.fillStyle = '#5a3e2c'; g.fillRect(114, 66 + i * 4, 10, 1); } // logs
  g.fillStyle = '#a7f070'; for (let i = 0; i < 8; i++) g.fillRect(20 + i * 10, 86 - Math.round(stop * 4), 2, 3 + Math.round(stop * 4)); // the thirsty field drinks
  g.fillStyle = '#ffcd75'; g.fillRect(100, 58 + bob(t), 7, 3); g.fillStyle = '#f2c6a0'; g.fillRect(101, 61 + bob(t), 5, 4); g.fillStyle = '#b13e53'; g.fillRect(100, 65, 7, 6); g.fillStyle = '#3b5dc9'; g.fillRect(101, 71, 5, 6); // Дід Панас (young-ish)
  // old photo look: sepia wash and a vignette
  g.fillStyle = 'rgba(138,98,72,0.35)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(26,28,44,0.35)'; g.fillRect(0, 0, W, 6); g.fillRect(0, H - 6, W, 6); g.fillRect(0, 0, 6, H); g.fillRect(W - 6, 0, 6, H);
}

// the valley from above: swamp on the left, castle on the right, roads, the farm; the horde marches, the generals appear
function map(g, t) {
  g.fillStyle = '#38b764'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#257179'; for (let i = 0; i < 40; i++) g.fillRect((i * 53) % W, (i * 29) % H, 2, 2);
  g.fillStyle = '#5d275d'; g.fillRect(0, 20, 34, 70); g.fillStyle = '#29366f'; for (let i = 0; i < 6; i++) g.fillRect(4 + (i * 7) % 26, 26 + i * 10, 6, 3); // the swamp
  g.fillStyle = '#566c86'; g.fillRect(212, 42, 22, 22); g.fillStyle = '#94b0c2'; g.fillRect(214, 38, 4, 6); g.fillRect(228, 38, 4, 6); g.fillStyle = '#b13e53'; g.fillRect(221, 34, 2, 6); // the castle
  g.fillStyle = '#a8805e'; g.fillRect(118, 40, 14, 10); g.fillStyle = '#b13e53'; g.fillRect(116, 36, 18, 5); // the farm
  const roads = [[[34, 30], [90, 30], [90, 60], [210, 60]], [[34, 80], [150, 80], [150, 55], [210, 55]]];
  g.fillStyle = '#8a6248';
  const along = (r, k) => { // point at fraction k of a road polyline
    const segs = r.slice(1).map((p, i) => [r[i], p, Math.hypot(p[0] - r[i][0], p[1] - r[i][1])]), total = segs.reduce((a, s) => a + s[2], 0);
    let d = k * total; for (const [a, b, l] of segs) { if (d <= l) return [a[0] + (b[0] - a[0]) * d / l, a[1] + (b[1] - a[1]) * d / l]; d -= l; } return r[r.length - 1];
  };
  for (const r of roads) for (let k = 0; k <= 1; k += 0.005) { const [x, y] = along(r, k); g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3); }
  // the horde: little slimes moving along the roads, the front creeps forward with time
  for (const r of roads) for (let i = 0; i < 14; i++) {
    const k = ((t * 0.12 + i * 0.05) % 0.75);
    const [x, y] = along(r, k); g.fillStyle = i % 4 ? '#38b764' : '#a7f070'; g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 3); g.fillStyle = '#1a1c2c'; g.fillRect(Math.round(x), Math.round(y) - 1, 1, 1);
  }
  // the generals light up one by one (red markers with names)
  const gens = [['Ґрок', 60, 22], ['Мама Слизу', 40, 92], ['Барон', 120, 88], ['КОРОЛЬ', 14, 12]];
  gens.forEach(([name, x, y], i) => {
    if (t < 0.6 + i * 0.8) return;
    const pulse = Math.floor(t * 4) % 2;
    g.fillStyle = '#1a1c2c'; g.fillRect(x - 3, y - 3, 7, 7); g.fillStyle = pulse ? '#b13e53' : '#ef7d57'; g.fillRect(x - 2, y - 2, 5, 5);
    g.font = '7px monospace'; g.fillStyle = '#1a1c2c'; g.fillText(name, x + 5, y + 3); g.fillStyle = i === 3 ? '#ffcd75' : '#f4f4f4'; g.fillText(name, x + 4, y + 2);
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
