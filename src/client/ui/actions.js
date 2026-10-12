// Player actions shared by mouse, keyboard and the tower popup. Each one either changes local UI state
// (selection, build mode) or sends a command through session.send().
import { isLocked, hasWall } from '../../sim/sim.js';
import { app, ui, net, sfx, me, P } from '../app.js';
import { $ } from '../dom.js';
import { send } from '../session.js';
import { banner } from './banner.js';

export const selTower = () => (ui.selected && ui.selected[0] === 't' ? app.state.towers.find((k) => 't' + k.id === ui.selected) : null);
export const selObstacle = () => (ui.selected && ui.selected[0] === 'o' ? app.state.obstacles.find((k) => 'o' + k.id === ui.selected) : null);

export function select(key) { ui.selected = key; sfx.play('click'); }

export function cancel() { ui.build = null; ui.selected = null; ui.ability = null; ui.moving = null; }

export function startMove() {
  const t = selTower();
  if (!t || t.owner !== me() || t.moveCd > 0) return;
  ui.moving = t.id; ui.build = null; ui.ability = null;
}

export function selectBuild(kind) {
  sfx.unlock();
  if (isLocked(app.state, me(), kind)) return;
  ui.ability = null;
  ui.selected = null;
  ui.build = ui.build === kind ? null : kind;
  sfx.play('click');
}

export function useAbility(id) {
  sfx.unlock();
  if (!app.running || !id || !P().abilities.includes(id) || P().cds[id] > 0) return;
  if (id === 'wall' && hasWall(app.state, me())) { banner('Барикада вже стоїть', 'gold'); return; }
  ui.build = null;
  if (id === 'nova' || id === 'overdrive') { send({ type: id }); return; } // no target: fires at once
  ui.ability = ui.ability === id ? null : id;
}

export function nextWave() { sfx.unlock(); send({ type: 'nextWave' }); }
export function upgradeSel() { const t = selTower(); if (t) send({ type: 'upgrade', id: t.id }); }
export function sellSel() { const t = selTower(); if (t && t.owner === me()) { send({ type: 'sell', id: t.id }); ui.selected = null; } }

export function toggleSpeed() {
  if (net.role === 'guest') return;
  app.speed = app.speed === 1 ? 2 : app.speed === 2 ? 3 : 1;
  $('speed').textContent = 'x' + app.speed;
}

export function togglePause() {
  if (net.role === 'guest') return;
  app.paused = !app.paused;
  $('pause').textContent = app.paused ? '▶' : '❚❚';
}
