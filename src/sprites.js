// Pixel art generated in code from one palette (Sweetie 16), with simple pseudo-3D primitives:
// shaded cylinders, cones, spheres and boxes lit from the top-left.
export const PAL = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
];
export const C = {
  ink: PAL[0], plum: PAL[1], red: PAL[2], orange: PAL[3], yellow: PAL[4], lime: PAL[5], green: PAL[6], teal: PAL[7],
  navy: PAL[8], blue: PAL[9], sky: PAL[10], cyan: PAL[11], white: PAL[12], silver: PAL[13], slate: PAL[14], dark: PAL[15],
};
// [light, mid, dark] tones
const STONE = [C.silver, C.slate, C.dark];
const IRON = [C.slate, C.dark, C.ink];
const ROOF = [C.orange, C.red, C.plum];
const GREENR = [C.lime, C.green, C.teal];
const ICE = [C.white, C.cyan, C.sky];
const GOLD = [C.yellow, C.orange, C.red];
const BLUE = [C.sky, C.blue, C.navy];
const WOOD = ['#c28569', '#8a6248', '#5a3e2c'];

function R(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

export function ellipse(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    if (w > 0) g.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
  }
}

// Vertical cylinder standing on (cx, bottom): shaded columns + rounded bottom + light top cap.
function cyl(g, cx, bottom, r, h, T, cap = T[0]) {
  const ry = Math.max(1, Math.round(r / 2.5));
  for (let dx = -r; dx < r; dx++) {
    const f = (dx + 0.5) / r;
    const c = f < -0.4 ? T[0] : f < 0.35 ? T[1] : T[2];
    const e = Math.round(ry * Math.sqrt(Math.max(0, 1 - f * f)));
    R(g, cx + dx, bottom - h, 1, h + e, c);
  }
  ellipse(g, cx, bottom - h, r - 0.5, ry, cap);
}

function cone(g, cx, base, r, h, T) {
  for (let i = 0; i < h; i++) {
    const w = Math.max(1, Math.round((r * (i + 1)) / h));
    const y = base - h + i;
    R(g, cx - w, y, w, 1, T[0]);
    R(g, cx, y, w, 1, T[1]);
    R(g, cx + Math.ceil(w / 2), y, Math.floor(w / 2), 1, T[2]);
  }
}

// Box seen from the front-top: light top face, mid front, dark right edge and base line.
function box(g, x, bottom, w, h, d, T) {
  R(g, x, bottom - h, w, h, T[1]);
  R(g, x, bottom - h - d, w, d, T[0]);
  R(g, x + w - 2, bottom - h, 2, h, T[2]);
  R(g, x, bottom - 1, w, 1, T[2]);
}

// Per-pixel lit sphere. T = [highlight, light, mid, dark].
function sphere(g, cx, cy, r, T) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const nx = dx / r, ny = dy / r;
      const l = -nx * 0.55 - ny * 0.75 + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 0.35;
      const c = l > 0.75 ? T[0] : l > 0.25 ? T[1] : l > -0.25 ? T[2] : T[3];
      R(g, cx + dx, cy + dy, 1, 1, c);
    }
  }
}

function crystal(g, cx, bottom, w, h, T) {
  for (let i = 0; i < h; i++) {
    const t = i / h;
    const half = Math.max(1, Math.round(t < 0.35 ? w * (t / 0.35) : w * (1 - (t - 0.35) / 0.65)));
    const y = bottom - h + i;
    R(g, cx - half, y, half, 1, T[0]);
    R(g, cx, y, half, 1, T[1]);
    R(g, cx + half - 1, y, 1, 1, T[2]);
  }
}

function barrel(g, cx, cy, aim, len, thick, T) {
  for (let i = 0; i < len; i++) {
    const x = cx + Math.cos(aim) * i, y = cy + Math.sin(aim) * i * 0.7;
    R(g, x - thick / 2, y - thick / 2, thick, thick, T[1]);
    R(g, x - thick / 2, y - thick / 2, thick, 1, T[0]);
  }
  const ex = cx + Math.cos(aim) * len, ey = cy + Math.sin(aim) * len * 0.7;
  R(g, ex - thick / 2, ey - thick / 2, thick, thick, C.ink);
}

