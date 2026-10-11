// Neutral wildlife: pure decoration living in the renderer (not in the sim, so never synced or blocking).
// Cows graze and moo, deer wander and bolt from monsters, frogs sit by the ponds and hop.
import { TILE, COLS, ROWS } from './sim/data.js';

const COLORS = {
  B: '#a8805e', H: '#8a6248', L: '#5a3e2c', b: '#5a3e2c', w: '#f4f4f4', n: '#1a1c2c',
  W: '#f4f4f4', K: '#333c57', h: '#ffcd75', p: '#ef7d57',
  G: '#38b764', g: '#a7f070', e: '#1a1c2c', l: '#257179',
};
const MAPS = {
  deer: [
    ['..........b.b', '...........b.', '..........HHn', '.BBBBBBBBBH..', 'BBBBBBBBBB...', '.BwBBBBBB....', '.L.L...L.L...', '.L.L...L.L...'],
    ['..........b.b', '...........b.', '..........HHn', '.BBBBBBBBBH..', 'BBBBBBBBBB...', '.BwBBBBBB....', '..L.L...L.L..', '.L...L.L...L.'],
    ['.............', '.............', '.............', '.BBBBBBBBB...', 'BBBBBBBBBBH.b', '.BwBBBBBBHHbb', '.L.L...L.LHn.', '.L.L...L.L...'],
  ],
  cow: [
    ['...........hh.', '..........WWWW', 'WWKKWWWWWWWKWp', 'WWWWKKWWWWWWW.', 'WKKWWWWWKKWW..', '.WWWWWWWWWW...', '.L.L....L.L...', '.L.L....L.L...'],
    ['...........hh.', '..........WWWW', 'WWKKWWWWWWWKWp', 'WWWWKKWWWWWWW.', 'WKKWWWWWKKWW..', '.WWWWWWWWWW...', '..L.L....L.L..', '.L...L..L...L.'],
    ['..............', '..............', 'WWKKWWWWWWW...', 'WWWWKKWWWWWW..', 'WKKWWWWWKKWWhh', '.WWWWWWWWWWWWW', '.L.L....L.LWKp', '.L.L....L.L...'],
  ],
  frog: [
    ['.e...e.', 'GGGGGGG', 'GgGGGgG', 'GGGGGGG', 'l.....l'],
    ['.......', 'GGGGGGG', 'GgGGGgG', 'GGGGGGG', 'l.....l'], // blink
    ['.e...e.', 'GGGGGGG', 'GgGGGgG', 'lGGGGGl', 'l.....l'], // legs out mid-hop
  ],
};

function sprite(rows, flip) {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length; cv.height = rows.length;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = COLORS[row[x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(flip ? row.length - 1 - x : x, y, 1, 1);
    }
  });
  return cv;
}
// SPR[kind][frame][0 = facing right, 1 = facing left]
const SPR = Object.fromEntries(Object.entries(MAPS).map(([k, frames]) => [k, frames.map((f) => [sprite(f, false), sprite(f, true)])]));

const KIND = {
  cow: { speed: 6, run: 14, roam: 2, say: ['Му!', 'Мууу…', 'Му?'], poke: ['МУУУ!', 'Ей!'] },
  deer: { speed: 12, run: 70, roam: 3, say: [], poke: [] },
  frog: { speed: 0, run: 0, roam: 1.5, say: ['ква', 'ква-ква'], poke: ['КВА!'] },
};
const rnd = (a, b) => a + Math.random() * (b - a);

export class Critters {
  constructor() {
    this.list = [];
    this.map = null;
    this.jumps = []; // fish leaping out of ponds
    this.fishT = 2;
  }

  grass(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return false;
    const k = tx + ',' + ty;
    if (this.map.tiles.has(k) || this.map.water.has(k)) return false;
    return !(this.map.castle && Math.abs(tx - this.map.castle[0]) <= 1 && Math.abs(ty - this.map.castle[1]) <= 1);
  }

