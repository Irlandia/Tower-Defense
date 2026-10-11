// Deterministic game simulation. No DOM, no Math.random, no Date.now.
// The client sends commands, step() advances one fixed tick and emits events for juice/sound.
import {
  TILE, COLS, ROWS, TICK_RATE as T, CONFIG, TOWERS, ENEMIES, UNLOCKS, CARDS,
  MAPGEN, BARREL, OBSTACLES, COIN, ABILITIES, SMITE,
} from './data.js';
import { rand, randInt } from './rng.js';

const center = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
const key = (x, y) => x + ',' + y;

// ---------- procedural map ----------

function buildLane(points) {
  const pts = points.map(([x, y]) => center(x, y));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { points, segs, total };
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

// 2-3 lanes snake from the left edge to one castle on the right; they may cross and merge.
function genMap(s) {
  const n = rand(s) < MAPGEN.lanes3Chance ? 3 : 2;
  const yc = 3 + randInt(s, ROWS - 6);
  const spawns = [];
  const lanes = [];
  for (let i = 0; i < n; i++) {
    let y0, guard = 0;
    do { y0 = 1 + randInt(s, ROWS - 2); } while (spawns.some((v) => Math.abs(v - y0) < 3) && guard++ < 50);
    spawns.push(y0);
    const pts = [[-1, y0]];
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
    lanes.push(pts);
  }
  const tiles = new Set();
  for (const p of lanes) addTiles(p, tiles);

  // ponds: decoration that blocks building
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
  return { lanes: lanes.map(buildLane), tiles, water, castle: [COLS - 1, yc], spawns };
}

export function posAt(map, lane, d) {
  const L = map.lanes[lane];
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
  const all = [...Array(n).keys()];
  const count = s.wave >= 4 && rand(s) < 0.5 ? Math.min(n, 2) : 1;
  const out = [];
  while (out.length < count) out.push(all.splice(randInt(s, all.length), 1)[0]);
  return out.sort();
}

// opts come from meta-progression + difficulty (see src/meta.js); in co-op the host sends them to the guest.
export function createGame(seed, opts = {}) {
  const s = {
    rngState: seed >>> 0,
    opts: { hpMul: 1, cards: 3, locked: [], ...opts },
    won: false,
    tick: 0,
    gold: CONFIG.startGold + (opts.bonusGold || 0),
    lives: CONFIG.startLives + (opts.bonusLives || 0),
    wave: 0,
    countdown: CONFIG.firstWaveDelay * T,
    map: null,
    plan: [],
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
    mods: {
      dmg: { arrow: 1, cannon: 1, frost: 1, tesla: 1, fire: 1 },
      rate: 1, range: 1, chain: 0, burn: 1, wet: 0, steam: 1, gold: 1, interest: 0, crit: 0.1,
      meteorCd: opts.meteorCd || 1, smite: 1, wall: 1,
    },
    cds: { meteor: 0, nova: 0, wall: 0 },
    combo: 0,
    comboT: 0,
    draft: null,
    draftedWave: 0,
    over: false,
    kills: 0,
  };
  s.map = genMap(s);
  s.plan = planLanes(s);

  const near = (tx, ty, [cx, cy], r) => Math.abs(tx - cx) <= r && Math.abs(ty - cy) <= r;
  const nearSpawn = (tx, ty) => tx <= 1 && s.map.spawns.some((y) => Math.abs(ty - y) <= 1);
  // Explosive barrels right next to the road.
  let guard = 0;
  while (s.barrels.length < MAPGEN.barrels && guard++ < 2000) {
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
    if (!isFree(s, tx, ty) || nearSpawn(tx, ty) || near(tx, ty, s.map.castle, 1)) continue;
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
export function abilityMax(s, id) {
  return Math.round(ABILITIES[id].cd * (id === 'meteor' ? s.mods.meteorCd : 1) * T);
}
export function enemyAt(s, x, y, r = 14) {
  let best = null, bd = r;
  for (const e of s.enemies) {
    const d = Math.hypot(e.x - x, e.y - 6 - y);
    if (!e.dead && d < bd) { best = e; bd = d; }
  }
  return best;
}

// Rate bonus from adjacent Dynamo towers.
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
  const lv = def.from ? 0 : t.level - 1;
  const buff = buffOf(s, t);
  return {
    range: (def.range + lv * CONFIG.rangePerLevel) * s.mods.range,
    dmg: def.dmg * (1 + 0.6 * lv) * s.mods.dmg[family(t.kind)],
    period: Math.max(1, Math.round(T / (def.rate * s.mods.rate * (1 + buff)))),
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

export function sellValue(t) {
  return Math.floor(t.spent * CONFIG.sellRatio);
}

// ---------- step ----------

export function step(s, cmds = [], advance = true) {
  s.events = [];
  for (const c of cmds) applyCmd(s, c);
  if (!advance || s.over || s.draft) return;

  s.tick++;
  for (const k in s.cds) if (s.cds[k] > 0) s.cds[k]--;
  if (s.comboT > 0 && --s.comboT === 0) s.combo = 0;

  if (!s.queue.length && s.wave < CONFIG.winWave) {
    s.countdown--;
    if (s.countdown <= 0) startWave(s);
  }
  while (s.queue.length && s.queue[0].at <= s.tick) {
    const q = s.queue.shift();
    spawn(s, q.type, q.lane, 0, q.hpMul);
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

  if (s.lives <= 0) {
    s.lives = 0;
    s.over = true;
    s.events.push({ type: 'gameover' });
  } else if (s.wave >= CONFIG.winWave && !s.queue.length && !s.enemies.length) {
    s.won = true;
    s.over = true;
    s.events.push({ type: 'victory' });
  } else if (s.wave > s.draftedWave && !s.queue.length && !s.enemies.length) {
    s.draftedWave = s.wave;
    s.draft = pickCards(s, s.opts.cards);
    s.events.push({ type: 'waveclear', wave: s.wave });
  }
}

function applyCmd(s, c) {
  if (s.over) return;
  if (c.type === 'pick') {
    if (!s.draft) return;
    const card = CARDS.find((k) => k.id === s.draft[c.index]);
    if (card) card.apply(s);
    s.draft = null;
    return;
  }
  if (s.draft) return;

  switch (c.type) {
    case 'place': {
      const def = TOWERS[c.kind];
      if (!def || def.from || s.opts.locked.includes(c.kind) || !canPlace(s, c.tx, c.ty) || s.gold < def.cost) return;
      s.gold -= def.cost;
      const t = { id: s.nextId++, kind: c.kind, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), level: 1, cd: 0, spent: def.cost, aim: 0, fired: 0 };
      s.towers.push(t);
      s.events.push({ type: 'build', x: t.x, y: t.y });
      return;
    }
    case 'upgrade': {
      const t = s.towers.find((k) => k.id === c.id);
      const cost = t ? upgradeCost(t) : 0;
      if (!cost || s.gold < cost) return;
      s.gold -= cost;
      t.spent += cost;
      t.level++;
      s.events.push({ type: 'upgrade', x: t.x, y: t.y });
      return;
    }
    case 'evolve': {
      const t = s.towers.find((k) => k.id === c.id);
      const def = TOWERS[c.kind];
      if (!t || !def || def.from !== t.kind || !canEvolve(t) || s.gold < def.cost) return;
      s.gold -= def.cost;
      t.spent += def.cost;
      t.kind = c.kind;
      t.cd = 0;
      s.events.push({ type: 'evolve', x: t.x, y: t.y, kind: c.kind });
      return;
    }
    case 'sell': {
      const i = s.towers.findIndex((k) => k.id === c.id);
      if (i < 0) return;
      const t = s.towers[i];
      s.gold += sellValue(t);
      s.towers.splice(i, 1);
      s.events.push({ type: 'sell', x: t.x, y: t.y, gold: sellValue(t) });
      return;
    }
    case 'clear': {
      const i = s.obstacles.findIndex((o) => o.id === c.id);
      if (i < 0) return;
      const o = s.obstacles[i];
      if (s.gold < clearCost(o)) return;
      s.gold -= clearCost(o);
      s.obstacles.splice(i, 1);
      const p = center(o.tx, o.ty);
      s.events.push({ type: 'clear', ...p, kind: o.kind });
      if (o.chest) {
        s.gold += OBSTACLES.chestGold;
        s.events.push({ type: 'chest', ...p, gold: OBSTACLES.chestGold });
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
        damage(s, e, dmg, { pierce: true });
        ignite(s, e, 6, 2);
      }
      s.events.push({ type: 'barrel', x: b.x, y: b.y, r: BARREL.radius });
      return;
    }
    case 'collect': {
      const i = s.coins.findIndex((k) => k.id === c.id);
      if (i < 0) return;
      const coin = s.coins[i];
      s.gold += coin.value;
      s.coins.splice(i, 1);
      s.events.push({ type: 'coin', x: coin.x, y: coin.y, gold: coin.value });
      return;
    }
    case 'smite': {
      const e = s.enemies.find((k) => k.id === c.id && !k.dead);
      if (!e) return;
      s.combo = s.comboT > 0 ? Math.min(SMITE.maxCombo, s.combo + 1) : 1;
      s.comboT = Math.round(SMITE.window * T);
      const dmg = (SMITE.dmg + s.wave * SMITE.perWave) * (1 + 0.5 * (s.combo - 1)) * s.mods.smite;
      s.events.push({ type: 'smite', x: e.x, y: e.y, combo: s.combo });
      damage(s, e, dmg, { pierce: true, big: s.combo >= 3 });
      return;
    }
    case 'nextWave': {
      if (s.queue.length || s.wave >= CONFIG.winWave) return;
      const bonus = s.wave > 0 ? Math.ceil(s.countdown / T) * CONFIG.earlyBonus : 0;
      s.gold += bonus;
      if (bonus) s.events.push({ type: 'bonus', gold: bonus });
      startWave(s);
      return;
    }
    case 'meteor': {
      if (s.cds.meteor > 0) return;
      s.cds.meteor = abilityMax(s, 'meteor');
      const dmg = 40 + s.wave * 6;
      for (const e of s.enemies) {
        if (e.dead || Math.hypot(e.x - c.x, e.y - c.y) > ABILITIES.meteor.radius) continue;
        damage(s, e, dmg, { pierce: true });
        ignite(s, e, 8, 3);
      }
      s.events.push({ type: 'meteor', x: c.x, y: c.y, r: ABILITIES.meteor.radius });
      return;
    }
    case 'nova': {
      if (s.cds.nova > 0) return;
      s.cds.nova = abilityMax(s, 'nova');
      const a = ABILITIES.nova;
      for (const e of s.enemies) {
        if (e.dead) continue;
        e.slowT = Math.round(a.freeze * T * (ENEMIES[e.type].lives ? 0.5 : 1));
        e.slowF = 0;
        e.wetT = Math.round(a.wet * T);
        e.burnT = 0;
      }
      s.events.push({ type: 'nova' });
      return;
    }
    case 'wall': {
      if (s.cds.wall > 0 || !isRoad(s, c.tx, c.ty) || c.tx < 0) return;
      if (s.walls.some((w) => w.tx === c.tx && w.ty === c.ty)) return;
      s.cds.wall = abilityMax(s, 'wall');
      const hp = Math.round((ABILITIES.wall.hp + s.wave * ABILITIES.wall.hpPerWave) * s.mods.wall);
      s.walls.push({ id: s.nextId++, tx: c.tx, ty: c.ty, ...center(c.tx, c.ty), hp, max: hp });
      s.events.push({ type: 'wallup', ...center(c.tx, c.ty) });
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
  if (s.mods.interest > 0) {
    const gain = Math.floor(s.gold * s.mods.interest);
    if (gain) { s.gold += gain; s.events.push({ type: 'bonus', gold: gain }); }
  }
  const lanes = s.plan;
  const hpMul = (1 + 0.2 * (w - 1) + 0.012 * (w - 1) * (w - 1)) * s.opts.hpMul;
  const pool = Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] <= w);
  let budget = 8 + w * 5;
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
    dist, x: p.x, y: p.y, px: p.x, py: p.y,
    slowT: 0, slowF: 1, wetT: 0, burnT: 0, burnDps: 0, burnAcc: 0, flash: 0, dead: false, blocked: false,
  };
  s.enemies.push(e);
  return e;
}

function updateEnemy(s, e) {
  if (e.dead) return;
  const def = ENEMIES[e.type];
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
      damage(s, e, d, { pierce: true, quiet: true });
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
  const speed = def.speed * (e.slowT > 0 ? e.slowF : 1);
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
  if (e.dist >= s.map.lanes[e.lane].total) {
    e.dead = true;
    s.lives -= def.lives || 1;
    if (def.steal) {
      const lost = Math.min(s.gold, def.steal);
      s.gold -= lost;
      s.events.push({ type: 'stolen', x: e.x, y: e.y, gold: lost });
    }
    s.events.push({ type: 'leak', x: e.x, y: e.y, boss: !!def.lives });
  }
}

function updateZone(s, z) {
  z.life--;
  if (z.life % 5) return;
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damage(s, e, z.dps / 4, { pierce: true, quiet: true });
  }
}

function inRange(s, x, y, range) {
  return s.enemies.filter((e) => !e.dead && e.dist >= 0 && Math.hypot(e.x - x, e.y - y) <= range);
}

function updateTower(s, t) {
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
      kind: def.proj, tower: t.kind, level: t.level, dmg: st.dmg, speed: def.speed,
      x: t.x, y: t.y - 14, px: t.x, py: t.y - 14, target: e.id, tx: e.x, ty: e.y, done: false,
    });
  }
  s.events.push({ type: 'shoot', kind: family(t.kind) });
}

