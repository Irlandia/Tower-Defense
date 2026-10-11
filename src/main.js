// Client entry: menu/lobby, fixed-tick loop (solo / co-op host / co-op guest), input, DOM UI.
// All game rules live in ./sim; meta-progression in ./meta; networking in ./net; nick + leaderboard in ./api.
import { TILE, TICK_RATE, TOWERS, TOWER_ORDER, BRANCHES, CARDS, CONFIG, ABILITIES, MODES, VERSION, BOSSES } from './sim/data.js';
import {
  createGame, step, canPlace, towerAt, obstacleAt, barrelAt, towerStats, upgradeCost, canEvolve, sellValue, clearCost,
  enemyAt, abilityMax, isRoad,
} from './sim/sim.js';
import { Renderer, W, H, MX, MY, PLAYER_COLORS } from './render.js';
import { drawTower, C } from './sprites.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import * as Meta from './meta.js';
import * as Api from './api.js';

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
let mode = 'classic';
let nick = '';
let partnerNick = '';
const ui = { build: null, selected: null, hover: null, mouse: null, ability: null, hoverEnemy: null, partner: null, me: 0 };
let speed = 1;
let paused = false;
let draftPause = false; // solo only: the talent window pauses the game
let freezeUntil = 0;
const collected = new Set();
// host: every command batch since the start, to resync a guest that reconnects mid-game
let cmdLog = [];
let game = null; // { seed, opts }

const me = () => (net.role === 'guest' ? 1 : 0);
const P = () => state.players[me()] || state.players[0];

// ---------- game lifecycle ----------
function startGame(seed, opts) {
  state = createGame(seed, opts);
  game = { seed, opts };
  cmdLog = [];
  pending = [];
  net.inbox = [];
  collected.clear();
  ui.build = null; ui.selected = null; ui.ability = null; ui.me = me();
  paused = false; draftPause = false; speed = 1;
  $('speed').textContent = 'x1';
  $('pause').textContent = '❚❚';
  running = true;
  hide("modal"); hide("menu");
  document.body.classList.remove("in-menu");
  infoKey = ''; popKey = '';
  buildToolbar();
  document.body.classList.toggle('guest', net.role === 'guest');
}

function newRun() {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const opts = Meta.gameOpts(meta, diff, mode, net.connected ? 2 : 1);
  if (net.role === 'host') net.send({ t: 'start', seed, opts, v: VERSION });
  startGame(seed, opts);
}

// Guest replays the host's whole command log to catch up after (re)connecting.
function resync(m) {
  startGame(m.seed, m.opts);
  for (const [tick, adv, cmds] of m.log) {
    while (state.tick < tick) step(state);
    step(state, cmds, adv);
  }
  while (state.tick < m.tick) step(state);
  lastMsgAt = performance.now();
}

function send(cmd) {
  if (net.role === 'guest') net.send({ t: 'cmd', cmd });
  else pending.push({ ...cmd, p: 0 });
}

