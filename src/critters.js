// Neutral wildlife: pure decoration living in the renderer (not in the sim, so never synced or blocking).
// Cows graze and moo, deer wander and bolt from monsters, frogs sit by the ponds and hop.
import { TILE, COLS, ROWS } from './sim/data.js';
import { say, hero } from "./say.js";

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

  reset(map, season = "summer", npc = null) {
    this.map = map;
    this.season = season;
    this.initFarm(map);
    this.initValeria(npc === "valeria");
    this.initWater();
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
    this.updateValeria(dt, enemies);
    this.updateWater(dt, this.mouse);
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
      if (j.say && j.t < 1.2) say(x, y - 8, j.say, j.gold ? "gold" : "");
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
      if (f.sayT > 0 && f.say) say(f.x, f.y - 6, f.say, f.gold ? "gold" : "");
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
    if (this.pokeValeria(x, y)) return true;
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
    if (c.sayT > 0 && c.say) say(c.x, y - 2, c.say);
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
    if (this.season === "winter") for (let i = 0; i < 4; i++) spots.push({ x: f.house[0] * T + 2 + i * 9, y: (f.house[1] + 1) * T + 5 });
    else for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) spots.push({ x: fx * T + 8 + i * ((fw * T - 16) / 2), y: fy * T + 12 + r * (fh * T - 22) });
    const home = { x: f.house[0] * T + 12, y: (f.house[1] + 1) * T + 4 };
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
    this.updateKid(dt);
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

  // farmer's and dog's lines, drawn after everything else so they stay readable (even at night)
  drawFarmSay(g) {
    this.drawValeriaSay();
    this.drawWaterSay();
    this.drawKidSay();
    const F = this.farm;
    if (!F) return;
    for (const k of [F.farmer, F.dog]) {
      if (!(k.sayT > 0) || !k.say || !k.sayAt) continue;
      say(k.sayAt[0], k.sayAt[1], k.say);
    }
  },

  farmItems() {
    const F = this.farm;
    const out = this.valeria ? [{ y: this.valeria.y, valeria: true }] : [];
    if (!F) return out;
    out.push({ y: F.farmer.y, farmer: true }, { y: F.dog.y, dog: true });
    if (F.bowl) out.push({ y: F.bowl.y - 1, bowl: true });
    if (F.kid) out.push({ y: F.kid.y, kid: true });
    if (F.mom) out.push({ y: F.mom.y + 0.5, mom: true });
    return out;
  },

  drawFarm(g, it) {
    if (it.valeria) { this.drawValeria(g); return; }
    if (it.kid || it.mom) { this.drawKidScene(g, it); return; }
    const F = this.farm;
    if (!F) return;
    const say = (k, x, y) => {
      if (!(k.sayT > 0) || !k.say) return;
      g.font = '600 8px Rubik, system-ui, sans-serif';
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
      fm.sayAt = [fm.x, y - 3]; // text is drawn later, above the night overlay (drawFarmSay)
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
      d.sayAt = [d.x, y - 2];
    }
  },
});

