// Static map background, drawn once per map: ground by season, water, roads with their decor, caves.
// Pure drawing into an offscreen canvas; Renderer (render.js) caches the result.
import { TILE, COLS, ROWS } from './sim/data.js';
import { C, drawCave, ellipse, drawFarmHouse, drawField, drawWinterDecor } from './sprites.js';

export function edgeOf([x, y]) {
  if (x === 0) return "left";
  if (x === COLS - 1) return "right";
  return y === 0 ? "top" : "bottom";
}
// Ground palettes per season.
const GROUND = {
  spring: { base: "#5fcf6a", patch: "#4cbb5c", tuft: ["#3a9e58", "#c7f59a"], bloom: ["#f4b6d2", "#f4f4f4", "#ffcd75", "#c9a8ff"], flowers: 160, rim: "#d9b382" },
  summer: { base: "#38b764", patch: "#2f9e57", tuft: ["#257179", "#a7f070"], bloom: ["#ffcd75", "#f4f4f4", "#b13e53", "#73eff7"], flowers: 70, rim: "#d9b382" },
  autumn: { base: "#9aa04a", patch: "#857f3a", tuft: ["#6d6b2f", "#c9a046"], bloom: ["#ef7d57", "#b13e53", "#ffcd75", "#8a6248"], flowers: 260, rim: "#c29a6b" },
  winter: { base: "#e8f1f6", patch: "#d3e2ec", tuft: ["#ffffff", "#b9cfdc"], bloom: ["#ffffff", "#73eff7"], flowers: 60, rim: "#f4f4f4" },
};

export function makeBackground(map, season = 'summer') {
  const cv = document.createElement('canvas');
  cv.width = COLS * TILE; cv.height = ROWS * TILE;
  const g = cv.getContext('2d');
  const road = (x, y) => map.tiles.has(x + ',' + y);
  const water = (x, y) => map.water.has(x + ',' + y);
  const rnd = Math.random;
  const L = GROUND[season] || GROUND.summer;
  // ground with soft darker patches
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      const patch = Math.sin(tx * 0.5 + ty * 0.3) + Math.cos(ty * 0.6 - tx * 0.2) > 0.8;
      g.fillStyle = patch ? L.patch : L.base;
      g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
    }
  }
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rnd() * cv.width), y = Math.floor(rnd() * cv.height);
    g.fillStyle = rnd() < 0.55 ? L.tuft[0] : L.tuft[1];
    g.fillRect(x, y, 1, rnd() < 0.5 ? 2 : 3); // grass tufts / snow drifts
  }
  for (let i = 0; i < L.flowers; i++) {
    const x = Math.floor(rnd() * cv.width), y = Math.floor(rnd() * cv.height);
    g.fillStyle = L.bloom[Math.floor(rnd() * L.bloom.length)];
    g.fillRect(x, y, 2, season === 'autumn' ? 1 : 2); // flowers, fallen leaves, frost glints
    if (season !== 'autumn' && season !== 'winter') { g.fillStyle = L.tuft[0]; g.fillRect(x, y + 2, 1, 2); }
  }
  // water: rim, deep centre; in winter a sheet of cracked ice
  for (const k of map.water) {
    const [tx, ty] = k.split(',').map(Number);
    g.fillStyle = L.rim;
    g.fillRect(tx * TILE - 2, ty * TILE - 2, TILE + 4, TILE + 4);
  }
  for (const k of map.water) {
    const [tx, ty] = k.split(',').map(Number);
    const x = tx * TILE, y = ty * TILE;
    if (season === 'winter') {
      g.fillStyle = '#bfe6f2'; g.fillRect(x, y, TILE, TILE);
      g.fillStyle = '#9fd3e6';
      if (!water(tx, ty - 1)) g.fillRect(x, y, TILE, 2);
      g.fillStyle = C.white;
      for (let i = 0; i < 3; i++) { const cx = x + Math.floor(rnd() * 20), cy = y + Math.floor(rnd() * 20); for (let k2 = 0; k2 < 5; k2++) g.fillRect(cx + k2, cy + ((k2 * 7) % 3) - 1, 1, 1); }
      continue;
    }
    g.fillStyle = C.blue; g.fillRect(x, y, TILE, TILE);
    if (!water(tx, ty - 1)) { g.fillStyle = C.navy; g.fillRect(x, y, TILE, 3); }
    if (water(tx - 1, ty) && water(tx + 1, ty) && water(tx, ty - 1) && water(tx, ty + 1)) { g.fillStyle = C.navy; g.fillRect(x + 4, y + 6, 14, 10); }
  }
  // road: lowered dirt with a shadowed top edge and light lip at the bottom
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = 0; tx < COLS; tx++) {
      if (!road(tx, ty)) continue;
      const x = tx * TILE, y = ty * TILE;
      g.fillStyle = '#8a6248'; g.fillRect(x, y, TILE, TILE);
      for (let i = 0; i < 5; i++) {
        const px = x + 2 + Math.floor(rnd() * 18), py = y + 2 + Math.floor(rnd() * 18);
        g.fillStyle = '#a8805e'; g.fillRect(px, py, 3, 2);
        g.fillStyle = '#6b4a36'; g.fillRect(px, py + 2, 3, 1);
      }
      g.fillStyle = '#4a3324';
      if (!road(tx, ty - 1)) g.fillRect(x, y, TILE, 3);
      if (!road(tx - 1, ty) && tx > 0) g.fillRect(x, y, 2, TILE);
      g.fillStyle = '#c29a6b';
      if (!road(tx, ty + 1)) g.fillRect(x, y + TILE - 2, TILE, 2);
      if (!road(tx + 1, ty) && tx < COLS - 1) g.fillRect(x + TILE - 2, y, 2, TILE);
    }
  }
  drawRoadDecor(g, map, season, road, rnd);
  if (season === "winter") {
    // snowy road edges and slush
    for (const k of map.tiles) {
      const [tx, ty] = k.split(",").map(Number);
      if (tx < 0 || tx >= COLS) continue;
      for (let i = 0; i < 6; i++) { g.fillStyle = rnd() < 0.6 ? C.white : "#c9d6de"; g.fillRect(tx * TILE + Math.floor(rnd() * 22), ty * TILE + Math.floor(rnd() * 22), 2, 1); }
    }
  }
  if (map.farm) {
    // farm yard: trodden earth under the house, the field with its fence
    const f = map.farm;
    g.fillStyle = season === "winter" ? "#d3e2ec" : "#a8805e";
    g.fillRect(f.x * TILE + 2, f.y * TILE + 2, TILE - 4, f.h * TILE - 4);
    drawField(g, f.field[0], f.field[1], f.field[2], f.field[3], season, TILE);
  }
  if (season === "winter") placeWinterDecor(g, map, road, water, rnd);
  for (const sp of map.spawns) {
    const [x, y] = sp, e = edgeOf(sp);
    if (e === "left") drawCave(g, 0, y * TILE);
    else if (e === "right") drawCave(g, COLS * TILE - 16, y * TILE);
    else if (e === "top") drawCave(g, x * TILE + 6, -12);
    else drawCave(g, x * TILE + 6, ROWS * TILE - 10);
  }
  return cv;
}

