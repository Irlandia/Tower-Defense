// Player commands (Command pattern): one handler per `c.type`, looked up in COMMANDS.
// Every handler validates its input itself: commands come from the network and must never be trusted.
// Handler signature: (s, pl, pi, c) where pl = s.players[pi], pi = acting player index, c = the command.
import { TILE, COLS, ROWS, TOWERS, CARDS, CONFIG, OBSTACLES, BARREL, ABILITIES, AURA, ENEMIES, COIN, TICK_RATE as T } from './data.js';
import { rand } from './rng.js';
import { center, posAt } from './mapgen.js';
import {
  canPlace, isRoad, isLocked, placeCost, upgradeCost, canEvolve, canMove, sellValue, clearCost,
  auraCost, abilityMax, hasWall, hasAbility, sellRatioOf, canMaster, masterCost,
} from './queries.js';
import { damage, ignite, pickCards } from './combat.js';
import { startWave } from './waves.js';

const isTile = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const own = (s, pi, id) => s.towers.find((k) => k.id === id && k.owner === pi);

export const COMMANDS = {
  // co-op: a player disconnected (sent by the host). Their towers keep shooting; their gold goes to the partners.
  leave(s, pl, pi) {
    const others = s.players.filter((q, i) => i !== pi && !q.left);
    if (pl.left || !others.length) return;
    pl.left = true;
    const share = Math.floor(pl.gold / others.length);
    for (const q of others) q.gold += share;
    s.events.push({ type: 'leave', p: pi, gold: share });
    pl.gold -= share * others.length;
  },
  rejoin(s, pl) { pl.left = false; }, // host: the player is back in their seat

  pick(s, pl, pi, c) {
    const draft = pl.drafts[0];
    const card = draft && CARDS.find((k) => k.id === draft[c.index]);
    if (!card) return;
    card.apply(s, pl);
    pl.picked[card.id] = (pl.picked[card.id] || 0) + 1;
    pl.drafts.shift();
    s.events.push({ type: 'picked', p: pi, card: card.id });
  },

  // swap the current draft for a fresh one with the same guarantee (one reroll per boss)
  reroll(s, pl, pi) {
    const draft = pl.drafts[0];
    if (!draft || !(pl.rerolls > 0)) return;
    pl.rerolls--;
    const best = draft.some((id) => CARDS.find((k) => k.id === id).rarity === "epic") ? "epic" : "rare";
    pl.drafts[0] = pickCards(s, draft.length, pl, best);
    s.events.push({ type: "reroll", p: pi });
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

  // the final upgrade (Mastery) of an evolved tower / a Totem with an aura at level 3
  master(s, pl, pi, c) {
    const t = own(s, pi, c.id);
    if (!t || !canMaster(t)) return;
    const cost = masterCost(s, pi, t);
    if (pl.gold < cost) return;
    pl.gold -= cost;
    t.spent += cost;
    t.master = true;
    t.cd = 0;
    s.events.push({ type: "master", x: t.x, y: t.y, kind: t.kind, p: pi });
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
    const gold = sellValue(t, sellRatioOf(s, pi));
    pl.gold += gold;
    s.towers.splice(i, 1);
    s.events.push({ type: 'sell', x: t.x, y: t.y, gold, p: pi });
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
    if (!isNum(c.x) || !isNum(c.y) || !hasAbility(pl, 'meteor') || pl.cds.meteor > 0) return;
    pl.cds.meteor = abilityMax(s, 'meteor', pi);
    const dmg = (40 + s.wave * 6) * pl.mods.meteorDmg;
    for (const e of s.enemies) {
      if (e.dead || Math.hypot(e.x - c.x, e.y - c.y) > ABILITIES.meteor.radius) continue;
      damage(s, e, dmg, pi, { pierce: true });
      ignite(s, e, 8, 3, pi);
    }
    s.events.push({ type: 'meteor', x: c.x, y: c.y, r: ABILITIES.meteor.radius, p: pi });
  },

  goldrain(s, pl, pi, c) {
    if (!isNum(c.x) || !isNum(c.y) || !hasAbility(pl, 'goldrain') || pl.cds.goldrain > 0) return;
    pl.cds.goldrain = abilityMax(s, 'goldrain', pi);
    const A = ABILITIES.goldrain;
    for (let n = 0; n < A.coins; n++) {
      const a = rand(s) * Math.PI * 2, r = rand(s) * A.radius;
      s.coins.push({
        id: s.nextId++, x: clamp(c.x + Math.cos(a) * r, 0, COLS * TILE - 1), y: clamp(c.y + Math.sin(a) * r, 0, ROWS * TILE - 1),
        value: A.value + s.wave, life: COIN.life * T,
      });
    }
    s.events.push({ type: 'goldrain', x: c.x, y: c.y, r: A.radius, p: pi });
  },

  overdrive(s, pl, pi) {
    if (!hasAbility(pl, 'overdrive') || pl.cds.overdrive > 0) return;
    pl.cds.overdrive = abilityMax(s, 'overdrive', pi);
    pl.overT = Math.round((ABILITIES.overdrive.dur + pl.mods.overSec) * T);
    s.events.push({ type: 'overdrive', p: pi });
  },

  // click on a road: the dragon flies that whole lane from its end back to the spawn (sim.js updateDragon)
  dragon(s, pl, pi, c) {
    if (!isNum(c.x) || !isNum(c.y) || !hasAbility(pl, "dragon") || pl.cds.dragon > 0) return;
    if (!isRoad(s, Math.floor(c.x / TILE), Math.floor(c.y / TILE))) return;
    let lane = -1, best = 1e9;
    s.map.lanes.forEach((L, i) => {
      for (let d = 0; d <= L.total; d += 12) { const p = posAt(s.map, i, d); const k = Math.hypot(p.x - c.x, p.y - c.y); if (k < best) { best = k; lane = i; } }
    });
    if (lane < 0) return;
    pl.cds.dragon = abilityMax(s, "dragon", pi);
    const L = s.map.lanes[lane], p = posAt(s.map, lane, L.total);
    s.dragons.push({ id: s.nextId++, lane, dist: L.total, owner: pi, x: p.x, y: p.y, px: p.x, py: p.y, hit: [] });
    s.events.push({ type: "dragon", x: p.x, y: p.y, p: pi });
  },

  quake(s, pl, pi, c) {
    if (!isNum(c.x) || !isNum(c.y) || !hasAbility(pl, 'quake') || pl.cds.quake > 0) return;
    pl.cds.quake = abilityMax(s, 'quake', pi);
    const A = ABILITIES.quake, dmg = A.dmg + s.wave * A.dmgPerWave;
    for (const e of s.enemies) {
      if (e.dead || Math.hypot(e.x - c.x, e.y - c.y) > A.radius) continue;
      damage(s, e, dmg, pi, { pierce: true });
      e.slowT = Math.round(A.slow * T * (ENEMIES[e.type].lives ? 0.5 : 1));
      e.slowF = A.slowF;
    }
    s.events.push({ type: 'quake', x: c.x, y: c.y, r: A.radius, p: pi });
  },

  nova(s, pl, pi) {
    if (!hasAbility(pl, 'nova') || pl.cds.nova > 0) return;
    pl.cds.nova = abilityMax(s, 'nova', pi);
    const a = ABILITIES.nova, freeze = a.freeze + pl.mods.novaFreeze;
    for (const e of s.enemies) {
      if (e.dead) continue;
      e.slowT = Math.round(freeze * T * (ENEMIES[e.type].lives ? 0.5 : 1));
      e.slowF = 0;
      if (!ENEMIES[e.type].dry) e.wetT = Math.round(a.wet * T); // Губка never gets wet
      e.burnT = 0;
    }
    s.events.push({ type: 'nova', p: pi });
  },

  wall(s, pl, pi, c) {
    if (!isTile(c.tx) || !isTile(c.ty)) return;
    if (!hasAbility(pl, 'wall') || pl.cds.wall > 0 || !isRoad(s, c.tx, c.ty) || c.tx < 0) return;
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