function flames(g, cx, base, size, t) {
  const f = (t >> 1) % 3;
  ellipse(g, cx, base - size * 0.3, size * 0.6, size * 0.35, C.red);
  ellipse(g, cx + (f - 1), base - size * 0.6, size * 0.45, size * 0.4, C.orange);
  ellipse(g, cx - (f - 1), base - size * 0.9, size * 0.28, size * 0.35, C.yellow);
  R(g, cx - 1 + (f === 2 ? 1 : 0), base - size * 1.3, 2, 3, C.yellow);
}

// x, y = top-left of the 24x24 tile. Models are taller than the tile (3/4 view).
export function drawTower(g, kind, x, y, level, aim = 0, t = 0, recoil = false) {
  const cx = x + 12, by = y + 16;
  // shadow + plinth
  g.fillStyle = 'rgba(0,0,0,0.3)';
  ellipse(g, cx + 2, y + 22, 11, 3, 'rgba(0,0,0,0.3)');
  box(g, x + 3, y + 22, 18, 4, 5, STONE);
  const ry = recoil ? 1 : 0;
  switch (kind) {
    case 'arrow':
      cyl(g, cx, by + ry, 6, 12, STONE);
      R(g, cx - 1, by - 9 + ry, 2, 4, C.ink);
      cone(g, cx, by - 12 + ry, 8, 9, ROOF);
      if (level >= 2) { R(g, cx, by - 25, 1, 5, C.dark); R(g, cx + 1, by - 25, 4, 2, C.yellow); }
      break;
    case 'cannon':
      cyl(g, cx, by, 7, 6, IRON);
      ellipse(g, cx, by - 7, 5, 2, C.silver);
      barrel(g, cx, by - 8, aim, recoil ? 7 : 10, 3, IRON);
      break;
    case 'frost': {
      const bob = (t >> 3) % 2;
      ellipse(g, cx, by - 1, 5, 2, C.sky);
      crystal(g, cx, by - 3 - bob, 6, 18, ICE);
      if ((t >> 2) % 6 === 0) R(g, cx + 6, by - 16, 1, 1, C.white);
      break;
    }
    case 'tesla':
      cyl(g, cx, by, 2, 16, IRON);
      for (const h of [5, 9, 13]) { ellipse(g, cx, by - h, 5, 1, C.orange); R(g, cx - 5, by - h - 1, 10, 1, C.yellow); }
      sphere(g, cx, by - 19, 3, (t >> 2) % 2 ? [C.white, C.cyan, C.sky, C.blue] : [C.white, C.white, C.cyan, C.sky]);
      break;
    case 'fire':
      cyl(g, cx, by, 7, 7, IRON);
      ellipse(g, cx, by - 7, 6, 2, C.red);
      flames(g, cx, by - 7, 8, t);
      break;
    // ----- evolutions -----
    case 'sniper':
      cyl(g, cx, by, 5, 20, BLUE);
      ellipse(g, cx, by - 20, 4, 2, C.cyan);
      barrel(g, cx, by - 20, aim, 13, 1, [C.ink, C.ink]);
      R(g, cx + Math.cos(aim) * 4, by - 22 + Math.sin(aim) * 3, 2, 1, C.red);
      break;
    case 'ranger':
      for (const ox of [-7, 7]) { cyl(g, cx + ox, by + 3, 3, 7, STONE); cone(g, cx + ox, by - 4, 4, 5, GREENR); }
      cyl(g, cx, by, 6, 13, STONE);
      R(g, cx - 1, by - 10, 2, 4, C.ink);
      cone(g, cx, by - 13, 8, 10, GREENR);
      R(g, cx, by - 27, 1, 5, C.dark); R(g, cx + 1, by - 27, 4, 2, C.yellow);
      break;
    case 'mortar':
      cyl(g, cx, by, 8, 7, IRON);
      R(g, cx - 8, by - 3, 16, 1, C.orange);
      cyl(g, cx, by - 7 + ry, 4, 8, IRON);
      ellipse(g, cx, by - 15 + ry, 3, 1, C.ink);
      break;
    case 'cluster':
      box(g, x + 5, by + 2, 14, 8, 3, GOLD.map((c, i) => [C.orange, C.red, C.plum][i]));
      R(g, x + 5, by - 3, 14, 1, C.yellow);
      for (const d of [-0.35, 0, 0.35]) barrel(g, cx, by - 7, aim + d, recoil ? 6 : 8, 2, IRON);
      break;
    case 'blizzard': {
      ellipse(g, cx, by - 1, 7, 2, C.sky);
      crystal(g, cx, by - 4, 8, 22, ICE);
      const a = t * 0.12;
      for (let i = 0; i < 3; i++) crystal(g, cx + Math.cos(a + i * 2.1) * 10, by - 6 + Math.sin(a + i * 2.1) * 4, 2, 6, ICE);
      break;
    }
    case 'glacier':
      box(g, x + 4, by + 2, 16, 13, 4, ICE);
      R(g, x + 7, by - 8, 1, 6, C.white); R(g, x + 12, by - 6, 4, 1, C.sky); R(g, x + 14, by - 9, 1, 4, C.sky);
      crystal(g, cx + 3, by - 15, 3, 8, ICE);
      break;
    case 'storm': {
      cyl(g, cx - 5, by, 2, 18, IRON);
      cyl(g, cx + 5, by + 1, 2, 14, IRON);
      const on = (t >> 2) % 2;
      sphere(g, cx - 5, by - 21, 3, on ? [C.white, C.cyan, C.sky, C.blue] : [C.white, C.white, C.cyan, C.sky]);
      sphere(g, cx + 5, by - 16, 3, on ? [C.white, C.white, C.cyan, C.sky] : [C.white, C.cyan, C.sky, C.blue]);
      if (on) for (let i = 0; i <= 8; i++) R(g, cx - 4 + i, by - 20 + i * 0.5 + ((i * 7 + t) % 3) - 1, 1, 1, C.white);
      break;
    }
    case 'overload': {
      // fat coil with a red overcharged core
      cyl(g, cx, by, 5, 10, IRON);
      for (const h of [3, 6, 9]) { ellipse(g, cx, by - h, 7, 2, C.orange); R(g, cx - 7, by - h - 1, 14, 1, C.yellow); }
      cyl(g, cx, by - 10, 2, 5, IRON);
      const hot = (t >> 2) % 2;
      sphere(g, cx, by - 19, 4, hot ? [C.white, C.yellow, C.orange, C.red] : [C.yellow, C.orange, C.red, C.plum]);
      if (hot) { R(g, cx - 7, by - 21, 1, 1, C.yellow); R(g, cx + 6, by - 17, 1, 1, C.yellow); }
      break;
    }
    case 'totem': {
      // carved obelisk with a floating gem; runes orbit it per aura level
      box(g, x + 7, by + 2, 10, 15, 3, [C.silver, C.slate, C.dark]);
      R(g, x + 9, by - 9, 2, 2, C.cyan); R(g, x + 9, by - 4, 2, 2, C.lime); R(g, x + 12, by - 7, 2, 2, C.yellow);
      const bob = Math.round(Math.sin(t * 0.15) * 1.5);
      crystal(g, cx, by - 17 + bob, 4, 9, [C.white, C.lime, C.green]);
      const a = t * 0.08;
      for (let i = 0; i < level; i++) R(g, cx + Math.cos(a + i * 2.1) * 10, by - 8 + Math.sin(a + i * 2.1) * 4, 2, 2, i % 2 ? C.yellow : C.cyan);
      break;
    }
    case 'inferno':
      cyl(g, cx, by, 9, 6, IRON);
      ellipse(g, cx, by - 6, 8, 3, C.red);
      flames(g, cx, by - 6, 12, t);
      break;
    case 'magma': {
      cyl(g, cx, by, 8, 9, [C.dark, C.ink, C.ink]);
      ellipse(g, cx, by - 9, 7, 2, C.orange);
      const b = (t >> 2) % 4;
      R(g, cx - 3 + b, by - 10, 2, 1, C.yellow);
      R(g, cx + 2 - b, by - 9, 1, 1, C.yellow);
      R(g, cx + 6, by - 7 + b, 1, 2, C.orange);
      break;
    }
  }
  if (kind === "totem") return; // totem shows aura levels as orbiting runes instead of pips
  if (level > 3) drawIcon(g, 'star', x + 10, y + 18);
  else for (let i = 1; i < level; i++) R(g, x + 4 + i * 4, y + 19, 3, 2, C.yellow);
}

