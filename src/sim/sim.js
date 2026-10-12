// Deterministic game simulation. No DOM, no Math.random, no Date.now.
// The client sends commands, step() advances one fixed tick and emits events for juice/sound.
// Every command carries `p` = player index (0 = host/solo, 1 = guest); each player has own gold, talents, abilities.
import {
  TILE, COLS, ROWS, TICK_RATE as T, CONFIG, TOWERS, ENEMIES, UNLOCKS, CARDS,
  MAPGEN, SEASONS, SEASON_ORDER, MODES, TOWER_ORDER, brawlOf, CAMPAIGN, BARREL, OBSTACLES, COIN, ABILITIES, AURA, BRANCHES, RARITY, BOSSES, bossKey,
} from './data.js';
import { rand, randInt } from './rng.js';

const center = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const key = (x, y) => x + ',' + y;

// ---------- procedural map ----------

// loopFrom: index of the point where the endless loop starts (circle mode); the loop closes back on it.
function buildLane(points, loopFrom = -1) {
  const pts = points.map(([x, y]) => center(x, y));
  const segs = [];
  let total = 0, loopStart = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (i === loopFrom) loopStart = total;
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return loopFrom >= 0 ? { points, segs, total, loop: true, loopStart, loopLen: total - loopStart } : { points, segs, total };
}

function addTiles(points, tiles) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    for (;;) {
      tiles.add(key(x, y));
      if (x === x1 && y === y1) break;
      x += dx; y += dy;
    }
  }
}

function genPonds(s, tiles) {
  const water = new Set();
  const [p0, p1] = SEASONS[s.season].ponds;
  const ponds = p0 + randInt(s, p1 - p0 + 1);
  for (let k = 0; k < ponds; k++) {
    const cx = 2 + randInt(s, COLS - 6), cy = 1 + randInt(s, ROWS - 2);
    const rx = 1.2 + rand(s) * 1.6, ry = 0.9 + rand(s) * 1.1;
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS || tiles.has(key(x, y))) continue;
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) water.add(key(x, y));
      }
    }
  }
  return water;
}

// Count road tiles of `pts` that run right next to (but not on) existing road: parallel lanes look like one wide road.
function hugging(pts, tiles) {
  const mine = new Set();
  addTiles(pts, mine);
  let n = 0;
  for (const k of mine) {
    if (tiles.has(k)) continue;
    const [x, y] = k.split(',').map(Number);
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles.has(key(x + dx, y + dy)) && !mine.has(key(x + dx, y + dy)))) n++;
  }
  return n;
}

// Classic: 2-3 lanes snake from the left edge to one castle on the right; they may cross but avoid running side by side.
function genClassic(s) {
  const n = rand(s) < MAPGEN.lanes3Chance ? 3 : 2;
  const yc = 3 + randInt(s, ROWS - 6);
  const spawns = [];
  const lanes = [];
  const tiles = new Set();
  for (let i = 0; i < n; i++) {
    let y0, guard = 0;
    do { y0 = 1 + randInt(s, ROWS - 2); } while (spawns.some(([, v]) => Math.abs(v - y0) < 3) && guard++ < 50);
    let pts, tries = 0;
    do {
      pts = [[-1, y0]];
      let x = -1, y = y0;
      for (;;) {
        x = Math.min(COLS - 3, x + 2 + randInt(s, 3));
        pts.push([x, y]);
        if (x >= COLS - 5) break;
        const ny = 1 + randInt(s, ROWS - 2);
        if (Math.abs(ny - y) >= 2) { y = ny; pts.push([x, y]); }
      }
      if (y !== yc) pts.push([x, yc]);
      pts.push([COLS - 1, yc]);
    } while (i > 0 && hugging(pts, tiles) > 3 && ++tries < 25);
    spawns.push([0, y0]);
    lanes.push(pts);
    addTiles(pts, tiles);
  }
  return { lanes: lanes.map((p) => buildLane(p)), tiles, water: genPonds(s, tiles), castle: [COLS - 1, yc], spawns };
}

// Circle: a closed ring with random inward dents; one entry road per player, each next to "their" side:
// player 1 from the left, 2 from the right, 3 from the top, 4 from the bottom. Sides with an entry stay straight.
function genCircle(s, players = 1) {
  const n = Math.max(1, Math.min(4, players));
  const x0 = 3 + randInt(s, 2), x1 = COLS - 4 - randInt(s, 2);
  const y0 = 1 + randInt(s, 2), y1 = ROWS - 2 - randInt(s, 2);
  const ym = Math.floor((y0 + y1) / 2) + randInt(s, 3) - 1;
  const ymR = Math.floor((y0 + y1) / 2) + randInt(s, 3) - 1;
  const xt = Math.floor((x0 + x1) / 2) + randInt(s, 3) - 1;
  const xb = Math.floor((x0 + x1) / 2) + randInt(s, 5) - 2;
  const dent = (a, b) => {
    // returns [from, to] inside (a, b) with room for corners, or null
    if (b - a < 9 || rand(s) < 0.35) return null;
    const p = a + 2 + randInt(s, Math.floor((b - a) / 2) - 2);
    return [p, Math.min(b - 2, p + 3 + randInt(s, 4))];
  };
  const join = {}; // side -> index of its join vertex in the loop
  const loop = [[x0, ym], [x0, y0]];
  if (n >= 3) { join.top = loop.length; loop.push([xt, y0]); } else {
    const dTop = dent(x0, x1), depthT = 2 + randInt(s, 2);
    if (dTop) loop.push([dTop[0], y0], [dTop[0], y0 + depthT], [dTop[1], y0 + depthT], [dTop[1], y0]);
  }
  loop.push([x1, y0]);
  if (n >= 2) { join.right = loop.length; loop.push([x1, ymR]); } else {
    const dRight = dent(y0, y1), depthR = 2 + randInt(s, 3);
    if (dRight) loop.push([x1, dRight[0]], [x1 - depthR, dRight[0]], [x1 - depthR, dRight[1]], [x1, dRight[1]]);
  }
  loop.push([x1, y1]);
  if (n >= 4) { join.bottom = loop.length; loop.push([xb, y1]); } else {
    const dBot = dent(x0, x1), depthB = 2 + randInt(s, 2);
    if (dBot) loop.push([dBot[1], y1], [dBot[1], y1 - depthB], [dBot[0], y1 - depthB], [dBot[0], y1]);
  }
  loop.push([x0, y1], [x0, ym]);
  const ring = loop.slice(0, -1);
  // same ring, same direction, entered elsewhere: rotate the loop to start at that side's join point
  const entry = (from, j) => buildLane([from, ...ring.slice(j), ...ring.slice(0, j), ring[j]], 1);
  const lanes = [buildLane([[-1, ym], ...loop], 1)];
  const spawns = [[0, ym]];
  if (n >= 2) { lanes.push(entry([COLS, ymR], join.right)); spawns.push([COLS - 1, ymR]); }
  if (n >= 3) { lanes.push(entry([xt, -1], join.top)); spawns.push([xt, 0]); }
  if (n >= 4) { lanes.push(entry([xb, ROWS], join.bottom)); spawns.push([xb, ROWS - 1]); }
  const tiles = new Set();
  for (const L of lanes) addTiles(L.points, tiles);
  return { lanes, tiles, water: genPonds(s, tiles), castle: null, spawns, ring: [x0, y0, x1, y1] };
}

