// Pure read-only queries on the game state. Used by the simulation, the renderer and the client UI.
import { TOWERS, CONFIG, OBSTACLES, ABILITIES, AURA, BRANCHES, ENEMIES, TICK_RATE as T, COLS, ROWS } from './data.js';
import { key } from './mapgen.js';

export function isFree(s, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  const k = key(tx, ty);
  if (s.map.tiles.has(k) || s.map.water.has(k)) return false;
  if (s.map.farm && s.map.farm.tiles.has(k)) return false; // the farm is off limits
  if (s.barrels.some((b) => b.tx === tx && b.ty === ty)) return false;
  if (s.obstacles.some((o) => o.tx === tx && o.ty === ty)) return false;
  return !s.towers.some((t) => t.tx === tx && t.ty === ty);
}
export const canPlace = isFree;
export const isRoad = (s, tx, ty) => s.map.tiles.has(key(tx, ty));
export const player = (s, p) => s.players[p] || s.players[0];

export function towerAt(s, tx, ty) {
  return s.towers.find((t) => t.tx === tx && t.ty === ty) || null;
}
export function obstacleAt(s, tx, ty) {
  return s.obstacles.find((o) => o.tx === tx && o.ty === ty) || null;
}
export function barrelAt(s, tx, ty) {
  return s.barrels.find((b) => b.tx === tx && b.ty === ty) || null;
}
export function family(kind) {
  return TOWERS[kind].from || kind;
}
export function clearCost(o) {
  return OBSTACLES[o.kind];
}
export const hasWall = (s, p) => s.walls.some((w) => w.owner === p && w.hp > 0);
const CD_KEY = { meteor: "meteorCd", nova: "novaCd", wall: "wallCd", goldrain: "goldrainCd", overdrive: "overdriveCd", quake: "quakeCd" };
export function abilityMax(s, id, p = 0) {
  const m = player(s, p).mods;
  return Math.round(ABILITIES[id].cd * (m[CD_KEY[id]] ?? 1) * m.cdAll * T);
}
// Only abilities in the player's loadout can be cast (talent tree decides the loadout).
export const hasAbility = (pl, id) => pl.abilities.includes(id);
export function enemyAt(s, x, y, r = 14) {
  let best = null, bd = r;
  for (const e of s.enemies) {
    const d = Math.hypot(e.x - x, e.y - 6 - y);
    if (!e.dead && d < bd) { best = e; bd = d; }
  }
  return best;
}

// Auras from Totems in range (any owner: co-op players can help each other). Strongest totem per aura wins, no stacking.
export function auraOf(s, t) {
  const a = { dmg: 0, rate: 0 };
  if (TOWERS[t.kind].support) return a;
  for (const o of s.towers) {
    if (!TOWERS[o.kind].support || Math.hypot(o.x - t.x, o.y - t.y) > TOWERS[o.kind].range) continue;
    const boost = player(s, o.owner).mods.aura;
    for (const k of ["dmg", "rate"]) if (o.aura[k]) a[k] = Math.max(a[k], AURA[k].bonus[o.aura[k] - 1] * boost);
  }
  return a;
}
export function auraCost(t, k) {
  const lv = (t.aura && t.aura[k]) || 0;
  return lv >= AURA[k].cost.length ? 0 : AURA[k].cost[lv];
}

export function towerStats(s, t) {
  const def = TOWERS[t.kind];
  const pl = player(s, t.owner), m = pl.mods;
  if (def.support) return { range: def.range, dmg: 0, period: 0, buff: 0, aura: auraOf(s, t) };
  const lv = def.from ? 0 : t.level - 1;
  const aura = auraOf(s, t);
  const od = pl.overT > 0 ? 1 + ABILITIES.overdrive.bonus : 1; // Overdrive: the owner's towers fire faster
  return {
    range: (def.range + lv * CONFIG.rangePerLevel) * m.range * (m.towerRange[family(t.kind)] || 1) * (s.mission && s.mission.night ? 0.7 : 1), // night: shorter sight
    dmg: def.dmg * (1 + 0.6 * lv) * (m.dmg[family(t.kind)] || 1) * (1 + aura.dmg),
    period: Math.max(1, Math.round(T / (def.rate * m.rate * (m.towerRate[family(t.kind)] || 1) * (1 + aura.rate) * od))),
    buff: aura.dmg + aura.rate,
    aura,
  };
}

// 0 = no plain upgrade available (max level or evolved; at level 3 evolution is offered instead).
// Towers locked for this player (each co-op player unlocks towers in their own talent tree).
export function isLocked(s, p, kind) {
  return ((s.opts.lockedBy && s.opts.lockedBy[p]) || s.opts.locked || []).includes(kind);
}
// Build price for this player (talent tree discounts, e.g. cheaper totems).
export function placeCost(s, p, kind) {
  const disc = player(s, p).mods.discount || {};
  const d = Math.min(0.8, (disc[kind] || 0) + (disc.all || 0)); // "all" = every tower (tree)
  return Math.round(TOWERS[kind].cost * (1 - d));
}

export function upgradeCost(t) {
  if (TOWERS[t.kind].from || TOWERS[t.kind].support || t.level >= CONFIG.maxLevel) return 0;
  return Math.floor(TOWERS[t.kind].cost * 0.8 * t.level);
}
export function canEvolve(t) {
  return !!BRANCHES[t.kind] && t.level >= CONFIG.maxLevel;
}

// Relocation: free tile within moveRange tiles, tower off cooldown.
export function canMove(s, t, tx, ty) {
  return !(t.moveCd > 0) && Math.hypot(tx - t.tx, ty - t.ty) <= CONFIG.moveRange && canPlace(s, tx, ty);
}

// Share of the spent gold a player gets back when selling (tree: Торг, Ковальня).
export const sellRatioOf = (s, p) => Math.min(1, CONFIG.sellRatio + player(s, p).mods.sell);
export function sellValue(t, ratio = CONFIG.sellRatio) {
  return Math.floor(t.spent * ratio);
}

// Campaign stars: 1 for the win, 1 for the mission's side objective, 1 for a brisk pace (early wave calls).
export function missionStars(s) {
  const M = s.mission, side = M.side || {};
  const sideOk = side.type === "noLeak" ? s.stats.leaks === 0
    : side.type === "farm" ? s.farmHp / (s.farmMax || 1) >= side.pct
    : side.type === "coins" ? s.stats.coins >= side.n
    : side.type === "peak" ? s.stats.peak <= side.n : false;
  return 1 + (sideOk ? 1 : 0) + (s.stats.early >= (M.early || 0) ? 1 : 0);
}

// src = tower family that dealt the damage; enemy types are weak or resistant to some families (ENEMIES[].vs).
export function vsMult(type, src) {
  return (src && ENEMIES[type].vs && ENEMIES[type].vs[src]) || 1;
}
