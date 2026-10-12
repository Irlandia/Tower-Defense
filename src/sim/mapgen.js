// Procedural map generation: lanes, ponds, the farm. Pure functions of (state.rngState, season, players).
import { TILE, COLS, ROWS, MAPGEN, SEASONS } from './data.js';
import { rand, randInt } from './rng.js';

export const center = (tx, ty) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
export const key = (x, y) => x + ',' + y;

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
export function genClassic(s) {
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
export function genCircle(s, players = 1) {
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
export function placeFarm(map) {
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