// ---------- network ----------
let lastMsgAt = 0;
let partnerAlive = false;
function netStatus(text, kind = '') {
  $('netStatus').textContent = text;
  $('netStatus').className = kind;
  $('lobbyStatus').textContent = text;
}
// Different code on the two machines would silently desync, so refuse to play.
function mismatch(v) {
  netStatus(`Різні версії гри (у тебе ${VERSION}, у друга ${v === undefined ? 'стара' : v}). Обом оновити сторінку: Ctrl+F5`, 'bad');
  if (net.role === 'guest') net.leave();
  if (running && net.role === 'guest') openMenu();
}
// Partner gone (closed tab, lost network): guest goes back to the lobby, host keeps playing with the room open.
function partnerLost() {
  if (!partnerAlive) return;
  partnerAlive = false;
  ui.partner = null;
  if (net.role === 'guest') {
    net.leave();
    if (running) openMenu();
    netStatus('Хост відключився — гру завершено', 'bad');
  } else if (net.role === 'host') {
    if (net.conn) { net.conn.close(); net.conn = null; } // free the slot so the partner can reconnect
    netStatus('Друг відключився. Кімната відкрита — він може повернутися', 'bad');
    if (running) banner('Друг відключився', 'boss');
  }
}
net.onStatus = (text, kind) => {
  netStatus(text, kind);
  if (kind === 'good') { partnerAlive = true; lastMsgAt = performance.now(); net.send({ t: 'hello', nick, v: VERSION }); }
  if (kind === 'bad' && net.conn) partnerLost();
};
net.onMessage = (m) => {
  lastMsgAt = performance.now();
  partnerAlive = true;
  switch (m.t) {
    case 'cmd': if (net.role === 'host') pending.push({ ...m.cmd, p: 1 }); break;
    case 'start': if (m.v === VERSION) startGame(m.seed, m.opts); else mismatch(m.v); break;
    case 'resync': if (m.v === VERSION) resync(m); else mismatch(m.v); break;
    case 'tick': case 'cmds': net.inbox.push(m); break;
    case 'cursor': ui.partner = { x: m.x, y: m.y, at: performance.now() }; break;
    case "lobby": if (net.role === "guest") { openMenu(true); netStatus("Хост у меню — чекаємо нову гру", "good"); } break;
    case "hello":
      partnerNick = m.nick || 'Друг';
      if (m.v !== VERSION) { mismatch(m.v); break; }
      if (net.role === 'host') {
        // partner joined: start together, or bring a reconnecting partner up to date without restarting
        if (running && state.players.length > 1 && !state.over) {
          net.send({ t: 'resync', ...game, log: cmdLog, tick: state.tick, v: VERSION });
          netStatus('Друг повернувся', 'good');
        } else newRun();
      }
      break;
  }
};
// heartbeat both ways + timeout (PeerJS 'close' is not always fired, e.g. when a tab is killed)
setInterval(() => {
  if (!net.online || !net.conn) return;
  net.send({ t: 'ping' });
  if (partnerAlive && performance.now() - lastMsgAt > 5000) partnerLost();
}, 1000);

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
  if (ui.ability === 'meteor') { send({ type: 'meteor', x: m.x, y: m.y }); ui.ability = null; return; }
  if (ui.ability === 'wall') {
    if (isRoad(state, m.tx, m.ty)) { send({ type: 'wall', tx: m.tx, ty: m.ty }); ui.ability = null; }
    return;
  }
  const t = towerAt(state, m.tx, m.ty);
  if (t) { select('t' + t.id); ui.build = null; return; }
  const b = barrelAt(state, m.tx, m.ty);
  if (b) { if (b.ready) send({ type: 'barrel', id: b.id }); return; }
  const o = obstacleAt(state, m.tx, m.ty);
  if (o) { select('o' + o.id); ui.build = null; return; }
  if (ui.build) {
    const cost = TOWERS[ui.build].cost;
    if (canPlace(state, m.tx, m.ty) && P().gold >= cost) {
      send({ type: 'place', kind: ui.build, tx: m.tx, ty: m.ty });
      if (!ev.shiftKey && P().gold - cost < cost) ui.build = null;
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
  if (P().cds[id] > 0 || !running) return;
  ui.build = null;
  if (id === 'nova') { send({ type: 'nova' }); return; }
  ui.ability = ui.ability === id ? null : id;
}
function nextWave() { sfx.unlock(); send({ type: 'nextWave' }); }
function upgradeSel() { const t = selTower(); if (t) send({ type: 'upgrade', id: t.id }); }
function sellSel() { const t = selTower(); if (t && t.owner === me()) { send({ type: 'sell', id: t.id }); ui.selected = null; } }
function toggleSpeed() { if (net.role === 'guest') return; speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('speed').textContent = 'x' + speed; }
function togglePause() { if (net.role === 'guest') return; paused = !paused; $('pause').textContent = paused ? '▶' : '❚❚'; }

window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.target.tagName === 'INPUT' || !running) return;
  const k = ev.key.toLowerCase();
  if (talentOpen && ['1', '2', '3', '4'].includes(k)) { pickCard(+k - 1); return; }
  const idx = ['1', '2', '3', '4', '5'].indexOf(k);
  if (idx >= 0) selectBuild(TOWER_ORDER[idx]);
  else if (k === 'q') useAbility('meteor');
  else if (k === 'w') useAbility('nova');
  else if (k === 'e') useAbility('wall');
  else if (k === 't') openTalent();
  else if (k === ' ') { ev.preventDefault(); nextWave(); }
  else if (k === 'u') upgradeSel();
  else if (k === 's') sellSel();
  else if (k === 'f') toggleSpeed();
  else if (k === 'p') togglePause();
  else if (k === 'escape') { cancel(); closeTalent(); }
});