// ----- enemies: 8x8 maps scaled up -----
const MAPS = {
  slime: ['........', '..0000..', '.066660.', '06c66c60', '06066060', '06655660', '.000000.', '........'],
  runner: ['..000...', '.03330..', '03c3c30.', '0333330.', '.03330..', '.03.030.', '.0...0..', '........'],
  splitter: ['.000000.', '01111110', '01c11c10', '01011010', '01122110', '01111110', '.011110.', '..0000..'],
  knight: ['..0000..', '.0dddd0.', '.0d00d0.', '.0dddd0.', '0edddde0', '0edeede0', '.0e00e0.', '..0..0..'],
  healer: ['...00...', '..0cc0..', '.0c22c0.', '0c2222c0', '0cc22cc0', '.0cccc0.', '..0000..', '........'],
  mini: ['.000.', '06560', '0c6c0', '06660', '.000.'],
  goblin: ['..0..0..', '.050050.', '.055550.', '.5c55c5.', '0455554.', '04444440', '.044440.', '..0..0..'],
  boss: ['..0000..', '.022220.', '02c22c20', '02022020', '02222220', '02344320', '.022220.', '0.0..0.0'],
  king: ['.4.44.4.', '.444444.', '02222220', '02c22c20', '02022020', '02344320', '.022220.', '0.0..0.0'],
};
export const ENEMY_COLOR = {
  slime: C.green, runner: C.orange, splitter: C.plum, knight: C.silver, healer: C.white, mini: C.lime, goblin: C.yellow, boss: C.red, king: C.red,
};
const SCALE = { boss: 3, king: 4 };