// ---------- Валерія Кудряшівна: a cheerful neutral fair-goer in a campaign mission (mission.npc = 'valeria') ----------
// Decoration only: wanders the grass between the roads and shouts funny lines; never touches the simulation.
const VAL_COL = { H: '#8a4a2a', h: '#d0803f', s: '#f2c6a0', k: '#1a1c2c', r: '#b13e53', p: '#5d275d', P: '#8a3f8f', w: '#f4f4f4', y: '#ffcd75' };
const VALERIA = {
  stand: ['.HhHhHh..', 'HhHhHhHh.', 'hHsssshHh', 'Hhsksksh.', 'hHssrsshH', '.hHsssHh.', '..yPPPy..', '.pPPPPPp.', 's.PwPwP.s', '..ppppp..', '..p...p..', '.kk...kk.'],
  walk: ['.HhHhHh..', 'HhHhHhHh.', 'hHsssshHh', 'Hhsksksh.', 'hHssrsshH', '.hHsssHh.', '..yPPPy..', '.pPPPPPp.', 's.PwPwP.s', '..ppppp..', '.p.....p.', 'kk.....kk'],
  shout: ['HhHhHhH..', 'hHhHhHhH.', 'HhsssshHh', 'hHsksksH.', 'HhsskkshH', '.hHsssHh.', 's.yPPPy.s', '.pPPPPPp.', '..PwPwP..', '..ppppp..', '..p...p..', '.kk...kk.'],
};
function valSprite(rows, flip) {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length; cv.height = rows.length;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = VAL_COL[row[x]]; if (!c) continue; g.fillStyle = c; g.fillRect(flip ? row.length - 1 - x : x, y, 1, 1); } });
  return cv;
}
const VAL_SPR = Object.fromEntries(Object.entries(VALERIA).map(([k, rows]) => [k, [valSprite(rows, false), valSprite(rows, true)]]));
const VAL_LINES = [
  'Хто замовляв слиз з підливою?', 'Я не панікую, я голосно думаю!', 'Мої кучері — не гніздо, гоблінам не сідати!',
  '{hero}, не стій — будуй!', 'Купуйте пиріжки! З… ну, з чимось!', 'Ще одна хвиля — і я в спа!',
  'Слизи, ви хоч ноги витирайте!', 'Кудряшівна все бачить!', 'Монетки збирайте — на ярмарку все дороге!',
  'Дракони? Де дракони? Я хочу автограф!', 'Хто так будує? А, нормально будує.', 'Ой, вежечка! Яка гарненька!',
];
const VAL_POKE = ['Не чіпай зачіску — я її три години крутила!', 'Ой! Лоскотно!', 'Привіт, будівничий!', 'Я тут просто подивитись!', 'Автограф — після перемоги!'];
const VAL_SCARED = ['Ай! Слиз на горизонті!', 'Тікаю-тікаю… ні, стою, мені цікаво!', 'Ану киш звідси, слизняку!'];
const VAL_BOSS = ['Оце так здоровань!', 'Цей бос — як понеділок: великий і ніхто не чекав!', 'Ой, мамочки, він ще й розмовляє!'];

Object.assign(Critters.prototype, {
  initValeria(on) {
    const at = on && this.randomSpot();
    this.valeria = at ? { x: at.x, y: at.y, tx: at.x, ty: at.y, dir: 1, t: 2, say: null, sayT: 0, shoutT: rnd(2, 4), sawBoss: new Set() } : null;
  },
  updateValeria(dt, enemies) {
    const v = this.valeria;
    if (!v) return;
    v.sayT -= dt;
    v.t -= dt;
    // stroll between grass spots
    const dx = v.tx - v.x, dy = v.ty - v.y, d = Math.hypot(dx, dy);
    if (d > 1) { const sp = 14 * dt; v.x += (dx / d) * Math.min(sp, d); v.y += (dy / d) * Math.min(sp, d); v.dir = dx >= 0 ? 1 : -1; }
    else if (v.t <= 0) { const n = this.randomSpot((x, y) => Math.hypot(x - v.x, y - v.y) < 70); if (n) { v.tx = n.x; v.ty = n.y; } v.t = rnd(2, 5); }
    const shout = (lines, time = 2.6) => { v.say = lines[Math.floor(Math.random() * lines.length)]; v.sayT = time; };
    // a new boss on the map gets a comment
    const boss = enemies && enemies.find((e) => !e.dead && (e.type === 'boss' || e.type === 'king') && !v.sawBoss.has(e.id));
    if (boss) { v.sawBoss.add(boss.id); shout(VAL_BOSS, 3); v.shoutT = rnd(6, 9); return; }
    v.shoutT -= dt;
    if (v.shoutT > 0 || v.sayT > 0) return;
    const near = enemies && enemies.some((e) => !e.dead && Math.hypot(e.x - v.x, e.y - v.y) < 40);
    shout(near ? VAL_SCARED : VAL_LINES);
    v.shoutT = rnd(6, 10);
  },
  pokeValeria(x, y) {
    const v = this.valeria;
    if (!v || Math.hypot(v.x - x, v.y - 6 - y) > 9) return false;
    v.say = VAL_POKE[Math.floor(Math.random() * VAL_POKE.length)];
    v.sayT = 2.4;
    v.shoutT = Math.max(v.shoutT, 4);
    return true;
  },
  drawValeria(g) {
    const v = this.valeria;
    if (!v) return;
    const moving = Math.hypot(v.tx - v.x, v.ty - v.y) > 1;
    const key = v.sayT > 0 ? 'shout' : moving && Math.floor(performance.now() / 200) % 2 ? 'walk' : 'stand';
    const spr = VAL_SPR[key][v.dir > 0 ? 0 : 1];
    const bounce = v.sayT > 0 ? Math.round(Math.abs(Math.sin(performance.now() / 120))) : 0;
    const x = Math.round(v.x - 4), y = Math.round(v.y - spr.height) - bounce;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 1, Math.round(v.y), 7, 2);
    g.drawImage(spr, x, y);
    v.sayAt = [v.x, y - 3];
  },
  drawValeriaSay() {
    const v = this.valeria;
    if (v && v.sayT > 0 && v.say && v.sayAt) say(v.sayAt[0], v.sayAt[1], hero(v.say), '', '#ffcd75');
  },
});