// ---------- toolbar ----------
function towerIcon(kind, level = 1) {
  const cv = document.createElement('canvas');
  cv.width = 28; cv.height = 40;
  drawTower(cv.getContext('2d'), kind, 2, 14, level);
  return cv;
}
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
    b.append(towerIcon(kind));
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
  const b = document.createElement('button');
  b.className = 'ability';
  b.id = 'ab-' + id;
  b.title = a.desc;
  b.innerHTML = `<span class="ab-name">${a.name}</span><span class="key">${a.key}</span><span class="cd"></span>`;
  b.addEventListener('click', () => useAbility(id));
  $('abilities').append(b);
}
$('next').addEventListener('click', nextWave);
$('talent').addEventListener('click', openTalent);
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
  const gold = P().gold;
  let key, html;
  if (t) {
    const def = TOWERS[t.kind];
    const st = towerStats(state, t);
    const mine = t.owner === me();
    const up = upgradeCost(t);
    const evo = canEvolve(t);
    key = `t${t.id}:${t.kind}:${t.level}:${Math.floor(gold / 5)}:${Math.round(st.dmg)}:${st.buff}`;
    html = `<div class="pop-title"><b>${def.name}</b> <span>${def.from ? '★ еволюція' : 'рів. ' + t.level}</span></div>
      <div class="pop-stats"><span>⚔ ${Math.round(st.dmg)}</span><span>◎ ${Math.round(st.range)}</span><span>⏱ ${(TICK_RATE / st.period).toFixed(1)}/с</span>${st.buff ? `<span class="buff">⚡+${Math.round(st.buff * 100)}%</span>` : ''}</div>`;
    if (!mine) {
      html += `<div class="pop-stats"><span style="color:${PLAYER_COLORS[t.owner]}">Вежа гравця ${partnerNick || 'союзника'}</span></div>`;
    } else {
      if (up) html += `<button data-act="upgrade" ${gold < up ? 'disabled' : ''}>▲ Покращити <i>● ${up}</i></button>`;
      if (evo) {
        html += '<div class="evo-title">Еволюція — обери шлях:</div><div class="evo">';
        for (const k of BRANCHES[t.kind]) {
          const d = TOWERS[k];
          html += `<button class="evo-btn" data-act="evolve" data-kind="${k}" ${gold < d.cost ? 'disabled' : ''}>
            <span class="icon" data-icon="${k}"></span><b>${d.name}</b><span>${d.desc}</span><i>● ${d.cost}</i></button>`;
        }
        html += '</div>';
      }
      html += `<button data-act="sell" class="sell">Продати <i>+${sellValue(t)}</i></button>`;
    }
  } else {
    const cost = clearCost(o);
    key = `o${o.id}:${gold >= cost}`;
    html = `<div class="pop-title"><b>${o.kind === 'tree' ? 'Дерево' : 'Камінь'}</b></div>
      <div class="pop-stats"><span>Звільняє місце під вежу. Іноді там скарб!</span></div>
      <button data-act="clear" ${gold < cost ? 'disabled' : ''}>⛏ Розчистити <i>● ${cost}</i></button>`;
  }
  if (key !== popKey) {
    popKey = key;
    pop.innerHTML = html;
    pop.className = '';
    for (const el of pop.querySelectorAll('[data-icon]')) el.replaceWith(towerIcon(el.dataset.icon, 4));
  }
  placePop(t ? t.tx : o.tx, t ? t.ty : o.ty);
}