function makeSprite(map, scale, mono) {
  const h = map.length, w = map[0].length;
  const cv = document.createElement('canvas');
  cv.width = w * scale; cv.height = h * scale;
  const g = cv.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      if (ch === '.') continue;
      g.fillStyle = mono || PAL[parseInt(ch, 16)];
      g.fillRect(x * scale, y * scale, scale, scale);
      // fake volume: lighter top-left pixel of each block, darker bottom row
      if (!mono && scale > 1 && ch !== '0') {
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(x * scale, y * scale, 1, 1);
      }
    }
  }
  return cv;
}

export const SPRITES = {};
export const FLASH = {};
export const FROZEN = {};
for (const k of Object.keys(MAPS)) {
  SPRITES[k] = makeSprite(MAPS[k], SCALE[k] || 2);
  FLASH[k] = makeSprite(MAPS[k], SCALE[k] || 2, C.white);
  FROZEN[k] = makeSprite(MAPS[k], SCALE[k] || 2, 'rgba(115,239,247,0.55)');
}

// ----- map objects (cached canvases) -----
function canvasOf(w, h, fn) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  fn(cv.getContext('2d'));
  return cv;
}
// Trees and rocks per season. Leaves: [highlight, light, mid, dark].
const SEASON_LOOK = {
  spring: { leaf: ['#c7f59a', C.lime, C.green, C.teal], pine: [C.lime, C.green, C.teal], dots: ['#f4b6d2', C.white], fruit: null, snow: false },
  summer: { leaf: [C.lime, C.green, C.teal, '#1e4f4a'], pine: [C.green, C.teal, '#1e4f4a'], dots: null, fruit: C.red, snow: false },
  autumn: { leaf: [C.yellow, C.orange, C.red, C.plum], pine: [C.green, C.teal, '#1e4f4a'], dots: [C.yellow], fruit: null, snow: false },
  winter: { leaf: null, pine: ['#dfeef5', C.silver, C.slate], dots: null, fruit: null, snow: true },
};

// bare branches for winter deciduous trees
function bareTree(g, cx, base) {
  cyl(g, cx, base, 2, 12, WOOD);
  const br = [[-1, -12, -7, -20], [1, -13, 6, -22], [0, -16, -3, -26], [0, -16, 4, -27], [-1, -9, -9, -14], [1, -10, 9, -16]];
  for (const [x0, y0, x1, y1] of br) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) R(g, cx + x0 + ((x1 - x0) * i) / n, base + y0 + ((y1 - y0) * i) / n, 1, 1, WOOD[1]);
    R(g, cx + x1 - 1, base + y1 - 1, 3, 1, C.white); // snow on twig tips
  }
}