// ---------- water decor: a tiny waterfall into a pond, and a mermaid who sometimes sits on the shore ----------
// Decoration only. The mermaid admires herself in a mirror; when the cursor comes close she dives and is gone for a while.
const MER_COL = { h: '#ef7d57', H: '#b13e53', s: '#f2c6a0', k: '#1a1c2c', p: '#f4b6d2', t: '#38b764', T: '#257179', c: '#73eff7', w: '#f4f4f4', y: '#ffcd75' };
const MERMAID = {
  sit: ['..hhhh....', '.hhhhhh...', 'hhsssshh..', 'hhsksksh..', 'hhssssshh.', '.hhsssshh.', '.hppsspph.', '.hsssssh..', '..ttttt...', '..tTtTtt..', '...ttttTt.', '....ttTtcc', '.....tt.cc'],
  comb: ['..hhhh....', '.hhhhhh.y.', 'hhsssshhy.', 'hhsksksh..', 'hhssssshhs', '.hhsssshh.', '.hppsspph.', '.hsssssh..', '..ttttt...', '..tTtTtt..', '...ttttTt.', '....ttTtcc', '.....tt.cc'],
  scared: ['..hhhh....', '.hhhhhh...', 'hhsssshh..', 'hhskskshs.', 'hhsssksh..', '.hhsssshh.', 's.hppsph..', '..hsssh...', '..ttttt...', '..tTtTtt..', '...ttttTt.', '....ttTtcc', '.....tt.cc'],
};
function merSprite(rows, flip) {
  const cv = document.createElement('canvas');
  cv.width = rows[0].length; cv.height = rows.length;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = MER_COL[row[x]]; if (!c) continue; g.fillStyle = c; g.fillRect(flip ? row.length - 1 - x : x, y, 1, 1); } });
  return cv;
}
const MER_SPR = Object.fromEntries(Object.entries(MERMAID).map(([k, rows]) => [k, [merSprite(rows, false), merSprite(rows, true)]]));
const MER_SAY = ['Яка я гарна…', 'Ля-ля-ля~', 'Дзеркальце, скажи…', 'Сонечко сьогодні!', 'Мої кучерики!'];
const MER_SCARED = ['Ой!', 'Ай!', 'Не дивись!', 'Бульк!'];