// Winter decor on free grass: two snowmen and two decorated Christmas trees, never on or next to a road, pond or the farm yard.
function placeWinterDecor(g, map, road, water, rnd) {
  const f = map.farm;
  const inFarm = (tx, ty) => !!f && tx >= Math.min(f.x, f.field[0]) - 1 && tx <= Math.max(f.x + 3, f.field[0] + f.field[2]) && ty >= Math.min(f.y, f.field[1]) - 1 && ty <= Math.max(f.y + f.h, f.field[1] + f.field[3]);
  const free = (tx, ty) => tx >= 1 && tx < COLS - 1 && ty >= 1 && ty < ROWS - 1 && !inFarm(tx, ty)
    && [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !road(tx + dx, ty + dy) && !water(tx + dx, ty + dy));
  const placed = [];
  for (const kind of ['snow', 'snow', 'tree', 'tree']) {
    for (let tries = 0; tries < 300; tries++) {
      const tx = 1 + Math.floor(rnd() * (COLS - 2)), ty = 1 + Math.floor(rnd() * (ROWS - 2));
      if (!free(tx, ty) || placed.some(([px, py]) => Math.abs(px - tx) + Math.abs(py - ty) < 3)) continue;
      placed.push([tx, ty]);
      drawWinterDecor(g, tx * TILE + 6 + rnd() * 12, ty * TILE + 20, kind);
      break;
    }
  }
}

