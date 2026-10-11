// Deterministic game simulation. No DOM, no Math.random, no Date.now.
// The client sends commands, step() advances one fixed tick and emits events for juice/sound.
// Every command carries `p` = player index (0 = host/solo, 1 = guest); each player has own gold, talents, abilities.
import {
  TILE, COLS, ROWS, TICK_RATE as T, CONFIG, TOWERS, ENEMIES, UNLOCKS, CARDS,
  MAPGEN, MODES, BARREL, OBSTACLES, COIN, ABILITIES,
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
  const ponds = MAPGEN.ponds[0] + randInt(s, MAPGEN.ponds[1] - MAPGEN.ponds[0] + 1);
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

// Circle: an entry road from the left joins a closed ring with random inward dents on top/bottom/right.
// With two players a second entry comes from the right edge — one spawn next to each player.
function genCircle(s, two = false) {
  const x0 = 3 + randInt(s, 2), x1 = COLS - 4 - randInt(s, 2);
  const y0 = 1 + randInt(s, 2), y1 = ROWS - 2 - randInt(s, 2);
  const ym = Math.floor((y0 + y1) / 2) + randInt(s, 3) - 1;
  const dent = (a, b) => {
    // returns [from, to] inside (a, b) with room for corners, or null
    if (b - a < 9 || rand(s) < 0.35) return null;
    const p = a + 2 + randInt(s, Math.floor((b - a) / 2) - 2);
    return [p, Math.min(b - 2, p + 3 + randInt(s, 4))];
  };
  const loop = [[x0, ym], [x0, y0]];
  const dTop = dent(x0, x1), depthT = 2 + randInt(s, 2);
  if (dTop) loop.push([dTop[0], y0], [dTop[0], y0 + depthT], [dTop[1], y0 + depthT], [dTop[1], y0]);
  loop.push([x1, y0]);
  // the right side keeps a straight stretch for the second entry
  const ymR = Math.floor((y0 + y1) / 2) + randInt(s, 3) - 1;
  const dRight = two ? null : dent(y0, y1), depthR = 2 + randInt(s, 3);
  if (dRight) loop.push([x1, dRight[0]], [x1 - depthR, dRight[0]], [x1 - depthR, dRight[1]], [x1, dRight[1]]);
  const joinR = loop.length;
  if (two) loop.push([x1, ymR]);
  loop.push([x1, y1]);
  const dBot = dent(x0, x1), depthB = 2 + randInt(s, 2);
  if (dBot) loop.push([dBot[1], y1], [dBot[1], y1 - depthB], [dBot[0], y1 - depthB], [dBot[0], y1]);
  loop.push([x0, y1], [x0, ym]);
  const lanes = [buildLane([[-1, ym], ...loop], 1)];
  const spawns = [[0, ym]];
  if (two) {
    // same ring, same direction, entered from the right: rotate the loop to start at the join point
    const ring = loop.slice(0, -1);
    const rotated = [...ring.slice(joinR), ...ring.slice(0, joinR), [x1, ymR]];
    lanes.push(buildLane([[COLS, ymR], ...rotated], 1));
    spawns.push([COLS - 1, ymR]);
  }
  const tiles = new Set();
  for (const L of lanes) addTiles(L.points, tiles);
  return { lanes, tiles, water: genPonds(s, tiles), castle: null, spawns, ring: [x0, y0, x1, y1] };
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

function newPlayer(opts) {
  return {
    gold: CONFIG.startGold + (opts.bonusGold || 0),
    mods: {
      dmg: { arrow: 1, cannon: 1, frost: 1, tesla: 1, fire: 1 },
      rate: 1, range: 1, chain: 0, burn: 1, wet: 0, steam: 1, gold: 1, interest: 0, crit: 0.1,
      meteorCd: opts.meteorCd || 1, wall: 1,
    },
    cds: { meteor: 0, nova: 0, wall: 0 },
    drafts: [], // pending talent choices (arrays of card ids); picking never pauses the game
    kills: 0,
  };
}

// opts come from meta-progression + difficulty (see src/meta.js); in co-op the host sends them to the guest.
export function createGame(seed, opts = {}) {
  const o = { hpMul: 1, cards: 3, locked: [], mode: 'classic', players: 1, ...opts };
  const s = {
    rngState: seed >>> 0,
    opts: o,
    mode: o.mode,
    won: false,
    tick: 0,
    lives: CONFIG.startLives + (o.bonusLives || 0),
    limit: o.mode === 'circle' ? MODES.circle.maxAlive + 5 * Math.round(((o.bonusLives || 0) / 3)) : 0,
    wave: 0,
    countdown: CONFIG.firstWaveDelay * T,
    map: null,
    plan: [],
    players: Array.from({ length: o.players }, () => newPlayer(o)),
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
  s.map = o.mode === "circle" ? genCircle(s, o.players > 1) : genClassic(s);
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
  while (s.obstacles.length < OBSTACLES.count && guard++ < 2000) {
    const tx = randInt(s, COLS), ty = randInt(s, ROWS);
    if (!isFree(s, tx, ty) || nearSpawn(tx, ty) || nearCastle(tx, ty)) continue;
    s.obstacles.push({ id: s.nextId++, tx, ty, kind: rand(s) < 0.65 ? 'tree' : 'rock', chest: rand(s) < OBSTACLES.chestChance, v: randInt(s, 3) });
  }
  return s;
}

// ---------- queries (also used by the client for previews) ----------

function isFree(s, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
  const k = key(tx, ty);
  if (s.map.tiles.has(k) || s.map.water.has(k)) return false;
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
export function abilityMax(s, id, p = 0) {
  return Math.round(ABILITIES[id].cd * (id === 'meteor' ? player(s, p).mods.meteorCd : 1) * T);
}
export function enemyAt(s, x, y, r = 14) {
  let best = null, bd = r;
  for (const e of s.enemies) {
    const d = Math.hypot(e.x - x, e.y - 6 - y);
    if (!e.dead && d < bd) { best = e; bd = d; }
  }
  return best;
}

// Rate bonus from adjacent Dynamo towers (any owner: co-op players can help each other).
function buffOf(s, t) {
  let b = 0;
  for (const o of s.towers) {
    if (o === t || !TOWERS[o.kind].buff) continue;
    if (Math.abs(o.tx - t.tx) <= 1 && Math.abs(o.ty - t.ty) <= 1) b += TOWERS[o.kind].buff;
  }
  return b;
}

export function towerStats(s, t) {
  const def = TOWERS[t.kind];
  const m = player(s, t.owner).mods;
  const lv = def.from ? 0 : t.level - 1;
  const buff = buffOf(s, t);
  return {
    range: (def.range + lv * CONFIG.rangePerLevel) * m.range,
    dmg: def.dmg * (1 + 0.6 * lv) * m.dmg[family(t.kind)],
    period: Math.max(1, Math.round(T / (def.rate * m.rate * (1 + buff)))),
    buff,
  };
}

// 0 = no plain upgrade available (max level or evolved; at level 3 evolution is offered instead).
export function upgradeCost(t) {
  if (TOWERS[t.kind].from || t.level >= CONFIG.maxLevel) return 0;
  return Math.floor(TOWERS[t.kind].cost * 0.8 * t.level);
}
export function canEvolve(t) {
  return !TOWERS[t.kind].from && t.level >= CONFIG.maxLevel;
}

// Relocation: free tile within moveRange tiles, tower off cooldown.
export function canMove(s, t, tx, ty) {
  return !(t.moveCd > 0) && Math.hypot(tx - t.tx, ty - t.ty) <= CONFIG.moveRange && canPlace(s, tx, ty);
}

export function sellValue(t) {
  return Math.floor(t.spent * CONFIG.sellRatio);
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

  if (!s.queue.length && s.wave < CONFIG.winWave) {
    s.countdown--;
    if (s.countdown <= 0) startWave(s);
  }
  while (s.queue.length && s.queue[0].at <= s.tick) {
    const q = s.queue.shift();
    const e = spawn(s, q.type, q.lane, 0, q.hpMul);
    e.bossWave = s.wave;
    if (ENEMIES[q.type].lives) s.events.push({ type: "bossSpawn", id: e.id, kind: q.type, wave: s.wave });
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

  const overrun = s.mode === 'circle' && s.enemies.length >= s.limit;
  if (s.lives <= 0 || overrun) {
    s.lives = Math.max(0, s.lives);
    s.over = true;
    s.events.push({ type: 'gameover' });
  } else if (s.wave >= CONFIG.winWave && !s.queue.length && !s.enemies.length) {
    s.won = true;
    s.over = true;
    s.events.push({ type: 'victory' });
  }
}

function applyCmd(s, c) {
  if (s.over) return;
  const pi = s.players[c.p] ? c.p : 0;
  const pl = s.players[pi];

  switch (c.type) {
    case 'pick': {
      const draft = pl.drafts[0];
      const card = draft && CARDS.find((k) => k.id === draft[c.index]);
      if (!card) return;
      card.apply(s, pl);
      pl.drafts.shift();
      s.events.push({ type: 'picked', p: pi, card: card.id });
      return;
    }
    case 'place': {
      const def = TOWERS[c.kind];
      if (!def || def.from || s.opts.locked.includes(c.kind) || !canPlace(s, c.tx, c.ty) || pl.gold < def.cost) return;
      pl.gold -= def.cost;
      const t = { id: s.nextId++, owner: pi, kind: c.kind, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), level: 1, cd: 0, spent: def.cost, aim: 0, fired: 0 };
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
    case "move": {
      const t = s.towers.find((k) => k.id === c.id && k.owner === pi);
      if (!t || !canMove(s, t, c.tx, c.ty)) return;
      const from = { x: t.x, y: t.y };
      Object.assign(t, { tx: c.tx, ty: c.ty, ...center(c.tx, c.ty) });
      t.moveCd = CONFIG.moveCd * T;
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
      const dmg = BARREL.dmg + s.wave * BARREL.dmgPerWave;
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
      s.events.push({ type: 'coin', x: coin.x, y: coin.y, gold: coin.value, p: pi });
      return;
    }
    case 'nextWave': {
      if (s.queue.length || s.wave >= CONFIG.winWave) return;
      const bonus = s.wave > 0 ? Math.ceil(s.countdown / T) * CONFIG.earlyBonus : 0;
      if (bonus) {
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
      if (s.walls.some((w) => w.tx === c.tx && w.ty === c.ty)) return;
      pl.cds.wall = abilityMax(s, 'wall', pi);
      const hp = Math.round((ABILITIES.wall.hp + s.wave * ABILITIES.wall.hpPerWave) * pl.mods.wall);
      s.walls.push({ id: s.nextId++, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), hp, max: hp });
      s.events.push({ type: 'wallup', ...center(c.tx, c.ty), p: pi });
      return;
    }
  }
}

function pickCards(s, n) {
  const pool = CARDS.map((c) => c.id);
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(randInt(s, pool.length), 1)[0]);
  return out;
}

function startWave(s) {
  s.wave++;
  const w = s.wave;
  for (const b of s.barrels) b.ready = true;
  // Surviving a wave earns every player their own talent choice (never pauses, never skipped by early calls).
  if (w >= 2) {
    for (let i = 0; i < s.players.length; i++) {
      s.players[i].drafts.push(pickCards(s, s.opts.cards));
      s.events.push({ type: 'draft', p: i });
    }
  }
  for (let i = 0; i < s.players.length; i++) {
    const pl = s.players[i];
    if (pl.mods.interest > 0) {
      const gain = Math.min(30, Math.floor(pl.gold * pl.mods.interest));
      if (gain) { pl.gold += gain; s.events.push({ type: 'bonus', gold: gain, p: i }); }
    }
  }
  const lanes = s.plan;
  const hpMul = (1 + 0.22 * (w - 1) + 0.025 * (w - 1) * (w - 1)) * s.opts.hpMul;
  const pool = Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] <= w);
  // co-op: a bit more enemies so two players still have to work
  let budget = (8 + w * 6) * (s.players.length > 1 ? 1.5 : 1);
  let at = s.tick + T;
  // Enemies come in small packs of one type, each pack on one of the planned lanes.
  while (budget > 0) {
    const type = pool[randInt(s, pool.length)];
    const lane = lanes[randInt(s, lanes.length)];
    const pack = 2 + randInt(s, 3);
    for (let i = 0; i < pack && budget > 0; i++) {
      s.queue.push({ type, lane, at, hpMul });
      at += type === 'runner' ? 7 : 12;
      budget -= ENEMIES[type].cost;
    }
    at += T;
  }
  // A rare gold thief: kill it for a pile of coins, or it steals from you.
  if (w >= 3 && rand(s) < 0.4) {
    const mid = s.queue[Math.floor(s.queue.length / 2)].at;
    s.queue.push({ type: 'goblin', lane: lanes[randInt(s, lanes.length)], at: mid, hpMul });
    s.queue.sort((a, b) => a.at - b.at);
  }
  if (w % 5 === 0) {
    s.queue.push({ type: w === CONFIG.winWave ? 'king' : 'boss', lane: lanes[0], at: at + T, hpMul: (1 + (w / 5 - 1) * 0.9) * s.opts.hpMul });
  }
  s.countdown = CONFIG.waveDelay * T;
  s.events.push({ type: 'wave', wave: w, boss: w % 5 === 0, final: w === CONFIG.winWave, lanes });
  s.plan = planLanes(s);
}

function spawn(s, type, lane, dist, hpMul) {
  const hp = Math.round(ENEMIES[type].hp * hpMul);
  const p = posAt(s.map, lane, dist);
  const e = {
    id: s.nextId++, type, lane, hp, maxHp: hp, armor: ENEMIES[type].armor, hpMul,
    dist, x: p.x, y: p.y, px: p.x, py: p.y, lap: 0, speedMul: 1,
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
      damage(s, e, d, e.burnOwner, { pierce: true, quiet: true });
      if (e.dead) return;
    }
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
  const speed = def.speed * e.speedMul * (e.slowT > 0 ? e.slowF : 1);
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
      if (lap <= cm.lapMax) e.speedMul += cm.lapSpeed;
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
    s.events.push({ type: 'leak', x: e.x, y: e.y, boss: !!def.lives });
  }
}

function updateZone(s, z) {
  z.life--;
  if (z.life % 5) return;
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damage(s, e, z.dps / 4, z.owner, { pierce: true, quiet: true });
  }
}