// ---------- side info ----------
let infoKey = '';
function updateUI() {
  const pl = P();
  for (const b of document.querySelectorAll('.tower-btn')) {
    b.classList.toggle('active', ui.build === b.dataset.kind);
    b.classList.toggle('poor', pl.gold < TOWERS[b.dataset.kind].cost);
  }
  for (const id of Object.keys(ABILITIES)) {
    const b = $('ab-' + id);
    b.classList.toggle('active', ui.ability === id);
    b.classList.toggle('cooling', pl.cds[id] > 0);
    b.style.setProperty('--cd', (pl.cds[id] / abilityMax(state, id, me())).toFixed(3));
  }
  const early = state.wave > 0 && !state.queue.length ? Math.ceil(state.countdown / TICK_RATE) * CONFIG.earlyBonus : 0;
  const last = state.wave >= CONFIG.winWave;
  $('next').textContent = last ? 'Фінал!' : state.queue.length ? 'Хвиля йде…' : early ? `Хвиля ▶ +${early}●` : 'Почати ▶';
  $('next').disabled = state.queue.length > 0 || last;
  const n = pl.drafts.length;
  $('talent').classList.toggle('hidden', !n);
  $('talent').textContent = `✦ Талант${n > 1 ? ' x' + n : ''} [T]`;
  $('waveInfo').textContent = `${MODES[state.mode].name} · Хвиля ${state.wave} / ${CONFIG.winWave}`;
  $('waveBar').style.width = (100 * state.wave) / CONFIG.winWave + '%';
  const coop = state.players.length > 1;
  $('coopInfo').classList.toggle('hidden', !coop);
  if (coop) {
    const other = state.players[1 - me()];
    $('coopInfo').innerHTML = `<span style="color:${PLAYER_COLORS[me()]}">■ ${nick || 'Ти'}: ${pl.gold}●</span> <span style="color:${PLAYER_COLORS[1 - me()]}">■ ${partnerNick || 'Друг'}: ${other.gold}●</span>`;
  }

  let key, html;
  if (ui.build) {
    const def = TOWERS[ui.build];
    key = 'b' + ui.build;
    html = `<b>${def.name}</b><br>${def.desc}<br><span class="hint">Shift — ставити кілька · ПКМ — скасувати</span>`;
  } else if (ui.ability) {
    const a = ABILITIES[ui.ability];
    key = 'a' + ui.ability;
    html = `<b>${a.name}</b><br>${a.desc}<br><span class="hint">ПКМ — скасувати</span>`;
  } else {
    key = 'h' + state.mode;
    html = state.mode === 'circle'
      ? `<b>Коло</b><br>Вороги не доходять до замку — вони крутяться по колу і з кожним колом швидшають. Живих більше <b>${state.limit}</b> — поразка.`
      : '<b>Порада</b><br>Крига робить ворогів <span class="wet">мокрими</span>: Тесла бʼє їх x2, а Вогонь викликає вибух пари.';
    html += state.mode === "circle"
      ? "<br><span class=\"hint\">🌳 дерева — скарби · монети — наводь мишку. Удвох: кожен тримає свій вхід (печери зліва і справа).</span>"
      : "<br><span class=\"hint\">🛢 бочки — вибух · 🌳 дерева — скарби · монети — наводь мишку · стрілки показують, звідки піде хвиля.</span>";
  }
  if (key !== infoKey) { infoKey = key; $('info').innerHTML = html; }
  updatePop();
  if (talentOpen) renderTalent();
}

// ---------- talents (per player, never pause co-op) ----------
let talentOpen = false;
let talentKey = '';
function openTalent() {
  if (!P().drafts.length) return;
  talentOpen = true;
  talentKey = '';
  if (!net.online) { draftPause = true; }
  renderTalent();
}
function closeTalent() {
  if (!talentOpen) return;
  talentOpen = false;
  draftPause = false;
  hide('modal');
}
function renderTalent() {
  const draft = P().drafts[0];
  if (!draft) { closeTalent(); return; }
  const k = draft.join() + P().drafts.length;
  if (k === talentKey) return;
  talentKey = k;
  const m = $('modal');
  m.innerHTML = `<h2>Обери талант</h2><p>${net.online ? 'Твій особистий вибір — гра не зупиняється' : 'Гра на паузі'} · Esc — пізніше</p><div class="cards"></div>`;
  draft.forEach((id, i) => {
    const c = CARDS.find((x) => x.id === id);
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = `<span class="key">${i + 1}</span><b>${c.name}</b><span>${c.desc}</span>`;
    el.addEventListener('click', () => pickCard(i));
    m.querySelector('.cards').append(el);
  });
  m.classList.remove('hidden');
}
function pickCard(i) {
  if (!P().drafts.length) return;
  send({ type: 'pick', index: i });
  sfx.play('card');
  talentKey = '';
  // the pick lands next tick; close now if this was the last pending choice
  if (P().drafts.length <= 1) closeTalent();
}

