// Fixed-step game loop (20 Hz) for solo / co-op host / co-op guest, plus the background ticker.
// Draws through the renderer and publishes `sim:events` and `frame` on the bus; owns no game rules.
import { step, stateHash } from '../sim/sim.js';
import { TICK_RATE } from '../sim/data.js';
import { app, bus, net, renderer, ui } from './app.js';
import { finishRun, resumeEndless } from './session.js';
import { heartbeat } from './netplay.js';

const DT = 1000 / TICK_RATE;
// events that change the game flow even during a fast silent catch-up
const FLOW_EVENTS = ['gameover', 'victory', 'endless', 'draft'];

let acc = 0;
let last = performance.now();
let lastSim = performance.now();
let lastTickAt = 0;
let bgBeats = 0;

/** Run flow reacts to sim events here; presentation (sound, banners) is done by subscribers of `sim:events`. */
function dispatch(events, quiet) {
  // fast catch-up: skip effects and sounds, but never the events that change the game flow
  if (quiet) events = events.filter((e) => FLOW_EVENTS.includes(e.type));
  if (!quiet) renderer.onEvents(events, app.state);
  for (const e of events) {
    if (e.type === 'gameover') finishRun(false);
    else if (e.type === 'victory') finishRun(true);
    else if (e.type === 'endless') resumeEndless();
  }
  bus.emit('sim:events', events, quiet);
}

// guest: the host's fingerprint arrives in order right after its tick, so our state must be at the same tick
let lastDesyncAsk = -1e9;
function checkHash(m) {
  const s = app.state;
  if (s.tick !== m.tick || stateHash(s) === m.h) return;
  const now = performance.now();
  if (now - lastDesyncAsk < 10000) return; // a resync is already on its way
  lastDesyncAsk = now;
  console.warn('desync at tick', m.tick);
  net.send({ t: 'desync', tick: m.tick });
  bus.emit('net:status', 'Розсинхрон — підтягуємо гру з хоста…', 'bad');
}

function tick(cmds, advance = true, quiet = false) {
  const s = app.state;
  step(s, cmds, advance);
  if (net.role === 'host') {
    net.send({ t: advance ? 'tick' : 'cmds', cmds });
    // every 5 s a fingerprint of the state: a guest that computed something else asks for a resync
    if (advance && s.tick % 100 === 0) net.send({ t: 'hash', tick: s.tick, h: stateHash(s) });
    if (cmds.length) app.cmdLog.push([s.tick - (advance ? 1 : 0), advance, cmds]);
  }
  dispatch(s.events, quiet);
}

/**
 * Advance the game; returns the interpolation alpha for drawing. Called every frame while visible and
 * by the background ticker while the tab is hidden, so the run never stalls for the other player.
 */
export function simulate(now) {
  const real = Math.min(250, now - lastSim);
  lastSim = now;
  const quiet = document.hidden; // nobody is watching: skip effects/sounds (they would pile up)
  const s = app.state;
  // the guest also keeps applying host messages on the end screen (e.g. the host's 'continue')
  // (also after the end screen is up: the host may still choose 'continue' in circle mode)
  if ((app.running || s.over || app.endShown) && net.role === 'guest') {
    // replay the host's ticks; after a long gap catch up fast and silently
    const backlog = net.inbox.length;
    let n = 0;
    while (net.inbox.length && n++ < 60) {
      const m = net.inbox.shift();
      if (m.t === 'hash') { checkHash(m); continue; }
      if (m.t === 'end') { if (!app.endShown) finishRun(m.won); continue; } // explicit end, in order with the ticks
      step(app.state, m.cmds, m.t === 'tick');
      dispatch(app.state.events, quiet || backlog > 10);
      if (m.t === 'tick') lastTickAt = now;
    }
    return Math.min(1, (now - lastTickAt) / DT);
  }
  // on the end screen the game is stopped, but commands like 'continue' must still go through
  if (!app.running) {
    if (app.pending.length && s.over) { const cmds = app.pending; app.pending = []; tick(cmds, false, quiet); }
    return 1;
  }
  if (s.over) acc = 0;
  else if (!app.paused && !app.draftPause && now >= app.freezeUntil) acc += real * app.speed;
  while (acc >= DT) {
    const cmds = app.pending;
    app.pending = [];
    tick(cmds, true, quiet);
    acc -= DT;
  }
  // commands issued while paused apply without advancing time
  if (app.pending.length) { const cmds = app.pending; app.pending = []; tick(cmds, false, quiet); }
  return app.paused || app.draftPause ? 1 : acc / DT;
}

function loop(now) {
  const real = Math.min(250, now - last);
  last = now;
  const alpha = simulate(now);
  renderer.draw(app.state, alpha, ui, real / 1000);
  bus.emit('frame');
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

// Background ticker: browsers freeze requestAnimationFrame and throttle timers in hidden tabs,
// but not timers inside a Worker. It keeps the simulation and the co-op heartbeat running.
function backgroundTick() {
  try {
    if (document.hidden) simulate(performance.now());
    if (++bgBeats % 20 === 0) heartbeat();
  } catch (err) {
    console.error(err);
  }
}

export function startLoop() {
  try {
    const src = 'setInterval(() => postMessage(0), 50);';
    const ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    ticker.onmessage = backgroundTick;
  } catch {
    setInterval(backgroundTick, 50); // no workers: best effort
  }
  requestAnimationFrame(frame);
}
