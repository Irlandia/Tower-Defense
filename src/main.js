// Client entry: menu/lobby, fixed-tick loop (solo / co-op host / co-op guest), input, DOM UI.
// All game rules live in ./sim; meta-progression in ./meta; networking in ./net; nick + leaderboard in ./api.
import { TILE, TICK_RATE, TOWERS, TOWER_ORDER, BRANCHES, CARDS, CONFIG, ABILITIES, MODES, VERSION, BOSSES, bossFor, AURA, ENEMIES, RARITY, SEASONS, SEASON_ORDER, brawlWeek, brawlOf, CAMPAIGN } from './sim/data.js';
import {
  createGame, step, canPlace, towerAt, obstacleAt, barrelAt, towerStats, upgradeCost, canEvolve, sellValue, clearCost,
  enemyAt, abilityMax, isRoad, canMove, hasWall, auraCost, isLocked, placeCost,
} from './sim/sim.js';
import { Renderer, W, H, MX, MY, PLAYER_COLORS } from './render.js';
import { drawTower, C } from './sprites.js';
import { Sfx, Music } from "./audio.js";
import { Net } from './net.js';
import * as Meta from './meta.js';
import * as Api from './api.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const sfx = new Sfx();
const music = new Music(sfx); // seasonal ambient soundtrack
renderer.onStomp = (king) => sfx.play(king ? 'stompBig' : 'stomp');
const net = new Net();
const meta = Meta.load();

let state = createGame(1);
let running = false;
let endShown = false; // end screen already shown for this run (guest may get it twice: event + host message)
let pending = [];
let diff = 'normal';
let mode = "classic";
let season = "random";
let treeBranch = "general";
let selectedMission = 1;
let nick = '';
let myIdx = 0; // guest: player index assigned by the host at start
const ui = { build: null, selected: null, hover: null, mouse: null, ability: null, hoverEnemy: null, partners: {}, me: 0, moving: null };
let speed = 1;
let paused = false;
let draftPause = false; // solo only: the talent window pauses the game
let freezeUntil = 0;
const collected = new Set();
// host: every command batch since the start, to resync a guest that reconnects mid-game
let cmdLog = [];
let game = null; // { seed, opts }

const me = () => (net.role === "guest" ? myIdx : 0);
const P = () => state.players[me()] || state.players[0];

// ---------- game lifecycle ----------
function startGame(seed, opts) {
  state = createGame(seed, opts);
  music.play(state.season);
  if (state.mission) tellStory(state.mission.story.intro);
  setTimeout(() => (state.mission ? banner(`Місія ${state.mission.id}: ${state.mission.title}`, "boss intro", state.mission.side.text, 2600) : state.brawl ? banner(`${state.brawl.icon} ${state.brawl.name.toUpperCase()}`, "boss intro", state.brawl.desc, 3200) : banner(SEASONS[state.season].name.toUpperCase(), "gold", "сезон", 1800)), 200);
  endShown = false;
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
  // seats: host = player 0, connected guests (by slot) = players 1..3; each plays with their own talent tree
  const guests = net.role === "host" ? roster.filter((r) => r.slot > 0 && net.slots[r.slot]).sort((a, b) => a.slot - b.slot) : [];
  for (const k in slotIdx) delete slotIdx[k];
  guests.forEach((g, i) => { g.idx = i + 1; slotIdx[g.slot] = i + 1; });
  const opts = Meta.gameOpts(meta, diff, mode, 1 + guests.length, season, guests.map((g) => g.perks));
  if (mode === "brawl") opts.week = brawlWeek(Date.now()); // every peer plays the host's week
  if (mode === "campaign") opts.mission = selectedMission;
  for (const g of guests) net.sendTo(g.slot, { t: "start", seed, opts, v: VERSION, idx: g.idx });
  if (net.role === "host") broadcastRoster();
  startGame(seed, opts);
}