// A small farm near the map centre: 1-tile house, a yard tile above it and a 2x2 field. No towers on it.
// Searched outward from the centre (no randomness), so every peer places it identically.
function placeFarm(map) {
  const W = 3, H = 2;
  const cand = [];
  for (let y = 0; y + H <= ROWS; y++) for (let x = 0; x + W <= COLS; x++) cand.push([x, y, Math.hypot(x + W / 2 - COLS / 2, y + H / 2 - ROWS / 2)]);
  cand.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of cand) {
    let ok = true;
    for (let j = 0; j < H && ok; j++) for (let i = 0; i < W && ok; i++) {
      const k = key(x + i, y + j);
      if (map.tiles.has(k) || map.water.has(k)) ok = false;
    }
    if (!ok) continue;
    const tiles = new Set();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) tiles.add(key(x + i, y + j));
    return { x, y, w: W, h: H, house: [x, y + 1], field: [x + 1, y, 2, 2], tiles };
  }
  return null;
}

export function posAt(map, lane, d) {
  const L = map.lanes[lane];
  if (L.loop && d > L.loopStart) d = L.loopStart + ((d - L.loopStart) % L.loopLen);
  for (const g of L.segs) {
    if (d <= g.start + g.len) {
      const t = (d - g.start) / g.len;
      return { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t };
    }
  }
  const last = L.segs[L.segs.length - 1].b;
  return { x: last.x, y: last.y };
}

// Which lanes the next wave will use (shown to the player in advance).
function planLanes(s) {
  const n = s.map.lanes.length;
  if (s.mode === "circle") return [...Array(n).keys()]; // every entry, every wave
  const all = [...Array(n).keys()];
  const count = s.wave >= 4 && rand(s) < 0.5 ? Math.min(n, 2) : 1;
  const out = [];
  while (out.length < count) out.push(all.splice(randInt(s, all.length), 1)[0]);
  return out.sort();
}

// i = player index; opts.perks[i] is that player's talent tree (src/meta.js perks()), applied once at start.
function newPlayer(opts, i = 0) {
  const k = (opts.perks && opts.perks[i]) || {};
  const dmg = { arrow: 1, cannon: 1, frost: 1, tesla: 1, fire: 1 };
  for (const f in k.dmg || {}) dmg[f] = (dmg[f] || 1) * k.dmg[f];
  const BR = opts.brawlRules || {};
  if (BR.towerDmg) for (const f in dmg) dmg[f] *= BR.towerDmg;
  return {
    gold: (opts.brawlRules && opts.brawlRules.startGold) || CONFIG.startGold + (k.bonusGold ?? (i === 0 ? opts.bonusGold || 0 : 0)),
    mods: {
      dmg,
      rate: 1, range: BR.towerRange || 1, chain: k.chain || 0, burn: k.burn || 1, wet: k.wet || 0, steam: k.steam || 1, gold: 1, interest: 0, crit: 0.1 + (k.crit || 0),
      meteorCd: (k.meteorCd || opts.meteorCd || 1) * (BR.meteorCd || 1), wall: 1,
      critMul: 2, aura: k.aura || 1, moveCd: k.moveCd || 1, novaCd: k.novaCd || 1, barrel: 1, lapDmg: 0, hunter: 0, thief: 0,
      towerRate: { ...(k.rate || {}) }, towerRange: { ...(k.range || {}) }, splash: k.splash || 1, discount: { ...(k.discount || {}) },
      cards: k.cards || opts.cards || 3,
    },
    picked: {}, // talent id -> times taken (cards have a max)
    cds: { meteor: 0, nova: 0, wall: 0 },
    drafts: [], // pending talent choices (arrays of card ids); picking never pauses the game
    kills: 0,
  };
}

