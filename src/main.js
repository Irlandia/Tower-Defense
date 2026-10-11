// Client entry: menu/lobby, fixed-tick loop (solo / co-op host / co-op guest), input, DOM UI.
// All game rules live in ./sim; meta-progression in ./meta; networking in ./net.
import { TILE, TICK_RATE, TOWERS, TOWER_ORDER, BRANCHES, CARDS, CONFIG, ABILITIES } from './sim/data.js';
import {
  createGame, step, canPlace, towerAt, obstacleAt, barrelAt, towerStats, upgradeCost, canEvolve, sellValue, clearCost,
  enemyAt, abilityMax, isRoad,
} from './sim/sim.js';
import { Renderer, W, H, MX, MY } from './render.js';
import { drawTower, C } from './sprites.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import * as Meta from './meta.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const net = new Net();
const meta = Meta.load();

let state = createGame(1);
let running = false;
let pending = [];
let diff = 'normal';
const ui = { build: null, selected: null, hover: null, mouse: null, ability: null, hoverEnemy: null, partner: null };
let lastSmite = 0;
let speed = 1;
let paused = false;
let freezeUntil = 0;
const collected = new Set();

// ---------- game lifecycle ----------
function startGame(seed, opts) {
  state = createGame(seed, opts);
  pending = [];
  net.inbox = [];
  collected.clear();
  ui.build = null; ui.selected = null; ui.ability = null;
  paused = false; speed = 1;
  $('speed').textContent = 'x1';
  $('pause').textContent = '❚❚';
  running = true;
  hide('modal'); hide('menu');
  infoKey = ''; popKey = '';
  buildToolbar();
  document.body.classList.toggle('guest', net.role === 'guest');
}

function newRun() {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const opts = Meta.gameOpts(meta, diff);
  if (net.role === 'host') net.send({ t: 'start', seed, opts });
  startGame(seed, opts);
}

function send(cmd) {
  if (net.role === 'guest') net.send({ t: 'cmd', cmd });
  else pending.push(cmd);
}

// ---------- network ----------
net.onStatus = (text, kind) => {
  $('netStatus').textContent = text;
  $('netStatus').className = kind;
  $('lobbyStatus').textContent = text;
  if (kind === 'good' && net.role === 'host') newRun(); // partner joined: restart together
};
net.onMessage = (m) => {
  switch (m.t) {
    case 'cmd': if (net.role === 'host') pending.push(m.cmd); break;
    case 'start': startGame(m.seed, m.opts); break;
    case 'tick': case 'cmds': net.inbox.push(m); break;
    case 'cursor': ui.partner = { x: m.x, y: m.y, at: performance.now() }; break;
  }
};

// ---------- layout: as big as the window allows ----------
function fit() {
  const side = window.innerWidth >= 1000;
  document.body.classList.toggle('side', side);
  const availW = window.innerWidth - (side ? 290 : 24);
  const availH = window.innerHeight - (side ? 24 : 190);
  const scale = Math.max(1, Math.floor(Math.min(availW / W, availH / H) * 2) / 2);
  canvas.style.width = W * scale + 'px';
  canvas.style.height = H * scale + 'px';
  popKey = '';
}
window.addEventListener('resize', fit);