// ---------- end of game ----------
function hide(id) { $(id).classList.add('hidden'); }

function showEnd(won) {
  running = false;
  talentOpen = false;
  const { earned, record } = Meta.finishRun(meta, state);
  const title = won ? 'ПЕРЕМОГА!' : state.mode === 'circle' ? 'Коло переповнене' : 'Замок впав';
  const m = $('modal');
  m.innerHTML = `<h2 class="${won ? 'win' : ''}">${title}</h2>
    <p>Хвиля <b>${state.wave}</b> / ${CONFIG.winWave} · Вбито <b>${state.kills}</b>${state.players.length > 1 ? ` (ти: ${P().kills})` : ''}${record ? ' · <span class="rec">Новий рекорд!</span>' : ''}</p>
    <p class="crys">+${earned} 💎 <span>(усього ${meta.crystals})</span></p>
    <p id="scoreMsg">${nick ? 'Надсилаємо результат…' : 'Введи нік у меню, щоб потрапити в таблицю лідерів'}</p>
    <div class="row">${net.role === 'guest' ? '<p>Чекаємо, поки хост почне нову гру…</p>' : '<button id="again" class="big">Ще раз</button>'}<button id="menuBtn" class="big">Меню</button></div>`;
  m.classList.remove('hidden');
  if ($('again')) $('again').addEventListener('click', newRun);
  $('menuBtn').addEventListener('click', openMenu);
  if (nick) {
    Api.addScore({ mode: state.mode, diff: state.opts.diff, wave: state.wave, kills: state.kills, won, coop: state.players.length > 1, partner: partnerNick })
      .then((r) => { $('scoreMsg').textContent = `Результат у таблиці лідерів: ${r.score} очок`; })
      .catch((e) => { $('scoreMsg').textContent = 'Таблиця лідерів недоступна: ' + e.message; });
  }
}

function banner(text, cls = "", sub = "", ms = 1600) {
  const b = $("banner");
  b.innerHTML = "";
  b.append(text);
  if (sub) { const s = document.createElement("small"); s.textContent = sub; b.append(s); }
  b.className = 'show ' + cls;
  clearTimeout(banner.t);
  banner.t = setTimeout(() => { b.className = ""; }, ms);
}

// ---------- menu / lobby / shop / leaderboard ----------
let boardMode = 'classic';
function openMenu(fromNet = false) {
  // host leaving to the lobby takes the guest along (instead of leaving them on a frozen game)
  if (running && net.role === "host" && net.connected && !fromNet) net.send({ t: "lobby" });
  running = false;
  document.body.classList.add("in-menu");
  talentOpen = false;
  hide('modal');
  $('pop').className = 'hidden';
  renderMenu();
  loadBoard();
  $("menu").classList.remove("hidden");
}

// The big start button depends on the room: solo, start together (host), or wait (guest).
function updatePlayButton() {
  const b = $("playSolo");
  if (net.role === "host" && net.connected) { b.textContent = "▶ Почати разом"; b.disabled = false; }
  else if (net.role === "guest" && net.connected) { b.textContent = "Чекаємо, поки хост почне…"; b.disabled = true; }
  else { b.textContent = "▶ Грати соло"; b.disabled = false; }
}