// opts come from meta-progression + difficulty (see src/meta.js); in co-op the host sends them to the guest.
export function createGame(seed, opts = {}) {
  const o = { hpMul: 1, cards: 3, locked: [], mode: "classic", players: 1, ...opts };
  // Weekly Brawl: a ruleset on top of a normal board; the same towers are open for everyone
  // Campaign missions reuse the brawl rule engine; boss waves come from the mission instead of "every 5th"
  const M = o.mode === "campaign" ? CAMPAIGN[Math.max(0, Math.min(CAMPAIGN.length - 1, (o.mission || 1) - 1))] : null;
  if (M) o.season = M.season;
  const B = o.mode === "brawl" ? brawlOf(o.week || 0) : M ? { ...M.rules, map: M.map, weather: M.weather, bossEvery: 999 } : null;
  if (B && B.towers) { const lock = TOWER_ORDER.filter((k) => !B.towers.includes(k)); o.locked = lock; o.lockedBy = Array.from({ length: o.players }, () => lock); }
  if (B && !B.towers) o.lockedBy = Array.from({ length: o.players }, () => []); // brawls open every tower
  if (B) o.brawlRules = B;
  const s = {
    rngState: seed >>> 0,
    opts: o,
    mode: B ? B.map : o.mode,
    brawl: B,
    mission: M,
    winWave: M ? M.waves : CONFIG.winWave,
    farmHp: M && M.farmHp ? M.farmHp : 0,
    farmMax: M && M.farmHp ? M.farmHp : 0,
    stats: { coins: 0, leaks: 0, peak: 0, early: 0 },
    stars: 0,
    won: false,
    lapSpeedMul: 1,
    tick: 0,
    lives: CONFIG.startLives + (o.bonusLives || 0),
    // alive limit depends on the board (brawls and missions can be played on the circle too)
    limit: (B ? B.map : o.mode) === 'circle' ? (M && M.limit ? M.limit : MODES.circle.maxAlive) + 15 * (o.players - 1) + 5 * Math.round((o.bonusLives || 0) / 3) : 0, // more players, bigger waves, more room
    wave: 0,
    countdown: CONFIG.firstWaveDelay * T,
    map: null,
    plan: [],
    players: Array.from({ length: o.players }, (_, i) => newPlayer(o, i)),
    enemies: [],
    towers: [],
    projs: [],
    zones: [],
    coins: [],
    walls: [],
    obstacles: [],
    barrels: [],
    queue: [],
    nextId: 100,
    events: [],
    over: false,
    kills: 0,
  };
  // season: chosen in the menu, or random (from the seed, so co-op peers agree)
  s.season = SEASONS[o.season] ? o.season : SEASON_ORDER[randInt(s, SEASON_ORDER.length)];
  s.map = o.mode === "circle" ? genCircle(s, o.players) : genClassic(s);
  s.map.farm = placeFarm(s.map);
  s.plan = planLanes(s);

  const nearSpawn = (tx, ty) => s.map.spawns.some(([x, y]) => Math.abs(tx - x) <= 1 && Math.abs(ty - y) <= 1);
  const nearCastle = (tx, ty) => s.map.castle && Math.abs(tx - s.map.castle[0]) <= 1 && Math.abs(ty - s.map.castle[1]) <= 1;
  // Explosive barrels right next to the road.
  let guard = 0;
  while (s.mode !== "circle" && s.barrels.length < MAPGEN.barrels && guard++ < 2000) {
    const tx = 2 + randInt(s, COLS - 5), ty = randInt(s, ROWS);
    if (!isFree(s, tx, ty) || nearSpawn(tx, ty)) continue;
    const byRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.map.tiles.has(key(tx + dx, ty + dy)));
    if (!byRoad || s.barrels.some((b) => Math.abs(b.tx - tx) + Math.abs(b.ty - ty) < 6)) continue;
    s.barrels.push({ id: s.barrels.length + 1, tx, ty, ...center(tx, ty), ready: true });
  }
  // Trees and rocks block building; clearing them costs gold and may reveal a chest.
  guard = 0;
  const sea = SEASONS[s.season];
  while (s.obstacles.length < sea.obstacles && guard++ < 2000) {
    const tx = randInt(s, COLS), ty = randInt(s, ROWS);
    if (!isFree(s, tx, ty) || nearSpawn(tx, ty) || nearCastle(tx, ty)) continue;
    s.obstacles.push({ id: s.nextId++, tx, ty, kind: rand(s) < sea.trees ? "tree" : "rock", chest: rand(s) < (sea.chest || OBSTACLES.chestChance), v: randInt(s, 3) });
  }
  return s;
}

// ---------- queries (also used by the client for previews) ----------