// Guest replays the host's whole command log to catch up after (re)connecting.
function resync(m) {
  myIdx = m.idx ?? myIdx;
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

// ---------- network (star: host + up to 3 guests) ----------
// roster: who is in the room. Host keeps it per guest slot and broadcasts it; player index is assigned at start.
let lastMsgAt = 0;
let hostAlive = false;
let roster = []; // [{ slot, nick, perks, idx }] — slot 0 is the host
const slotIdx = {}; // host: guest slot -> player index in the running game
const nickOf = (idx) => (roster.find((r) => r.idx === idx) || {}).nick || (idx === me() ? nick : 'Гравець ' + (idx + 1));
const others = () => roster.filter((r) => r.idx !== me()).map((r) => r.nick || 'Гравець').join(', ');

function netStatus(text, kind = '') {
  $('netStatus').textContent = text;
  $('netStatus').className = kind;
  $('lobbyStatus').textContent = text;
}
// Different code on two machines would silently desync, so refuse to play.
function mismatch(v) {
  netStatus(`Різні версії гри (у тебе ${VERSION}, у іншого ${v === undefined ? 'стара' : v}). Оновіть сторінку: Ctrl+F5`, 'bad');
  if (net.role === 'guest') { net.leave(); if (running) openMenu(); }
}
function myEntry() { return { slot: 0, nick, perks: Meta.perks(meta), idx: 0 }; }
function broadcastRoster() {
  if (net.role !== 'host') return;
  roster = [myEntry(), ...roster.filter((r) => r.slot > 0)];
  net.send({ t: 'roster', list: roster.map(({ slot, nick: n, idx }) => ({ slot, nick: n, idx })) });
  renderRoster();
}
function renderRoster() {
  const el = $('roster');
  if (!el) return;
  el.classList.toggle('hidden', !net.online);
  el.innerHTML = roster.map((r) => `<span style="color:${PLAYER_COLORS[r.idx ?? r.slot] || '#fff'}">■ ${esc(r.nick || 'Гравець')}${r.slot === 0 ? ' (хост)' : ''}</span>`).join('');
}

// host: a guest connected — greet it, wait for its hello (nick, version, talent tree)
net.onJoin = (slot) => {
  net.sendTo(slot, { t: 'welcome', slot, v: VERSION });
  netStatus(`Гравець підключився (${net.guestSlots().length + 1}/4)`, 'good');
};
// host: a guest left / guest: the host left
net.onLeave = (slot) => {
  if (net.role === 'guest' || slot === 0) {
    hostAlive = false;
    const wasRunning = running;
    net.leave();
    roster = [];
    if (wasRunning) openMenu();
    netStatus('Хост відключився — гру завершено', 'bad');
    return;
  }
  const r = roster.find((k) => k.slot === slot);
  roster = roster.filter((k) => k.slot !== slot);
  if (r && r.idx !== undefined) delete ui.partners[r.idx];
  netStatus(`${(r && r.nick) || 'Гравець'} відключився. Кімната відкрита`, 'bad');
  if (running && r) banner(`${r.nick || 'Гравець'} відключився`, 'boss'); // their towers keep shooting
  broadcastRoster();
};
net.onStatus = (text, kind) => {
  netStatus(text, kind);
  if (kind === 'good' && net.role === 'guest') { hostAlive = true; lastMsgAt = performance.now(); net.send({ t: 'hello', nick, v: VERSION, perks: Meta.perks(meta) }); }
};
net.onMessage = (m, slot) => {
  if (net.role === 'guest') { lastMsgAt = performance.now(); hostAlive = true; }
  switch (m.t) {
    // ---- host side ----
    case 'hello': {
      if (net.role !== 'host') break;
      if (m.v !== VERSION) { net.sendTo(slot, { t: 'mismatch', v: VERSION }); setTimeout(() => net.drop(slot), 300); break; }
      const prev = roster.find((r) => r.slot === slot);
      const entry = { slot, nick: m.nick || 'Гравець', perks: m.perks || null, idx: prev ? prev.idx : undefined };
      roster = [...roster.filter((r) => r.slot !== slot), entry];
      // a returning player gets their old seat back in the running game
      if (running && !state.over && slotIdx[slot] !== undefined && slotIdx[slot] < state.players.length) {
        entry.idx = slotIdx[slot];
        net.sendTo(slot, { t: 'resync', ...game, log: cmdLog, tick: state.tick, v: VERSION, idx: entry.idx });
        netStatus(`${entry.nick} повернувся`, 'good');
      }
      broadcastRoster();
      break;
    }
    case 'cmd': if (net.role === 'host' && slotIdx[slot] !== undefined) pending.push({ ...m.cmd, p: slotIdx[slot] }); break;
    // ---- both ----
    case 'cursor':
      if (net.role === 'host') {
        const idx = slotIdx[slot];
        if (idx === undefined) break;
        ui.partners[idx] = { x: m.x, y: m.y, at: performance.now() };
        net.sendExcept(slot, { t: 'cursor', idx, x: m.x, y: m.y });
      } else if (m.idx !== me()) ui.partners[m.idx] = { x: m.x, y: m.y, at: performance.now() };
      break;
    // ---- guest side ----
    case 'welcome': if (m.v !== VERSION) mismatch(m.v); break;
    case 'mismatch': mismatch(m.v); break;
    case 'full': netStatus('Кімната заповнена (4/4)', 'bad'); net.leave(); break;
    case 'roster': roster = m.list; renderRoster(); break;
    case 'start': if (m.v === VERSION) { myIdx = m.idx; startGame(m.seed, m.opts); } else mismatch(m.v); break;
    case 'resync': if (m.v === VERSION) resync(m); else mismatch(m.v); break;
    case 'tick': case 'cmds': net.inbox.push(m); break;
    case 'lobby': if (net.role === 'guest') { openMenu(true); netStatus('Хост у меню — чекаємо нову гру', 'good'); } break;
    // explicit end-of-game from the host: guests must see it even if their replay lagged or missed the event
    case 'end': if (net.role === 'guest' && !endShown) showEnd(m.won); break;
  }
};
// heartbeat + timeouts (PeerJS 'close' is not always fired, e.g. when a tab is killed).
// Driven by the background ticker (once a second) so it keeps beating in hidden tabs.
function heartbeat() {
  if (!net.online) return;
  net.send({ t: 'ping' });
  const now = performance.now();
  if (net.role === 'guest' && hostAlive && now - lastMsgAt > 5000) net.onLeave(0);
  if (net.role === 'host') for (const s of net.guestSlots()) if (now - net.slots[s].lastMsg > 5000) net.drop(s);
}

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
const magnetBoss = () => (running ? state.enemies.find((e) => e.magnetT > 0) : null);
let lastMouseEv = null;
function toMap(ev) {
  const r = canvas.getBoundingClientRect();
  let x = ((ev.clientX - r.left) / r.width) * W - MX;
  let y = ((ev.clientY - r.top) / r.height) * H - MY;
  // Baron's magnet drags the cursor (and so every click) towards him
  const mag = magnetBoss();
  if (mag) { x += (mag.x - x) * 0.35; y += (mag.y - 8 - y) * 0.35; }
  return { x, y, tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

// While the magnet is on the system cursor is hidden and a dragged pixel cursor is drawn instead.
function drawPulledCursor() {
  const on = !!magnetBoss();
  canvas.classList.toggle('magnet', on);
  if (!on || !lastMouseEv) return;
  const m = toMap(lastMouseEv);
  ui.mouse = m;
  ui.hover = m.y >= 0 && m.x >= 0 ? { tx: m.tx, ty: m.ty } : null;
  const g = canvas.getContext('2d');
  const x = Math.round(m.x) + MX, y = Math.round(m.y) + MY;
  const arrow = ['1', '11', '121', '1221', '12221', '122221', '1222221', '1221111', '11 121', '1  121', '    11'];
  arrow.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === ' ') continue;
      g.fillStyle = row[i] === '1' ? C.ink : C.silver;
      g.fillRect(x + i, y + j, 1, 1);
    }
  });
}