function buildTrees(look) {
  const dots = (g, cx, cy, r, n) => {
    if (!look.dots) return;
    for (let i = 0; i < n; i++) {
      const a = (i * 2.4) % 6.28, d = ((i * 37) % 10) / 10 * r;
      R(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 1, look.dots[i % look.dots.length]);
    }
  };
  return [
    canvasOf(28, 36, (g) => {
      ellipse(g, 15, 33, 10, 3, 'rgba(0,0,0,0.3)');
      if (!look.leaf) return bareTree(g, 14, 32);
      cyl(g, 14, 32, 2, 9, WOOD);
      sphere(g, 9, 19, 7, look.leaf); sphere(g, 19, 18, 7, look.leaf); sphere(g, 14, 12, 8, look.leaf);
      dots(g, 14, 16, 9, 10);
    }),
    canvasOf(28, 38, (g) => {
      ellipse(g, 15, 35, 9, 3, 'rgba(0,0,0,0.3)');
      cyl(g, 14, 34, 2, 6, WOOD);
      cone(g, 14, 30, 11, 10, look.pine);
      cone(g, 14, 22, 9, 9, look.pine);
      cone(g, 14, 15, 6, 9, look.snow ? [C.white, '#dfeef5', C.silver] : [look.pine[0], look.pine[1], look.pine[2]]);
      if (look.snow) { R(g, 6, 29, 6, 1, C.white); R(g, 16, 28, 7, 1, C.white); R(g, 8, 21, 5, 1, C.white); R(g, 16, 20, 5, 1, C.white); }
    }),
    canvasOf(28, 34, (g) => {
      ellipse(g, 15, 31, 10, 3, 'rgba(0,0,0,0.3)');
      if (!look.leaf) return bareTree(g, 14, 30);
      cyl(g, 14, 30, 2, 8, WOOD);
      sphere(g, 14, 15, 10, look.leaf);
      if (look.fruit) { R(g, 10, 12, 2, 2, look.fruit); R(g, 17, 17, 2, 2, look.fruit); R(g, 12, 19, 2, 2, look.fruit); }
      dots(g, 14, 15, 9, 12);
    }),
  ];
}

function buildRocks(snow) {
  const cap = (g, cx, cy, r) => { if (snow) { ellipse(g, cx - 1, cy - r + 2, r - 1, 2, C.white); } };
  return [
    canvasOf(24, 20, (g) => {
      ellipse(g, 13, 17, 10, 3, 'rgba(0,0,0,0.3)');
      sphere(g, 10, 11, 7, [C.white, C.silver, C.slate, C.dark]); cap(g, 10, 11, 7);
      sphere(g, 16, 13, 5, [C.white, C.silver, C.slate, C.dark]); cap(g, 16, 13, 5);
    }),
    canvasOf(24, 20, (g) => {
      ellipse(g, 12, 17, 9, 3, 'rgba(0,0,0,0.3)');
      sphere(g, 12, 11, 7, [C.silver, C.slate, C.dark, C.ink]);
      if (snow) cap(g, 12, 11, 7); else { R(g, 9, 7, 3, 2, C.green); R(g, 12, 6, 2, 1, C.lime); }
    }),
    canvasOf(24, 20, (g) => {
      ellipse(g, 12, 17, 10, 3, 'rgba(0,0,0,0.3)');
      sphere(g, 8, 13, 5, [C.white, C.silver, C.slate, C.dark]); cap(g, 8, 13, 5);
      sphere(g, 15, 10, 6, [C.white, C.silver, C.slate, C.dark]); cap(g, 15, 10, 6);
    }),
  ];
}

const OBSTACLE_SPR = Object.fromEntries(Object.entries(SEASON_LOOK).map(([k, look]) => [k, { tree: buildTrees(look), rock: buildRocks(look.snow) }]));

export function drawObstacle(g, o, x, y, season = 'summer') {
  const set = OBSTACLE_SPR[season] || OBSTACLE_SPR.summer;
  const spr = set[o.kind][o.v % 3];
  g.drawImage(spr, x + Math.round((24 - spr.width) / 2), y + 23 - spr.height);
}

const BARREL_SPR = canvasOf(16, 20, (g) => {
  ellipse(g, 9, 18, 7, 2, 'rgba(0,0,0,0.3)');
  cyl(g, 8, 16, 6, 11, [C.orange, C.red, C.plum], C.red);
  R(g, 2, 8, 12, 1, C.dark); R(g, 2, 13, 12, 1, C.dark);
  R(g, 6, 9, 3, 3, C.yellow); R(g, 7, 10, 1, 1, C.ink);
});
export function drawBarrel(g, x, y, ready, t) {
  g.globalAlpha = ready ? 1 : 0.35;
  g.drawImage(BARREL_SPR, x + 4, y + 4);
  g.globalAlpha = 1;
  if (ready && (t >> 2) % 2) { R(g, x + 12, y + 2, 2, 2, C.yellow); R(g, x + 13, y + 0, 1, 2, C.orange); }
}