// ---------- input ----------
function toMap(ev) {
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * W - MX;
  const y = ((ev.clientY - r.top) / r.height) * H - MY;
  return { x, y, tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

let lastCursor = 0;
canvas.addEventListener('mousemove', (ev) => {
  const m = toMap(ev);
  ui.mouse = m;
  ui.hover = m.y >= 0 && m.x >= 0 ? { tx: m.tx, ty: m.ty } : null;
  const en = enemyAt(state, m.x, m.y);
  ui.hoverEnemy = en ? en.id : null;
  canvas.style.cursor = en && !ui.build && !ui.ability ? "pointer" : "crosshair";
  // coins are collected by hovering over them
  for (const c of state.coins) {
    if (!collected.has(c.id) && Math.hypot(c.x - m.x, c.y - m.y) < 10) { collected.add(c.id); send({ type: 'collect', id: c.id }); }
  }
  if (net.connected && performance.now() - lastCursor > 80) {
    lastCursor = performance.now();
    net.send({ t: 'cursor', x: Math.round(m.x), y: Math.round(m.y) });
  }
});
canvas.addEventListener('mouseleave', () => { ui.hover = null; ui.mouse = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); });
canvas.addEventListener('mousedown', (ev) => {
  sfx.unlock();
  if (ev.button !== 0 || !running) return;
  const m = toMap(ev);
  if (m.y < 0) return;
  if (ui.ability === "meteor") { send({ type: "meteor", x: m.x, y: m.y }); ui.ability = null; return; }
  if (ui.ability === "wall") {
    if (isRoad(state, m.tx, m.ty)) { send({ type: "wall", tx: m.tx, ty: m.ty }); ui.ability = null; }
    return;
  }
  const t = towerAt(state, m.tx, m.ty);
  if (t) { select('t' + t.id); ui.build = null; return; }
  const b = barrelAt(state, m.tx, m.ty);
  if (b) { if (b.ready) send({ type: 'barrel', id: b.id }); return; }
  const o = obstacleAt(state, m.tx, m.ty);
  if (o) { select("o" + o.id); ui.build = null; return; }
  // click an enemy to hit it (combo for quick consecutive hits)
  const en = enemyAt(state, m.x, m.y);
  if (en && !ui.build) {
    if (performance.now() - lastSmite > 90) { lastSmite = performance.now(); send({ type: "smite", id: en.id }); }
    return;
  }
  if (ui.build) {
    if (canPlace(state, m.tx, m.ty) && state.gold >= TOWERS[ui.build].cost) {
      send({ type: 'place', kind: ui.build, tx: m.tx, ty: m.ty });
      if (!ev.shiftKey && state.gold - TOWERS[ui.build].cost < TOWERS[ui.build].cost) ui.build = null;
    }
    return;
  }
  ui.selected = null;
});

function select(key) { ui.selected = key; sfx.play('click'); }
function cancel() { ui.build = null; ui.selected = null; ui.ability = null; }
const selTower = () => ui.selected && ui.selected[0] === 't' ? state.towers.find((k) => 't' + k.id === ui.selected) : null;
const selObstacle = () => ui.selected && ui.selected[0] === 'o' ? state.obstacles.find((k) => 'o' + k.id === ui.selected) : null;

function selectBuild(kind) {
  sfx.unlock();
  if (state.opts.locked.includes(kind)) return;
  ui.ability = null;
  ui.selected = null;
  ui.build = ui.build === kind ? null : kind;
  sfx.play('click');
}
function useAbility(id) {
  sfx.unlock();
  if (state.cds[id] > 0 || !running) return;
  ui.build = null;
  if (id === "nova") { send({ type: "nova" }); return; }
  ui.ability = ui.ability === id ? null : id;
}
function nextWave() { sfx.unlock(); send({ type: 'nextWave' }); }
function upgradeSel() { const t = selTower(); if (t) send({ type: 'upgrade', id: t.id }); }
function sellSel() { const t = selTower(); if (t) { send({ type: 'sell', id: t.id }); ui.selected = null; } }
function toggleSpeed() { if (net.role === 'guest') return; speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('speed').textContent = 'x' + speed; }
function togglePause() { if (net.role === 'guest') return; paused = !paused; $('pause').textContent = paused ? '▶' : '❚❚'; }

window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.target.tagName === 'INPUT' || !running) return;
  const k = ev.key.toLowerCase();
  if (state.draft && ['1', '2', '3', '4'].includes(k)) { pickCard(+k - 1); return; }
  const idx = ['1', '2', '3', '4', '5'].indexOf(k);
  if (idx >= 0) selectBuild(TOWER_ORDER[idx]);
  else if (k === "q") useAbility("meteor");
  else if (k === "w") useAbility("nova");
  else if (k === "e") useAbility("wall");
  else if (k === ' ') { ev.preventDefault(); nextWave(); }
  else if (k === 'u') upgradeSel();
  else if (k === 's') sellSel();
  else if (k === 'f') toggleSpeed();
  else if (k === 'p') togglePause();
  else if (k === 'escape') cancel();
});