function isFree(s, tx, ty) {
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
export function abilityMax(s, id, p = 0) {
  const m = player(s, p).mods;
  return Math.round(ABILITIES[id].cd * (id === "meteor" ? m.meteorCd : id === "nova" ? m.novaCd : 1) * T);
}
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
  const m = player(s, t.owner).mods;
  if (def.support) return { range: def.range, dmg: 0, period: 0, buff: 0, aura: auraOf(s, t) };
  const lv = def.from ? 0 : t.level - 1;
  const aura = auraOf(s, t);
  return {
    range: (def.range + lv * CONFIG.rangePerLevel) * m.range * (m.towerRange[family(t.kind)] || 1) * (s.mission && s.mission.night ? 0.7 : 1), // night: shorter sight
    dmg: def.dmg * (1 + 0.6 * lv) * (m.dmg[family(t.kind)] || 1) * (1 + aura.dmg),
    period: Math.max(1, Math.round(T / (def.rate * m.rate * (m.towerRate[family(t.kind)] || 1) * (1 + aura.rate)))),
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
  const d = (player(s, p).mods.discount || {})[kind] || 0;
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

export function sellValue(t) {
  return Math.floor(t.spent * CONFIG.sellRatio);
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

// ---------- step ----------

export function step(s, cmds = [], advance = true) {
  s.events = [];
  for (const c of cmds) applyCmd(s, c);
  if (!advance || s.over) return;

  s.tick++;
  for (const pl of s.players) {
    for (const k in pl.cds) if (pl.cds[k] > 0) pl.cds[k]--;
  }

  if (!s.queue.length && (s.wave < s.winWave || s.endless)) {
    s.countdown--;
    if (s.countdown <= 0) startWave(s);
  }
  while (s.queue.length && s.queue[0].at <= s.tick) {
    const q = s.queue.shift();
    const e = spawn(s, q.type, q.lane, 0, q.hpMul);
    e.bossWave = s.wave;
    if (ENEMIES[q.type].lives) { e.bk = q.bk || bossKey(s.wave); e.abT = BOSSES[e.bk].skill.every * T; }
    if (ENEMIES[q.type].lives) s.events.push({ type: "bossSpawn", id: e.id, kind: q.type, wave: s.wave, bk: e.bk });
  }

  for (const e of s.enemies) updateEnemy(s, e);
  for (const z of s.zones) updateZone(s, z);
  for (const t of s.towers) updateTower(s, t);
  for (const p of s.projs) updateProj(s, p);
  for (const c of s.coins) c.life--;
  s.projs = s.projs.filter((p) => !p.done);
  s.enemies = s.enemies.filter((e) => !e.dead);
  s.zones = s.zones.filter((z) => z.life > 0);
  s.coins = s.coins.filter((c) => c.life > 0);
  s.walls = s.walls.filter((w) => w.hp > 0);

  s.stats.peak = Math.max(s.stats.peak, s.enemies.length);
  // campaign: enemies passing by the farm trample it
  if (s.farmMax && s.map.farm) {
    const f = s.map.farm, fx = (f.x + f.w / 2) * TILE, fy = (f.y + f.h / 2) * TILE;
    for (const e of s.enemies) if (Math.hypot(e.x - fx, e.y - fy) < 34) s.farmHp -= 0.04 * (ENEMIES[e.type].lives ? 4 : 1); // ~0.8 HP/s per enemy nearby
    if (s.farmHp < 0) s.farmHp = 0;
  }
  const overrun = s.mode === "circle" && s.enemies.length >= s.limit;
  if (s.lives <= 0 || overrun || (s.farmMax && s.farmHp <= 0)) {
    s.lives = Math.max(0, s.lives);
    s.over = true;
    s.events.push({ type: 'gameover' });
  } else if (!s.endless && s.wave >= s.winWave && !s.queue.length && (s.mode === "circle" ? !s.enemies.some((e) => ENEMIES[e.type].lives) : !s.enemies.length)) {
    // circle: enemies pile up by design, so the win is "wave 20 fully out and its bosses dead"
    s.won = true;
    s.over = true;
    if (s.mission) s.stars = missionStars(s);
    s.events.push({ type: "victory", stars: s.stars });
  }
}

function applyCmd(s, c) {
  // circle mode: after winning, the run can go on endlessly with ever harder waves
  if (c.type === "continue") {
    if (s.won && s.over && !s.endless && s.mode === "circle" && !s.mission) {
      s.over = false;
      s.endless = true;
      s.won = false; // the win is already credited; the endless run ends in a (scored) defeat
      s.countdown = CONFIG.waveDelay * T;
      s.events.push({ type: "endless" });
    }
    return;
  }
  if (s.over) return;
  const pi = s.players[c.p] ? c.p : 0;
  const pl = s.players[pi];

  switch (c.type) {
    case 'pick': {
      const draft = pl.drafts[0];
      const card = draft && CARDS.find((k) => k.id === draft[c.index]);
      if (!card) return;
      card.apply(s, pl);
      pl.picked[card.id] = (pl.picked[card.id] || 0) + 1;
      pl.drafts.shift();
      s.events.push({ type: 'picked', p: pi, card: card.id });
      return;
    }
    case 'place': {
      const def = TOWERS[c.kind];
      const cost = def ? placeCost(s, pi, c.kind) : 0;
      if (s.mission && s.mission.maxTowers && s.towers.filter((k) => k.owner === pi).length >= s.mission.maxTowers) return; // tower limit
      if (!def || def.from || isLocked(s, pi, c.kind) || !canPlace(s, c.tx, c.ty) || pl.gold < cost) return;
      pl.gold -= cost;
      const t = { id: s.nextId++, owner: pi, kind: c.kind, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), level: 1, cd: 0, spent: cost, aim: 0, fired: 0 };
      if (def.support) t.aura = { dmg: 0, rate: 0 };
      s.towers.push(t);
      s.events.push({ type: 'build', x: t.x, y: t.y, p: pi });
      return;
    }
    case 'upgrade': {
      const t = s.towers.find((k) => k.id === c.id && k.owner === pi);
      const cost = t ? upgradeCost(t) : 0;
      if (!cost || pl.gold < cost) return;
      pl.gold -= cost;
      t.spent += cost;
      t.level++;
      s.events.push({ type: 'upgrade', x: t.x, y: t.y, p: pi });
      return;
    }
    case 'evolve': {
      const t = s.towers.find((k) => k.id === c.id && k.owner === pi);
      const def = TOWERS[c.kind];
      if (!t || !def || def.from !== t.kind || !canEvolve(t) || pl.gold < def.cost) return;
      pl.gold -= def.cost;
      t.spent += def.cost;
      t.kind = c.kind;
      t.cd = 0;
      s.events.push({ type: 'evolve', x: t.x, y: t.y, kind: c.kind, p: pi });
      return;
    }
    case "aura": {
      const t = s.towers.find((k) => k.id === c.id && k.owner === pi);
      if (!t || !TOWERS[t.kind].support || !AURA[c.aura]) return;
      const cost = auraCost(t, c.aura);
      if (!cost || pl.gold < cost) return;
      pl.gold -= cost;
      t.spent += cost;
      t.aura[c.aura]++;
      s.events.push({ type: "aura", x: t.x, y: t.y, aura: c.aura, level: t.aura[c.aura], p: pi });
      return;
    }
    case "move": {
      const t = s.towers.find((k) => k.id === c.id && k.owner === pi);
      if (!t || !canMove(s, t, c.tx, c.ty)) return;
      const from = { x: t.x, y: t.y };
      Object.assign(t, { tx: c.tx, ty: c.ty, ...center(c.tx, c.ty) });
      t.moveCd = Math.round(CONFIG.moveCd * T * pl.mods.moveCd);
      t.cd = Math.max(t.cd, CONFIG.moveSetup * T);
      s.events.push({ type: "move", fx: from.x, fy: from.y, x: t.x, y: t.y, p: pi });
      return;
    }
    case 'sell': {
      const i = s.towers.findIndex((k) => k.id === c.id && k.owner === pi);
      if (i < 0) return;
      const t = s.towers[i];
      pl.gold += sellValue(t);
      s.towers.splice(i, 1);
      s.events.push({ type: 'sell', x: t.x, y: t.y, gold: sellValue(t), p: pi });
      return;
    }
    case 'clear': {
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
      return;
    }
    case 'barrel': {
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
      return;
    }
    case 'collect': {
      const i = s.coins.findIndex((k) => k.id === c.id);
      if (i < 0) return;
      const coin = s.coins[i];
      pl.gold += coin.value;
      s.coins.splice(i, 1);
      s.stats.coins++;
      s.events.push({ type: "coin", x: coin.x, y: coin.y, gold: coin.value, p: pi });
      return;
    }
    case 'nextWave': {
      if (s.queue.length || (s.wave >= s.winWave && !s.endless)) return;
      const bonus = s.wave > 0 ? Math.ceil(s.countdown / T) * CONFIG.earlyBonus : 0;
      if (bonus) {
        s.stats.early++;
        for (const q of s.players) q.gold += bonus;
        s.events.push({ type: 'bonus', gold: bonus });
      }
      startWave(s);
      return;
    }
    case 'meteor': {
      if (pl.cds.meteor > 0) return;
      pl.cds.meteor = abilityMax(s, 'meteor', pi);
      const dmg = 40 + s.wave * 6;
      for (const e of s.enemies) {
        if (e.dead || Math.hypot(e.x - c.x, e.y - c.y) > ABILITIES.meteor.radius) continue;
        damage(s, e, dmg, pi, { pierce: true });
        ignite(s, e, 8, 3, pi);
      }
      s.events.push({ type: 'meteor', x: c.x, y: c.y, r: ABILITIES.meteor.radius, p: pi });
      return;
    }
    case 'nova': {
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
      return;
    }
    case 'wall': {
      if (pl.cds.wall > 0 || !isRoad(s, c.tx, c.ty) || c.tx < 0) return;
      if (hasWall(s, pi)) return; // one standing barricade per player
      if (s.walls.some((w) => w.tx === c.tx && w.ty === c.ty)) return;
      pl.cds.wall = abilityMax(s, 'wall', pi);
      const hp = Math.round((ABILITIES.wall.hp + s.wave * ABILITIES.wall.hpPerWave) * pl.mods.wall);
      s.walls.push({ id: s.nextId++, owner: pi, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), hp, max: hp });
      s.events.push({ type: 'wallup', ...center(c.tx, c.ty), p: pi });
      return;
    }
  }
}

// Weighted draw without repeats from the cards valid for this mode and not maxed out by this player.
export function pickCards(s, n, pl, guaranteeRare = false) {
  const pool = CARDS.filter((c) => (!c.modes || c.modes.includes(s.mode)) && !(c.needs && isLocked(s, s.players.indexOf(pl), c.needs)) && !(c.coop && s.players.length < 2) && (pl.picked[c.id] || 0) < c.max);
  const out = [];
  if (guaranteeRare) {
    const rares = pool.filter((c) => c.rarity === "rare");
    if (rares.length) { const c = rares[randInt(s, rares.length)]; out.push(c.id); pool.splice(pool.indexOf(c), 1); }
  }
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, c) => a + RARITY[c.rarity].weight, 0);
    let r = rand(s) * total, i = 0;
    while (i < pool.length - 1 && (r -= RARITY[pool[i].rarity].weight) > 0) i++;
    out.push(pool.splice(i, 1)[0].id);
  }
  if (guaranteeRare && out.length > 1) { const j = randInt(s, out.length); [out[0], out[j]] = [out[j], out[0]]; }
  return out;
}

