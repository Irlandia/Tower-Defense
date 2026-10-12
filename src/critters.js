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
// Fish model 12x8 (faces right): body with scale highlights, pale belly, fins, forked tail, eye.
const FISH_MAP = [
  "....ff......",
  "..BBBBBB...T",
  ".BBsBBsBB.TT",
  "BeBBBBBBBBTT",
  "BBBBsBBBBTTT",
  ".bbbbbbbb.TT",
  "..bbbbbb...T",
  "....f.......",
];
const FISH = [
  { B: "#94b0c2", s: "#f4f4f4", b: "#f4f4f4", f: "#566c86", T: "#566c86", e: "#1a1c2c" },
  { B: "#ffcd75", s: "#f4f4f4", b: "#fff4d6", f: "#ef7d57", T: "#ef7d57", e: "#1a1c2c" },
].map((pal) => {
  const cv = document.createElement("canvas");
  cv.width = 12; cv.height = 8;
  const g = cv.getContext("2d");
  FISH_MAP.forEach((row, y) => { for (let x = 0; x < 12; x++) if (pal[row[x]]) { g.fillStyle = pal[row[x]]; g.fillRect(x, y, 1, 1); } });
  return cv;
});

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
    this.sparks = []; // golden fish glitter
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

  reset(map, season = "summer") {
    this.map = map;
    this.season = season;
    this.initFarm(map);
    this.iceFish = [];
    this.list = [];
    this.jumps = [];
    this.sparks = [];
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
    this.updateFarm(dt);
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

  // Every few seconds a fish leaps out of a random pond tile, arcs through the air and splashes back.
  updateFish(dt) {
    if (this.season === "winter") { this.updateIceFish(dt); return; }
    for (const j of this.jumps) j.t += dt;
    this.jumps = this.jumps.filter((j) => j.t < j.dur + 0.6);
    for (const p of this.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; p.life -= dt; }
    this.sparks = this.sparks.filter((p) => p.life > 0);
    if (!this.map.water.size) return;
    this.fishT -= dt;
    if (this.fishT > 0) return;
    this.fishT = rnd(1.5, 4.5);
    const tiles = [...this.map.water];
    const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)].split(',').map(Number);
    this.leap(tx * TILE + rnd(6, TILE - 6), ty * TILE + rnd(8, TILE - 4));
  }

  // Start a jump from (x, y); lands back in the water (or in place if the arc would leave the pond).
  leap(x, y, opts = {}) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const to = x + dir * rnd(10, 20);
    const ty = Math.floor(y / TILE);
    const back = this.map.water.has(Math.floor(to / TILE) + ',' + ty) ? to : x;
    this.jumps.push({ x, y, x2: back, t: 0, dur: rnd(0.6, 0.85), h: rnd(10, 16), dir: back >= x ? 1 : -1, gold: Math.random() < 0.12, spin: 0, ...opts });
  }

  fishPos(j) {
    const k = Math.min(1, j.t / j.dur);
    return { k, x: j.x + (j.x2 - j.x) * k, y: j.y - Math.sin(k * Math.PI) * j.h };
  }

  // Click on a leaping fish: it gets flicked high with a spin and complains; golden fish showers sparkles.
  // Click on empty water: a curious fish pops out.
  pokeFish(x, y) {
    if (this.season === "winter") return this.pokeIce(x, y);
    for (const j of this.jumps) {
      const p = this.fishPos(j);
      if (p.k >= 1 || j.smacked || Math.hypot(p.x - x, p.y - y) > 10) continue;
      const tiles = [...this.map.water];
      const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)].split(',').map(Number);
      Object.assign(j, { x: p.x, y: p.y, x2: tx * TILE + 12, t: 0, dur: 1.4, h: 46, smacked: true, spin: (Math.random() < 0.5 ? -1 : 1) * 14 });
      j.y2 = ty * TILE + 14;
      const lines = j.gold ? ['Три бажання? Ні, сам працюй!', 'Я золота, а не банкомат!', 'Бажання: щоб ти не клацав.'] : ['БУЛЬ!', 'Я ж риба!', 'Ай, мокро!', 'Ей! Я пливла!', 'Бульк-бульк!'];
      j.say = lines[Math.floor(Math.random() * lines.length)];
      if (j.gold) for (let i = 0; i < 24; i++) this.sparks.push({ x: p.x, y: p.y, vx: rnd(-50, 50), vy: rnd(-70, -10), life: rnd(0.5, 1), c: Math.random() < 0.5 ? '#ffcd75' : '#f4f4f4' });
      return true;
    }
    if (this.map.water.has(Math.floor(x / TILE) + ',' + Math.floor(y / TILE))) {
      this.leap(x, y, { say: '?', h: 8 });
      return true;
    }
    return false;
  }

  drawFish(g) {
    if (this.season === "winter") { this.drawIceFish(g); return; }
    for (const j of this.jumps) {
      const land = j.y2 ?? j.y;
      // splash rings where it left and where it lands
      for (const [sx, sy, st] of [[j.x, j.y, j.t], [j.x2, land, j.t - j.dur]]) {
        if (st < 0 || st > 0.6) continue;
        const r = 2 + st * 10;
        g.globalAlpha = 1 - st / 0.6;
        g.fillStyle = '#f4f4f4';
        g.fillRect(Math.round(sx - r), Math.round(sy), 2, 1);
        g.fillRect(Math.round(sx + r - 1), Math.round(sy), 2, 1);
        if (st < 0.15) { g.fillRect(Math.round(sx - 1), Math.round(sy - 3 - st * 20), 1, 2); g.fillRect(Math.round(sx + 2), Math.round(sy - 2 - st * 16), 1, 2); }
        g.globalAlpha = 1;
      }
      const k = Math.min(1, j.t / j.dur);
      if (k >= 1) continue;
      const x = j.x + (j.x2 - j.x) * k;
      const y = j.y + (land - j.y) * k - Math.sin(k * Math.PI) * j.h;
      // nose follows the arc; flicked fish spin
      const slope = Math.cos(k * Math.PI) * j.h * Math.PI;
      const ang = j.spin ? j.t * j.spin : Math.atan2(-slope, Math.abs(j.x2 - j.x) * 4 + 1);
      g.save();
      g.translate(Math.round(x), Math.round(y));
      g.rotate(ang * j.dir);
      g.scale(j.dir, 1);
      g.drawImage(FISH[j.gold ? 1 : 0], -6, -4);
      g.restore();
      if (j.say && j.t < 1.2) {
        g.font = '8px "Pixelify Sans", monospace';
        const w = Math.ceil(g.measureText(j.say).width);
        g.fillStyle = '#1a1c2c';
        g.fillText(j.say, Math.round(x - w / 2) + 1, Math.round(y - 9));
        g.fillStyle = j.gold ? '#ffcd75' : '#f4f4f4';
        g.fillText(j.say, Math.round(x - w / 2), Math.round(y - 10));
      }
    }
    for (const p of this.sparks) {
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
  }

  // Winter: fish frozen under the ice, slowly turning and staring up at you.
  updateIceFish(dt) {
    if (!this.iceFish.length && this.map.water.size) {
      const tiles = [...this.map.water];
      for (let i = 0; i < Math.min(4, tiles.length); i++) {
        const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)].split(",").map(Number);
        this.iceFish.push({ x: tx * TILE + rnd(6, 18), y: ty * TILE + rnd(8, 18), dir: Math.random() < 0.5 ? 1 : -1, t: rnd(0, 6), bonk: 0, say: null, sayT: 0, gold: Math.random() < 0.15 });
      }
    }
    for (const f of this.iceFish) {
      f.t += dt;
      if (f.bonk > 0) f.bonk -= dt;
      if (f.sayT > 0) f.sayT -= dt;
      if (Math.random() < dt * 0.15) f.dir = -f.dir; // slowly turns around
    }
  }

  pokeIce(x, y) {
    const f = this.iceFish.find((k) => Math.hypot(k.x - x, k.y - y) < 9);
    if (f) {
      f.bonk = 0.4; f.sayT = 1.4;
      f.say = f.gold ? ["Відтань мене — дам бажання!", "Холодно, але я золота!"][Math.floor(Math.random() * 2)] : ["Тук-тук!", "Випусти!", "Буль… ой, лід", "Мені й тут добре"][Math.floor(Math.random() * 4)];
      return true;
    }
    if (this.map.water.has(Math.floor(x / TILE) + "," + Math.floor(y / TILE))) {
      this.iceFish.push({ x, y, dir: 1, t: 0, bonk: 0.3, say: "Хрусь!", sayT: 0.8, gold: false, crack: true, life: 0.8 });
      return true;
    }
    return false;
  }

  drawIceFish(g) {
    this.iceFish = this.iceFish.filter((f) => !f.crack || f.sayT > 0);
    for (const f of this.iceFish) {
      if (!f.crack) {
        const wob = f.bonk > 0 ? Math.round(Math.sin(f.bonk * 40) * 2) : 0;
        g.save();
        g.globalAlpha = 0.55; // seen through the ice
        g.translate(Math.round(f.x) + wob, Math.round(f.y));
        g.scale(f.dir, 1);
        g.drawImage(FISH[f.gold ? 1 : 0], -6, -4);
        g.restore();
        // big staring eye, blinking now and then
        if (Math.floor(f.t * 2) % 9 !== 0) { g.fillStyle = "#1a1c2c"; g.fillRect(Math.round(f.x) + wob + (f.dir > 0 ? 3 : -4), Math.round(f.y) - 1, 1, 1); }
      } else {
        g.fillStyle = "#f4f4f4";
        for (let i = -3; i <= 3; i++) g.fillRect(Math.round(f.x + i * 1.5), Math.round(f.y + ((i * 5) % 3) - 1), 1, 1);
      }
      if (f.sayT > 0 && f.say) {
        g.font = "8px \"Pixelify Sans\", monospace";
        const w = Math.ceil(g.measureText(f.say).width);
        g.fillStyle = "#1a1c2c"; g.fillText(f.say, Math.round(f.x - w / 2) + 1, Math.round(f.y - 7));
        g.fillStyle = f.gold ? "#ffcd75" : "#29366f"; g.fillText(f.say, Math.round(f.x - w / 2), Math.round(f.y - 8));
      }
    }
  }

  updateFrog(c, dt) {
    if (this.season === "winter") { c.state = "sleep"; return; } // frogs hibernate
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
    if (this.pokeFarm(x, y)) return true;
    if (this.pokeFish(x, y)) return true;
    const c = this.list.find((k) => Math.hypot(k.x - x, k.y - 4 - y) < 10);
    if (!c) return false;
    if (c.kind === 'cow') { this.talk(c, KIND.cow.poke); c.state = 'idle'; c.t = 1; c.hopKick = 0.25; }
    if (c.kind === 'deer') this.scare(c, { x, y });
    if (c.kind === "frog" && this.season === "winter") { c.say = ["Хррр…", "Ще 5 хвилинок…", "Весною розбудиш!"][Math.floor(Math.random() * 3)]; c.sayT = 1.6; }
    else if (c.kind === "frog") { this.talk(c, KIND.frog.poke); this.hopTo(c, 2.5, 16); }
    return true;
  }

  draw(g, c) {
    const grazing = c.state === 'graze' && Math.floor(performance.now() / 900 + c.x) % 3 !== 0;
    const frame = c.kind === "frog" ? (c.state === "sleep" ? 1 : c.state === "hop" ? 2 : c.frame) : grazing ? 2 : c.state === 'walk' || c.state === 'flee' ? c.frame : 0;
    const spr = SPR[c.kind][frame][c.dir > 0 ? 0 : 1];
    let lift = c.hop || 0;
    if (c.hopKick > 0) { c.hopKick -= 0.016; lift = 3; }
    const x = Math.round(c.x - spr.width / 2), y = Math.round(c.y - spr.height - lift);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(Math.round(c.x - spr.width / 2.6), Math.round(c.y), Math.round(spr.width / 1.3), 2);
    g.drawImage(spr, x, y);
    if (c.state === "sleep") {
      // hibernating frog: snow cap and drifting "z"
      g.fillStyle = "#f4f4f4"; g.fillRect(x, y - 1, spr.width, 1);
      const k = Math.floor(performance.now() / 300 + c.x) % 8;
      g.fillStyle = "#29366f";
      g.fillRect(x + spr.width + 1, y - 3 - k, 3, 1); g.fillRect(x + spr.width + 2, y - 2 - k, 1, 1); g.fillRect(x + spr.width + 1, y - 1 - k, 3, 1);
    }
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

// ---------- the farm: a farmer working the field by season, and his dog ----------
const FARM_COL = { Y: '#ffcd75', y: '#e8b04a', s: '#f2c6a0', r: '#b13e53', b: '#3b5dc9', k: '#1a1c2c', d: '#a8805e', D: '#8a6248', n: '#1a1c2c', w: '#f4f4f4' };
const FARMER = {
  stand: ['..YYY..', '.yYYYy.', '..sss..', '..sks..', '.rrrrr.', 'rrbbbrr', 's.bbb.s', '..bbb..', '..b.b..', '..b.b..', '.kk.kk.'],
  walk: ['..YYY..', '.yYYYy.', '..sss..', '..sks..', '.rrrrr.', 'rrbbbrr', 's.bbb.s', '..bbb..', '..b.b..', '.b...b.', 'kk...kk'],
  work: ['.......', '..YYY..', '.yYYYy.', '..sss..', '..sks..', '.rrrrrs', 'rrbbbr.', '..bbb..', '..bbb..', '..b.b..', '.kk.kk.'],
};
const DOG = {
  stand: ['......dd.', '.....dDdn', 'd.dddddd.', '.ddddddd.', '.d.d..d.d'],
  run: ['......dd.', '.....dDdn', 'd.dddddd.', '.ddddddd.', 'd.d....dd'],
  eat: ['.........', '.........', 'd.dddddd.', '.dddddDdd', '.d.d..dnd'],
};
function farmSprite(rows, flip) {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length; cv.height = rows.length;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = FARM_COL[row[x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(flip ? row.length - 1 - x : x, y, 1, 1);
    }
  });
  return cv;
}
const FARM_SPR = {};
for (const [k, rows] of Object.entries(FARMER)) FARM_SPR['f_' + k] = [farmSprite(rows, false), farmSprite(rows, true)];
for (const [k, rows] of Object.entries(DOG)) FARM_SPR['d_' + k] = [farmSprite(rows, false), farmSprite(rows, true)];