let lastCursor = 0;
canvas.addEventListener('mousemove', (ev) => {
  lastMouseEv = ev;
  const m = toMap(ev);
  ui.mouse = m;
  ui.hover = m.y >= 0 && m.x >= 0 ? { tx: m.tx, ty: m.ty } : null;
  const en = enemyAt(state, m.x, m.y, 16);
  ui.hoverEnemy = en ? en.id : null; // shows the enemy's weaknesses in the side panel
  // coins are collected by hovering over them
  for (const c of state.coins) {
    if (!collected.has(c.id) && Math.hypot(c.x - m.x, c.y - m.y) < 10) { collected.add(c.id); send({ type: 'collect', id: c.id }); }
  }
  if (net.connected && performance.now() - lastCursor > 80) {
    lastCursor = performance.now();
    net.send({ t: "cursor", idx: me(), x: Math.round(m.x), y: Math.round(m.y) });
  }
});
canvas.addEventListener('mouseleave', () => { ui.hover = null; ui.mouse = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); });
canvas.addEventListener('mousedown', (ev) => {
  sfx.unlock();
  if (running) music.play(state.season); // audio may only start after a user gesture
  if (ev.button !== 0 || !running) return;
  const m = toMap(ev);
  if (m.y < 0) return;
  if (ui.moving) {
    // relocating a tower: click a highlighted free tile
    const mt = state.towers.find((k) => k.id === ui.moving);
    if (mt && canMove(state, mt, m.tx, m.ty)) { send({ type: "move", id: mt.id, tx: m.tx, ty: m.ty }); ui.moving = null; ui.selected = null; }
    else if (!mt) ui.moving = null;
    return;
  }
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
  // poke the wildlife (decoration only)
  if (!ui.build && renderer.critters.poke(m.x, m.y)) return;
  if (ui.build) {
    const cost = placeCost(state, me(), ui.build);
    if (canPlace(state, m.tx, m.ty) && P().gold >= cost) {
      send({ type: 'place', kind: ui.build, tx: m.tx, ty: m.ty });
      if (!ev.shiftKey && P().gold - cost < cost) ui.build = null;
    }
    return;
  }
  ui.selected = null;
});

function select(key) { ui.selected = key; sfx.play('click'); }
function cancel() { ui.build = null; ui.selected = null; ui.ability = null; ui.moving = null; }
function startMove() {
  const t = selTower();
  if (!t || t.owner !== me() || t.moveCd > 0) return;
  ui.moving = t.id; ui.build = null; ui.ability = null;
}
const selTower = () => ui.selected && ui.selected[0] === 't' ? state.towers.find((k) => 't' + k.id === ui.selected) : null;
const selObstacle = () => ui.selected && ui.selected[0] === 'o' ? state.obstacles.find((k) => 'o' + k.id === ui.selected) : null;

function selectBuild(kind) {
  sfx.unlock();
  if (isLocked(state, me(), kind)) return;
  ui.ability = null;
  ui.selected = null;
  ui.build = ui.build === kind ? null : kind;
  sfx.play('click');
}
function useAbility(id) {
  sfx.unlock();
  if (P().cds[id] > 0 || !running) return;
  if (id === "wall" && hasWall(state, me())) { banner("Барикада вже стоїть", "gold"); return; }
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
  const idx = ['1', '2', '3', '4', '5', '6'].indexOf(k);
  if (idx >= 0) selectBuild(TOWER_ORDER[idx]);
  else if (k === 'q') useAbility('meteor');
  else if (k === 'w') useAbility('nova');
  else if (k === 'e') useAbility('wall');
  else if (k === 't') openTalent();
  else if (k === ' ') { ev.preventDefault(); nextWave(); }
  else if (k === "m") startMove();
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
    const locked = isLocked(state, me(), kind);
    const b = document.createElement('button');
    b.className = 'tower-btn' + (locked ? ' locked' : '');
    b.dataset.kind = kind;
    b.title = locked ? 'Відкривається в магазині за кристали' : `${def.name} [${i + 1}] — ${def.desc}`;
    b.append(towerIcon(kind));
    const label = document.createElement('span');
    label.className = 'label';
    label.innerHTML = `<b>${def.name}</b><span class="cost">${locked ? "🔒" : "● " + placeCost(state, me(), kind)}</span>`;
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
$("mute").addEventListener("click", () => {
  sfx.muted = !sfx.muted;
  $("mute").textContent = sfx.muted ? "🔇" : "🔊";
  if (sfx.muted) music.stop(); else if (running) music.play(state.season);
});
$("music").textContent = music.on ? "♪" : "♪̸";
$("music").addEventListener("click", () => {
  sfx.unlock();
  music.setOn(!music.on);
  $("music").textContent = music.on ? "♪" : "♪̸";
  if (music.on && running) music.play(state.season);
});
$('toMenu').addEventListener('click', () => openMenu()); // the run is kept: 'Повернутися до гри' in the menu resumes it

// ---------- on-map popup for towers / obstacles ----------
let popKey = '';
$('pop').addEventListener('mousedown', (ev) => ev.stopPropagation());
$('pop').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const t = selTower();
  if (a.dataset.act === 'upgrade') upgradeSel();
  if (a.dataset.act === "sell") sellSel();
  if (a.dataset.act === "move") startMove();
  if (a.dataset.act === 'aura' && t) send({ type: 'aura', id: t.id, aura: a.dataset.aura });
  if (a.dataset.act === 'evolve' && t) send({ type: 'evolve', id: t.id, kind: a.dataset.kind });
  if (a.dataset.act === 'clear') { const o = selObstacle(); if (o) send({ type: 'clear', id: o.id }); ui.selected = null; }
});

