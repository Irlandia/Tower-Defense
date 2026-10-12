// Mouse and keyboard on the canvas -> actions / commands.
import { TILE, TOWER_ORDER } from '../../sim/data.js';
import { canPlace, canMove, isRoad, towerAt, obstacleAt, barrelAt, placeCost, enemyAt } from '../../sim/sim.js';
import { W, H, MX, MY } from '../../render.js';
import { app, ui, net, sfx, music, renderer, canvas, collected, me, P } from '../app.js';
import { send } from '../session.js';
import { select, cancel, selectBuild, useAbility, nextWave, upgradeSel, sellSel, startMove, toggleSpeed, togglePause } from './actions.js';
import { openTalent, closeTalent, pickCard } from './talents.js';

let lastMouseEv = null;
let lastCursorSent = 0;

export const getLastMouseEv = () => lastMouseEv;
export const magnetBoss = () => (app.running ? app.state.enemies.find((e) => e.magnetT > 0) : null);

/** Client mouse event -> map coordinates (pixels and tile). The Baron's magnet drags the pointer towards him. */
export function toMap(ev) {
  const r = canvas.getBoundingClientRect();
  let x = ((ev.clientX - r.left) / r.width) * W - MX;
  let y = ((ev.clientY - r.top) / r.height) * H - MY;
  const mag = magnetBoss();
  if (mag) { x += (mag.x - x) * 0.35; y += (mag.y - 8 - y) * 0.35; }
  return { x, y, tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
}

canvas.addEventListener('mousemove', (ev) => {
  lastMouseEv = ev;
  const m = toMap(ev);
  ui.mouse = m;
  ui.hover = m.y >= 0 && m.x >= 0 ? { tx: m.tx, ty: m.ty } : null;
  const en = enemyAt(app.state, m.x, m.y, 16);
  ui.hoverEnemy = en ? en.id : null; // shows the enemy's weaknesses in the side panel
  // coins are collected by hovering over them
  for (const c of app.state.coins) {
    if (!collected.has(c.id) && Math.hypot(c.x - m.x, c.y - m.y) < 10) { collected.add(c.id); send({ type: 'collect', id: c.id }); }
  }
  if (net.connected && performance.now() - lastCursorSent > 80) {
    lastCursorSent = performance.now();
    net.send({ t: 'cursor', idx: me(), x: Math.round(m.x), y: Math.round(m.y) });
  }
});
canvas.addEventListener('mouseleave', () => { ui.hover = null; ui.mouse = null; });
canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); cancel(); });

canvas.addEventListener('mousedown', (ev) => {
  sfx.unlock();
  if (app.running) music.playFor(app.state); // audio may only start after a user gesture
  if (ev.button !== 0 || !app.running) return;
  const s = app.state;
  const m = toMap(ev);
  if (m.y < 0) return;
  if (ui.moving) {
    // relocating a tower: click a highlighted free tile
    const mt = s.towers.find((k) => k.id === ui.moving);
    if (mt && canMove(s, mt, m.tx, m.ty)) { send({ type: 'move', id: mt.id, tx: m.tx, ty: m.ty }); ui.moving = null; ui.selected = null; }
    else if (!mt) ui.moving = null;
    return;
  }
  if (ui.ability === 'dragon') { // needs a road: the dragon follows that lane
    if (isRoad(s, m.tx, m.ty)) { send({ type: 'dragon', x: m.x, y: m.y }); ui.ability = null; }
    return;
  }
  if (ui.ability === 'wall') {
    if (isRoad(s, m.tx, m.ty)) { send({ type: 'wall', tx: m.tx, ty: m.ty }); ui.ability = null; }
    return;
  }
  // every other targeted ability (meteor, goldrain, quake) hits the point under the cursor
  if (ui.ability) { send({ type: ui.ability, x: m.x, y: m.y }); ui.ability = null; return; }
  const t = towerAt(s, m.tx, m.ty);
  if (t) { select('t' + t.id); ui.build = null; return; }
  const b = barrelAt(s, m.tx, m.ty);
  if (b) { if (b.ready) send({ type: 'barrel', id: b.id }); return; }
  const o = obstacleAt(s, m.tx, m.ty);
  if (o) { select('o' + o.id); ui.build = null; return; }
  // poke the wildlife (decoration only)
  if (!ui.build && renderer.critters.poke(m.x, m.y)) return;
  if (ui.build) {
    const cost = placeCost(s, me(), ui.build);
    if (canPlace(s, m.tx, m.ty) && P().gold >= cost) {
      send({ type: 'place', kind: ui.build, tx: m.tx, ty: m.ty });
      // guest: show the tower at once while the host confirms it (hides the network round-trip)
      if (net.role === 'guest') ui.pendingPlace.push({ kind: ui.build, tx: m.tx, ty: m.ty, at: performance.now() });
      if (!ev.shiftKey && P().gold - cost < cost) ui.build = null;
    }
    return;
  }
  ui.selected = null;
});

window.addEventListener('keydown', (ev) => {
  if (ev.repeat || ev.target.tagName === 'INPUT' || !app.running) return;
  const k = ev.key.toLowerCase();
  if (app.talentOpen && ['1', '2', '3', '4'].includes(k)) { pickCard(+k - 1); return; }
  const idx = ['1', '2', '3', '4', '5', '6'].indexOf(k);
  const slot = ['q', 'w', 'e', 'r'].indexOf(k);
  if (idx >= 0) selectBuild(TOWER_ORDER[idx]);
  else if (slot >= 0) useAbility(P().abilities[slot]);
  else if (k === 't') openTalent();
  else if (k === ' ') { ev.preventDefault(); nextWave(); }
  else if (k === 'm') startMove();
  else if (k === 'u') upgradeSel();
  else if (k === 's') sellSel();
  else if (k === 'f') toggleSpeed();
  else if (k === 'p') togglePause();
  else if (k === 'escape') { cancel(); closeTalent(); }
});

// Buttons must not keep keyboard focus: Space is the "next wave" hotkey and would also "click" a focused
// (possibly hidden) button such as "Ще раз" / "Почати разом", restarting the game and wiping the enemies.
document.addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) b.blur(); });
document.addEventListener('keyup', (ev) => { if (ev.key === ' ' && ev.target.tagName === 'BUTTON') ev.preventDefault(); }, true);