function renderMenu() {
  $('crystals').textContent = meta.crystals;
  const ml = $('modes');
  ml.innerHTML = '';
  for (const [id, md] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'diff' + (mode === id ? ' active' : '');
    b.innerHTML = `<b>${md.name}</b><span>${md.desc}</span>`;
    b.addEventListener('click', () => { mode = id; renderMenu(); });
    ml.append(b);
  }
  const dl = $('diffs');
  dl.innerHTML = '';
  for (const d of Meta.DIFFS) {
    const ok = Meta.unlockedDiff(meta, d);
    const k = Meta.bestKey(mode, d.id);
    const b = document.createElement('button');
    b.className = 'diff' + (diff === d.id ? ' active' : '');
    b.disabled = !ok;
    b.innerHTML = `<b>${ok ? '' : '🔒 '}${d.name}</b><span>${ok ? `рекорд: ${meta.best[k] || 0}/${CONFIG.winWave}${meta.wins[k] ? ' · 🏆' + meta.wins[k] : ''}` : 'Переможи на попередній'}</span>`;
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
  for (const b of document.querySelectorAll('[data-board]')) b.classList.toggle('active', b.dataset.board === boardMode);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIFF_NAMES = Object.fromEntries(Meta.DIFFS.map((d) => [d.id, d.name]));
async function loadBoard() {
  const el = $('board');
  el.innerHTML = '<p class="hint">Завантаження…</p>';
  try {
    const rows = await Api.scores(boardMode);
    if (!rows.length) { el.innerHTML = '<p class="hint">Ще ніхто не зіграв у цьому режимі. Стань першим!</p>'; return; }
    el.innerHTML = '<table><tr><th>#</th><th>Гравець</th><th>Хвиля</th><th>Склад.</th><th>Очки</th></tr>' + rows.map((r, i) => `
      <tr class="${r.nick === nick ? 'me' : ''}"><td>${i + 1}</td>
      <td>${r.won ? '🏆 ' : ''}${esc(r.nick)}${r.coop ? ` <small>+ ${esc(r.partner || 'друг')}</small>` : ''}</td>
      <td>${r.wave}</td><td>${DIFF_NAMES[r.diff] || ''}</td><td>${r.score}</td></tr>`).join('') + '</table>';
  } catch (e) {
    el.innerHTML = `<p class="hint">Таблиця лідерів недоступна (${esc(e.message)})</p>`;
  }
}
for (const b of document.querySelectorAll('[data-board]')) {
  b.addEventListener('click', () => { boardMode = b.dataset.board; renderMenu(); loadBoard(); });
}

async function saveNick() {
  const v = $('nick').value.trim();
  if (v.length < 2) { $('nickMsg').textContent = 'Мінімум 2 символи'; return; }
  try {
    nick = await Api.setNick(v);
    $('nick').value = nick;
    $('nickMsg').textContent = '✓ збережено';
    net.send({ t: 'hello', nick });
  } catch (e) { $('nickMsg').textContent = e.message; }
}
$('nickSave').addEventListener('click', saveNick);
$('nick').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveNick(); });
Api.getNick().then((n) => { nick = n; $('nick').value = n; });

$("playSolo").addEventListener("click", () => {
  sfx.unlock();
  if (net.role === "host" && net.connected) { newRun(); return; } // keep the room, start with the chosen mode
  net.leave();
  $("netStatus").textContent = "";
  newRun();
});
setInterval(updatePlayButton, 300);
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
function handleEvents(events, quiet = false) {
  if (quiet) return; // fast catch-up: skip effects
  renderer.onEvents(events, state);
  const mine = (e) => e.p === undefined || e.p === me();
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
      case 'sell': case 'coin': case 'chest': if (mine(e)) sfx.play('sell'); break;
      case 'leak': case 'stolen': sfx.play('leak'); break;
      case 'lap': sfx.play('click'); break;
      case 'wave':
        sfx.play('wave');
        banner(e.final ? 'ФІНАЛЬНА ХВИЛЯ!' : e.boss ? `Хвиля ${e.wave} — БОС!` : `Хвиля ${e.wave}`, e.boss ? 'boss' : '');
        break;
      case "bossSpawn": {
        const info = BOSSES[e.wave] || BOSSES[20];
        sfx.play("rumble");
        banner(info.name.toUpperCase(), "boss intro", info.title, 2600);
        break;
      }
      case "bossRage": sfx.play("leak"); break;
      case 'nova': sfx.play('frost'); sfx.play('explode'); break;
      case 'wallup': case 'wallbreak': sfx.play('cannon'); break;
      case 'bonus': if (mine(e)) banner(`+${e.gold} золота`, 'gold'); break;
      case 'draft':
        if (e.p === me()) { sfx.play('card'); if (!net.online && !talentOpen) openTalent(); }
        break;
      case 'gameover': sfx.play('gameover'); showEnd(false); break;
      case 'victory': sfx.play('card'); showEnd(true); break;
    }
  }
}