function inRange(s, x, y, range) {
  return s.enemies.filter((e) => !e.dead && e.dist >= 0 && Math.hypot(e.x - x, e.y - y) <= range);
}

function updateTower(s, t) {
  if (t.moveCd > 0) t.moveCd--;
  if (t.cd > 0) { t.cd--; return; }
  const def = TOWERS[t.kind];
  const st = towerStats(s, t);
  const targets = inRange(s, t.x, t.y, st.range);
  if (!targets.length) return;
  // "first" = furthest along its lane; snipers pick the toughest
  targets.sort(def.target === 'strong' ? (a, b) => b.hp - a.hp || a.id - b.id : (a, b) => b.dist - a.dist || a.id - b.id);
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
    damage(s, e, st.dmg, t.owner, { quiet: def.burn !== undefined });
    if (e.dead) continue;
    if (def.slow !== undefined) applyCold(e, def, m);
    if (def.burn) ignite(s, e, def.burn, def.burnTime, t.owner);
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
  const pts = [{ x: t.x, y: t.y - 20 }];
  for (const e of hit) {
    pts.push({ x: e.x, y: e.y - 6 });
    const wet = e.wetT > 0;
    damage(s, e, st.dmg * (wet ? 2 : 1), t.owner, { big: wet });
  }
  s.events.push({ type: 'zap', pts });
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

function explode(s, x, y, r, dmg, owner) {
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) <= r) damage(s, e, dmg, owner, { pierce: true });
  }
  s.events.push({ type: 'explode', x, y, r });
}