function placePop(tx, ty) {
  const pop = $('pop');
  const scale = canvas.clientWidth / W;
  const cx = (MX + tx * TILE + 12) * scale;
  const H = canvas.clientHeight;
  // never taller than the field; scrolls if it really cannot fit
  pop.style.maxHeight = H - 8 + 'px';
  const h = pop.offsetHeight;
  const topAbove = (MY + ty * TILE - 12) * scale - h - 6; // above the tower
  const topBelow = (MY + (ty + 1) * TILE) * scale + 6; // below the tower
  // prefer above; otherwise below; otherwise pinned so the whole menu (incl. evolution) stays visible
  let top = topAbove >= 4 ? topAbove : topBelow + h <= H - 4 ? topBelow : Math.max(4, H - h - 4);
  pop.style.left = Math.max(0, Math.min(canvas.clientWidth - pop.offsetWidth, cx - pop.offsetWidth / 2)) + 'px';
  pop.style.top = top + 'px';
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
    key = `t${t.id}:${t.kind}:${t.level}:${Math.floor(gold / 5)}:${Math.round(st.dmg)}:${st.buff}:${Math.ceil((t.moveCd || 0) / TICK_RATE)}`;
    html = `<div class="pop-title"><b>${def.name}</b> <span>${def.from ? '★ еволюція' : 'рів. ' + t.level}</span></div>
      ${def.support
        ? `<div class="pop-stats"><span>◎ ${def.range}</span><span class="buff">⚔ +${Math.round((t.aura.dmg ? AURA.dmg.bonus[t.aura.dmg - 1] : 0) * 100)}%</span><span>⏱ +${Math.round((t.aura.rate ? AURA.rate.bonus[t.aura.rate - 1] : 0) * 100)}%</span></div>`
        : `<div class="pop-stats"><span>⚔ ${Math.round(st.dmg)}</span><span>◎ ${Math.round(st.range)}</span><span>⏱ ${(TICK_RATE / st.period).toFixed(1)}/с</span>${st.buff ? `<span class="buff">⚡+${Math.round(st.buff * 100)}%</span>` : ''}</div>`}`;
    if (def.support) key += `:${t.aura.dmg}${t.aura.rate}`;
    if (!mine) {
      html += `<div class="pop-stats"><span style="color:${PLAYER_COLORS[t.owner]}">Вежа гравця ${nickOf(t.owner)}</span></div>`;
    } else {
      if (up) html += `<button data-act="upgrade" ${gold < up ? 'disabled' : ''}>▲ Покращити <i>● ${up}</i></button>`;
      if (def.support) {
        for (const k of ['dmg', 'rate']) {
          const lv = t.aura[k], cost = auraCost(t, k), a = AURA[k];
          html += cost
            ? `<button data-act="aura" data-aura="${k}" ${gold < cost ? 'disabled' : ''}>${k === 'dmg' ? '⚔' : '⏱'} ${a.name} ${lv}→${lv + 1} (+${Math.round(a.bonus[lv] * 100)}%) <i>● ${cost}</i></button>`
            : `<button disabled>${k === 'dmg' ? '⚔' : '⏱'} ${a.name} — МАКС</button>`;
        }
      }
      if (evo) {
        html += '<div class="evo-title">Еволюція — обери шлях:</div><div class="evo">';
        for (const k of BRANCHES[t.kind]) {
          const d = TOWERS[k];
          html += `<button class="evo-btn" data-act="evolve" data-kind="${k}" ${gold < d.cost ? 'disabled' : ''}>
            <span class="icon" data-icon="${k}"></span><b>${d.name}</b><span>${d.desc}</span><i>● ${d.cost}</i></button>`;
        }
        html += '</div>';
      }
      const mcd = Math.ceil((t.moveCd || 0) / TICK_RATE);
      html += `<button data-act="move" ${mcd ? 'disabled' : ''}>↔ Перемістити [M] <i>${mcd ? mcd + ' с' : `до ${CONFIG.moveRange} кл.`}</i></button>`;
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
    b.classList.toggle("poor", pl.gold < placeCost(state, me(), b.dataset.kind));
  }
  for (const id of Object.keys(ABILITIES)) {
    const b = $('ab-' + id);
    b.classList.toggle('active', ui.ability === id);
    b.classList.toggle("cooling", pl.cds[id] > 0 || (id === "wall" && hasWall(state, me())));
    b.style.setProperty('--cd', (pl.cds[id] / abilityMax(state, id, me())).toFixed(3));
  }
  const early = state.wave > 0 && !state.queue.length ? Math.ceil(state.countdown / TICK_RATE) * CONFIG.earlyBonus : 0;
  const last = state.wave >= state.winWave;
  $('next').textContent = last ? 'Фінал!' : state.queue.length ? 'Хвиля йде…' : early ? `Хвиля ▶ +${early}●` : 'Почати ▶';
  $('next').disabled = state.queue.length > 0 || last;
  const n = pl.drafts.length;
  $('talent').classList.toggle('off', !n); // keep its slot so the panel never jumps
  $('talent').textContent = `✦ Талант${n > 1 ? ' x' + n : ''} [T]`;
  $("waveInfo").textContent = `${state.mission ? "📜 Місія " + state.mission.id : state.brawl ? state.brawl.icon + " " + state.brawl.name : MODES[state.mode].name} · Хвиля ${state.wave} / ${state.winWave}`;
  $('waveBar').style.width = (100 * state.wave) / state.winWave + '%';
  const coop = state.players.length > 1;
  $('coopInfo').classList.toggle('hidden', !coop);
  if (coop) {
    $("coopInfo").innerHTML = state.players.map((q, i) => `<span style="color:${PLAYER_COLORS[i]}">■ ${esc(i === me() ? nick || "Ти" : nickOf(i))}: ${q.gold}●</span>`).join(" ");
  }

  let key, html;
  if (ui.build) {
    const def = TOWERS[ui.build];
    key = 'b' + ui.build;
    html = `<b>${def.name}</b><br>${def.desc}<br><span class="hint">Shift — ставити кілька · ПКМ — скасувати</span>`;
  } else if (ui.hoverEnemy && state.enemies.some((e) => e.id === ui.hoverEnemy)) {
    const e = state.enemies.find((k) => k.id === ui.hoverEnemy);
    const def = ENEMIES[e.type];
    const vs = Object.entries(def.vs || {});
    const fam = (k) => TOWERS[k].name;
    const weak = vs.filter(([, v]) => v > 1).map(([k, v]) => `${fam(k)} x${v}`).join(', ');
    const res = vs.filter(([, v]) => v < 1).map(([k, v]) => `${fam(k)} x${v}`).join(', ');
    key = `e${e.id}:${Math.ceil(e.hp / 10)}`;
    html = `<b>${def.name}</b> · ❤ ${Math.max(0, Math.round(e.hp))}/${e.maxHp}${e.armor ? ` · 🛡 ${e.armor}` : ''}<br>`
      + (weak ? `<span style="color:#a7f070">Слабкий до: ${weak}</span><br>` : '')
      + (res ? `<span style="color:#94b0c2">Опір: ${res}</span>` : '')
      + (!weak && !res ? '<span class="hint">Без особливих слабкостей</span>' : '');
  } else if (ui.moving) {
    key = 'mv';
    html = `<b>Переміщення вежі</b><br>Клікни по підсвіченій клітинці (до ${CONFIG.moveRange} клітинок). Після переїзду вежа 1 с розгортається, перезарядка ${CONFIG.moveCd} с.<br><span class="hint">ПКМ / Esc — скасувати</span>`;
  } else if (ui.ability) {
    const a = ABILITIES[ui.ability];
    key = 'a' + ui.ability;
    html = `<b>${a.name}</b><br>${a.desc}<br><span class="hint">ПКМ — скасувати</span>`;
  } else {
    key = "h" + state.mode + (state.brawl ? state.brawl.id : "");
    html = state.mode === 'circle'
      ? `<b>Коло</b><br>Вороги не доходять до замку — вони крутяться по колу і з кожним колом швидшають. Живих більше <b>${state.limit}</b> — поразка.`
      : '<b>Порада</b><br>Крига робить ворогів <span class="wet">мокрими</span>: Тесла бʼє їх x2, а Вогонь викликає вибух пари.';
    if (state.mission) {
      const M = state.mission, mine = state.towers.filter((t) => t.owner === me()).length;
      html = `<b>Місія ${M.id}: ${esc(M.title)}</b><br>★ ${esc(M.side.text)}`
        + (M.maxTowers ? `<br>Веж: ${mine} / ${M.maxTowers}` : "")
        + (state.farmMax ? `<br>Ферма: ${Math.ceil(state.farmHp)} / ${state.farmMax}` : "")
        + (M.night ? "<br>Ніч: вежі бачать на 30% ближче" : "");
      key += ":" + mine + ":" + Math.ceil(state.farmHp);
    } else if (state.brawl) html = `<b>${state.brawl.icon} Бійка: ${state.brawl.name}</b><br>${state.brawl.desc}`;
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
    el.className = 'card ' + c.rarity;
    const taken = P().picked[c.id] || 0;
    const count = c.max > 1 && c.max < 99 ? ` · ${taken}/${c.max}` : '';
    el.innerHTML = `<span class="key">${i + 1}</span><span class="rar">${RARITY[c.rarity].name}${count}</span><b>${c.name}</b><span>${c.desc}</span>`;
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
  if (endShown) return;
  endShown = true;
  if (net.role === "host") net.send({ t: "end", won });
  running = false;
  talentOpen = false;
  const { earned, record } = Meta.finishRun(meta, state);
  const M = state.mission;
  const farmLost = state.farmMax && state.farmHp <= 0;
  const title = won ? "ПЕРЕМОГА!" : farmLost ? "Ферму потоптали" : state.endless ? "Нескінченність скінчилась" : state.mode === "circle" ? "Коло переповнене" : "Замок впав";
  const canContinue = won && state.mode === "circle" && !M && net.role !== "guest";
  const m = $('modal');
  // campaign: stars, the story's closing line and the way on
  let camp = '';
  if (M) {
    const st = won ? state.stars : 0;
    const next = CAMPAIGN.find((x) => x.id === M.id + 1);
    camp = `<p class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</p>
      <p class="hint">★ перемога · ★ ${esc(M.side.text)} · ★ ранній виклик хвиль ×${M.early}</p>
      ${won ? `<p class="outro"><b>${esc(M.story.outro[0])}:</b> «${esc(M.story.outro[1])}»</p>` : ''}
      ${won && next && net.role !== 'guest' ? '<button id="nextMission" class="big primary">Наступна місія ▶</button>' : ''}
      ${won && !next ? '<p class="rec">Кампанію пройдено! Долина врятована.</p>' : ''}`;
  }
  m.innerHTML = `<h2 class="${won ? 'win' : ''}">${M ? `Місія ${M.id}. ` : ''}${title}</h2>${camp}
    <p>Хвиля <b>${state.wave}</b>${state.endless ? " (нескінченний)" : " / " + state.winWave} · Вбито <b>${state.kills}</b>${state.players.length > 1 ? ` (ти: ${P().kills})` : ''}${record ? ' · <span class="rec">Новий рекорд!</span>' : ''}</p>
    <p class="crys">+${earned} ✦ досвіду <span>(усього ${meta.xp})</span></p>
    <p id="scoreMsg">${nick ? 'Надсилаємо результат…' : 'Введи нік у меню, щоб потрапити в таблицю лідерів'}</p>
    <div class="row">${canContinue ? '<button id="endless" class="big primary">Продовжити ∞</button>' : ""}${net.role === "guest" ? (won && state.mode === "circle" ? "<p>Хост вирішує: продовжити чи ні…</p>" : "<p>Чекаємо, поки хост почне нову гру…</p>") : '<button id="again" class="big">Ще раз</button>'}<button id="menuBtn" class="big">Меню</button></div>`;
  m.classList.remove('hidden');
  if ($("again")) $("again").addEventListener("click", newRun);
  if ($("nextMission")) $("nextMission").addEventListener("click", () => { selectedMission = M.id + 1; newRun(); });
  if ($("endless")) $("endless").addEventListener("click", () => send({ type: "continue" }));
  $('menuBtn').addEventListener('click', openMenu);
  if (nick && !M) { // campaign missions are not leaderboard runs
    Api.addScore({ mode: state.opts.mode === "brawl" ? "brawl" : state.mode, week: state.opts.week, diff: state.opts.diff, wave: state.wave, kills: state.kills, won, coop: state.players.length > 1, partner: others() })
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
// Back to the paused run (solo or host). The host brings the guest back with a full resync.
function canResume() {
  return !!game && !state.over && state.tick > 0 && net.role !== "guest";
}
function resumeGame() {
  if (!canResume()) return;
  hide("menu");
  document.body.classList.remove("in-menu");
  running = true;
  popKey = ""; infoKey = "";
  if (net.role === "host" && net.connected && state.players.length > 1) net.send({ t: "resync", ...game, log: cmdLog, tick: state.tick, v: VERSION });
}

function updatePlayButton() {
  $("resume").classList.toggle("hidden", !canResume());
  const b = $("playSolo");
  if (net.role === "host" && net.connected) { b.textContent = `▶ Почати (${net.guestSlots().length + 1} гравці)`; b.disabled = false; }
  else if (net.role === "guest" && net.connected) { b.textContent = "Чекаємо, поки хост почне…"; b.disabled = true; }
  else { b.textContent = "▶ Грати соло"; b.disabled = false; }
}

function renderMenu() {
  $("crystals").textContent = meta.xp;
  const ml = $('modes');
  ml.innerHTML = '';
  for (const [id, md] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.className = 'diff' + (mode === id ? ' active' : '');
    b.innerHTML = `<b>${md.name}</b><span>${md.desc}</span>`;
    b.addEventListener('click', () => { mode = id; renderMenu(); });
    ml.append(b);
  }
  // Weekly Brawl: this week's special ruleset, rotates every Monday
  {
    const wk = brawlWeek(Date.now()), br = brawlOf(wk);
    const msLeft = Date.UTC(2024, 0, 1) + (wk + 1) * 7 * 86400000 - Date.now();
    const left = msLeft > 86400000 ? `${Math.ceil(msLeft / 86400000)} дн.` : `${Math.ceil(msLeft / 3600000)} год.`;
    const b = document.createElement('button');
    b.className = 'diff brawl' + (mode === 'brawl' ? ' active' : '');
    b.innerHTML = `<b>${br.icon} Тижнева бійка: ${br.name}</b><span>${br.desc}</span><small>${br.map === 'circle' ? 'Коло' : 'Класика'} · нова бійка через ${left}</small>`;
    b.addEventListener('click', () => { mode = 'brawl'; renderMenu(); });
    ml.append(b);
  }
  // Campaign: a road of 10 missions; each opens after winning the previous one
  {
    const total = CAMPAIGN.reduce((a, x) => a + Meta.missionStars(meta, x.id), 0);
    const b = document.createElement('button');
    b.className = 'diff campaign' + (mode === 'campaign' ? ' active' : '');
    b.innerHTML = `<b>📜 Кампанія «Останній прилив»</b><span>10 місій крізь рік: від першого лучника до битви з Королем Слизу.</span><small>★ ${total} / ${CAMPAIGN.length * 3}</small>`;
    b.addEventListener('click', () => { mode = 'campaign'; renderMenu(); });
    ml.append(b);
  }
  const cw = $('campaign');
  cw.classList.toggle('hidden', mode !== 'campaign');
  if (mode === 'campaign') {
    if (!Meta.missionOpen(meta, selectedMission)) selectedMission = 1;
    const SEA = { spring: '🌸', summer: '☀', autumn: '🍂', winter: '❄' };
    cw.innerHTML = '<div class="camp-road">' + CAMPAIGN.map((x) => {
      const open = Meta.missionOpen(meta, x.id), st = Meta.missionStars(meta, x.id);
      return `<button class="camp-node${x.id === selectedMission ? ' active' : ''}${st ? ' done' : ''}" data-mission="${x.id}" ${open ? '' : 'disabled'}>
        <b>${open ? x.id : '🔒'}</b><small>${SEA[x.season]}</small><i>${'★'.repeat(st)}${'☆'.repeat(open ? 3 - st : 0)}</i></button>`;
    }).join('') + '</div>';
    const M = CAMPAIGN.find((x) => x.id === selectedMission);
    const rules = [`${M.waves} хвиль`, M.map === 'circle' ? 'Коло' : 'Класика'];
    if (M.rules.towers) rules.push('вежі: ' + M.rules.towers.map((k) => TOWERS[k].name).join(', '));
    if (M.farmHp) rules.push('захисти ферму');
    if (M.maxTowers) rules.push(`не більше ${M.maxTowers} веж`);
    if (M.night) rules.push('ніч: вежі бачать ближче');
    if (M.goblins) rules.push('гобліни щохвилі');
    if (M.rules.alwaysWet) rules.push('злива');
    if (M.bosses) rules.push('генерали: ' + Object.entries(M.bosses).map(([w, k]) => `${BOSSES[k].name} (хв. ${w})`).join(', '));
    const brief = document.createElement('div');
    brief.className = 'camp-brief';
    brief.innerHTML = `<b>Місія ${M.id}. ${esc(M.title)}</b><span class="hint">${rules.join(' · ')}</span>
      ${M.story.intro.map(([who, t]) => `<p><i>${esc(who)}:</i> «${esc(t)}»</p>`).join('')}
      <span class="hint">★ перемога · ★ ${esc(M.side.text)} · ★ ранній виклик хвиль ×${M.early}</span>`;
    cw.append(brief);
    for (const n of cw.querySelectorAll('[data-mission]')) n.addEventListener('click', () => { selectedMission = +n.dataset.mission; renderMenu(); });
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
  // talent tree: branch tabs, then the branch's nodes top to bottom (each needs the previous one)
  const shop = $('shop');
  shop.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'tree-tabs';
  for (const br of Meta.BRANCHES) {
    const t = document.createElement('button');
    const got = Meta.TREE.filter((n) => n.branch === br.id && Meta.level(meta, n.id)).length;
    t.className = 'tree-tab' + (treeBranch === br.id ? ' active' : '');
    t.title = br.name;
    t.innerHTML = `${br.icon}<small>${got}/${Meta.TREE.filter((n) => n.branch === br.id).length}</small>`;
    t.addEventListener('click', () => { treeBranch = br.id; renderMenu(); });
    tabs.append(t);
  }
  shop.append(tabs);
  const title = document.createElement('div');
  title.className = 'tree-title';
  title.textContent = Meta.BRANCHES.find((b) => b.id === treeBranch).name;
  shop.append(title);
  for (const n of Meta.TREE.filter((k) => k.branch === treeBranch)) {
    const lv = Meta.level(meta, n.id);
    const max = lv >= n.cost.length;
    const reqOk = !n.req || Meta.level(meta, n.req) > 0;
    const b = document.createElement('button');
    b.className = 'shop-item tree-node' + (max ? ' max' : '') + (lv ? ' owned' : '') + (reqOk ? '' : ' blocked');
    b.disabled = max || !Meta.canBuy(meta, n);
    const price = max ? 'ВИВЧЕНО' : reqOk ? `${n.cost[lv]} ✦` : `🔒 ${Meta.nodeOf(n.req).name}`;
    b.innerHTML = `<b>${n.name}</b><span>${n.desc}</span><i>${price}${n.cost.length > 1 ? ` · ${lv}/${n.cost.length}` : ''}</i>`;
    b.addEventListener('click', () => { if (Meta.buy(meta, n.id)) { sfx.unlock(); sfx.play('card'); renderMenu(); } });
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
    const rows = await Api.scores(boardMode, brawlWeek(Date.now()));
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
    net.send({ t: "hello", nick, v: VERSION, perks: Meta.perks(meta) });
  } catch (e) { $('nickMsg').textContent = e.message; }
}
$('nickSave').addEventListener('click', saveNick);
$('nick').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveNick(); });
Api.getNick().then((n) => { nick = n; $('nick').value = n; });

$("resume").addEventListener("click", () => { sfx.unlock(); resumeGame(); });
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
    $("roomCode").textContent = code;
    $("roomBox").classList.remove("hidden");
    roster = [myEntry()];
    renderRoster();
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
  // fast catch-up: skip effects and sounds, but never the events that change the game flow
  if (quiet) events = events.filter((e) => ['gameover', 'victory', 'endless', 'draft'].includes(e.type));
  if (!quiet) renderer.onEvents(events, state);
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
        const info = e.bk ? BOSSES[e.bk] : bossFor(e.wave);
        sfx.play("rumble");
        banner(info.name.toUpperCase(), "boss intro", info.title, 2600);
        break;
      }
      case "bossRage": sfx.play("leak"); break;
      case 'nova': sfx.play('frost'); sfx.play('explode'); break;
      case 'wallup': case 'wallbreak': sfx.play('cannon'); break;
      case 'bonus': if (mine(e)) banner(`+${e.gold} золота`, 'gold'); break;
      // co-op pranks
      case 'roulette': {
        const lucky = e.p === me();
        sfx.play(lucky ? 'card' : 'leak');
        banner(lucky ? 'РУЛЕТКА: +250 ТОБІ!' : `Рулетка: ${nickOf(e.p)} виграв 250`, "gold", e.by === me() ? "ти крутив" : `крутив ${nickOf(e.by)}`, 2200);
        break;
      }
      case 'steal':
        if (e.from === me()) { sfx.play('leak'); banner(`${nickOf(e.p)} поцупив у тебе ${e.gold}!`, 'gold', 'кишеньковий злодій', 1800); }
        else if (e.p === me()) banner(`Поцупив у друга +${e.gold} 😏`, 'gold', '', 1500);
        break;
      case 'draft':
        if (e.p === me()) { sfx.play('card'); if (!net.online && !talentOpen) openTalent(); }
        break;
      case 'gameover': sfx.play('gameover'); showEnd(false); break;
      case 'victory': sfx.play('card'); showEnd(true); break;
      case "endless":
        endShown = false;
        running = true;
        hide("modal");
        sfx.play("wave");
        banner("НЕСКІНЧЕННІСТЬ", "boss intro", "Хвилі важчають, боси частішають", 2600);
        break;
    }
  }
}