// Partner's cursor: a pixel arrow in their colour with their nick.
function drawPartnerCursor() {
  const p = ui.partner;
  if (!p || !net.connected || performance.now() - p.at > 3000) return;
  const g = canvas.getContext('2d');
  const x = Math.round(p.x) + MX, y = Math.round(p.y) + MY;
  const arrow = ['1', '11', '121', '1221', '12221', '122221', '1222221', '1221111', '11 121', '1  121', '    11'];
  const col = PLAYER_COLORS[1 - me()];
  arrow.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === ' ') continue;
      g.fillStyle = row[i] === '1' ? C.ink : col;
      g.fillRect(x + i, y + j, 1, 1);
    }
  });
  const name = partnerNick || 'Друг';
  g.font = '8px "Pixelify Sans", monospace';
  const w = Math.ceil(g.measureText(name).width) + 4;
  g.fillStyle = 'rgba(26,28,44,0.85)';
  g.fillRect(x + 8, y + 9, w, 10);
  g.fillStyle = col;
  g.fillText(name, x + 10, y + 17);
}

// ---------- main loop ----------
const DT = 1000 / TICK_RATE;
let acc = 0;
let last = performance.now();
let lastTickAt = 0;

function tick(cmds, advance = true) {
  step(state, cmds, advance);
  if (net.role === 'host') {
    net.send({ t: advance ? 'tick' : 'cmds', cmds });
    if (cmds.length) cmdLog.push([state.tick - (advance ? 1 : 0), advance, cmds]);
  }
  handleEvents(state.events);
}

function frame(now) {
  requestAnimationFrame(frame);
  try {
    loop(now);
  } catch (err) {
    // never let one bad frame freeze the game; show it in the console for debugging
    console.error(err);
  }
}

function loop(now) {
  const real = Math.min(250, now - last);
  last = now;
  let alpha = 1;
  if (running && net.role === 'guest') {
    // replay the host's ticks; after a long gap catch up fast and silently
    const backlog = net.inbox.length;
    let n = 0;
    while (net.inbox.length && n++ < 60) {
      const m = net.inbox.shift();
      step(state, m.cmds, m.t === 'tick');
      handleEvents(state.events, backlog > 10);
      if (m.t === 'tick') lastTickAt = now;
    }
    alpha = Math.min(1, (now - lastTickAt) / DT);
  } else if (running) {
    if (state.over) acc = 0;
    else if (!paused && !draftPause && now >= freezeUntil) acc += real * speed;
    while (acc >= DT) {
      const cmds = pending;
      pending = [];
      tick(cmds);
      acc -= DT;
    }
    // commands issued while paused apply without advancing time
    if (pending.length) { const cmds = pending; pending = []; tick(cmds, false); }
    alpha = paused || draftPause ? 1 : acc / DT;
  }
  renderer.draw(state, alpha, ui, real / 1000);
  drawPartnerCursor();
  if (running) updateUI();
}

buildToolbar();
fit();
if (new URLSearchParams(location.search).has('demo')) {
  // debug: start immediately with a few towers to check rendering
  const dm = new URLSearchParams(location.search).get('demo');
  mode = dm && dm.startsWith('circle') ? 'circle' : 'classic';
  startGame(12345, Meta.gameOpts(meta, diff, mode, dm === 'circle2' ? 2 : 1));
  state.players[0].gold = 2000;
  state.opts.locked = [];
  // put each tower type on a free tile next to the road
  const spots = [];
  for (let ty = 0; ty < 14 && spots.length < 5; ty++) for (let tx = 2; tx < 24 && spots.length < 5; tx += 3) {
    if (canPlace(state, tx, ty) && (isRoad(state, tx, ty + 1) || isRoad(state, tx + 1, ty))) spots.push([tx, ty]);
  }
  spots.forEach(([tx, ty], i) => send({ type: 'place', kind: TOWER_ORDER[i], tx, ty }));
  if (dm === 'boss') {
    state.wave = 4;
    state.queue.push({ type: 'boss', lane: 0, at: state.tick + 1, hpMul: 1 });
  } else send({ type: 'nextWave' });
} else openMenu();
requestAnimationFrame(frame);
