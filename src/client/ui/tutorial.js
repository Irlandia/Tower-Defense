// First-run tutorial: a few short hints in the first solo classic game, each closed by doing the thing.
// UI only — reads the state, never sends commands. Shown once (localStorage), skippable.
import { canPlace } from '../../sim/sim.js';
import { COLS, ROWS } from '../../sim/data.js';
import { app, ui, net, bus, me } from '../app.js';
import { $ } from '../dom.js';

const KEY = 'pixeltd-tutorial-done';
const done = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const finish = () => { try { localStorage.setItem(KEY, '1'); } catch { /* private mode: show again next time */ } };

// Each step: text, optional tile highlight, and the condition that completes it (t = seconds on this step).
const STEPS = [
  { text: 'Обери <b>Лучника</b> (клавіша <b>1</b>) і постав його біля дороги — найкраще там, де вона вигинається.', tile: true,
    done: (s) => s.towers.some((t) => t.owner === me()) },
  { text: 'Натисни <b>«Почати ▶»</b> або <b>Пробіл</b>. Викликаєш хвилю раніше — отримуєш бонусне золото.',
    done: (s) => s.wave >= 1 },
  { text: 'Вбивства дають золото. <b>Клікни свою вежу</b>, щоб прокачати її. На 3 рівні вона еволюціонує в одну з двох веж.',
    done: (s, t) => s.towers.some((k) => k.owner === me() && k.level >= 2) || t > 40 },
  { text: '<b>Комбо:</b> Крига робить ворогів мокрими 💧 — Тесла бʼє мокрих ×2, а Вогонь підриває їх парою.',
    done: (s, t) => t > 12 },
  { text: 'Здібності — клавіші <b>Q W E</b>: метеор по натовпу, заморозка, барикада на дорозі. Перезаряджаються самі.',
    done: (s, t) => t > 12 || Object.values(s.players[me()].cds).some((v) => v > 0) },
  { text: 'Кожні 5 хвиль — <b>бос</b>. За нього даються таланти. Вистій 20 хвиль — і долина врятована. Успіхів!',
    done: (s, t) => t > 8 },
];

let step = -1, since = 0;

function box() {
  let el = $('tutor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tutor';
    el.className = 'hidden';
    el.innerHTML = '<span class="tt-text"></span><button class="tt-skip" title="Пропустити навчання">✕</button>';
    $('stage').append(el);
    el.querySelector('.tt-skip').addEventListener('click', () => stop(true));
  }
  return el;
}

function show(i) {
  step = i;
  since = performance.now();
  const el = box();
  el.querySelector('.tt-text').innerHTML = STEPS[i].text;
  el.classList.remove('hidden');
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  ui.tutorTile = STEPS[i].tile ? bestTile(app.state) : null;
}

function stop(complete) {
  step = -1;
  ui.tutorTile = null;
  box().classList.add('hidden');
  if (complete) finish();
}

// The free tile with the most road around it (same idea the balance bot uses).
function bestTile(s) {
  const road = [...s.map.tiles].map((k) => k.split(',').map(Number));
  let best = null, bestN = -1;
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!canPlace(s, tx, ty)) continue;
    const n = road.filter(([x, y]) => Math.hypot(x - tx, y - ty) <= 2.5).length;
    if (n > bestN) { bestN = n; best = { tx, ty }; }
  }
  return best;
}

bus.on('run:start', () => {
  const s = app.state;
  if (done() || net.role !== 'solo' || s.mode !== 'classic' || s.mission || s.brawl || new URLSearchParams(location.search).has('demo')) { stop(false); return; }
  show(0);
});
bus.on('run:end', () => { if (step >= 0) stop(false); });
bus.on('menu:show', () => { if (step >= 0) box().classList.add('hidden'); });
bus.on('run:resume', () => { if (step >= 0) box().classList.remove('hidden'); });

bus.on('frame', () => {
  if (step < 0 || !app.running) return;
  const s = app.state;
  if (ui.tutorTile && !canPlace(s, ui.tutorTile.tx, ui.tutorTile.ty)) ui.tutorTile = null;
  if (!STEPS[step].done(s, (performance.now() - since) / 1000)) return;
  if (step + 1 < STEPS.length) show(step + 1);
  else stop(true);
});