// Other players' cursors: a pixel arrow in each player's colour with their nick.
function drawPartnerCursor() {
  if (!net.online || !running) return;
  const g = canvas.getContext('2d');
  const arrow = ['1', '11', '121', '1221', '12221', '122221', '1222221', '1221111', '11 121', '1  121', '    11'];
  for (const [idx, p] of Object.entries(ui.partners)) {
    if (+idx === me() || performance.now() - p.at > 3000) continue;
    const x = Math.round(p.x) + MX, y = Math.round(p.y) + MY;
    const col = PLAYER_COLORS[idx] || C.white;
    arrow.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === ' ') continue;
        g.fillStyle = row[i] === '1' ? C.ink : col;
        g.fillRect(x + i, y + j, 1, 1);
      }
    });
    const name = nickOf(+idx);
    g.font = '8px "Pixelify Sans", monospace';
    const w = Math.ceil(g.measureText(name).width) + 4;
    g.fillStyle = 'rgba(26,28,44,0.85)';
    g.fillRect(x + 8, y + 9, w, 10);
    g.fillStyle = col;
    g.fillText(name, x + 10, y + 17);
  }
}

// ---------- main loop ----------
const DT = 1000 / TICK_RATE;
let acc = 0;
let last = performance.now();
let lastTickAt = 0;