export function drawWall(g, w, t) {
  const x = Math.round(w.x - 12), y = Math.round(w.y - 12);
  ellipse(g, x + 12, y + 20, 11, 3, 'rgba(0,0,0,0.35)');
  for (let i = 0; i < 4; i++) {
    cyl(g, x + 4 + i * 5, y + 19, 2, 12 + (i % 2) * 3, WOOD, '#c28569');
    R(g, x + 3 + i * 5, y + 4 - (i % 2) * 3 + 3, 2, 2, C.silver);
  }
  R(g, x + 1, y + 12, 22, 2, WOOD[2]);
  const hp = Math.max(0, w.hp / w.max);
  R(g, x + 2, y - 2, 20, 3, C.ink);
  R(g, x + 3, y - 1, Math.round(18 * hp), 1, hp > 0.4 ? C.yellow : C.red);
  void t;
}

export function drawCoin(g, x, y, t, blink) {
  if (blink && (t >> 1) % 2) return;
  const w = [4, 3, 1, 3][(t >> 2) % 4];
  const yy = Math.round(y - 4 + Math.sin(t * 0.2) * 2);
  ellipse(g, x, y + 3, 4, 1, 'rgba(0,0,0,0.3)');
  R(g, x - w, yy - 4, w * 2, 8, C.orange);
  R(g, x - w, yy - 4, Math.max(1, w * 2 - 1), 7, C.yellow);
  if (w > 2) R(g, x - 1, yy - 2, 1, 3, C.white);
}

export function drawChest(g, x, y) {
  box(g, x - 7, y + 4, 14, 7, 4, GOLD);
  R(g, x - 1, y - 3, 2, 3, C.ink);
}

export function drawCastle(g, x, y) {
  // occupies the castle tile, rises above it
  ellipse(g, x + 12, y + 22, 16, 4, 'rgba(0,0,0,0.35)');
  box(g, x - 2, y + 22, 28, 14, 6, STONE);
  for (const ox of [-4, 20]) { cyl(g, x + ox + 4, y + 22, 5, 22, STONE); cone(g, x + ox + 4, y, 6, 9, ROOF); }
  R(g, x + 8, y + 12, 8, 10, C.ink);
  ellipse(g, x + 12, y + 12, 4, 2, C.ink);
  R(g, x + 12, y - 20, 1, 12, C.dark);
  R(g, x + 13, y - 20, 7, 4, C.red);
}

export function drawCave(g, x, y) {
  sphere(g, x + 4, y + 10, 12, [C.slate, C.dark, '#262b44', C.ink]);
  ellipse(g, x + 6, y + 14, 7, 7, C.ink);
}

// Tiny 3x5 bitmap font for numbers in the HUD and floating damage.
const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
  '+': '000010111010000', '-': '000000111000000', '/': '001001010100100', ':': '000010000010000', x: '000101010101000',
  '!': '010010010000010', ' ': '000000000000000',
};
export function drawNum(g, str, x, y, color, scale = 1, outline = null) {
  str = String(str);
  if (outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) drawNum(g, str, x + dx, y + dy, outline, scale);
  }
  g.fillStyle = color;
  let cx = Math.round(x);
  for (const ch of str) {
    const gl = GLYPHS[ch];
    if (gl) {
      for (let i = 0; i < 15; i++) {
        if (gl[i] === '1') g.fillRect(cx + (i % 3) * scale, Math.round(y) + Math.floor(i / 3) * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
}
export function numWidth(str, scale = 1) {
  return String(str).length * 4 * scale - scale;
}

export function drawIcon(g, name, x, y) {
  const icons = {
    heart: ['.22.22.', '2222222', '2c22222', '.22222.', '..222..', '...2...'],
    coin: ['.444.', '44c44', '44344', '44344', '.444.'],
    skull: ['.ccc.', 'c0c0c', 'ccccc', '.c.c.'],
    flag: ['22220', '22220', '22220', '0....', '0....', '0....'],
    star: ['..4..', '.444.', '44444', '.4.4.'],
  };
  const m = icons[name];
  for (let j = 0; j < m.length; j++) {
    for (let i = 0; i < m[j].length; i++) {
      if (m[j][i] === '.') continue;
      g.fillStyle = PAL[parseInt(m[j][i], 16)];
      g.fillRect(x + i, y + j, 1, 1);
    }
  }
}
