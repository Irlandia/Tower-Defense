// Co-op protocol: validates every incoming message, applies it, keeps the heartbeat.
// Message catalogue: docs/net-protocol.md. Transport (PeerJS) lives in src/net.js.
import { VERSION } from '../sim/data.js';
import * as Meta from '../meta.js';
import { validate } from './protocol.js';
import { app, bus, net, meta, ui } from './app.js';
import { startGame, resync, enterLobby, finishRun } from './session.js';
import { broadcastRoster } from './roster.js';


const status = (text, kind = '') => bus.emit('net:status', text, kind);
const desyncAt = {}; // slot -> last resync sent because of a desync report

// Different code on two machines would silently desync, so refuse to play.
function mismatch(v) {
  status(`Різні версії гри (у тебе ${VERSION}, у іншого ${v === undefined ? 'стара' : v}). Оновіть сторінку: Ctrl+F5`, 'bad');
  if (net.role === 'guest') { net.leave(); if (app.running) enterLobby(); }
}

// host: a guest connected — greet it, wait for its hello (nick, version, talent tree)
net.onJoin = (slot) => {
  net.sendTo(slot, { t: 'welcome', slot, v: VERSION });
  status(`Гравець підключився (${net.guestSlots().length + 1}/4)`, 'good');
};

// host: a guest left / guest: the host left
net.onLeave = (slot) => {
  if (net.role === 'guest' || slot === 0) {
    app.hostAlive = false;
    const wasRunning = app.running;
    net.leave();
    app.roster = [];
    if (wasRunning) enterLobby();
    status('Хост відключився — гру завершено', 'bad');
    return;
  }
  const r = app.roster.find((k) => k.slot === slot);
  app.roster = app.roster.filter((k) => k.slot !== slot);
  if (r && r.idx !== undefined) delete ui.partners[r.idx];
  status(`${(r && r.nick) || 'Гравець'} відключився. Кімната відкрита`, 'bad');
  if (app.running && r) {
    bus.emit('banner', `${r.nick || 'Гравець'} відключився`, 'boss', 'Його вежі стріляють далі, золото — вам'); // their towers keep shooting
    if (r.idx !== undefined && !app.state.over) app.pending.push({ type: 'leave', p: r.idx });
  }
  broadcastRoster();
};

net.onStatus = (text, kind) => {
  status(text, kind);
  if (kind === 'good' && net.role === 'guest') {
    app.hostAlive = true;
    app.lastMsgAt = performance.now();
    net.send({ t: 'hello', nick: app.nick, v: VERSION, perks: Meta.perks(meta) });
  }
};

net.onMessage = (raw, slot) => {
  const m = validate(raw);
  if (!m) return;
  if (net.role === 'guest') { app.lastMsgAt = performance.now(); app.hostAlive = true; }
  switch (m.t) {
    // ---- host side ----
    case 'hello': {
      if (net.role !== 'host') break;
      if (m.v !== VERSION) { net.sendTo(slot, { t: 'mismatch', v: VERSION }); setTimeout(() => net.drop(slot), 300); break; }
      const prev = app.roster.find((r) => r.slot === slot);
      const entry = { slot, nick: m.nick || 'Гравець', perks: m.perks || null, idx: prev ? prev.idx : undefined };
      app.roster = [...app.roster.filter((r) => r.slot !== slot), entry];
      // a returning player gets their old seat back in the running game
      if (app.running && !app.state.over && app.slotIdx[slot] !== undefined && app.slotIdx[slot] < app.state.players.length) {
        entry.idx = app.slotIdx[slot];
        app.pending.push({ type: 'rejoin', p: entry.idx });
        net.sendTo(slot, { t: 'resync', ...app.game, log: app.cmdLog, tick: app.state.tick, v: VERSION, idx: entry.idx });
        status(`${entry.nick} повернувся`, 'good');
      }
      broadcastRoster();
      break;
    }
    case 'desync': {
      // a guest's state fingerprint differed from ours: send it the full replay (at most every 10 s per guest)
      if (net.role !== 'host' || !app.running || app.state.over) break;
      const idx = app.slotIdx[slot], now = performance.now();
      if (idx === undefined || now - (desyncAt[slot] || -1e9) < 10000) break;
      desyncAt[slot] = now;
      net.sendTo(slot, { t: 'resync', ...app.game, log: app.cmdLog, tick: app.state.tick, v: VERSION, idx });
      break;
    }
    case 'cmd':
      if (net.role === 'host' && app.slotIdx[slot] !== undefined) app.pending.push({ ...m.cmd, p: app.slotIdx[slot] });
      break;
    // ---- both ----
    case 'cursor':
      if (net.role === 'host') {
        const idx = app.slotIdx[slot];
        if (idx === undefined) break;
        ui.partners[idx] = { x: m.x, y: m.y, at: performance.now() };
        net.sendExcept(slot, { t: 'cursor', idx, x: m.x, y: m.y });
      } else if (m.idx !== undefined && m.idx !== app.myIdx) ui.partners[m.idx] = { x: m.x, y: m.y, at: performance.now() };
      break;
    // ---- guest side ----
    case 'welcome': if (m.v !== VERSION) mismatch(m.v); break;
    case 'mismatch': mismatch(m.v); break;
    case 'full': status('Кімната заповнена (4/4)', 'bad'); net.leave(); break;
    case 'roster': app.roster = m.list; bus.emit('roster:changed'); break;
    case 'start': if (m.v === VERSION) { app.myIdx = m.idx; startGame(m.seed, m.opts); } else mismatch(m.v); break;
    case 'resync': if (m.v === VERSION) resync(m); else mismatch(m.v); break;
    case 'tick': case 'cmds': case 'hash': if (net.role === 'guest') net.inbox.push(m); break;
    case 'lobby': if (net.role === 'guest') { enterLobby(true); status('Хост у меню — чекаємо нову гру', 'good'); } break;
    // explicit end-of-game from the host: guests must see it even if their replay lagged or missed the event
    // queued in order with the ticks: handled immediately it could overtake ticks still in the inbox and stop the replay
    case 'end': if (net.role === 'guest') net.inbox.push(m); break;
  }
};

/** Heartbeat + timeouts (PeerJS 'close' is not always fired, e.g. when a tab is killed). Called ~1/s from loop.js. */
export function heartbeat() {
  if (!net.online) return;
  net.send({ t: 'ping' });
  const now = performance.now();
  if (net.role === 'guest' && app.hostAlive && now - app.lastMsgAt > 5000) net.onLeave(0);
  if (net.role === 'host') for (const s of net.guestSlots()) if (now - net.slots[s].lastMsg > 5000) net.drop(s);
}