function startWave(s) {
  s.wave++;
  const w = s.wave;
  for (const b of s.barrels) b.ready = true;
  // co-op prank: pickpockets take a cut of their partner's gold at every wave start
  for (let i = 0; i < s.players.length; i++) {
    const pl = s.players[i], other = s.players[(i + 1) % s.players.length]; // picks the next player's pocket
    if (!pl.mods.thief || !other) continue;
    const cut = Math.min(20, Math.floor(other.gold * pl.mods.thief));
    if (cut > 0) { other.gold -= cut; pl.gold += cut; s.events.push({ type: "steal", p: i, from: s.players.indexOf(other), gold: cut }); }
  }
  for (let i = 0; i < s.players.length; i++) {
    const pl = s.players[i];
    if (pl.mods.interest > 0) {
      const gain = Math.min(25, Math.floor(pl.gold * pl.mods.interest));
      if (gain) { pl.gold += gain; s.events.push({ type: 'bonus', gold: gain, p: i }); }
    }
  }
  const lanes = s.plan;
  const over20 = Math.max(0, w - s.winWave);
  const B = s.brawl || {};
  const hpMul = (B.hp || 1) * (1 + 0.22 * (w - 1) + 0.017 * (w - 1) * (w - 1)) * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20;
  const pool = B.pool || Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] <= w);
  // co-op: a bit more enemies so two players still have to work
  const budget = (B.budget || 1) * (8 + w * 6) * (1 + 0.5 * (s.players.length - 1)); // +50% per extra player
  // Every planned lane gets its own stream starting at the same moment (two entries = two
  // simultaneous attacks, not alternating packs); the wave budget is split between them.
  for (const lane of lanes) {
    let left = budget / lanes.length;
    let at = s.tick + T;
    // small packs of one type: readable and interesting to counter
    while (left > 0) {
      const type = pool[randInt(s, pool.length)];
      const pack = 2 + randInt(s, 3);
      for (let i = 0; i < pack && left > 0; i++) {
        s.queue.push({ type, lane, at, hpMul });
        at += type === "runner" ? 7 : 12;
        left -= ENEMIES[type].cost;
      }
      at += T;
    }
  }
  s.queue.sort((a, b) => a.at - b.at || a.lane - b.lane);
  // A rare gold thief: kill it for a pile of coins, or it steals from you.
  if ((s.mission && s.mission.goblins) || (w >= 3 && rand(s) < 0.4)) {
    const mid = s.queue[Math.floor(s.queue.length / 2)].at;
    s.queue.push({ type: 'goblin', lane: lanes[randInt(s, lanes.length)], at: mid, hpMul });
    s.queue.sort((a, b) => a.at - b.at);
  }
  const bossHp = (B.bossHp || 1) * (1 + Math.max(0, w / 5 - 1) * 0.9) * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20;
  // Bosses: one per player, arriving 3 s into the wave (right with the announcement), staggered by 2 s
  // and spread over the lanes. Endless: every couple of waves, more of them the deeper you go.
  let bosses = 0, kind = () => "boss";
  if (over20 > 0) {
    if (over20 % MODES.circle.endlessBossEvery === 0) { bosses = (1 + Math.floor(over20 / 6)) * s.players.length; kind = (i) => (i % 2 ? "king" : "boss"); }
  } else if (w % (B.bossEvery || 5) === 0) {
    bosses = s.players.length;
    kind = () => (w === s.winWave ? "king" : "boss");
  }
  for (let i = 0; i < bosses; i++) {
    s.queue.push({ type: kind(i), lane: lanes[i % lanes.length], at: s.tick + 3 * T + i * 2 * T, hpMul: bossHp });
  }
  // campaign: the mission names its generals by wave (one per player)
  const mk = s.mission && s.mission.bosses && s.mission.bosses[w];
  if (mk) for (let i = 0; i < s.players.length; i++) {
    s.queue.push({ type: mk === 20 ? "king" : "boss", bk: mk, lane: lanes[i % lanes.length], at: s.tick + 3 * T + i * 2 * T, hpMul: (B.bossHp || 1) * (1 + Math.max(0, mk / 5 - 1) * 0.9) * s.opts.hpMul });
  }
  s.queue.sort((a, b) => a.at - b.at);
  s.countdown = CONFIG.waveDelay * T;
  s.events.push({ type: "wave", wave: w, boss: over20 ? over20 % MODES.circle.endlessBossEvery === 0 : w % 5 === 0, final: w === s.winWave, lanes });
  s.plan = planLanes(s);
}