// ---------- toolbar ----------
function buildToolbar() {
  const bar = $('towers');
  bar.innerHTML = '';
  TOWER_ORDER.forEach((kind, i) => {
    const def = TOWERS[kind];
    const locked = state.opts.locked.includes(kind);
    const b = document.createElement('button');
    b.className = 'tower-btn' + (locked ? ' locked' : '');
    b.dataset.kind = kind;
    b.title = locked ? 'Відкривається в магазині за кристали' : `${def.name} [${i + 1}] — ${def.desc}`;
    const ic = document.createElement('canvas');
    ic.width = 16; ic.height = 16;
    drawTower(ic.getContext('2d'), kind, 0, 0, 1);
    b.append(ic);
    const label = document.createElement('span');
    label.className = 'label';
    label.innerHTML = `<b>${def.name}</b><span class="cost">${locked ? '🔒' : '● ' + def.cost}</span>`;
    b.append(label);
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = i + 1;
    b.append(key);
    b.addEventListener('click', () => selectBuild(kind));
    bar.append(b);
  });
}
for (const id of Object.keys(ABILITIES)) {
  const a = ABILITIES[id];
  const b = document.createElement("button");
  b.className = "ability";
  b.id = "ab-" + id;
  b.title = a.desc;
  b.innerHTML = `<span class="ab-name">${a.name}</span><span class="key">${a.key}</span><span class="cd"></span>`;
  b.addEventListener("click", () => useAbility(id));
  $("abilities").append(b);
}
$('next').addEventListener('click', nextWave);
$('speed').addEventListener('click', toggleSpeed);
$('pause').addEventListener('click', togglePause);
$('mute').addEventListener('click', () => { sfx.muted = !sfx.muted; $('mute').textContent = sfx.muted ? '🔇' : '🔊'; });
$('toMenu').addEventListener('click', () => { if (confirm('Вийти в меню? Поточна гра буде втрачена.')) openMenu(); });

// ---------- on-map popup for towers / obstacles ----------
let popKey = '';
$('pop').addEventListener('mousedown', (ev) => ev.stopPropagation());
$('pop').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const t = selTower();
  if (a.dataset.act === 'upgrade') upgradeSel();
  if (a.dataset.act === 'sell') sellSel();
  if (a.dataset.act === 'evolve' && t) send({ type: 'evolve', id: t.id, kind: a.dataset.kind });
  if (a.dataset.act === 'clear') { const o = selObstacle(); if (o) send({ type: 'clear', id: o.id }); ui.selected = null; }
});

function placePop(tx, ty) {
  const pop = $('pop');
  const scale = canvas.clientWidth / W;
  const cx = (MX + tx * TILE + 12) * scale;
  const above = ty >= 5;
  const y = (MY + (above ? ty * TILE - 12 : (ty + 1) * TILE)) * scale;
  pop.style.left = Math.max(0, Math.min(canvas.clientWidth - pop.offsetWidth, cx - pop.offsetWidth / 2)) + 'px';
  pop.style.top = (above ? y - pop.offsetHeight - 6 : y + 6) + 'px';
}

function updatePop() {
  const pop = $('pop');
  const t = selTower();
  const o = selObstacle();
  if (!t && !o) { if (popKey) { pop.className = 'hidden'; popKey = ''; } return; }
  let key, html;
  if (t) {
    const def = TOWERS[t.kind];
    const st = towerStats(state, t);
    const up = upgradeCost(t);
    const evo = canEvolve(t);
    key = `t${t.id}:${t.kind}:${t.level}:${Math.floor(state.gold / 5)}:${Math.round(st.dmg)}:${st.buff}`;
    html = `<div class="pop-title"><b>${def.name}</b> <span>${def.from ? '★ еволюція' : 'рів. ' + t.level}</span></div>
      <div class="pop-stats"><span>⚔ ${Math.round(st.dmg)}</span><span>◎ ${Math.round(st.range)}</span><span>⏱ ${(TICK_RATE / st.period).toFixed(1)}/с</span>${st.buff ? `<span class="buff">⚡+${Math.round(st.buff * 100)}%</span>` : ''}</div>`;
    if (up) html += `<button data-act="upgrade" ${state.gold < up ? 'disabled' : ''}>▲ Покращити <i>● ${up}</i></button>`;
    if (evo) {
      html += '<div class="evo-title">Еволюція — обери шлях:</div><div class="evo">';
      for (const k of BRANCHES[t.kind]) {
        const d = TOWERS[k];
        html += `<button class="evo-btn" data-act="evolve" data-kind="${k}" ${state.gold < d.cost ? 'disabled' : ''}>
          <canvas data-icon="${k}" width="16" height="16"></canvas><b>${d.name}</b><span>${d.desc}</span><i>● ${d.cost}</i></button>`;
      }
      html += '</div>';
    }
    html += `<button data-act="sell" class="sell">Продати <i>+${sellValue(t)}</i></button>`;
  } else {
    const cost = clearCost(o);
    key = `o${o.id}:${state.gold >= cost}`;
    html = `<div class="pop-title"><b>${o.kind === 'tree' ? 'Дерево' : 'Камінь'}</b></div>
      <div class="pop-stats"><span>Звільняє місце під вежу. Іноді там скарб!</span></div>
      <button data-act="clear" ${state.gold < cost ? 'disabled' : ''}>⛏ Розчистити <i>● ${cost}</i></button>`;
  }
  if (key !== popKey) {
    popKey = key;
    pop.innerHTML = html;
    pop.className = '';
    for (const cv of pop.querySelectorAll('canvas[data-icon]')) drawTower(cv.getContext('2d'), cv.dataset.icon, 0, 0, 4);
  }
  placePop(t ? t.tx : o.tx, t ? t.ty : o.ty);
}

