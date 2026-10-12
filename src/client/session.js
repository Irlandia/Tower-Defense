// Run lifecycle: start / restart / resync / finish / resume, and the command entry point `send`.
// The only module (besides loop.js stepping the state) that replaces app.state. UI reacts through the bus.
import { createGame, step } from '../sim/sim.js';
import { VERSION, brawlWeek } from '../sim/data.js';
import * as Meta from '../meta.js';
import { app, bus, net, meta, ui, collected, me } from './app.js';
import { broadcastRoster } from './roster.js';

/** Begin a run locally (solo, host, or guest on the host's `start`). Emits `run:start`. */
export function startGame(seed, opts) {
  app.state = createGame(seed, opts);
  app.endShown = false;
  app.game = { seed, opts };
  app.cmdLog = [];
  app.pending = [];
  net.inbox = [];
  collected.clear();
  ui.build = null; ui.selected = null; ui.ability = null; ui.me = me();
  app.paused = false; app.draftPause = false; app.speed = 1;
  app.running = true;
  bus.emit('run:start');
}

/** Host or solo: pick a seed, seat the connected guests, tell them, start. */
export function newRun() {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  // seats: host = player 0, connected guests (by slot) = players 1..3; each plays with their own talent tree
  const guests = net.role === 'host' ? app.roster.filter((r) => r.slot > 0 && net.slots[r.slot]).sort((a, b) => a.slot - b.slot) : [];
  for (const k in app.slotIdx) delete app.slotIdx[k];
  guests.forEach((g, i) => { g.idx = i + 1; app.slotIdx[g.slot] = i + 1; });
  const opts = Meta.gameOpts(meta, app.diff, app.mode, 1 + guests.length, app.season, guests.map((g) => g.perks));
  if (app.mode === 'brawl') opts.week = brawlWeek(Date.now()); // every peer plays the host's week
  if (app.mode === 'campaign') opts.mission = app.selectedMission;
  for (const g of guests) net.sendTo(g.slot, { t: 'start', seed, opts, v: VERSION, idx: g.idx });
  if (net.role === 'host') broadcastRoster();
  startGame(seed, opts);
}

/** Guest: replay the host's whole command log to catch up after (re)connecting. */
export function resync(m) {
  app.myIdx = m.idx ?? app.myIdx;
  startGame(m.seed, m.opts);
  for (const [tick, adv, cmds] of m.log) {
    while (app.state.tick < tick) step(app.state);
    step(app.state, cmds, adv);
  }
  while (app.state.tick < m.tick) step(app.state);
  app.lastMsgAt = performance.now();
}

/** Queue a command for the next tick (guest: forward it to the host, which stamps the player index). */
export function send(cmd) {
  if (net.role === 'guest') net.send({ t: 'cmd', cmd });
  else app.pending.push({ ...cmd, p: 0 });
}

/** The run is over (game-over / victory event or the host's `end` message). Credits meta-progression once. */
export function finishRun(won) {
  if (app.endShown) return;
  app.endShown = true;
  if (net.role === 'host') net.send({ t: 'end', won });
  app.running = false;
  app.talentOpen = false;
  const { earned, record } = Meta.finishRun(meta, app.state);
  bus.emit('run:end', { won, earned, record });
}

/** Circle mode: the player chose to go on after the win. */
export function resumeEndless() {
  app.endShown = false;
  app.running = true;
  bus.emit('run:endless');
}

/** Back to the paused run (solo or host). The host brings the guest back with a full resync. */
export function canResume() {
  return !!app.game && !app.state.over && app.state.tick > 0 && net.role !== 'guest';
}
export function resumeGame() {
  if (!canResume()) return;
  app.running = true;
  bus.emit('run:resume');
  if (net.role === 'host' && net.connected && app.state.players.length > 1) {
    net.send({ t: 'resync', ...app.game, log: app.cmdLog, tick: app.state.tick, v: VERSION });
  }
}

/** Leave the run for the lobby. The host takes the guest along (instead of leaving them on a frozen game). */
export function enterLobby(fromNet = false) {
  if (app.running && net.role === 'host' && net.connected && !fromNet) net.send({ t: 'lobby' });
  app.running = false;
  app.talentOpen = false;
  bus.emit('menu:show');
}