function spawn(s, type, lane, dist, hpMul) {
  const hp = Math.round(ENEMIES[type].hp * hpMul);
  const p = posAt(s.map, lane, dist);
  const e = {
    id: s.nextId++, type, lane, hp, maxHp: hp, armor: ENEMIES[type].armor, hpMul,
    dist, x: p.x, y: p.y, px: p.x, py: p.y, lap: 0, speedMul: (s.brawl && s.brawl.speed) || 1,
    slowT: 0, slowF: 1, wetT: 0, burnT: 0, burnDps: 0, burnAcc: 0, burnOwner: 0, flash: 0, dead: false, blocked: false,
  };
  s.enemies.push(e);
  return e;
}

function updateEnemy(s, e) {
  if (e.dead) return;
  const def = ENEMIES[e.type];
  const L = s.map.lanes[e.lane];
  e.px = e.x; e.py = e.y;
  if (e.flash > 0) e.flash--;
  if (e.slowT > 0) e.slowT--;
  if (e.wetT > 0) e.wetT--;
  if (e.burnT > 0) {
    e.burnT--;
    e.burnAcc += e.burnDps / T;
    if (e.burnAcc >= 1) {
      const d = Math.floor(e.burnAcc);
      e.burnAcc -= d;
      damage(s, e, d, e.burnOwner, { pierce: true, quiet: true, src: e.burnSrc });
      if (e.dead) return;
    }
  }
  if (s.brawl) {
    if (s.brawl.alwaysWet) e.wetT = Math.max(e.wetT, 2); // the storm keeps everyone soaked
    if (s.brawl.regen && s.tick % T === 0) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * s.brawl.regen));
  }
  if (def.heal && s.tick % T === 0) {
    let healed = false;
    for (const o of s.enemies) {
      if (o === e || o.dead || o.hp >= o.maxHp) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) > def.healRange) continue;
      o.hp = Math.min(o.maxHp, o.hp + Math.round(def.heal * e.hpMul));
      healed = true;
    }
    if (healed) s.events.push({ type: 'heal', x: e.x, y: e.y });
  }
  if (e.bk) bossSkill(s, e);
  if (e.dead) return;
  const speed = def.speed * e.speedMul * (e.slowT > 0 ? e.slowF : 1) * (e.dashT > 0 ? BOSSES[e.bk].skill.mult : 1);
  const next = posAt(s.map, e.lane, e.dist + speed / T);
  // Barricades stop enemies walking into them; enemies chew through the wall.
  const wall = s.walls.find((w) => w.hp > 0 && Math.hypot(next.x - w.x, next.y - w.y) < 16 && Math.hypot(next.x - w.x, next.y - w.y) < Math.hypot(e.x - w.x, e.y - w.y));
  e.blocked = !!wall;
  if (wall) {
    wall.hp -= (def.lives || 1) * 0.5;
    if (wall.hp <= 0) s.events.push({ type: 'wallbreak', x: wall.x, y: wall.y });
    return;
  }
  e.dist += speed / T;
  e.x = next.x; e.y = next.y;
  if (L.loop) {
    // every full lap makes the monster faster and heals it a bit
    const lap = e.dist > L.loopStart ? Math.floor((e.dist - L.loopStart) / L.loopLen) : 0;
    if (lap > e.lap) {
      e.lap = lap;
      const cm = MODES.circle;
      if (lap <= cm.lapMax) e.speedMul += cm.lapSpeed * s.lapSpeedMul;
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * cm.lapHeal));
      s.events.push({ type: 'lap', x: e.x, y: e.y, lap });
    }
  } else if (e.dist >= L.total) {
    e.dead = true;
    s.lives -= def.lives || 1;
    if (def.steal) {
      // the thief robs everyone a little
      for (const pl of s.players) pl.gold -= Math.min(pl.gold, def.steal);
      s.events.push({ type: 'stolen', x: e.x, y: e.y, gold: def.steal });
    }
    s.stats.leaks++;
    s.events.push({ type: "leak", x: e.x, y: e.y, boss: !!def.lives });
  }
}