// ---------- side info ----------
let infoKey = '';
function updateUI() {
  for (const b of document.querySelectorAll('.tower-btn')) {
    b.classList.toggle('active', ui.build === b.dataset.kind);
    b.classList.toggle('poor', state.gold < TOWERS[b.dataset.kind].cost);
  }
  for (const id of Object.keys(ABILITIES)) {
    const b = $("ab-" + id);
    b.classList.toggle("active", ui.ability === id);
    b.classList.toggle("cooling", state.cds[id] > 0);
    b.style.setProperty("--cd", (state.cds[id] / abilityMax(state, id)).toFixed(3));
  }
  const early = state.wave > 0 && !state.queue.length ? Math.ceil(state.countdown / TICK_RATE) * CONFIG.earlyBonus : 0;
  const last = state.wave >= CONFIG.winWave;
  $('next').textContent = last ? 'Фінал!' : state.queue.length ? 'Хвиля йде…' : early ? `Хвиля ▶ +${early}●` : 'Почати ▶';
  $('next').disabled = state.queue.length > 0 || last;
  $('waveInfo').textContent = `Хвиля ${state.wave} / ${CONFIG.winWave}`;
  $('waveBar').style.width = (100 * state.wave) / CONFIG.winWave + '%';

  let key, html;
  if (ui.build) {
    const def = TOWERS[ui.build];
    key = 'b' + ui.build;
    html = `<b>${def.name}</b><br>${def.desc}<br><span class="hint">Shift — ставити кілька · ПКМ — скасувати</span>`;
  } else if (ui.ability) {
    const a = ABILITIES[ui.ability];
    key = "a" + ui.ability;
    html = `<b>${a.name}</b><br>${a.desc}<br><span class="hint">ПКМ — скасувати</span>`;
  } else {
    key = 'h';
    html = `<b>Порада</b><br>Крига робить ворогів <span class="wet">мокрими</span>: Тесла бʼє їх x2, а Вогонь викликає вибух пари.<br>
      <span class="hint">⚔ Клікай по ворогах — удар з комбо до x5! · 🛢 бочки — вибух · 🌳 дерева — скарби · монети — наводь мишку · стрілки показують, звідки піде хвиля.</span>`;
  }
  if (key !== infoKey) { infoKey = key; $('info').innerHTML = html; }
  updatePop();
}

// ---------- modals ----------
function hide(id) { $(id).classList.add('hidden'); }

function showDraft() {
  const m = $('modal');
  m.innerHTML = `<h2>Хвилю ${state.wave} відбито!</h2><p>Обери посилення${net.online ? ' (обирає той, хто клікне першим)' : ''}</p><div class="cards"></div>`;
  state.draft.forEach((id, i) => {
    const c = CARDS.find((k) => k.id === id);
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = `<span class="key">${i + 1}</span><b>${c.name}</b><span>${c.desc}</span>`;
    el.addEventListener('click', () => pickCard(i));
    m.querySelector('.cards').append(el);
  });
  m.classList.remove('hidden');
}
function pickCard(i) {
  if (!state.draft) return;
  send({ type: 'pick', index: i });
  sfx.play('card');
}