function hit(s, p, target) {
  const def = TOWERS[p.tower];
  const m = player(s, p.owner).mods;
  const lvMul = def.from ? 1.6 : 1 + 0.6 * (p.level - 1);
  switch (p.kind) {
    case 'arrow':
      if (target) damage(s, target, p.dmg, p.owner, { pierce: def.pierce, crit: rand(s) < m.crit });
      break;
    case 'ball':
      explode(s, p.x, p.y + 6, def.splash, p.dmg, p.owner);
      for (let i = 0; i < (def.bomblets || 0); i++) {
        const a = rand(s) * Math.PI * 2, r = 15 + rand(s) * 21;
        explode(s, p.x + Math.cos(a) * r, p.y + 6 + Math.sin(a) * r, 18, p.dmg * 0.4, p.owner);
      }
      break;
    case 'ice':
      if (!target) break;
      damage(s, target, p.dmg, p.owner);
      if (!target.dead) applyCold(target, def, m);
      break;
    case 'fire':
      if (def.puddle) {
        s.zones.push({ x: p.x, y: p.y + 6, r: def.puddle.r, dps: def.puddle.dps * m.burn, life: def.puddle.time * T, max: def.puddle.time * T, owner: p.owner });
      }
      if (!target) break;
      if (target.wetT > 0) {
        // Synergy: fire + wet = steam explosion.
        target.wetT = 0;
        const dmg = CONFIG.steamDmg * lvMul * m.steam;
        for (const e of s.enemies) {
          if (!e.dead && Math.hypot(e.x - target.x, e.y - target.y) <= CONFIG.steamRadius) damage(s, e, dmg, p.owner, { pierce: true });
        }
        s.events.push({ type: 'steam', x: target.x, y: target.y });
      } else {
        damage(s, target, p.dmg, p.owner);
        ignite(s, target, def.burn * lvMul, def.burnTime, p.owner);
      }
      break;
  }
}