function pulse(s, t, def, st, targets) {
  for (const e of targets) {
    damage(s, e, st.dmg, { quiet: def.burn !== undefined });
    if (e.dead) continue;
    if (def.slow !== undefined) applyCold(s, e, def);
    if (def.burn) ignite(s, e, def.burn, def.burnTime);
  }
  s.events.push({ type: 'pulse', x: t.x, y: t.y, r: st.range, kind: t.kind });
}

function applyCold(s, e, def) {
  const boss = !!ENEMIES[e.type].lives;
  e.slowT = Math.round(def.slowTime * T * (boss && def.freeze ? 0.4 : 1));
  e.slowF = def.slow;
  e.wetT = Math.round((def.wetTime + s.mods.wet) * T);
  e.burnT = 0; // water puts out fire
}

function zap(s, t, first, st, def) {
  const hit = [first];
  let jumps = def.chain + s.mods.chain + (first.wetT > 0 ? 1 : 0);
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
    damage(s, e, st.dmg * (wet ? 2 : 1), { big: wet });
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

function explode(s, x, y, r, dmg) {
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) <= r) damage(s, e, dmg, { pierce: true });
  }
  s.events.push({ type: 'explode', x, y, r });
}

function hit(s, p, target) {
  const def = TOWERS[p.tower];
  const lvMul = def.from ? 1.6 : 1 + 0.6 * (p.level - 1);
  switch (p.kind) {
    case 'arrow':
      if (target) damage(s, target, p.dmg, { pierce: def.pierce, crit: rand(s) < s.mods.crit });
      break;
    case 'ball':
      explode(s, p.x, p.y + 6, def.splash, p.dmg);
      for (let i = 0; i < (def.bomblets || 0); i++) {
        const a = rand(s) * Math.PI * 2, r = 15 + rand(s) * 21;
        explode(s, p.x + Math.cos(a) * r, p.y + 6 + Math.sin(a) * r, 18, p.dmg * 0.4);
      }
      break;
    case 'ice':
      if (!target) break;
      damage(s, target, p.dmg);
      if (!target.dead) applyCold(s, target, def);
      break;
    case 'fire':
      if (def.puddle) {
        s.zones.push({ x: p.x, y: p.y + 6, r: def.puddle.r, dps: def.puddle.dps * s.mods.burn, life: def.puddle.time * T, max: def.puddle.time * T });
      }
      if (!target) break;
      if (target.wetT > 0) {
        // Synergy: fire + wet = steam explosion.
        target.wetT = 0;
        const dmg = CONFIG.steamDmg * lvMul * s.mods.steam;
        for (const e of s.enemies) {
          if (!e.dead && Math.hypot(e.x - target.x, e.y - target.y) <= CONFIG.steamRadius) damage(s, e, dmg, { pierce: true });
        }
        s.events.push({ type: 'steam', x: target.x, y: target.y });
      } else {
        damage(s, target, p.dmg);
        ignite(s, target, def.burn * lvMul, def.burnTime);
      }
      break;
  }
}