const FARM_LINES = {
  spring: ['Посіємо — пожнемо!', 'Гарна весна видалась'],
  summer: ['Ох і спека…', 'Пий, капустонько!'],
  autumn: ['Ну й гарбуз!', 'Врожай — на славу'],
  winter: ['Знову намело…', 'Де моя лопата?'],
};
const FEED = ['Смачного, Бровко!', 'Хто тут хороший пес?', 'Тримай, друже!'];

Object.assign(Critters.prototype, {
  initFarm(map) {
    const f = map.farm;
    if (!f) { this.farm = null; return; }
    const T = TILE;
    const [fx, fy, fw, fh] = f.field;
    // work spots: along the field rows (in winter: in front of the house, shovelling)
    const spots = [];
    if (this.season === 'winter') for (let i = 0; i < 4; i++) spots.push({ x: f.house[0] * T + 8 + i * 10, y: (f.house[1] + 2) * T + 6 });
    else for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) spots.push({ x: fx * T + 10 + i * ((fw * T - 20) / 2), y: fy * T + 12 + r * ((fh * T - 20) / 2) });
    const home = { x: f.house[0] * T + 24, y: (f.house[1] + 2) * T + 4 };
    this.farm = {
      spots, home, sparks: [],
      farmer: { x: home.x, y: home.y, tx: home.x, ty: home.y, state: 'idle', t: rnd(1, 3), dir: 1, say: null, sayT: 0 },
      dog: { x: home.x + 10, y: home.y + 2, state: 'follow', t: 0, dir: 1, say: null, sayT: 0, jump: 0 },
      bowl: null,
    };
  },

  updateFarm(dt) {
    const F = this.farm;
    if (!F) return;
    const fm = F.farmer, dog = F.dog;
    for (const k of [fm, dog]) if (k.sayT > 0) k.sayT -= dt;
    for (const p of F.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.heart ? -10 : 50) * dt; p.life -= dt; }
    F.sparks = F.sparks.filter((p) => p.life > 0);
    // farmer: walk to a spot, work there, repeat (sometimes a break at home)
    fm.t -= dt;
    if (fm.state === 'walk') {
      const dx = fm.tx - fm.x, dy = fm.ty - fm.y, d = Math.hypot(dx, dy);
      if (d < 1) { fm.state = fm.toHome ? 'idle' : 'work'; fm.t = rnd(2.5, 4.5); }
      else { fm.x += (dx / d) * 10 * dt; fm.y += (dy / d) * 10 * dt; fm.dir = dx >= 0 ? 1 : -1; }
    } else if (fm.state === 'work') {
      this.workFx(fm, dt);
      if (fm.t <= 0) this.nextSpot(fm);
    } else if (fm.t <= 0) this.nextSpot(fm);
    // dog: eats at the bowl, else trots after the farmer, sometimes sits and sniffs
    if (dog.jump > 0) dog.jump -= dt;
    if (F.bowl) {
      const dx = F.bowl.x - 6 - dog.x, dy = F.bowl.y - dog.y, d = Math.hypot(dx, dy);
      if (d > 2) { dog.state = 'run'; dog.x += (dx / d) * 45 * dt; dog.y += (dy / d) * 45 * dt; dog.dir = dx >= 0 ? 1 : -1; }
      else {
        dog.state = 'eat';
        dog.dir = 1;
        F.bowl.t -= dt;
        if (Math.random() < dt * 4) F.sparks.push({ x: dog.x + 2, y: dog.y - 8, vx: rnd(-6, 6), vy: -12, life: 0.9, heart: true });
        if (F.bowl.t <= 0) { F.bowl = null; dog.say = 'Гав-гав!'; dog.sayT = 1.5; dog.jump = 0.4; dog.state = 'follow'; }
      }
    } else {
      const tx = F.farmer.x - F.farmer.dir * 12, ty = F.farmer.y + 3;
      const dx = tx - dog.x, dy = ty - dog.y, d = Math.hypot(dx, dy);
      dog.t -= dt;
      if (d > 14) { dog.state = 'run'; dog.x += (dx / d) * 30 * dt; dog.y += (dy / d) * 30 * dt; dog.dir = dx >= 0 ? 1 : -1; }
      else if (dog.t <= 0 || dog.state === 'run') {
        dog.state = Math.random() < 0.5 ? 'stand' : 'sniff';
        dog.t = rnd(1, 3);
        if (Math.random() < 0.15) { dog.say = 'Гав!'; dog.sayT = 1; }
      }
    }
  },

  nextSpot(fm) {
    const F = this.farm;
    const home = Math.random() < 0.15;
    const p = home ? F.home : F.spots[Math.floor(Math.random() * F.spots.length)];
    Object.assign(fm, { state: 'walk', tx: p.x, ty: p.y, toHome: home });
    if (Math.random() < 0.2) {
      const l = FARM_LINES[this.season] || FARM_LINES.summer;
      fm.say = l[Math.floor(Math.random() * l.length)];
      fm.sayT = 2;
    }
  },

  // little particles for the season's job: seeds, water, chaff, snow
  workFx(fm, dt) {
    const F = this.farm, s = this.season;
    if (Math.random() > dt * 8) return;
    const hx = fm.x + fm.dir * 5, hy = fm.y - 6;
    if (s === 'spring') F.sparks.push({ x: hx, y: hy, vx: fm.dir * rnd(8, 20), vy: rnd(-20, -5), life: 0.6, c: '#ffcd75' });
    if (s === 'summer') F.sparks.push({ x: hx + fm.dir * 3, y: hy + 2, vx: fm.dir * rnd(2, 6), vy: rnd(0, 10), life: 0.5, c: '#41a6f6' });
    if (s === 'autumn') F.sparks.push({ x: hx, y: fm.y, vx: rnd(-6, 6), vy: rnd(-15, -5), life: 0.5, c: Math.random() < 0.5 ? '#e8b04a' : '#ef7d57' });
    if (s === 'winter') F.sparks.push({ x: hx + fm.dir * 4, y: fm.y - 2, vx: fm.dir * rnd(15, 30), vy: rnd(-30, -15), life: 0.6, c: '#f4f4f4' });
  },

  // click: the farmer feeds the dog / the dog barks
  pokeFarm(x, y) {
    const F = this.farm;
    if (!F) return false;
    const fm = F.farmer, dog = F.dog;
    if (Math.hypot(fm.x - x, fm.y - 6 - y) < 9) {
      if (!F.bowl) {
        F.bowl = { x: fm.x + fm.dir * 8, y: fm.y + 2, t: 3 };
        fm.state = 'idle';
        fm.t = 3.5;
      }
      fm.say = FEED[Math.floor(Math.random() * FEED.length)];
      fm.sayT = 2;
      return true;
    }
    if (Math.hypot(dog.x - x, dog.y - 3 - y) < 7) { dog.say = 'Гав!'; dog.sayT = 1; dog.jump = 0.4; return true; }
    return false;
  },

  farmItems() {
    const F = this.farm;
    if (!F) return [];
    const out = [{ y: F.farmer.y, farmer: true }, { y: F.dog.y, dog: true }];
    if (F.bowl) out.push({ y: F.bowl.y - 1, bowl: true });
    return out;
  },

  drawFarm(g, it) {
    const F = this.farm;
    if (!F) return;
    const say = (k, x, y) => {
      if (!(k.sayT > 0) || !k.say) return;
      g.font = '8px "Pixelify Sans", monospace';
      const w = Math.ceil(g.measureText(k.say).width);
      g.fillStyle = '#1a1c2c'; g.fillText(k.say, Math.round(x - w / 2) + 1, y + 1);
      g.fillStyle = '#f4f4f4'; g.fillText(k.say, Math.round(x - w / 2), y);
    };
    if (it.bowl) {
      const b = F.bowl;
      g.fillStyle = '#566c86'; g.fillRect(Math.round(b.x) - 3, Math.round(b.y) - 2, 7, 3);
      g.fillStyle = '#8a6248'; g.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 3, 5, 1);
      return;
    }
    if (it.farmer) {
      const fm = F.farmer;
      const walking = fm.state === 'walk';
      const key = fm.state === 'work' ? 'f_work' : walking && Math.floor(performance.now() / 200) % 2 ? 'f_walk' : 'f_stand';
      const spr = FARM_SPR[key][fm.dir > 0 ? 0 : 1];
      const x = Math.round(fm.x - 3), y = Math.round(fm.y - spr.height);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, Math.round(fm.y), 7, 2);
      g.drawImage(spr, x, y);
      // the season's tool in hand
      const hx = fm.dir > 0 ? x + 7 : x - 3, hy = y + 6;
      const s = this.season;
      if (s === 'spring') { g.fillStyle = '#c28569'; g.fillRect(hx, hy, 3, 3); }
      if (s === 'summer') { g.fillStyle = '#41a6f6'; g.fillRect(hx, hy, 4, 3); g.fillRect(hx + (fm.dir > 0 ? 4 : -1), hy - 1, 1, 1); }
      if (s === 'autumn') { g.fillStyle = '#8a6248'; g.fillRect(hx - 1, hy + 1, 5, 3); g.fillStyle = '#ef7d57'; g.fillRect(hx, hy, 3, 1); }
      if (s === 'winter') { g.fillStyle = '#94b0c2'; g.fillRect(hx, hy - 4, 1, 8); g.fillRect(hx - 1, hy + 4, 3, 2); }
      say(fm, fm.x, y - 3);
      for (const p of F.sparks) {
        const px = Math.round(p.x), py = Math.round(p.y);
        if (p.heart) {
          g.fillStyle = '#b13e53';
          g.fillRect(px, py, 2, 1); g.fillRect(px + 3, py, 2, 1); g.fillRect(px, py + 1, 5, 1); g.fillRect(px + 1, py + 2, 3, 1); g.fillRect(px + 2, py + 3, 1, 1);
        } else { g.fillStyle = p.c; g.fillRect(px, py, 1, 1); }
      }
      return;
    }
    if (it.dog) {
      const d = F.dog;
      const key = d.state === 'eat' ? 'd_eat' : d.state === 'run' && Math.floor(performance.now() / 120) % 2 ? 'd_run' : 'd_stand';
      const spr = FARM_SPR[key][d.dir > 0 ? 0 : 1];
      const lift = d.jump > 0 ? Math.round(Math.sin((d.jump / 0.4) * Math.PI) * 5) : 0;
      const x = Math.round(d.x - 4), y = Math.round(d.y - spr.height - lift);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 1, Math.round(d.y), 7, 1);
      g.drawImage(spr, x, y);
      // wagging tail
      if (d.state !== 'run' && Math.floor(performance.now() / 150) % 2) { g.fillStyle = '#a8805e'; g.fillRect(d.dir > 0 ? x - 1 : x + 9, y + 1, 1, 1); }
      say(d, d.x, y - 2);
    }
  },
});