function ignite(s, e, dps, time, owner) {
  if (e.dead) return;
  e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps * player(s, owner).mods.burn);
  e.burnT = Math.round(time * T);
  e.burnOwner = owner;
}

function damage(s, e, amount, owner, { pierce = false, crit = false, big = false, quiet = false } = {}) {
  if (e.dead) return;
  let d = pierce ? amount : amount - e.armor;
  if (crit) d *= 2;
  d = Math.max(1, Math.round(d));
  e.hp -= d;
  e.flash = 2;
  if (!quiet) s.events.push({ type: 'hit', x: e.x, y: e.y, dmg: d, crit: crit || big });
  if (ENEMIES[e.type].lives && !e.raged && e.hp > 0 && e.hp < e.maxHp / 2) {
    e.raged = true;
    s.events.push({ type: "bossRage", id: e.id, wave: e.bossWave || s.wave });
  }
  if (e.hp <= 0) kill(s, e, owner);
}

// The player who lands the killing blow gets the gold.
function kill(s, e, owner) {
  e.dead = true;
  const def = ENEMIES[e.type];
  const pl = player(s, owner);
  const gold = Math.round(def.gold * pl.mods.gold);
  pl.gold += gold;
  pl.kills++;
  s.kills++;
  s.events.push({ type: 'death', x: e.x, y: e.y, kind: e.type, gold, p: s.players[owner] ? owner : 0 });
  // Coins drop on the map and must be picked up with the mouse (by anyone).
  const n = def.coins || (rand(s) < COIN.chance ? 1 : 0);
  for (let i = 0; i < n; i++) {
    s.coins.push({
      id: s.nextId++, x: e.x + (rand(s) * 24 - 12), y: e.y + (rand(s) * 18 - 9),
      value: COIN.base + Math.floor(s.wave / 2), life: COIN.life * T,
    });
  }
  if (def.splits) {
    for (const off of [-7, 7]) {
      const m = spawn(s, def.splits, e.lane, Math.max(0, e.dist + off), e.hpMul);
      m.lap = e.lap; m.speedMul = e.speedMul;
    }
  }
}