Object.assign(Critters.prototype, {
  initWater() {
    const W = this.map.water;
    const taken = this.taken || new Set(); // barrels and rocks/trees on the map (set by the renderer)
    const free = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !W.has(x + ',' + y) && !this.map.tiles.has(x + ',' + y) && !taken.has(x + ',' + y);
    const pond = [...W].map((k) => k.split(',').map(Number));
    // waterfall: a pond tile with dry land right above it (the ledge the water falls from)
    const fall = pond.filter(([x, y]) => free(x, y - 1) && W.has(x + ',' + (y + 1)))[0] || pond.filter(([x, y]) => free(x, y - 1))[0];
    this.waterfall = fall ? { x: fall[0] * TILE, y: fall[1] * TILE, drops: [] } : null;
    // mermaid: a pond tile with a free shore tile beside it; she sits on a rock on that shore
    const spots = [];
    for (const [x, y] of pond) for (const dx of [-1, 1]) {
      if (free(x + dx, y) && (!fall || Math.abs(x - fall[0]) + Math.abs(y - fall[1]) > 1)) spots.push({ wx: x, wy: y, sx: x + dx, dir: -dx });
    }
    const sp = spots[Math.floor(Math.random() * spots.length)];
    // in winter the pond is frozen: she sleeps under the ice
    this.mermaid = sp && this.season !== 'winter' ? { ...sp, state: 'away', t: rnd(4, 9), say: null, sayT: 0, hearts: [] } : null;
    this.waterSplash = [];
  },

  updateWater(dt, mouse) {
    const wf = this.waterfall;
    if (wf && this.season !== 'winter') {
      if (Math.random() < 0.6) wf.drops.push({ x: wf.x + 6 + Math.random() * 12, y: wf.y + 14, vx: Math.random() * 30 - 15, vy: -20 - Math.random() * 20, life: 0.4 });
      for (const d of wf.drops) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 140 * dt; d.life -= dt; }
      wf.drops = wf.drops.filter((d) => d.life > 0);
    }
    for (const sp of this.waterSplash) { sp.r += 30 * dt; sp.life -= dt; }
    this.waterSplash = this.waterSplash.filter((s) => s.life > 0);
    const m = this.mermaid;
    if (!m) return;
    m.t -= dt; m.sayT -= dt;
    m.x = m.sx * TILE + 12 - m.dir * 5; m.y = m.wy * TILE + 16;
    if (m.state === 'away' && m.t <= 0) { m.state = 'rise'; m.t = 0.7; this.splashAt(m.wx * TILE + 12, m.wy * TILE + 14); }
    else if (m.state === 'rise' && m.t <= 0) { m.state = 'sit'; m.t = rnd(12, 22); m.combT = 0; }
    else if (m.state === 'sit') {
      m.combT -= dt;
      if (m.combT <= 0) { m.comb = !m.comb; m.combT = rnd(0.6, 1.6); }
      if (Math.random() < dt * 0.25 && m.sayT <= 0) { m.say = MER_SAY[Math.floor(Math.random() * MER_SAY.length)]; m.sayT = 2.2; }
      if (Math.random() < dt * 1.2) m.hearts.push({ x: m.x + Math.random() * 10 - 5, y: m.y - 18, life: 1.2 });
      const near = mouse && Math.hypot(mouse.x - m.x, mouse.y - (m.y - 8)) < 34;
      if (near) { m.state = 'scared'; m.t = 0.45; m.say = MER_SCARED[Math.floor(Math.random() * MER_SCARED.length)]; m.sayT = 1; }
      else if (m.t <= 0) { m.state = 'dive'; m.t = 0.5; }
    } else if (m.state === 'scared' && m.t <= 0) { m.state = 'dive'; m.t = 0.4; }
    else if (m.state === 'dive' && m.t <= 0) { m.state = 'away'; m.t = rnd(10, 22); this.splashAt(m.wx * TILE + 12, m.wy * TILE + 14); }
    for (const h of m.hearts) { h.y -= 10 * dt; h.life -= dt; }
    m.hearts = m.hearts.filter((h) => h.life > 0);
  },

  splashAt(x, y) {
    this.waterSplash.push({ x, y, r: 2, life: 0.6 });
    if (this.waterfall) for (let i = 0; i < 10; i++) this.waterfall.drops.push({ x, y, vx: Math.random() * 60 - 30, vy: -40 - Math.random() * 40, life: 0.5 });
  },

  // drawn right after the background (under towers and enemies)
  drawWater(g) {
    const wf = this.waterfall, t = performance.now() / 1000;
    if (wf) {
      const x = wf.x, y = wf.y;
      // the ledge: a few stones on the shore above
      g.fillStyle = '#566c86'; g.fillRect(x + 2, y - 5, 20, 6);
      g.fillStyle = '#94b0c2'; g.fillRect(x + 3, y - 6, 6, 3); g.fillRect(x + 11, y - 7, 7, 4); g.fillRect(x + 18, y - 5, 4, 3);
      if (this.season === 'winter') { // icicles instead of water
        g.fillStyle = '#dff3fa'; g.fillRect(x + 5, y, 14, 3);
        for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#f4f4f4' : '#a9d6ea'; g.fillRect(Math.round(x + 5 + i * 2.5), y + 3, 2, 4 + (i * 3) % 6); }
      } else {
        // the falling sheet: light stripes scroll down
        g.fillStyle = '#41a6f6'; g.fillRect(x + 6, y - 1, 12, 15);
        for (let i = 0; i < 4; i++) {
          const off = Math.floor((t * 28 + i * 7) % 14);
          g.fillStyle = i % 2 ? '#73eff7' : '#f4f4f4';
          g.fillRect(x + 7 + i * 3, y - 1 + off, 1, 3);
        }
        // foam at the bottom
        for (let i = 0; i < 5; i++) { const b = Math.sin(t * 6 + i) > 0 ? 1 : 0; g.fillStyle = '#f4f4f4'; g.fillRect(x + 4 + i * 4, y + 13 + b, 3, 2); }
        g.fillStyle = 'rgba(244,244,244,0.5)'; g.fillRect(x + 2, y + 16, 20, 1);
        for (const d of wf.drops) { g.fillStyle = '#c7f2ff'; g.fillRect(Math.round(d.x), Math.round(d.y), 1, 1); }
      }
    }
    for (const sp of this.waterSplash) {
      g.strokeStyle = `rgba(244,244,244,${Math.max(0, sp.life).toFixed(2)})`;
      g.beginPath(); g.ellipse(sp.x, sp.y, sp.r * 1.6, sp.r * 0.6, 0, 0, Math.PI * 2); g.stroke();
    }
    const m = this.mermaid;
    if (!m || m.x === undefined) return;
    // her rock on the shore (stays when she is away)
    g.fillStyle = '#566c86'; g.fillRect(Math.round(m.x) - 7, Math.round(m.y) - 2, 14, 5);
    g.fillStyle = '#94b0c2'; g.fillRect(Math.round(m.x) - 6, Math.round(m.y) - 3, 9, 3);
    if (m.state === 'away') return;
    const key = m.state === 'scared' ? 'scared' : m.comb ? 'comb' : 'sit';
    const spr = MER_SPR[key][m.dir > 0 ? 0 : 1];
    // leaping like a fish: an arc between the rock and the water, turning head-first; she vanishes in the splash
    if (m.state === 'rise' || m.state === 'dive') {
      const dive = m.state === 'dive', p = Math.min(1, Math.max(0, dive ? 1 - m.t / 0.5 : 1 - m.t / 0.7));
      const wx = m.wx * TILE + 12, wy = m.wy * TILE + 16;
      const [ax, ay, bx, by] = dive ? [m.x, m.y - 6, wx, wy] : [wx, wy, m.x, m.y - 6];
      const px = ax + (bx - ax) * p, py = ay + (by - ay) * p - Math.sin(Math.PI * p) * 20;
      const turn = (dive ? p : 1 - p) * 2.6 * (m.dir > 0 ? 1 : -1) * (dive ? 1 : -1);
      g.save();
      g.globalAlpha = dive ? Math.min(1, (1 - p) * 4) : Math.min(1, p * 4); // in and out of the water
      g.translate(Math.round(px), Math.round(py)); g.rotate(turn);
      g.drawImage(spr, -Math.round(spr.width / 2), -Math.round(spr.height / 2));
      g.restore();
      return;
    }
    const dx = Math.round(m.x - spr.width / 2), dy = Math.round(m.y - spr.height - 1);
    g.drawImage(spr, dx, dy);
    if (m.state === 'sit' || m.state === 'scared') { // hand mirror
      const mx = m.dir > 0 ? dx + spr.width : dx - 3, my = dy + 5;
      g.fillStyle = '#ffcd75'; g.fillRect(mx, my, 3, 4); g.fillStyle = '#c7f2ff'; g.fillRect(mx + 1, my + 1, 1, 2);
    }
    if (m.state === 'sit') for (const hh of m.hearts) {
      g.globalAlpha = Math.min(1, hh.life);
      const px = Math.round(hh.x), py = Math.round(hh.y);
      g.fillStyle = Math.floor(hh.life * 5) % 2 ? '#f4b6d2' : '#ffcd75';
      g.fillRect(px, py, 1, 1); g.fillRect(px + 2, py, 1, 1); g.fillRect(px, py + 1, 3, 1); g.fillRect(px + 1, py + 2, 1, 1);
      g.globalAlpha = 1;
    }
    m.sayAt = [m.x, dy - 2];
  },

  drawWaterSay() {
    const m = this.mermaid;
    if (m && m.sayT > 0 && m.say && m.sayAt && m.state !== 'away') say(m.sayAt[0], m.sayAt[1], m.say, '', '#f4b6d2');
  },
});

