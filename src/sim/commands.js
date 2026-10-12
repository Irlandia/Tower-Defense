// Player commands (Command pattern): one handler per `c.type`, looked up in COMMANDS.
// Every handler validates its input itself: commands come from the network and must never be trusted.
// Handler signature: (s, pl, pi, c) where pl = s.players[pi], pi = acting player index, c = the command.
import { TOWERS, CARDS, CONFIG, OBSTACLES, BARREL, ABILITIES, AURA, ENEMIES, TICK_RATE as T } from './data.js';
import { center } from './mapgen.js';
import {
  canPlace, isRoad, isLocked, placeCost, upgradeCost, canEvolve, canMove, sellValue, clearCost,
  auraCost, abilityMax, hasWall,
} from './queries.js';
import { damage, ignite } from './combat.js';
import { startWave } from './waves.js';

const isTile = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (s, pi, id) => s.towers.find((k) => k.id === id && k.owner === pi);

export const COMMANDS = {
  pick(s, pl, pi, c) {
    const draft = pl.drafts[0];
    const card = draft && CARDS.find((k) => k.id === draft[c.index]);
    if (!card) return;
    card.apply(s, pl);
    pl.picked[card.id] = (pl.picked[card.id] || 0) + 1;
    pl.drafts.shift();
    s.events.push({ type: 'picked', p: pi, card: card.id });
  },

  place(s, pl, pi, c) {
    if (!isTile(c.tx) || !isTile(c.ty)) return;
    const def = TOWERS[c.kind];
    const cost = def ? placeCost(s, pi, c.kind) : 0;
    if (s.mission && s.mission.maxTowers && s.towers.filter((k) => k.owner === pi).length >= s.mission.maxTowers) return; // tower limit
    if (!def || def.from || isLocked(s, pi, c.kind) || !canPlace(s, c.tx, c.ty) || pl.gold < cost) return;
    pl.gold -= cost;
    const t = { id: s.nextId++, owner: pi, kind: c.kind, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), level: 1, cd: 0, spent: cost, aim: 0, fired: 0 };
    if (def.support) t.aura = { dmg: 0, rate: 0 };
    s.towers.push(t);
    s.events.push({ type: 'build', x: t.x, y: t.y, p: pi });
  },

  upgrade(s, pl, pi, c) {
    const t = own(s, pi, c.id);
    const cost = t ? upgradeCost(t) : 0;
    if (!cost || pl.gold < cost) return;
    pl.gold -= cost;
    t.spent += cost;
    t.level++;
    s.events.push({ type: 'upgrade', x: t.x, y: t.y, p: pi });
  },

  evolve(s, pl, pi, c) {
    const t = own(s, pi, c.id);
    const def = TOWERS[c.kind];
    if (!t || !def || def.from !== t.kind || !canEvolve(t) || pl.gold < def.cost) return;
    pl.gold -= def.cost;
    t.spent += def.cost;
    t.kind = c.kind;
    t.cd = 0;
    s.events.push({ type: 'evolve', x: t.x, y: t.y, kind: c.kind, p: pi });
  },

  aura(s, pl, pi, c) {
    const t = own(s, pi, c.id);
    if (!t || !TOWERS[t.kind].support || !AURA[c.aura]) return;
    const cost = auraCost(t, c.aura);
    if (!cost || pl.gold < cost) return;
    pl.gold -= cost;
    t.spent += cost;
    t.aura[c.aura]++;
    s.events.push({ type: 'aura', x: t.x, y: t.y, aura: c.aura, level: t.aura[c.aura], p: pi });
  },

  move(s, pl, pi, c) {
    if (!isTile(c.tx) || !isTile(c.ty)) return;
    const t = own(s, pi, c.id);
    if (!t || !canMove(s, t, c.tx, c.ty)) return;
    const from = { x: t.x, y: t.y };
    Object.assign(t, { tx: c.tx, ty: c.ty, ...center(c.tx, c.ty) });
    t.moveCd = Math.round(CONFIG.moveCd * T * pl.mods.moveCd);
    t.cd = Math.max(t.cd, CONFIG.moveSetup * T);
    s.events.push({ type: 'move', fx: from.x, fy: from.y, x: t.x, y: t.y, p: pi });
  },

  sell(s, pl, pi, c) {
    const i = s.towers.findIndex((k) => k.id === c.id && k.owner === pi);
    if (i < 0) return;
    const t = s.towers[i];
    pl.gold += sellValue(t);
    s.towers.splice(i, 1);
    s.events.push({ type: 'sell', x: t.x, y: t.y, gold: sellValue(t), p: pi });
  },

  clear(s, pl, pi, c) {
    const i = s.obstacles.findIndex((o) => o.id === c.id);
    if (i < 0) return;
    const o = s.obstacles[i];
    if (pl.gold < clearCost(o)) return;
    pl.gold -= clearCost(o);
    s.obstacles.splice(i, 1);
    const p = center(o.tx, o.ty);
    s.events.push({ type: 'clear', ...p, kind: o.kind, p: pi });
    if (o.chest) {
      pl.gold += OBSTACLES.chestGold;
      s.events.push({ type: 'chest', ...p, gold: OBSTACLES.chestGold, p: pi });
    }
  },

  barrel(s, pl, pi, c) {
    const b = s.barrels.find((k) => k.id === c.id);
    if (!b || !b.ready) return;
    b.ready = false;
    const dmg = (BARREL.dmg + s.wave * BARREL.dmgPerWave) * pl.mods.barrel;
    for (const e of s.enemies) {
      if (e.dead || Math.hypot(e.x - b.x, e.y - b.y) > BARREL.radius) continue;
      damage(s, e, dmg, pi, { pierce: true });
      ignite(s, e, 6, 2, pi);
    }
    s.events.push({ type: 'barrel', x: b.x, y: b.y, r: BARREL.radius });
  },

  collect(s, pl, pi, c) {
    const i = s.coins.findIndex((k) => k.id === c.id);
    if (i < 0) return;
    const coin = s.coins[i];
    pl.gold += coin.value;
    s.coins.splice(i, 1);
    s.stats.coins++;
    s.events.push({ type: 'coin', x: coin.x, y: coin.y, gold: coin.value, p: pi });
  },

  nextWave(s) {
    if (s.queue.length || (s.wave >= s.winWave && !s.endless)) return;
    const bonus = s.wave > 0 ? Math.ceil(s.countdown / T) * CONFIG.earlyBonus : 0;
    if (bonus) {
      s.stats.early++;
      for (const q of s.players) q.gold += bonus;
      s.events.push({ type: 'bonus', gold: bonus });
    }
    startWave(s);
  },

  meteor(s, pl, pi, c) {
    if (!isNum(c.x) || !isNum(c.y) || pl.cds.meteor > 0) return;
    pl.cds.meteor = abilityMax(s, 'meteor', pi);
    const dmg = 40 + s.wave * 6;
    for (const e of s.enemies) {
      if (e.dead || Math.hypot(e.x - c.x, e.y - c.y) > ABILITIES.meteor.radius) continue;
      damage(s, e, dmg, pi, { pierce: true });
      ignite(s, e, 8, 3, pi);
    }
    s.events.push({ type: 'meteor', x: c.x, y: c.y, r: ABILITIES.meteor.radius, p: pi });
  },

  nova(s, pl, pi) {
    if (pl.cds.nova > 0) return;
    pl.cds.nova = abilityMax(s, 'nova', pi);
    const a = ABILITIES.nova;
    for (const e of s.enemies) {
      if (e.dead) continue;
      e.slowT = Math.round(a.freeze * T * (ENEMIES[e.type].lives ? 0.5 : 1));
      e.slowF = 0;
      e.wetT = Math.round(a.wet * T);
      e.burnT = 0;
    }
    s.events.push({ type: 'nova', p: pi });
  },

  wall(s, pl, pi, c) {
    if (!isTile(c.tx) || !isTile(c.ty)) return;
    if (pl.cds.wall > 0 || !isRoad(s, c.tx, c.ty) || c.tx < 0) return;
    if (hasWall(s, pi)) return; // one standing barricade per player
    if (s.walls.some((w) => w.tx === c.tx && w.ty === c.ty)) return;
    pl.cds.wall = abilityMax(s, 'wall', pi);
    const hp = Math.round((ABILITIES.wall.hp + s.wave * ABILITIES.wall.hpPerWave) * pl.mods.wall);
    s.walls.push({ id: s.nextId++, owner: pi, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), hp, max: hp });
    s.events.push({ type: 'wallup', ...center(c.tx, c.ty), p: pi });
  },
};

// Circle mode: after winning, the run can go on endlessly with ever harder waves.
// Handled before the "game over" guard because it is the one command valid on the end screen.
function applyContinue(s) {
  if (s.won && s.over && !s.endless && s.mode === 'circle' && !s.mission) {
    s.over = false;
    s.endless = true;
    s.won = false; // the win is already credited; the endless run ends in a (scored) defeat
    s.countdown = CONFIG.waveDelay * T;
    s.events.push({ type: 'endless' });
  }
}

export function applyCmd(s, c) {
  if (!c || typeof c !== 'object') return;
  if (c.type === 'continue') { applyContinue(s); return; }
  if (s.over) return;
  const handler = Object.prototype.hasOwnProperty.call(COMMANDS, c.type) ? COMMANDS[c.type] : null;
  if (!handler) return;
  const pi = s.players[c.p] ? c.p : 0;
  handler(s, s.players[pi], pi, c);
}
