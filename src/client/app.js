// Shared client context: the one place that owns mutable client state, the singletons and the event bus.
// Modules read/write `app.*` instead of keeping their own cross-file module-level variables.
// Event catalogue: docs/architecture.md §4.
import { createGame } from '../sim/sim.js';
import { Renderer } from '../render.js';
import { Sfx, Music } from '../audio.js';
import { Net } from '../net.js';
import * as Meta from '../meta.js';

/** Minimal publish/subscribe bus. Handlers run synchronously in registration order. */
export const bus = {
  _h: Object.create(null),
  on(evt, fn) { (this._h[evt] ||= []).push(fn); },
  emit(evt, ...args) { const l = this._h[evt]; if (l) for (const fn of l) fn(...args); },
};

export const canvas = document.getElementById('game');
export const renderer = new Renderer(canvas);
export const sfx = new Sfx();
export const music = new Music(sfx); // seasonal ambient soundtrack
renderer.onStomp = (king) => sfx.play(king ? 'stompBig' : 'stomp');
export const net = new Net();
export const meta = Meta.load();

export const app = {
  state: createGame(1),
  running: false,
  endShown: false, // end screen already shown for this run (guest may get it twice: event + host message)
  pending: [], // commands waiting for the next tick
  // menu selections
  diff: 'normal',
  mode: 'classic',
  season: 'random',
  selectedMission: 1,
  menuTab: 'play',
  boardMode: 'classic',
  boardPeriod: 'month', // leaderboard: this month / all time
  bestiaryPick: null, // boss key shown in the bestiary details
  nick: '',
  // run control
  myIdx: 0, // guest: player index assigned by the host at start
  speed: 1,
  paused: false,
  draftPause: false, // solo only: the talent window pauses the game
  freezeUntil: 0, // hit-stop (performance.now() deadline)
  talentOpen: false,
  // co-op
  cmdLog: [], // host: every command batch since the start, to resync a guest that reconnects mid-game
  game: null, // { seed, opts } of the current run
  roster: [], // [{ slot, nick, perks, idx }] — slot 0 is the host
  slotIdx: {}, // host: guest slot -> player index in the running game
  lastMsgAt: 0,
  hostAlive: false,
};

/** Pointer / selection state of the local player. */
export const ui = { build: null, selected: null, hover: null, mouse: null, ability: null, hoverEnemy: null, partners: {}, me: 0, moving: null, pendingPlace: [] };

/** Coin ids already sent for collection (avoids duplicate commands while the tick is pending). */
export const collected = new Set();

/** Index of the local player in state.players. */
export const me = () => (net.role === 'guest' ? app.myIdx : 0);
/** The local player's record. */
export const P = () => app.state.players[me()] || app.state.players[0];