function showEnd(won) {
  running = false;
  const { earned, record } = Meta.finishRun(meta, state);
  const m = $('modal');
  m.innerHTML = `<h2 class="${won ? 'win' : ''}">${won ? 'ПЕРЕМОГА!' : 'Замок впав'}</h2>
    <p>Хвиля <b>${state.wave}</b> / ${CONFIG.winWave} · Вбито <b>${state.kills}</b>${record ? ' · <span class="rec">Новий рекорд!</span>' : ''}</p>
    <p class="crys">+${earned} 💎 <span>(усього ${meta.crystals})</span></p>
    ${won && state.opts.diff !== 'nightmare' ? '<p class="rec">Відкрито нову складність!</p>' : ''}
    <div class="row">${net.role === 'guest' ? '<p>Чекаємо, поки хост почне нову гру…</p>' : '<button id="again" class="big">Ще раз</button>'}<button id="menuBtn" class="big">Меню / Магазин</button></div>`;
  m.classList.remove('hidden');
  if ($('again')) $('again').addEventListener('click', newRun);
  $('menuBtn').addEventListener('click', openMenu);
}

function banner(text, cls = '') {
  const b = $('banner');
  b.textContent = text;
  b.className = 'show ' + cls;
  clearTimeout(banner.t);
  banner.t = setTimeout(() => { b.className = ''; }, 1600);
}

// ---------- menu / lobby / shop ----------
function openMenu() {
  running = false;
  hide('modal');
  $("pop").className = "hidden";
  renderMenu();
  $('menu').classList.remove('hidden');
}

function renderMenu() {
  $('crystals').textContent = meta.crystals;
  const dl = $('diffs');
  dl.innerHTML = '';
  for (const d of Meta.DIFFS) {
    const ok = Meta.unlockedDiff(meta, d);
    const b = document.createElement('button');
    b.className = 'diff' + (diff === d.id ? ' active' : '');
    b.disabled = !ok;
    b.innerHTML = `<b>${ok ? '' : '🔒 '}${d.name}</b><span>${ok ? `рекорд: ${meta.best[d.id] || 0}/${CONFIG.winWave}${meta.wins[d.id] ? ' · 🏆' + meta.wins[d.id] : ''}` : 'Переможи на попередній'}</span>`;
    b.addEventListener('click', () => { diff = d.id; renderMenu(); });
    dl.append(b);
  }
  const shop = $('shop');
  shop.innerHTML = '';
  for (const it of Meta.SHOP) {
    const lv = Meta.level(meta, it.id);
    const max = lv >= it.cost.length;
    const b = document.createElement('button');
    b.className = 'shop-item' + (max ? ' max' : '');
    b.disabled = max || meta.crystals < it.cost[lv];
    b.innerHTML = `<b>${it.name}</b><span>${it.desc}</span><i>${max ? 'КУПЛЕНО' : it.cost[lv] + ' 💎'}${it.cost.length > 1 ? ` · ${lv}/${it.cost.length}` : ''}</i>`;
    b.addEventListener('click', () => { if (Meta.buy(meta, it.id)) { sfx.unlock(); sfx.play('card'); renderMenu(); } });
    shop.append(b);
  }
}

$('playSolo').addEventListener('click', () => { sfx.unlock(); net.leave(); $('netStatus').textContent = ''; newRun(); });
$('hostBtn').addEventListener('click', async () => {
  sfx.unlock();
  net.leave();
  $('lobbyStatus').textContent = 'Створюємо кімнату…';
  try {
    const code = await net.host();
    $('roomCode').textContent = code;
    $('roomBox').classList.remove('hidden');
  } catch (e) { $('lobbyStatus').textContent = e.message || 'Не вдалося створити кімнату'; }
});
$('joinBtn').addEventListener('click', async () => {
  sfx.unlock();
  const code = $('joinCode').value.trim();
  if (code.length < 4) { $('lobbyStatus').textContent = 'Введи код кімнати'; return; }
  net.leave();
  $('lobbyStatus').textContent = 'Підключаємось…';
  try { await net.join(code); $('lobbyStatus').textContent = 'Підключено! Чекаємо старт від хоста…'; } catch (e) { /* status already shown */ }
});
$('copyCode').addEventListener('click', () => { navigator.clipboard?.writeText($('roomCode').textContent); $('copyCode').textContent = '✓'; });