  nearWater(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.map.water.has(tx + dx + ',' + (ty + dy))) return true;
    return false;
  }

  randomSpot(pred = () => true) {
    for (let i = 0; i < 300; i++) {
      const x = rnd(8, COLS * TILE - 8), y = rnd(8, ROWS * TILE - 8);
      if (this.grass(x, y) && pred(x, y)) return { x, y };
    }
    return null;
  }

  reset(map) {
    this.map = map;
    this.list = [];
    this.jumps = [];
    this.fishT = rnd(1, 3);
    const add = (kind, at) => at && this.list.push({ kind, x: at.x, y: at.y, state: 'idle', t: rnd(0.5, 3), dir: Math.random() < 0.5 ? 1 : -1, hop: 0, frame: 0, say: null, sayT: 0, flee: 0 });
    // a small herd of cows around one spot
    const herd = this.randomSpot();
    for (let i = 0; i < 3 && herd; i++) add('cow', this.randomSpot((x, y) => Math.hypot(x - herd.x, y - herd.y) < 50) || herd);
    for (let i = 0; i < 3; i++) add('deer', this.randomSpot());
    const wet = this.map.water.size > 0;
    for (let i = 0; i < 4; i++) add('frog', this.randomSpot(wet ? (x, y) => this.nearWater(x, y) : undefined));
  }

  talk(c, lines) {
    if (!lines.length) return;
    c.say = lines[Math.floor(Math.random() * lines.length)];
    c.sayT = 1.4;
  }

  // Pick a reachable grass point nearby (straight path must not cross road or water).
  target(c, dist, awayFrom) {
    for (let i = 0; i < 12; i++) {
      let a = Math.random() * Math.PI * 2;
      if (awayFrom) a = Math.atan2(c.y - awayFrom.y, c.x - awayFrom.x) + rnd(-0.7, 0.7);
      const d = rnd(dist * 0.4, dist) * TILE;
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      let ok = this.grass(x, y);
      for (let k = 1; ok && k < 6; k++) ok = this.grass(c.x + ((x - c.x) * k) / 6, c.y + ((y - c.y) * k) / 6);
      if (ok) return { x, y };
    }
    return null;
  }

  update(dt, enemies) {
    this.updateFish(dt);
    for (const c of this.list) {
      const K = KIND[c.kind];
      c.t -= dt;
      if (c.sayT > 0) c.sayT -= dt;
      // deer bolt from nearby monsters
      if (c.kind === 'deer' && c.state !== 'flee') {
        const m = enemies.find((e) => Math.hypot(e.x - c.x, e.y - c.y) < 42);
        if (m) this.scare(c, m);
      }
      if (c.kind === 'frog') this.updateFrog(c, dt);
      else if (c.state === 'walk' || c.state === 'flee') {
        const sp = c.state === 'flee' ? K.run : K.speed;
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        if (d < 1 || c.t <= 0) { c.state = Math.random() < 0.6 ? 'graze' : 'idle'; c.t = rnd(2, 6); }
        else {
          c.x += (dx / d) * sp * dt; c.y += (dy / d) * sp * dt;
          c.dir = dx >= 0 ? 1 : -1;
          c.frame = Math.floor(performance.now() / (c.state === 'flee' ? 90 : 220)) % 2;
        }
      } else if (c.t <= 0) {
        if (Math.random() < 0.15) this.talk(c, K.say);
        const to = Math.random() < 0.7 && this.target(c, K.roam);
        if (to) { c.state = 'walk'; c.tx = to.x; c.ty = to.y; c.t = 8; }
        else { c.state = Math.random() < 0.5 ? 'graze' : 'idle'; c.t = rnd(2, 5); }
      }
    }
  }

  // Every few seconds a fish leaps out of a random pond tile, flips in the air and splashes back.
  updateFish(dt) {
    for (const j of this.jumps) j.t += dt;
    this.jumps = this.jumps.filter((j) => j.t < j.dur + 0.6);
    if (!this.map.water.size) return;
    this.fishT -= dt;
    if (this.fishT > 0) return;
    this.fishT = rnd(1.5, 4.5);
    const tiles = [...this.map.water];
    const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)].split(",").map(Number);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x = tx * TILE + rnd(6, TILE - 6), y = ty * TILE + rnd(8, TILE - 4);
    const to = x + dir * rnd(8, 16);
    // land back in water (or stay in place if the leap would leave the pond)
    const back = this.map.water.has(Math.floor(to / TILE) + "," + ty) ? to : x;
    this.jumps.push({ x, y, x2: back, t: 0, dur: rnd(0.55, 0.8), h: rnd(9, 15), dir: back >= x ? 1 : -1, gold: Math.random() < 0.15 });
  }

  drawFish(g) {
    for (const j of this.jumps) {
      const k = Math.min(1, j.t / j.dur);
      // splash rings where it left and where it lands
      for (const [sx, st] of [[j.x, j.t], [j.x2, j.t - j.dur]]) {
        if (st < 0 || st > 0.6) continue;
        const r = 2 + st * 10;
        g.globalAlpha = 1 - st / 0.6;
        g.fillStyle = "#f4f4f4";
        g.fillRect(Math.round(sx - r), Math.round(j.y), 2, 1);
        g.fillRect(Math.round(sx + r - 1), Math.round(j.y), 2, 1);
        if (st < 0.15) { g.fillRect(Math.round(sx - 1), Math.round(j.y - 3 - st * 20), 1, 2); g.fillRect(Math.round(sx + 2), Math.round(j.y - 2 - st * 16), 1, 2); }
        g.globalAlpha = 1;
      }
      if (k >= 1) continue;
      const x = j.x + (j.x2 - j.x) * k, y = j.y - Math.sin(k * Math.PI) * j.h;
      const tilt = k < 0.5 ? -1 : 1; // nose up, then nose down
      const body = j.gold ? "#ffcd75" : "#94b0c2", belly = j.gold ? "#ef7d57" : "#f4f4f4";
      for (let i = 0; i < 6; i++) {
        const px = Math.round(x + (i - 3) * j.dir), py = Math.round(y + (i - 3) * tilt * 0.5);
        g.fillStyle = i === 0 ? "#566c86" : body;
        g.fillRect(px, py, 1, 2);
        if (i > 1 && i < 5) { g.fillStyle = belly; g.fillRect(px, py + 1, 1, 1); }
      }
      g.fillStyle = "#1a1c2c";
      g.fillRect(Math.round(x + 2 * j.dir), Math.round(y + 2 * tilt * 0.5), 1, 1);
    }
  }

  updateFrog(c, dt) {
    if (c.state === 'hop') {
      c.hopT += dt;
      const k = Math.min(1, c.hopT / c.hopDur);
      c.x = c.fx + (c.tx - c.fx) * k;
      c.y = c.fy + (c.ty - c.fy) * k;
      c.hop = Math.sin(k * Math.PI) * c.hopH;
      if (k >= 1) { c.state = 'idle'; c.hop = 0; c.t = rnd(1.5, 4); }
      return;
    }
    c.frame = Math.floor(performance.now() / 120 + c.x) % 40 === 0 ? 1 : 0; // occasional blink
    if (c.t <= 0) {
      if (Math.random() < 0.25) this.talk(c, KIND.frog.say);
      this.hopTo(c, KIND.frog.roam, 8);
    }
  }

  hopTo(c, dist, height) {
    const to = this.target(c, dist);
    if (!to) { c.t = rnd(1, 3); return; }
    Object.assign(c, { state: 'hop', fx: c.x, fy: c.y, tx: to.x, ty: to.y, hopT: 0, hopDur: 0.35 + dist * 0.05, hopH: height });
    c.dir = to.x >= c.x ? 1 : -1;
  }

  scare(c, from) {
    const to = this.target(c, 4, from);
    if (!to) return;
    Object.assign(c, { state: 'flee', tx: to.x, ty: to.y, t: 3 });
  }

  // Click reaction; returns true if a critter was hit.
  poke(x, y) {
    const c = this.list.find((k) => Math.hypot(k.x - x, k.y - 4 - y) < 10);
    if (!c) return false;
    if (c.kind === 'cow') { this.talk(c, KIND.cow.poke); c.state = 'idle'; c.t = 1; c.hopKick = 0.25; }
    if (c.kind === 'deer') this.scare(c, { x, y });
    if (c.kind === 'frog') { this.talk(c, KIND.frog.poke); this.hopTo(c, 2.5, 16); }
    return true;
  }

  draw(g, c) {
    const grazing = c.state === 'graze' && Math.floor(performance.now() / 900 + c.x) % 3 !== 0;
    const frame = c.kind === 'frog' ? (c.state === 'hop' ? 2 : c.frame) : grazing ? 2 : c.state === 'walk' || c.state === 'flee' ? c.frame : 0;
    const spr = SPR[c.kind][frame][c.dir > 0 ? 0 : 1];
    let lift = c.hop || 0;
    if (c.hopKick > 0) { c.hopKick -= 0.016; lift = 3; }
    const x = Math.round(c.x - spr.width / 2), y = Math.round(c.y - spr.height - lift);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(Math.round(c.x - spr.width / 2.6), Math.round(c.y), Math.round(spr.width / 1.3), 2);
    g.drawImage(spr, x, y);
    if (c.sayT > 0 && c.say) {
      g.font = '8px "Pixelify Sans", monospace';
      const w = Math.ceil(g.measureText(c.say).width);
      g.fillStyle = '#1a1c2c';
      g.fillText(c.say, Math.round(c.x - w / 2) + 1, y - 2);
      g.fillStyle = '#f4f4f4';
      g.fillText(c.say, Math.round(c.x - w / 2), y - 3);
    }
  }
}