// ---------- the farm family: little Кирилло sneaks out, mum runs after him and carries him home ----------
// Decoration only. About once a minute: the toddler crawls out of the door and away; 2 s later mum runs out,
// shouts, picks him up and carries him back inside.
const FAM_COL = { b: '#f2c6a0', h: '#ffcd75', B: '#73eff7', w: '#f4f4f4', k: '#1a1c2c', m: '#8a4a2a', d: '#b13e53', a: '#f4f4f4', s: '#f2c6a0', r: '#ef7d57' };
const FAMILY = {
  kid_a: ['.hh..', 'hbbh.', '.bkb.', 'BBBBb', 'b.B.b'], // crawling, two frames
  kid_b: ['.hh..', 'hbbh.', '.bkb.', 'BBBB.', '.bB.b'],
  mom_stand: ['.mmm.', 'mmmmm', 'msssm', '.sks.', '.sss.', 'ddadd', 'ddadd', 'sdadd', '.ddd.', '.ddd.', '.k.k.'],
  mom_run: ['.mmm.', 'mmmmm', 'msssm', '.sks.', '.sss.', 'ddadd', 'ddadds', 'sdadd.', '.ddd.', '.d.d.', 'k...k'],
  mom_carry: ['.mmm..', 'mmmmm.', 'msssm.', '.sks..', '.sss.h', 'ddaddb', 'dsBBBb', '.dadd.', '.ddd..', '.d.d..', 'k...k.'],
};
function famSprite(rows, flip) {
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = rows.length;
  const g = cv.getContext('2d');
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = FAM_COL[row[x]]; if (!c) continue; g.fillStyle = c; g.fillRect(flip ? w - 1 - x : x, y, 1, 1); } });
  return cv;
}
const FAM_SPR = Object.fromEntries(Object.entries(FAMILY).map(([k, rows]) => [k, [famSprite(rows, false), famSprite(rows, true)]]));
const MOM_SHOUT = ['Кирилло, ти куда знов тікаєш?!', 'Кирилло! Ану додому!', 'Кирилло, куди це ти зібрався?!'];
const KID_SAY = ['Агу!', 'Хі-хі!', 'Ням?'];