function ignite(s, e, dps, time) {
  if (e.dead) return;
  e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps * s.mods.burn);
  e.burnT = Math.round(time * T);
}

function damage(s, e, amount, { pierce = false, crit = false, big = false, quiet = false } = {}) {
  if (e.dead) return;
  let d = pierce ? amount : amount - e.armor;
  if (crit) d *= 2;
  d = Math.max(1, Math.round(d));
  e.hp -= d;
  e.flash = 2;
  if (!quiet) s.events.push({ type: 'hit', x: e.x, y: e.y, dmg: d, crit: crit || big });
  if (e.hp <= 0) kill(s, e);
}

function kill(s, e) {
  e.dead = true;
  const def = ENEMIES[e.type];
  const gold = Math.round(def.gold * s.mods.gold);
  s.gold += gold;
  s.kills++;
  s.events.push({ type: 'death', x: e.x, y: e.y, kind: e.type, gold });
  // Coins drop on the map and must be picked up with the mouse.
  const n = def.coins || (rand(s) < COIN.chance ? 1 : 0);
  for (let i = 0; i < n; i++) {
    s.coins.push({
      id: s.nextId++, x: e.x + (rand(s) * 24 - 12), y: e.y + (rand(s) * 18 - 9),
      value: COIN.base + Math.floor(s.wave / 2), life: COIN.life * T,
    });
  }
  if (def.splits) {
    for (const off of [-7, 7]) spawn(s, def.splits, e.lane, Math.max(0, e.dist + off), e.hpMul);
  }
}