function tick(cmds, advance = true, quiet = false) {
  step(state, cmds, advance);
  if (net.role === 'host') {
    net.send({ t: advance ? 'tick' : 'cmds', cmds });
    if (cmds.length) cmdLog.push([state.tick - (advance ? 1 : 0), advance, cmds]);
  }
  handleEvents(state.events, quiet);
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

// Advances the game; returns the interpolation alpha for drawing. Called every frame while visible and
// by the background ticker while the tab is hidden, so the run never stalls for the other player.
let lastSim = performance.now();
function simulate(now) {
  const real = Math.min(250, now - lastSim);
  lastSim = now;
  const quiet = document.hidden; // nobody is watching: skip effects/sounds (they would pile up)
  // the guest also keeps applying host messages on the end screen (e.g. the host's 'continue')
  if ((running || state.over) && net.role === 'guest') {
    // replay the host's ticks; after a long gap catch up fast and silently
    const backlog = net.inbox.length;
    let n = 0;
    while (net.inbox.length && n++ < 60) {
      const m = net.inbox.shift();
      step(state, m.cmds, m.t === 'tick');
      handleEvents(state.events, quiet || backlog > 10);
      if (m.t === 'tick') lastTickAt = now;
    }
    return Math.min(1, (now - lastTickAt) / DT);
  }
  // on the end screen the game is stopped, but commands like 'continue' must still go through
  if (!running) { if (pending.length && state.over) { const cmds = pending; pending = []; tick(cmds, false, quiet); } return 1; }
  if (state.over) acc = 0;
  else if (!paused && !draftPause && now >= freezeUntil) acc += real * speed;
  while (acc >= DT) {
    const cmds = pending;
    pending = [];
    tick(cmds, true, quiet);
    acc -= DT;
  }
  // commands issued while paused apply without advancing time
  if (pending.length) { const cmds = pending; pending = []; tick(cmds, false, quiet); }
  return paused || draftPause ? 1 : acc / DT;
}

function loop(now) {
  const real = Math.min(250, now - last);
  last = now;
  const alpha = simulate(now);
  renderer.draw(state, alpha, ui, real / 1000);
  drawPartnerCursor();
  drawPulledCursor();
  if (running) updateUI();
}

// Background ticker: browsers freeze requestAnimationFrame and throttle timers in hidden tabs,
// but not timers inside a Worker. It keeps the simulation and the co-op heartbeat running.
let bgBeats = 0;
function backgroundTick() {
  try {
    if (document.hidden) simulate(performance.now());
    if (++bgBeats % 20 === 0) heartbeat();
  } catch (err) {
    console.error(err);
  }
}
try {
  const src = 'setInterval(() => postMessage(0), 50);';
  const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  ticker.onmessage = backgroundTick;
} catch {
  setInterval(backgroundTick, 50); // no workers: best effort
}

buildToolbar();
fit();
if (new URLSearchParams(location.search).has('demo')) {
  // debug: start immediately with a few towers to check rendering
  const dm = new URLSearchParams(location.search).get('demo');
  season = new URLSearchParams(location.search).get('season') || 'random';
  mode = dm === 'campaign' ? 'campaign' : dm === 'brawl' ? 'brawl' : dm && dm.startsWith('circle') ? 'circle' : 'classic';
  const dOpts = Meta.gameOpts(meta, diff, mode, dm === 'circle2' ? 2 : dm === 'circle4' ? 4 : 1, season);
  if (mode === 'brawl') dOpts.week = +(new URLSearchParams(location.search).get('week') || brawlWeek(Date.now()));
  if (mode === 'campaign') dOpts.mission = +(new URLSearchParams(location.search).get('mission') || 1);
  startGame(12345, dOpts);
  state.players[0].gold = 2000;
  state.opts.locked = []; state.opts.lockedBy = null;
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

// Buttons must not keep keyboard focus: Space is the "next wave" hotkey and would also "click" a focused
// (possibly hidden) button such as "Ще раз" / "Почати разом", restarting the game and wiping the enemies.
document.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) b.blur(); });
document.addEventListener('keyup', (ev) => { if (ev.key === ' ' && ev.target.tagName === 'BUTTON') ev.preventDefault(); }, true);