Object.assign(Critters.prototype, {
  updateKid(dt) {
    const F = this.farm;
    if (!F) return;
    const door = { x: F.home.x, y: F.home.y + 1 };
    F.kidWait = (F.kidWait ?? (this.kidDemo ? 1 : 40 + Math.random() * 30)) - dt;
    if (!F.kid && F.kidWait <= 0) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      F.kid = { x: door.x, y: door.y, dir, t: 0, say: KID_SAY[Math.floor(Math.random() * KID_SAY.length)], sayT: 1.2 };
      F.mom = null;
      F.kidWait = this.kidDemo ? 9 : 55 + Math.random() * 15; // about once a minute
    }
    const kid = F.kid;
    if (!kid) return;
    kid.t += dt; kid.sayT -= dt;
    if (!kid.carried) kid.x += kid.dir * 7 * dt; // a determined little crawl
    if (!F.mom && kid.t >= 2) F.mom = { x: door.x, y: door.y, dir: kid.dir, state: 'run', say: MOM_SHOUT[Math.floor(Math.random() * MOM_SHOUT.length)], sayT: 2.4 };
    const mom = F.mom;
    if (!mom) return;
    mom.sayT -= dt;
    if (mom.state === 'run') {
      const dx = kid.x - mom.x;
      mom.dir = dx >= 0 ? 1 : -1;
      mom.x += Math.sign(dx) * Math.min(Math.abs(dx), 34 * dt);
      if (Math.abs(dx) < 3) { mom.state = 'carry'; kid.carried = true; kid.say = null; }
    } else if (mom.state === 'carry') {
      const dx = door.x - mom.x;
      mom.dir = dx >= 0 ? 1 : -1;
      mom.x += Math.sign(dx) * Math.min(Math.abs(dx), 20 * dt);
      kid.x = mom.x; kid.y = mom.y;
      if (Math.abs(dx) < 1) { F.kid = null; F.mom = null; } // back inside
    }
  },

  drawKidScene(g, it) {
    const F = this.farm;
    if (it.kid && F.kid && !F.kid.carried) {
      const k = F.kid, frame = Math.floor(performance.now() / 220) % 2 ? 'kid_a' : 'kid_b';
      const spr = FAM_SPR[frame][k.dir > 0 ? 0 : 1];
      const x = Math.round(k.x - 2), y = Math.round(k.y - spr.height);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, Math.round(k.y), 5, 1);
      g.drawImage(spr, x, y);
      k.sayAt = [k.x, y - 2];
    }
    if (it.mom && F.mom) {
      const m = F.mom, key = m.state === 'carry' ? 'mom_carry' : Math.floor(performance.now() / 120) % 2 ? 'mom_run' : 'mom_stand';
      const spr = FAM_SPR[key][m.dir > 0 ? 0 : 1];
      const x = Math.round(m.x - 3), y = Math.round(m.y - spr.height);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, Math.round(m.y), 6, 2);
      g.drawImage(spr, x, y);
      m.sayAt = [m.x, y - 3];
    }
  },

  drawKidSay() {
    const F = this.farm;
    if (!F) return;
    if (F.mom && F.mom.sayT > 0 && F.mom.sayAt) say(F.mom.sayAt[0], F.mom.sayAt[1], F.mom.say, '', '#f4b6d2');
    else if (F.kid && F.kid.sayT > 0 && F.kid.say && F.kid.sayAt) say(F.kid.sayAt[0], F.kid.sayAt[1], F.kid.say, '', '#73eff7');
  },
});