// ---------- events -> sound/UI ----------
function handleEvents(events) {
  renderer.onEvents(events, state);
  for (const e of events) {
    switch (e.type) {
      case 'shoot': sfx.play(e.kind); break;
      case 'zap': sfx.play('zap'); break;
      case 'hit': sfx.play('hit'); break;
      case 'death': sfx.play('death'); if (e.kind === 'boss' || e.kind === 'king') freezeUntil = performance.now() + 150; break;
      case 'explode': case 'steam': case 'barrel': sfx.play('explode'); break;
      case 'meteor': sfx.play('meteor'); freezeUntil = performance.now() + 80; break;
      case 'build': case 'upgrade': case 'clear': sfx.play('build'); break;
      case 'evolve': sfx.play('card'); popKey = ''; break;
      case 'sell': case 'coin': case 'chest': sfx.play('sell'); break;
      case 'leak': case 'stolen': sfx.play('leak'); break;
      case 'wave':
        sfx.play('wave');
        banner(e.final ? 'ФІНАЛЬНА ХВИЛЯ!' : e.boss ? `Хвиля ${e.wave} — БОС!` : `Хвиля ${e.wave}`, e.boss ? 'boss' : '');
        break;
      case "nova": sfx.play("frost"); sfx.play("explode"); break;
      case "smite": sfx.play(e.combo >= 3 ? "build" : "click"); break;
      case "wallup": case "wallbreak": sfx.play("cannon"); break;
      case 'bonus': banner(`+${e.gold} золота`, 'gold'); break;
      case 'waveclear': showDraft(); break;
      case 'gameover': sfx.play('gameover'); showEnd(false); break;
      case 'victory': sfx.play('card'); showEnd(true); break;
    }
  }
  if (!state.draft && !$('modal').classList.contains('hidden') && !state.over) hide('modal');
}

function drawPartnerCursor() {
  const p = ui.partner;
  if (!p || performance.now() - p.at > 3000) return;
  const g = canvas.getContext('2d');
  const x = Math.round(p.x) + MX, y = Math.round(p.y) + MY;
  g.fillStyle = C.ink;
  g.fillRect(x - 1, y - 1, 5, 7);
  g.fillStyle = C.cyan;
  for (let i = 0; i < 5; i++) g.fillRect(x, y + i, Math.max(1, 4 - i), 1);
}

// ---------- main loop ----------
const DT = 1000 / TICK_RATE;
let acc = 0;
let last = performance.now();
let lastTickAt = 0;

function tick(cmds, advance = true) {
  step(state, cmds, advance);
  if (net.role === 'host') net.send({ t: advance ? 'tick' : 'cmds', cmds });
  handleEvents(state.events);
}

function frame(now) {
  const real = Math.min(250, now - last);
  last = now;
  let alpha = 1;
  if (running && net.role === 'guest') {
    // replay the host's ticks; catch up quickly if we fell behind
    while (net.inbox.length) {
      const m = net.inbox.shift();
      step(state, m.cmds, m.t === 'tick');
      handleEvents(state.events);
      if (m.t === 'tick') lastTickAt = now;
    }
    alpha = Math.min(1, (now - lastTickAt) / DT);
  } else if (running) {
    if (state.draft || state.over) acc = 0;
    else if (!paused && now >= freezeUntil) acc += real * speed;
    while (acc >= DT) {
      const cmds = pending;
      pending = [];
      tick(cmds);
      acc -= DT;
    }
    // commands issued while paused / in a draft apply without advancing time
    if (pending.length) { const cmds = pending; pending = []; tick(cmds, false); }
    alpha = paused ? 1 : acc / DT;
  }
  renderer.draw(state, alpha, ui, real / 1000);
  drawPartnerCursor();
  if (running) updateUI();
  requestAnimationFrame(frame);
}

buildToolbar();
fit();
if (new URLSearchParams(location.search).has('demo')) {
  // debug: start immediately with a few towers to check rendering
  newRun();
  state.gold = 2000;
  state.opts.locked = [];
  // put each tower type on a free tile next to the road
  const spots = [];
  for (let ty = 0; ty < 14 && spots.length < 5; ty++) for (let tx = 2; tx < 24 && spots.length < 5; tx += 3) {
    if (canPlace(state, tx, ty) && (isRoad(state, tx, ty + 1) || isRoad(state, tx + 1, ty))) spots.push([tx, ty]);
  }
  spots.forEach(([tx, ty], i) => send({ type: "place", kind: TOWER_ORDER[i], tx, ty }));
  send({ type: 'nextWave' });
} else openMenu();
requestAnimationFrame(frame);
