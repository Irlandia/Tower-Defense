// URL debug switches (for screenshots and manual checks):
//   ?tutorial — fresh solo classic run with the first-run hints
//   ?demo[=circle|circle2|circle4|boss|brawl|campaign][&season=winter][&week=N][&mission=N][&select=I]
import { TOWER_ORDER, brawlWeek, DAY } from '../sim/data.js';
import { canPlace, isRoad, posAt } from '../sim/sim.js';
import * as Meta from '../meta.js';
import { app, ui, meta } from './app.js';
import { startGame, send } from './session.js';

/** Returns true if a demo run was started (the caller then skips opening the menu). */
export function runDemoIfRequested() {
  const q = new URLSearchParams(location.search);
  if (q.has('select')) {
    setTimeout(() => { const t = app.state.towers[+q.get('select') || 0]; if (t) ui.selected = 't' + t.id; }, 600);
  }
  // ?tutorial: a fresh solo classic run with the first-run hints (forgets that they were seen)
  if (q.has('tutorial')) {
    try { localStorage.removeItem('pixeltd-tutorial-done'); } catch { /* ignore */ }
    app.mode = 'classic';
    startGame(12345, Meta.gameOpts(meta, app.diff, 'classic', 1, q.get('season') || 'random'));
    return true;
  }
  if (!q.has('demo')) return false;
  const dm = q.get('demo');
  app.season = q.get('season') || 'random';
  app.mode = dm === 'campaign' ? 'campaign' : dm === 'brawl' ? 'brawl' : dm && dm.startsWith('circle') ? 'circle' : 'classic';
  const players = dm === 'circle2' ? 2 : dm === 'circle4' ? 4 : 1;
  const opts = Meta.gameOpts(meta, app.diff, app.mode, players, app.season);
  if (app.mode === 'brawl') opts.week = +(q.get('week') || brawlWeek(Date.now()));
  if (app.mode === 'campaign') opts.mission = +(q.get('mission') || 1);
  startGame(12345, opts);
  const s = app.state;
  s.players[0].gold = 2000;
  s.opts.locked = []; s.opts.lockedBy = null;
  if (q.has('dragon')) { // &dragon: cast the dragon on the first lane (screenshots)
    s.players[0].abilities = [...s.players[0].abilities, 'dragon'];
    const p = posAt(s.map, 0, s.map.lanes[0].total / 2);
    setTimeout(() => send({ type: 'dragon', x: p.x, y: p.y }), +(q.get('dragon') || 300));
  }
  if (q.has('time')) s.dayStart = Math.max(0, DAY.phases.findIndex((p) => p.id === q.get('time'))); // &time=day|evening|night|dawn
  // put each tower type on a free tile next to the road
  const spots = [];
  for (let ty = 0; ty < 14 && spots.length < 5; ty++) for (let tx = 2; tx < 24 && spots.length < 5; tx += 3) {
    if (canPlace(s, tx, ty) && (isRoad(s, tx, ty + 1) || isRoad(s, tx + 1, ty))) spots.push([tx, ty]);
  }
  spots.forEach(([tx, ty], i) => send({ type: 'place', kind: TOWER_ORDER[i], tx, ty }));
  if (dm === 'boss') {
    s.wave = 4;
    s.queue.push({ type: 'boss', bk: q.get('bk') || undefined, lane: 0, at: s.tick + 1, hpMul: 1 }); // &bk=kvak etc.
  } else send({ type: 'nextWave' });
  return true;
}