// Atmosphere on the roads (static background only): wheel ruts, puddles / ice / dry cracks,
// pebbles, hoof prints, grass at the edges, signposts on bends, cobbles near the castle.
function drawRoadDecor(g, map, season, road, rnd) {
  const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const tiles = [...map.tiles].map((k) => k.split(',').map(Number)).filter(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS);
  const castle = map.castle;
  for (const [tx, ty] of tiles) {
    const x = tx * TILE, y = ty * TILE;
    const L = road(tx - 1, ty), Rr = road(tx + 1, ty), U = road(tx, ty - 1), D = road(tx, ty + 1);
    const near = castle && Math.abs(tx - castle[0]) + Math.abs(ty - castle[1]) <= 3;
    if (near) {
      // cobblestones on the approach to the castle
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
        const cx = x + 2 + i * 5 + (j % 2) * 2, cy = y + 2 + j * 5;
        P(cx, cy, 4, 3, season === 'winter' ? '#c9d6de' : '#94b0c2'); P(cx, cy + 3, 4, 1, '#566c86');
      }
      continue;
    }
    // wheel ruts along the direction of travel
    const rut = season === 'winter' ? '#b9c7d0' : '#6b4a36';
    if ((L || Rr) && !(U && D && !L && !Rr)) for (let i = 0; i < TILE; i += 3) if (rnd() < 0.8) { P(x + i, y + 8, 2, 1, rut); P(x + i, y + 15, 2, 1, rut); }
    if ((U || D) && !(L && Rr && !U && !D)) for (let i = 0; i < TILE; i += 3) if (rnd() < 0.8) { P(x + 8, y + i, 1, 2, rut); P(x + 15, y + i, 1, 2, rut); }
    // puddles, ice patches or dry cracks
    const r = rnd();
    if (r < 0.07) {
      const px = x + 5 + rnd() * 10, py = y + 6 + rnd() * 10;
      if (season === 'winter') { ellipse(g, px, py, 5, 2, '#dff3fa'); P(px - 2, py - 1, 3, 1, C.white); }
      else if (season === 'summer') { const c = '#5a3e2c'; P(px, py, 4, 1, c); P(px + 3, py + 1, 3, 1, c); P(px + 1, py - 1, 1, 2, c); P(px + 5, py - 1, 1, 1, c); }
      else {
        ellipse(g, px, py, 5, 2, '#3b5dc9'); P(px - 3, py - 1, 3, 1, '#73eff7');
        if (season === 'autumn') P(px + 1, py, 2, 1, C.orange); // a leaf floating in it
      }
    } else if (r < 0.2) {
      // a bigger pebble with a highlight
      const px = x + 3 + rnd() * 16, py = y + 3 + rnd() * 16;
      P(px, py, 3, 2, '#94b0c2'); P(px, py, 1, 1, C.white); P(px, py + 2, 3, 1, '#566c86');
    } else if (r < 0.26 && season !== 'winter') {
      // hoof prints
      const vert = U || D;
      for (let i = 0; i < 3; i++) {
        const px = x + (vert ? 10 + (i % 2) * 3 : 4 + i * 7), py = y + (vert ? 4 + i * 7 : 10 + (i % 2) * 3);
        P(px, py, 2, 1, '#5a3e2c'); P(px, py + 1, 1, 1, '#5a3e2c'); P(px + 1, py + 1, 1, 1, '#5a3e2c');
      }
    }
    // grass and the odd flower creeping onto the road edges
    if (season !== 'winter') {
      const tuft = season === 'autumn' ? '#c9a046' : C.green, bloom = season === 'autumn' ? C.orange : C.yellow;
      const edge = (ex, ey, horiz) => {
        for (let i = 0; i < 3; i++) {
          const gx = ex + (horiz ? 3 + rnd() * 18 : 0), gy = ey + (horiz ? 0 : 3 + rnd() * 18);
          P(gx, gy, 1, 2, tuft); P(gx + 1, gy + 1, 1, 1, tuft);
          if (rnd() < 0.15) P(gx, gy - 1, 1, 1, bloom);
        }
      };
      if (!U) edge(x, y + 3, true);
      if (!D) edge(x, y + TILE - 5, true);
      if (!L && tx > 0) edge(x + 2, y, false);
      if (!Rr && tx < COLS - 1) edge(x + TILE - 4, y, false);
    }
    // signposts on bends, on the outer corner of the turn
    const bend = (L || Rr) && (U || D) && !(L && Rr) && !(U && D);
    if (bend && rnd() < 0.45) {
      const sx = x + (L ? TILE - 3 : 1), sy = y + (U ? TILE - 3 : 2);
      P(sx, sy - 9, 1, 10, '#5a3e2c');
      P(sx - 4, sy - 9, 9, 4, '#c28569'); P(sx - 4, sy - 9, 9, 1, '#e0b089');
      P(Rr ? sx + 4 : sx - 5, sy - 8, 1, 2, '#c28569'); // the board's arrow tip points along the road
      P(sx - 2, sy - 7, 5, 1, '#5a3e2c');
      if (season === 'winter') P(sx - 4, sy - 10, 9, 1, C.white);
    }
  }
}