// ---------- custom pixel cursors: high-contrast, readable on grass, snow and roads ----------
const CURSOR_MAPS = {
  arrow: { hot: [0, 0], c: { K: '#1a1c2c', Y: '#ffcd75', W: '#f4f4f4' }, rows: ['K...........', 'KK..........', 'KWK.........', 'KYWK........', 'KYYYK.......', 'KYYYYK......', 'KYYYYYK.....', 'KYYYYYYK....', 'KYYYYKKKK...', 'KYKKYK......', 'KK..KYK.....', '.....KK.....'] },
  build: { hot: [5, 4], c: { K: '#1a1c2c', G: '#a7f070' }, rows: ['....KKK....', '....KGK....', '....KGK....', 'KKKK...KKKK', 'KGGG.G.GGGK', 'KKKK...KKKK', '....KGK....', '....KGK....', '....KKK....'] },
  target: { hot: [5, 5], c: { K: '#1a1c2c', R: '#ef7d57', Y: '#ffcd75' }, rows: ['...KKKKK...', '..KRRRRRK..', '.KRK...KRK.', 'KRK.....KRK', 'KRK..Y..KRK', 'KRK.YYY.KRK', 'KRK..Y..KRK', 'KRK.....KRK', '.KRK...KRK.', '..KRRRRRK..', '...KKKKK...'] },
  move: { hot: [5, 5], c: { K: '#1a1c2c', B: '#73eff7' }, rows: ['....KKK....', '...KBBBK...', '....KBK....', '.K..KBK..K.', 'KBKKKBKKKBK', 'KBBBBBBBBBK', 'KBKKKBKKKBK', '.K..KBK..K.', '....KBK....', '...KBBBK...', '....KKK....'] },
};
const CURSORS = {};
for (const [k, m] of Object.entries(CURSOR_MAPS)) {
  const S = 2; // drawn at 2x so they stay crisp and big enough
  const cv = document.createElement('canvas');
  cv.width = m.rows[0].length * S; cv.height = m.rows.length * S;
  const g = cv.getContext('2d');
  m.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = m.c[row[x]]; if (col) { g.fillStyle = col; g.fillRect(x * S, y * S, S, S); } } });
  CURSORS[k] = `url(${cv.toDataURL()}) ${m.hot[0] * S} ${m.hot[1] * S}, crosshair`;
}
let cursorKind = '';
function updateCursor() {
  const k = ui.moving ? 'move' : ui.build ? 'build' : ui.ability ? 'target' : 'arrow';
  if (k === cursorKind) return;
  cursorKind = k;
  canvas.style.cursor = CURSORS[k];
}
setInterval(updateCursor, 50);
updateCursor();
document.body.style.cursor = CURSORS.arrow; // menus and panels use the same arrow

// Campaign story: intro lines appear one by one as speech bubbles over the farmer (client-side only,
// never pauses co-op); without a farm they fall back to banners.
function tellStory(lines) {
  lines.forEach(([who, text], i) => setTimeout(() => {
    if (!running) return;
    const F = renderer.critters.farm;
    const line = who === 'Дід Панас' ? text : `${who}: ${text}`;
    if (F) { F.farmer.say = line; F.farmer.sayT = 4; F.farmer.state = 'idle'; F.farmer.t = 4; }
    else banner(who, 'gold', text, 3500);
  }, 1800 + i * 4200));
}