// Each boss has a signature move on a timer (see BOSSES[].skill in data.js).
function bossSkill(s, e) {
  const sk = BOSSES[e.bk].skill;
  if (e.dashT > 0) e.dashT--;
  if (e.magnetT > 0) e.magnetT--;
  if (e.slowT > 0 && e.slowF === 0) return; // frozen bosses cannot act
  if (--e.abT > 0) return;
  e.abT = sk.every * T;
  switch (sk.type) {
    case "dash": // Grok charges forward
      e.dashT = Math.round(sk.dur * T);
      break;
    case "brood": // Slime Mother births slimes right behind her
      for (let i = 0; i < sk.count; i++) spawn(s, "slime", e.lane, Math.max(0, e.dist - 10 - i * 9), e.hpMul * 0.5);
      break;
    case "magnet": // Baron drags every tower's fire (and the players' cursors) to himself
      e.magnetT = Math.round(sk.dur * T);
      break;
    case "decree": // the King stuns towers around him
      for (const t of s.towers) if (Math.hypot(t.x - e.x, t.y - e.y) <= sk.range) t.stunT = Math.round(sk.stun * T);
      break;
  }
  s.events.push({ type: "bossSkill", kind: sk.type, id: e.id, x: e.x, y: e.y, r: sk.range || 0 });
}

function updateZone(s, z) {
  z.life--;
  if (z.life % 5) return;
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damage(s, e, z.dps / 4, z.owner, { pierce: true, quiet: true, src: z.src });
  }
}

function inRange(s, x, y, range) {
  return s.enemies.filter((e) => !e.dead && e.dist >= 0 && Math.hypot(e.x - x, e.y - y) <= range);
}

function updateTower(s, t) {
  if (t.moveCd > 0) t.moveCd--;
  if (TOWERS[t.kind].support) return;
  if (t.stunT > 0) { t.stunT--; return; } // stunned by the King's decree
  if (t.cd > 0) { t.cd--; return; }
  const def = TOWERS[t.kind];
  const st = towerStats(s, t);
  const targets = inRange(s, t.x, t.y, st.range);
  if (!targets.length) return;
  // "first" = furthest along its lane; snipers pick the toughest
  targets.sort(def.target === 'strong' ? (a, b) => b.hp - a.hp || a.id - b.id : (a, b) => b.dist - a.dist || a.id - b.id);
  // a magnetised boss in range pulls every tower's fire
  const mag = targets.find((e) => e.magnetT > 0);
  if (mag) { targets.splice(targets.indexOf(mag), 1); targets.unshift(mag); }
  const target = targets[0];
  t.cd = st.period;
  t.aim = Math.atan2(target.y - t.y, target.x - t.x);
  t.fired = s.tick;

  if (def.pulse) { pulse(s, t, def, st, targets); return; }
  if (def.chain !== undefined) { zap(s, t, target, st, def); return; }
  for (const e of targets.slice(0, def.multi || 1)) {
    s.projs.push({
      kind: def.proj, tower: t.kind, owner: t.owner, level: t.level, dmg: st.dmg, speed: def.speed,
      x: t.x, y: t.y - 14, px: t.x, py: t.y - 14, target: e.id, tx: e.x, ty: e.y, done: false,
    });
  }
  s.events.push({ type: 'shoot', kind: family(t.kind) });
}

function pulse(s, t, def, st, targets) {
  const m = player(s, t.owner).mods;
  for (const e of targets) {
    damage(s, e, st.dmg, t.owner, { quiet: def.burn !== undefined, src: family(t.kind) });
    if (e.dead) continue;
    if (def.slow !== undefined) applyCold(e, def, m);
    if (def.burn) ignite(s, e, def.burn, def.burnTime, t.owner, "fire");
  }
  s.events.push({ type: 'pulse', x: t.x, y: t.y, r: st.range, kind: t.kind });
}

function applyCold(e, def, m) {
  const boss = !!ENEMIES[e.type].lives;
  e.slowT = Math.round(def.slowTime * T * (boss && def.freeze ? 0.4 : 1));
  e.slowF = def.slow;
  e.wetT = Math.round((def.wetTime + m.wet) * T);
  e.burnT = 0; // water puts out fire
}

function zap(s, t, first, st, def) {
  const hit = [first];
  let jumps = def.chain + player(s, t.owner).mods.chain + (first.wetT > 0 ? 1 : 0);
  let cur = first;
  while (jumps-- > 0) {
    let next = null, nd = Infinity;
    for (const e of s.enemies) {
      if (e.dead || hit.includes(e)) continue;
      const d = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (d <= def.chainRange && d < nd) { next = e; nd = d; }
    }
    if (!next) break;
    hit.push(next);
    cur = next;
  }
  // Overload: consecutive hits on the same target build up charge
  let over = 1;
  if (def.overcharge) {
    t.charge = t.lastTarget === first.id ? (t.charge || 0) + 1 : 0;
    t.lastTarget = first.id;
    over = Math.min(def.overMax, 1 + def.overcharge * t.charge);
  }
  const pts = [{ x: t.x, y: t.y - 20 }];
  for (const e of hit) {
    pts.push({ x: e.x, y: e.y - 6 });
    const wet = e.wetT > 0;
    damage(s, e, st.dmg * (wet ? 2 : 1) * (e === first ? over : 1), t.owner, { big: wet || over >= 2, src: family(t.kind) });
  }
  s.events.push({ type: "zap", pts, over });
}

function updateProj(s, p) {
  p.px = p.x; p.py = p.y;
  const target = s.enemies.find((e) => e.id === p.target && !e.dead) || null;
  if (target) { p.tx = target.x; p.ty = target.y - 6; }
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const d = Math.hypot(dx, dy);
  const move = p.speed / T;
  if (d <= move) {
    p.x = p.tx; p.y = p.ty;
    hit(s, p, target);
    p.done = true;
  } else {
    p.x += (dx / d) * move;
    p.y += (dy / d) * move;
  }
}

function explode(s, x, y, r, dmg, owner, src = null) {
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) <= r) damage(s, e, dmg, owner, { pierce: true, src });
  }
  s.events.push({ type: 'explode', x, y, r });
}

function hit(s, p, target) {
  const def = TOWERS[p.tower];
  const m = player(s, p.owner).mods;
  const src = family(p.tower);
  const lvMul = def.from ? 1.6 : 1 + 0.6 * (p.level - 1);
  switch (p.kind) {
    case 'arrow':
      if (target) damage(s, target, p.dmg, p.owner, { pierce: def.pierce, crit: rand(s) < m.crit, src });
      break;
    case 'ball':
      explode(s, p.x, p.y + 6, def.splash * m.splash, p.dmg, p.owner, src);
      for (let i = 0; i < (def.bomblets || 0); i++) {
        const a = rand(s) * Math.PI * 2, r = 15 + rand(s) * 21;
        explode(s, p.x + Math.cos(a) * r, p.y + 6 + Math.sin(a) * r, 18, p.dmg * 0.4, p.owner, src);
      }
      break;
    case 'ice':
      if (!target) break;
      damage(s, target, p.dmg, p.owner, { src });
      if (!target.dead) applyCold(target, def, m);
      break;
    case 'fire':
      if (def.puddle) {
        s.zones.push({ x: p.x, y: p.y + 6, r: def.puddle.r, dps: def.puddle.dps * m.burn, life: def.puddle.time * T, max: def.puddle.time * T, owner: p.owner, src });
      }
      if (!target) break;
      if (target.wetT > 0) {
        // Synergy: fire + wet = steam explosion.
        target.wetT = 0;
        const dmg = CONFIG.steamDmg * lvMul * m.steam;
        for (const e of s.enemies) {
          if (!e.dead && Math.hypot(e.x - target.x, e.y - target.y) <= CONFIG.steamRadius) damage(s, e, dmg, p.owner, { pierce: true, src });
        }
        s.events.push({ type: 'steam', x: target.x, y: target.y });
      } else {
        damage(s, target, p.dmg, p.owner, { src });
        ignite(s, target, def.burn * lvMul, def.burnTime, p.owner, src);
      }
      break;
  }
}

function ignite(s, e, dps, time, owner, src = null) {
  if (e.dead) return;
  e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps * player(s, owner).mods.burn);
  e.burnT = Math.round(time * T);
  e.burnOwner = owner;
  e.burnSrc = src;
}

// src = tower family that dealt the damage; enemy types are weak or resistant to some families (ENEMIES[].vs).
export function vsMult(type, src) {
  return (src && ENEMIES[type].vs && ENEMIES[type].vs[src]) || 1;
}

function damage(s, e, amount, owner, { pierce = false, crit = false, big = false, quiet = false, src = null } = {}) {
  if (e.dead) return;
  const om = player(s, owner).mods;
  const mult = vsMult(e.type, src);
  amount *= mult * (src && e.lap >= 3 ? 1 + om.lapDmg : 1);
  let d = pierce ? amount : amount - e.armor;
  if (crit) d *= om.critMul;
  d = Math.max(1, Math.round(d));
  e.hp -= d;
  e.flash = 2;
  if (!quiet) s.events.push({ type: "hit", x: e.x, y: e.y, dmg: d, crit: crit || big, eff: mult > 1 ? 1 : mult < 1 ? -1 : 0 });
  if (ENEMIES[e.type].lives && !e.raged && e.hp > 0 && e.hp < e.maxHp / 2) {
    e.raged = true;
    // the King splits when wounded
    if (e.bk && BOSSES[e.bk].skill.split) for (let i = 0; i < BOSSES[e.bk].skill.split; i++) spawn(s, "splitter", e.lane, Math.max(0, e.dist - 8 - i * 10), e.hpMul * 0.6);
    s.events.push({ type: "bossRage", id: e.id, wave: e.bossWave || s.wave });
  }
  if (e.hp <= 0) kill(s, e, owner);
}

// The player who lands the killing blow gets the gold.
function kill(s, e, owner) {
  e.dead = true;
  const def = ENEMIES[e.type];
  const pl = player(s, owner);
  const killGold = s.brawl && s.brawl.killGold !== undefined ? s.brawl.killGold : 1;
  const gold = Math.round(def.gold * pl.mods.gold * killGold) + (e.lap >= 1 ? pl.mods.hunter : 0);
  pl.gold += gold;
  pl.kills++;
  s.kills++;
  s.events.push({ type: 'death', x: e.x, y: e.y, kind: e.type, gold, p: s.players[owner] ? owner : 0 });
  // Talents come only from bosses: every player gets a personal choice (never pauses co-op)
  if (def.lives) {
    for (let i = 0; i < s.players.length; i++) {
      s.players[i].drafts.push(pickCards(s, s.players[i].mods.cards, s.players[i], true));
      s.events.push({ type: "draft", p: i });
    }
  }
  // Coins drop on the map and must be picked up with the mouse (by anyone).
  const n = def.coins || (rand(s) < ((s.brawl && s.brawl.coinChance) || COIN.chance) ? 1 : 0);
  for (let i = 0; i < n; i++) {
    s.coins.push({
      id: s.nextId++, x: e.x + (rand(s) * 24 - 12), y: e.y + (rand(s) * 18 - 9),
      value: Math.round((COIN.base + Math.floor(s.wave / 2)) * ((s.brawl && s.brawl.coinValue) || 1)), life: COIN.life * T,
    });
  }
  if (def.splits) {
    const parts = (s.brawl && s.brawl.split) || 2;
    for (let pi = 0; pi < parts; pi++) {
      const off = (pi - (parts - 1) / 2) * 9;
      const m = spawn(s, def.splits, e.lane, Math.max(0, e.dist + off), e.hpMul);
      m.lap = e.lap; m.speedMul = e.speedMul;
    }
  }
}
