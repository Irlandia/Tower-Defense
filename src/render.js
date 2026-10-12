// Canvas renderer + visual juice. Reads sim state, never mutates it.
import { TILE, COLS, ROWS, TICK_RATE, TOWERS, CONFIG, ABILITIES, BARREL, BOSSES, bossFor } from './sim/data.js';
import { towerStats, canPlace, posAt, isRoad, canMove } from './sim/sim.js';
import {
  C, SPRITES, FLASH, FROZEN, ENEMY_COLOR, drawTower, drawCastle, drawCave, drawNum, numWidth, drawIcon,
  drawObstacle, drawBarrel, drawCoin, drawChest, drawWall, ellipse,
} from './sprites.js';
import { Critters } from './critters.js';

export const PLAYER_COLORS = [C.yellow, C.cyan, C.lime, "#f4b6d2"];
// where a spawn tile sits on the map edge: cave and "!" marker positions
function edgeOf([x, y]) {
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

export const W = 640;
export const H = 360;
export const HUD = 20;
// top-left of the map inside the canvas
export const MX = (W - COLS * TILE) / 2;
export const MY = HUD + 2;

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
    this.bg = null;
    this.mapRef = null;
    this.parts = [];
    this.texts = [];
    this.zaps = [];
    this.rings = [];
    this.chests = [];
    this.shake = 0;
    this.redFlash = 0;
    this.blueFlash = 0;
    this.quake = 0; // seconds of gentle rolling shake (boss arrival)
    this.speech = []; // { id, text, life } bubbles above enemies
    this.bossInfo = {}; // enemy id -> BOSSES entry
    this.decals = []; // ground cracks left by heavy footsteps
    this.lastStomp = {}; // enemy id -> tick of its last stomp
    this.onStomp = null; // callback for the stomp sound
    this.critters = new Critters();
  }

  makeBackground(map, season = 'summer') {
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
    if (season === "winter") {
      // snowy road edges and slush
      for (const k of map.tiles) {
        const [tx, ty] = k.split(",").map(Number);
        if (tx < 0 || tx >= COLS) continue;
        for (let i = 0; i < 6; i++) { g.fillStyle = rnd() < 0.6 ? C.white : "#c9d6de"; g.fillRect(tx * TILE + Math.floor(rnd() * 22), ty * TILE + Math.floor(rnd() * 22), 2, 1); }
      }
    }
    for (const sp of map.spawns) {
      const [x, y] = sp, e = edgeOf(sp);
      if (e === "left") drawCave(g, 0, y * TILE);
      else if (e === "right") drawCave(g, COLS * TILE - 16, y * TILE);
      else if (e === "top") drawCave(g, x * TILE + 6, -12);
      else drawCave(g, x * TILE + 6, ROWS * TILE - 10);
    }
    return cv;
  }

  // ---------- events -> effects ----------
  onEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          // colour = effectiveness vs this enemy type: green weak spot, grey resisted
          this.text(e.x, e.y - 18, e.dmg, e.crit ? C.yellow : e.eff > 0 ? C.lime : e.eff < 0 ? C.slate : C.white, e.crit || e.eff > 0 ? 2 : 1);
          this.burst(e.x, e.y - 6, 3, C.white, 40);
          break;
        case 'death': {
          const big = e.kind === 'boss' || e.kind === 'king';
          this.burst(e.x, e.y - 6, big ? 60 : 14, ENEMY_COLOR[e.kind], 80);
          this.burst(e.x, e.y - 6, 5, C.ink, 50);
          this.text(e.x, e.y - 24, '+' + e.gold, C.yellow, 1);
          if (big) { this.shake = 8; this.rings.push({ x: e.x, y: e.y, r: 2, max: 70, c: C.red, life: 1 }); }
          break;
        }
        case 'explode':
          this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r, c: C.orange, life: 1 });
          this.burst(e.x, e.y, 14, C.orange, 70);
          this.burst(e.x, e.y, 8, C.dark, 40, -15);
          this.shake = Math.max(this.shake, 2);
          break;
        case 'steam':
          this.rings.push({ x: e.x, y: e.y, r: 2, max: CONFIG.steamRadius, c: C.white, life: 1 });
          this.burst(e.x, e.y, 18, C.silver, 60, -30);
          this.text(e.x, e.y - 28, 'x2', C.cyan, 2);
          this.shake = Math.max(this.shake, 2.5);
          break;
        case 'zap':
          this.zaps.push({ pts: e.pts, life: 0.18 });
          if (e.over >= 2) this.burst(e.pts[1].x, e.pts[1].y, 10, C.orange, 60);
          for (const p of e.pts.slice(1)) this.burst(p.x, p.y, 4, C.cyan, 50);
          break;
        case 'meteor':
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.yellow, life: 1 });
          this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.7, c: C.red, life: 1 });
          this.burst(e.x, e.y, 60, C.orange, 120);
          this.burst(e.x, e.y, 30, C.yellow, 90);
          this.shake = 8;
          break;
        case "bossSpawn": {
          const info = bossFor(e.wave);
          this.bossInfo[e.id] = info;
          this.quake = 2.2;
          this.say(e.id, info.lines[Math.floor(Math.random() * info.lines.length)], 3.5);
          break;
        }
        case "bossSkill":
          if (e.kind === "dash") { this.burst(e.x, e.y + 4, 20, "#a8805e", 70, -10); this.text(e.x, e.y - 34, "!!", C.red, 2); this.shake = Math.max(this.shake, 3); }
          if (e.kind === "brood") { this.burst(e.x, e.y, 24, C.lime, 60, -20); this.rings.push({ x: e.x, y: e.y, r: 2, max: 20, c: C.green, life: 0.8 }); }
          if (e.kind === "magnet") { this.rings.push({ x: e.x, y: e.y - 8, r: 60, max: 4, c: C.silver, life: 1 }); this.burst(e.x, e.y - 8, 16, C.silver, 50); }
          if (e.kind === "decree") { this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.plum, life: 1 }); this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.6, c: C.yellow, life: 1 }); this.shake = Math.max(this.shake, 4); }
          break;
        case "bossRage": {
          const info = this.bossInfo[e.id] || bossFor(e.wave);
          this.say(e.id, info.rage[Math.floor(Math.random() * info.rage.length)], 2.5);
          this.shake = Math.max(this.shake, 4);
          break;
        }
        case 'nova':
          this.blueFlash = 0.5;
          this.shake = 4;
          break;
        case 'wallup':
          this.burst(e.x, e.y + 6, 16, '#8a6248', 50, -10);
          this.shake = Math.max(this.shake, 2);
          break;
        case 'wallbreak':
          this.burst(e.x, e.y, 24, '#c28569', 80, -20);
          this.shake = Math.max(this.shake, 3);
          break;
        case 'evolve':
          this.rings.push({ x: e.x, y: e.y, r: 2, max: 40, c: C.yellow, life: 1 });
          this.burst(e.x, e.y - 8, 40, C.yellow, 90, -25);
          this.burst(e.x, e.y - 8, 16, C.white, 60, -25);
          this.text(e.x, e.y - 34, '+', C.yellow, 3);
          this.shake = Math.max(this.shake, 3);
          break;
        case 'clear':
          this.burst(e.x, e.y, 20, e.kind === 'tree' ? C.green : C.slate, 60, -10);
          this.burst(e.x, e.y, 8, '#8a6248', 40);
          break;
        case 'chest':
          this.chests.push({ x: e.x, y: e.y, life: 1 });
          this.burst(e.x, e.y, 30, C.yellow, 80, -40);
          this.text(e.x, e.y - 30, '+' + e.gold, C.yellow, 2);
          break;
        case 'barrel':
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.orange, life: 1 });
          this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.6, c: C.yellow, life: 1 });
          this.burst(e.x, e.y, 50, C.orange, 120);
          this.burst(e.x, e.y, 20, C.dark, 60, -30);
          this.shake = 6;
          break;
        case 'coin':
          this.burst(e.x, e.y, 10, C.yellow, 50, -25);
          this.text(e.x, e.y - 14, '+' + e.gold, C.yellow, 1);
          break;
        case 'stolen':
          this.text(e.x - 30, e.y - 18, '-' + e.gold, C.red, 2);
          break;
        case 'pulse':
          if (e.kind === 'inferno') {
            for (let i = 0; i < 8; i++) {
              const a = Math.random() * 6.28, d = Math.random() * e.r;
              this.parts.push({ x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, vx: 0, vy: -25, life: 0.3, c: Math.random() < 0.5 ? C.orange : C.yellow });
            }
          } else {
            this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.cyan, life: 0.8 });
            this.burst(e.x, e.y, 12, C.white, e.r * 1.5);
          }
          break;
        case "lap":
          this.rings.push({ x: e.x, y: e.y - 6, r: 2, max: 14, c: C.orange, life: 0.6 });
          this.text(e.x, e.y - 26, "+" , C.orange, 2);
          break;
        case 'heal':
          this.burst(e.x, e.y - 6, 5, C.lime, 25, -35);
          break;
        case 'leak':
          this.shake = e.boss ? 10 : 4;
          this.redFlash = 0.35;
          break;
        case 'build':
        case 'upgrade':
          this.burst(e.x, e.y + 8, 14, C.silver, 45, -12);
          if (e.type === 'upgrade') this.burst(e.x, e.y - 6, 12, C.yellow, 50, -40);
          break;
        case "aura":
          this.rings.push({ x: e.x, y: e.y, r: 4, max: 60, c: e.aura === "dmg" ? C.orange : C.cyan, life: 1 });
          this.burst(e.x, e.y - 10, 20, e.aura === "dmg" ? C.orange : C.cyan, 60, -30);
          break;
        case "move":
          this.burst(e.fx, e.fy + 8, 14, "#8a6248", 45, -15);
          this.burst(e.x, e.y + 8, 18, C.silver, 50, -15);
          this.rings.push({ x: e.x, y: e.y + 4, r: 2, max: 18, c: C.lime, life: 0.8 });
          this.shake = Math.max(this.shake, 1.5);
          break;
        case 'sell':
          this.burst(e.x, e.y, 10, C.yellow, 50);
          this.text(e.x, e.y - 16, '+' + e.gold, C.yellow, 1);
          break;
      }
    }
  }

  say(id, text, life) {
    this.speech = this.speech.filter((b) => b.id !== id);
    this.speech.push({ id, text, life, max: life });
  }

  burst(x, y, n, c, spd, vy0 = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = Math.random() * spd;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + vy0, life: 0.3 + Math.random() * 0.4, c, s: Math.random() < 0.3 ? 2 : 1 });
    }
  }

  text(x, y, str, c, scale) {
    this.texts.push({ x: x + (Math.random() * 8 - 4), y, str, c, scale, life: 0.8 });
  }

  // ---------- draw ----------
  draw(s, alpha, ui, dt) {
    const g = this.g;
    if (this.mapRef !== s.map) { this.mapRef = s.map; this.bg = this.makeBackground(s.map, s.season); this.critters.reset(s.map, s.season); this.season = s.season; }
    this.critters.update(Math.min(dt, 0.1), s.enemies);
    this.updateFx(dt);
    g.save();
    g.fillStyle = C.ink;
    g.fillRect(0, 0, W, H);
    const sx = this.shake > 0 ? Math.round((Math.random() * 2 - 1) * this.shake) : 0;
    let sy = this.shake > 0 ? Math.round((Math.random() * 2 - 1) * this.shake) : 0;
    let qx = 0;
    if (this.quake > 0) {
      // slow rolling sway instead of jitter: feels like the ground moves
      const k = Math.min(1, this.quake), t = performance.now();
      qx = Math.round(Math.sin(t * 0.04) * 2.5 * k);
      sy += Math.round(Math.sin(t * 0.065) * 1.2 * k);
      if (Math.random() < 0.5) this.parts.push({ x: Math.random() * COLS * TILE, y: -2, vx: 0, vy: 40 + Math.random() * 40, life: 0.6, c: Math.random() < 0.5 ? "#8a6248" : C.slate, s: 2 });
    }
    g.translate(MX + sx + qx, MY + sy);
    g.drawImage(this.bg, 0, 0);
    this.drawWater(s);
    this.critters.drawFish(g);
    if (!s.queue.length && !s.over) this.drawLanePreview(s);

    // relocation: highlight every free tile the tower can move to
    const mover = ui.moving && s.towers.find((t) => t.id === ui.moving);
    if (mover) {
      g.fillStyle = "rgba(167,240,112,0.28)";
      for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) if (canMove(s, mover, tx, ty)) g.fillRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
      this.outline(mover.tx * TILE, mover.ty * TILE);
    }
    // range previews
    const sel = ui.selected && s.towers.find((t) => 't' + t.id === ui.selected);
    if (sel) this.rangeCircle(sel.x, sel.y, towerStats(s, sel).range, true);
    if (ui.build && ui.hover) {
      const { tx, ty } = ui.hover;
      const ok = canPlace(s, tx, ty) && (s.players[ui.me || 0] || s.players[0]).gold >= TOWERS[ui.build].cost;
      this.rangeCircle(tx * TILE + 12, ty * TILE + 12, TOWERS[ui.build].range * (s.players[ui.me || 0] || s.players[0]).mods.range, ok);
    }
    if (ui.ability === 'meteor' && ui.mouse) this.rangeCircle(ui.mouse.x, ui.mouse.y, ABILITIES.meteor.radius, true, C.orange);
    if (ui.ability === 'wall' && ui.hover) {
      g.fillStyle = isRoad(s, ui.hover.tx, ui.hover.ty) ? 'rgba(255,205,117,0.35)' : 'rgba(177,62,83,0.4)';
      g.fillRect(ui.hover.tx * TILE, ui.hover.ty * TILE, TILE, TILE);
    }

    for (const z of s.zones) this.drawZone(z, s.tick);
    this.drawDecals();
    if (ui.hover && !ui.ability && !ui.build) {
      g.fillStyle = 'rgba(244,244,244,0.08)';
      g.fillRect(ui.hover.tx * TILE, ui.hover.ty * TILE, TILE, TILE);
    }

    // y-sorted world: towers, enemies, obstacles, barrels, walls, castle
    const items = [];
    for (const t of s.towers) items.push({ y: t.y, t });
    for (const o of s.obstacles) items.push({ y: o.ty * TILE + 12, o });
    for (const b of s.barrels) items.push({ y: b.y, b });
    for (const w of s.walls) items.push({ y: w.y, w });
    for (const e of s.enemies) items.push({ y: e.py + (e.y - e.py) * alpha, e });
    if (s.map.castle) items.push({ y: s.map.castle[1] * TILE + 12, castle: true });
    for (const c of this.critters.list) items.push({ y: c.y, critter: c });
    items.sort((a, b) => a.y - b.y);
    const hov = (tx, ty) => ui.hover && ui.hover.tx === tx && ui.hover.ty === ty;
    for (const it of items) {
      if (it.o) {
        drawObstacle(g, it.o, it.o.tx * TILE, it.o.ty * TILE, s.season);
        if (hov(it.o.tx, it.o.ty)) this.outline(it.o.tx * TILE, it.o.ty * TILE);
      } else if (it.b) {
        drawBarrel(g, it.b.tx * TILE, it.b.ty * TILE, it.b.ready, s.tick);
        if (it.b.ready && hov(it.b.tx, it.b.ty)) { this.rangeCircle(it.b.x, it.b.y, BARREL.radius, true, C.orange); this.outline(it.b.tx * TILE, it.b.ty * TILE); }
      } else if (it.w) {
        drawWall(g, it.w, s.tick);
      } else if (it.critter) {
        this.critters.draw(g, it.critter);
      } else if (it.castle) {
        drawCastle(g, s.map.castle[0] * TILE, s.map.castle[1] * TILE);
      } else if (it.t) {
        const t = it.t;
        drawTower(g, t.kind, t.tx * TILE, t.ty * TILE, TOWERS[t.kind].support ? t.aura.dmg + t.aura.rate : TOWERS[t.kind].from ? 4 : t.level, t.aim, s.tick, s.tick - t.fired < 2);
        if (s.players.length > 1) this.ownerMark(t.tx * TILE, t.ty * TILE, t.owner);
        this.auraMarks(s, t);
        if (t.stunT > 0) this.stunMark(t, s.tick);
        if ('t' + t.id === ui.selected || hov(t.tx, t.ty)) this.outline(t.tx * TILE, t.ty * TILE);
      } else this.drawEnemy(g, it.e, alpha, s.tick, ui.hoverEnemy === it.e.id);
    }

    if (mover && ui.hover && canMove(s, mover, ui.hover.tx, ui.hover.ty)) {
      g.globalAlpha = 0.6;
      drawTower(g, mover.kind, ui.hover.tx * TILE, ui.hover.ty * TILE, TOWERS[mover.kind].from ? 4 : mover.level, mover.aim, s.tick);
      g.globalAlpha = 1;
    }
    // ghost tower
    if (ui.build && ui.hover) {
      const { tx, ty } = ui.hover;
      g.globalAlpha = 0.55;
      drawTower(g, ui.build, tx * TILE, ty * TILE, 1, 0, s.tick);
      g.globalAlpha = 1;
      if (!canPlace(s, tx, ty)) { g.fillStyle = 'rgba(177,62,83,0.45)'; g.fillRect(tx * TILE, ty * TILE, TILE, TILE); }
    }

    this.drawMagnets(s);
    this.drawProjectiles(s, alpha);
    for (const c of s.coins) drawCoin(g, c.x, c.y, s.tick + c.id, c.life < 2 * TICK_RATE);
    for (const ch of this.chests) drawChest(g, ch.x, ch.y - (1 - ch.life) * 14);

    for (const z of this.zaps) {
      g.fillStyle = z.life > 0.1 ? C.white : C.cyan;
      for (let i = 0; i < z.pts.length - 1; i++) this.jaggedLine(z.pts[i], z.pts[i + 1]);
    }
    for (const rg of this.rings) {
      g.strokeStyle = rg.c;
      g.globalAlpha = Math.max(0, rg.life);
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(Math.round(rg.x), Math.round(rg.y), rg.r, rg.r * 0.75, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const p of this.parts) {
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.s || 1, p.s || 1);
    }
    for (const t of this.texts) {
      g.globalAlpha = Math.min(1, t.life * 3);
      drawNum(g, t.str, t.x - numWidth(t.str, t.scale) / 2, t.y, t.c, t.scale, C.ink);
      g.globalAlpha = 1;
    }
    this.drawSpeech(s, alpha);
    this.drawBossBar(s);
    g.restore();

    if (this.redFlash > 0) { g.fillStyle = `rgba(177,62,83,${this.redFlash})`; g.fillRect(0, 0, W, H); }
    if (this.blueFlash > 0) { g.fillStyle = `rgba(115,239,247,${this.blueFlash})`; g.fillRect(0, 0, W, H); }
    this.drawHud(s, ui.me || 0);
  }

  // Comic-style bubbles above talking bosses.
  drawSpeech(s, alpha) {
    const g = this.g;
    g.font = "8px \"Pixelify Sans\", monospace";
    for (const b of this.speech) {
      const e = s.enemies.find((k) => k.id === b.id);
      if (!e) { b.life = 0; continue; }
      const x = Math.round(e.px + (e.x - e.px) * alpha), y = Math.round(e.py + (e.y - e.py) * alpha) - 40;
      const w = Math.ceil(g.measureText(b.text).width) + 10;
      const bx = Math.max(2, Math.min(COLS * TILE - w - 2, x - w / 2)), by = Math.max(2, y - 14);
      const pop = Math.min(1, (b.max - b.life) * 8);
      g.globalAlpha = Math.min(1, b.life * 2) * pop;
      g.fillStyle = C.ink; g.fillRect(bx - 1, by - 1, w + 2, 15);
      g.fillStyle = C.white; g.fillRect(bx, by, w, 13);
      g.fillStyle = C.ink;
      for (let i = 0; i < 4; i++) g.fillRect(x - 2 + i, by + 13 + i, 4 - i, 1);
      g.fillStyle = C.ink; g.fillText(b.text, bx + 5, by + 10);
      g.globalAlpha = 1;
    }
  }

  // Wide HP bar with the boss name while a boss is alive.
  drawBossBar(s) {
    const e = s.enemies.find((k) => this.bossInfo[k.id]);
    if (!e) return;
    const g = this.g, info = this.bossInfo[e.id];
    const w = 240, x = Math.round((COLS * TILE - w) / 2), y = 4;
    g.fillStyle = C.ink; g.fillRect(x - 2, y - 2, w + 4, 18);
    g.fillStyle = C.plum; g.fillRect(x, y + 10, w, 4);
    g.fillStyle = C.red; g.fillRect(x, y + 10, Math.round(w * Math.max(0, e.hp) / e.maxHp), 4);
    g.font = "8px \"Pixelify Sans\", monospace";
    g.fillStyle = C.yellow;
    g.fillText(`${info.name} — ${info.title} · ${info.skill.name}`, x + 2, y + 7);
  }

  drawWater(s) {
    if (s.season === "winter") return; // frozen: no ripples
    const g = this.g;
    for (const k of s.map.water) {
      const [tx, ty] = k.split(',').map(Number);
      const ph = (tx * 7 + ty * 13 + (s.tick >> 3)) % 9;
      if (ph < 3) { g.fillStyle = C.sky; g.fillRect(tx * TILE + 4 + ph * 4, ty * TILE + 8 + ph * 3, 5, 1); }
      if (ph === 5) { g.fillStyle = C.white; g.fillRect(tx * TILE + 14, ty * TILE + 15, 2, 1); }
    }
  }

  // Animated chevrons along the lanes the next wave will take.
  drawLanePreview(s) {
    const g = this.g;
    for (const lane of s.plan) {
      const L = s.map.lanes[lane];
      g.fillStyle = 'rgba(255,205,117,0.8)';
      for (let d = (s.tick * 1.5) % 36; d < L.total; d += 36) {
        const p = posAt(s.map, lane, d), q = posAt(s.map, lane, d + 4);
        const a = Math.atan2(q.y - p.y, q.x - p.x);
        for (let i = -3; i <= 3; i++) {
          const k = Math.abs(i);
          g.fillRect(Math.round(p.x - Math.cos(a) * k - Math.sin(a) * i), Math.round(p.y - Math.sin(a) * k + Math.cos(a) * i), 2, 2);
        }
      }
      const sp = s.map.spawns[lane] || s.map.spawns[0];
      const e = edgeOf(sp);
      const mx = e === "left" ? 16 : e === "right" ? COLS * TILE - 26 : sp[0] * TILE + 26;
      const my = e === "top" ? 4 : e === "bottom" ? ROWS * TILE - 20 : sp[1] * TILE + 2;
      if ((s.tick >> 3) % 2) drawNum(g, "!", mx, my, C.yellow, 3, C.ink);
    }
  }

  drawProjectiles(s, alpha) {
    const g = this.g;
    for (const p of s.projs) {
      const x = Math.round(p.px + (p.x - p.px) * alpha), y = Math.round(p.py + (p.y - p.py) * alpha);
      switch (p.kind) {
        case 'arrow': {
          const a = Math.atan2(p.ty - p.y, p.tx - p.x);
          g.fillStyle = C.white;
          for (let i = 0; i < 6; i++) g.fillRect(Math.round(x - Math.cos(a) * i), Math.round(y - Math.sin(a) * i), 1, 1);
          g.fillStyle = C.red;
          g.fillRect(Math.round(x - Math.cos(a) * 6), Math.round(y - Math.sin(a) * 6), 1, 1);
          break;
        }
        case 'ball':
          ellipse(g, x, y + 10, 3, 1, 'rgba(0,0,0,0.3)');
          g.fillStyle = C.ink; g.fillRect(x - 3, y - 3, 6, 6);
          g.fillStyle = C.slate; g.fillRect(x - 2, y - 3, 3, 2);
          break;
        case 'ice':
          g.fillStyle = C.cyan; g.fillRect(x - 2, y - 2, 4, 4);
          g.fillStyle = C.white; g.fillRect(x - 1, y - 1, 2, 2);
          break;
        case 'fire':
          g.fillStyle = C.orange; g.fillRect(x - 3, y - 3, 6, 6);
          g.fillStyle = C.yellow; g.fillRect(x - 2, y - 2, 3, 3);
          if (Math.random() < 0.7) this.parts.push({ x, y, vx: 0, vy: -12, life: 0.25, c: C.red, s: 2 });
          break;
      }
    }
  }

  drawEnemy(g, e, alpha, tick, hovered) {
    const x = e.px + (e.x - e.px) * alpha;
    const y = e.py + (e.y - e.py) * alpha;
    const frozen = e.slowT > 0 && e.slowF === 0;
    const spr = (e.flash > 0 ? FLASH : SPRITES)[e.type];
    const heavy = e.type === "boss" || e.type === "king";
    let bob;
    if (heavy) {
      // heavy gait: slow lift, hard drop; every landing shakes the ground
      const STEP = e.type === "king" ? 18 : 14;
      const phase = (tick + e.id) % STEP;
      bob = frozen || e.blocked ? 0 : Math.round(Math.sin((phase / STEP) * Math.PI) * (e.type === "king" ? 6 : 4));
      if (phase === 0 && !frozen && this.lastStomp[e.id] !== tick) {
        this.lastStomp[e.id] = tick;
        this.stomp(x, y, e.type === "king");
      }
    } else {
      bob = frozen || e.blocked ? 0 : e.type === "runner" ? ((tick >> 1) % 2) * 2 : (((tick + e.id * 3) >> 2) % 2) * 2;
    }
    const dx = Math.round(x - spr.width / 2), dy = Math.round(y - spr.height + 6 - bob);
    ellipse(g, Math.round(x), Math.round(y) + 6, Math.max(2, Math.round(spr.width / 2.6) - (heavy ? Math.floor(bob / 2) : 0)), heavy ? 3 : 2, heavy ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.3)");
    if (hovered) ellipse(g, Math.round(x), Math.round(y) + 6, Math.round(spr.width / 2) + 2, 3, 'rgba(255,205,117,0.6)');
    g.drawImage(spr, dx, dy);
    if (frozen) g.drawImage(FROZEN[e.type], dx, dy);
    if (e.wetT > 0 && (tick >> 2) % 3 === 0) { g.fillStyle = C.sky; g.fillRect(dx + 2 + (e.id % 9), dy + spr.height, 1, 3); }
    if (e.slowT > 0 && !frozen) { g.fillStyle = C.cyan; g.fillRect(dx, dy + spr.height - 1, spr.width, 1); }
    if (e.burnT > 0 && Math.random() < 0.6) this.parts.push({ x: x + Math.random() * 10 - 5, y: dy + 4, vx: 0, vy: -24, life: 0.3, c: Math.random() < 0.5 ? C.orange : C.yellow, s: 2 });
    if (e.blocked && (tick >> 2) % 2) this.parts.push({ x: x + Math.random() * 8 - 4, y: y + 4, vx: Math.random() * 20 - 10, vy: -10, life: 0.3, c: '#c28569' });
    if (e.hp < e.maxHp) {
      const w = Math.max(14, spr.width);
      const bx = Math.round(x - w / 2), by = dy - 4;
      g.fillStyle = C.ink; g.fillRect(bx - 1, by - 1, w + 2, 4);
      g.fillStyle = C.red; g.fillRect(bx, by, w, 2);
      g.fillStyle = C.lime; g.fillRect(bx, by, Math.max(1, Math.round((w * e.hp) / e.maxHp)), 2);
    }
  }

  stomp(x, y, king) {
    this.shake = Math.max(this.shake, king ? 2.5 : 1.6);
    for (const side of [-1, 1]) this.burst(x + side * 8, y + 6, king ? 8 : 5, "#a8805e", 35, -12);
    this.decals.push({ x: Math.round(x), y: Math.round(y) + 6, life: 4, big: king, seed: Math.random() });
    if (this.decals.length > 40) this.decals.shift();
    if (this.onStomp) this.onStomp(king);
  }

  drawDecals() {
    const g = this.g;
    for (const d of this.decals) {
      g.globalAlpha = Math.min(1, d.life / 1.5) * 0.7;
      g.fillStyle = "#4a3324";
      const n = d.big ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const a = d.seed * 6.28 + (i * 6.28) / n, len = d.big ? 9 : 6;
        for (let k = 1; k < len; k++) g.fillRect(Math.round(d.x + Math.cos(a) * k), Math.round(d.y + Math.sin(a) * k * 0.5), 1, 1);
      }
      g.globalAlpha = 1;
    }
  }

  drawZone(z, tick) {
    const g = this.g;
    g.globalAlpha = 0.85 * Math.min(1, z.life / 20);
    ellipse(g, Math.round(z.x), Math.round(z.y), z.r, Math.round(z.r * 0.55), C.red);
    ellipse(g, Math.round(z.x), Math.round(z.y), Math.round(z.r * 0.6), Math.round(z.r * 0.3), C.orange);
    g.globalAlpha = 1;
    if ((tick + Math.round(z.x)) % 3 === 0) this.parts.push({ x: z.x + Math.random() * z.r - z.r / 2, y: z.y, vx: 0, vy: -18, life: 0.4, c: C.yellow });
  }

  // Aura buffs on a tower: orange sword = damage aura, cyan clock = attack-speed aura.
  // Totems with any aura show their reach as a soft dotted ring.
  auraMarks(s, t) {
    const g = this.g;
    const x = t.tx * TILE, y = t.ty * TILE;
    if (TOWERS[t.kind].support) {
      if (!t.aura.dmg && !t.aura.rate) return;
      const r = TOWERS[t.kind].range, n = 28, ph = s.tick * 0.02;
      g.fillStyle = t.aura.dmg >= t.aura.rate ? 'rgba(239,125,87,0.55)' : 'rgba(115,239,247,0.55)';
      for (let i = 0; i < n; i++) {
        const a = ph + (i / n) * Math.PI * 2;
        g.fillRect(Math.round(t.x + Math.cos(a) * r), Math.round(t.y + Math.sin(a) * r * 0.8), 2, 1);
      }
      return;
    }
    const a = towerStats(s, t).aura;
    if (!a || (!a.dmg && !a.rate)) return;
    const glow = (s.tick >> 3) % 2;
    if (a.dmg) {
      // tiny sword
      g.fillStyle = C.ink; g.fillRect(x + 1, y + 15, 5, 7);
      g.fillStyle = glow ? C.yellow : C.orange; g.fillRect(x + 3, y + 16, 1, 4);
      g.fillStyle = C.orange; g.fillRect(x + 2, y + 19, 3, 1); g.fillRect(x + 3, y + 20, 1, 1);
    }
    if (a.rate) {
      // tiny clock
      g.fillStyle = C.ink; g.fillRect(x + 18, y + 15, 6, 6);
      g.fillStyle = glow ? C.white : C.cyan; g.fillRect(x + 19, y + 16, 4, 4);
      g.fillStyle = C.ink; g.fillRect(x + 21, y + 17, 1, 2); g.fillRect(x + 21, y + 18, 1, 1);
    }
  }

  // Stunned by the King's decree: grey veil and floating "z".
  stunMark(t, tick) {
    const g = this.g;
    const x = t.tx * TILE, y = t.ty * TILE;
    g.fillStyle = 'rgba(86,108,134,0.45)';
    g.fillRect(x + 3, y - 8, 18, 30);
    g.fillStyle = C.white;
    const k = (tick >> 2) % 6;
    g.fillRect(x + 15, y - 6 - k, 3, 1); g.fillRect(x + 16, y - 5 - k, 1, 1); g.fillRect(x + 15, y - 4 - k, 3, 1);
  }

  // Baron's magnet: crackling lines to every tower in reach.
  drawMagnets(s) {
    const g = this.g;
    for (const e of s.enemies) {
      if (!(e.magnetT > 0)) continue;
      const r = 110;
      g.strokeStyle = 'rgba(148,176,194,0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(Math.round(e.x), Math.round(e.y - 8), 14 + ((s.tick >> 1) % 6), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = (s.tick >> 1) % 2 ? C.silver : C.cyan;
      for (const t of s.towers) {
        if (TOWERS[t.kind].support || Math.hypot(t.x - e.x, t.y - e.y) > r) continue;
        this.jaggedLine({ x: t.x, y: t.y - 12 }, { x: e.x, y: e.y - 8 });
      }
    }
  }

  buffMark(x, y, tick) {
    if ((tick >> 2) % 2) return;
    this.g.fillStyle = C.yellow;
    this.g.fillRect(x + 20, y - 2, 2, 5);
    this.g.fillRect(x + 18, y, 6, 1);
  }

  jaggedLine(a, b) {
    const g = this.g;
    const n = Math.max(2, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : Math.random() * 4 - 2;
      g.fillRect(Math.round(a.x + (b.x - a.x) * t + j), Math.round(a.y + (b.y - a.y) * t + j), 2, 1);
    }
  }

  rangeCircle(x, y, r, ok, color) {
    const g = this.g;
    g.fillStyle = ok ? 'rgba(244,244,244,0.08)' : 'rgba(177,62,83,0.15)';
    g.strokeStyle = color || (ok ? 'rgba(244,244,244,0.55)' : 'rgba(177,62,83,0.7)');
    g.lineWidth = 1;
    g.beginPath();
    g.arc(Math.round(x) + 0.5, Math.round(y) + 0.5, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  outline(x, y) {
    const g = this.g;
    g.fillStyle = C.yellow;
    for (const [ox, oy] of [[0, 0], [19, 0], [0, 23], [19, 23]]) g.fillRect(x + ox, y + oy, 5, 1);
    for (const [ox, oy] of [[0, 0], [23, 0], [0, 19], [23, 19]]) g.fillRect(x + ox, y + oy, 1, 5);
  }

  ownerMark(x, y, owner) {
    const g = this.g;
    g.fillStyle = C.ink; g.fillRect(x + 1, y - 4, 6, 5);
    g.fillStyle = PLAYER_COLORS[owner] || C.white; g.fillRect(x + 2, y - 3, 4, 3);
  }

  drawHud(s, me) {
    const pl = s.players[me] || s.players[0];
    const g = this.g;
    g.fillStyle = C.ink;
    g.fillRect(0, 0, W, HUD);
    g.fillStyle = C.dark;
    g.fillRect(0, HUD - 1, W, 1);
    if (s.mode === "circle") {
      const danger = s.enemies.length >= s.limit * 0.75;
      drawIcon(g, "skull", 8, 8);
      drawNum(g, s.enemies.length + "/" + s.limit, 18, 5, danger ? C.red : C.white, 2);
    } else {
      drawIcon(g, "heart", 8, 7);
      drawNum(g, s.lives, 18, 5, s.lives <= 5 ? C.red : C.white, 2);
    }
    drawIcon(g, "coin", 86, 7);
    drawNum(g, pl.gold, 94, 5, C.yellow, 2);
    drawIcon(g, 'flag', 160, 7);
    drawNum(g, s.wave + '/' + CONFIG.winWave, 168, 5, C.white, 2);
    drawIcon(g, 'skull', 250, 8);
    drawNum(g, s.kills, 258, 5, C.silver, 2);
    if (!s.queue.length && !s.over && s.wave < CONFIG.winWave) {
      const total = (s.wave === 0 ? CONFIG.firstWaveDelay : CONFIG.waveDelay) * TICK_RATE;
      const w = 110, x = 330;
      g.fillStyle = C.dark; g.fillRect(x, 6, w, 8);
      g.fillStyle = C.orange; g.fillRect(x + 1, 7, Math.max(0, Math.round((w - 2) * (s.countdown / total))), 6);
      drawNum(g, Math.ceil(s.countdown / TICK_RATE), x + w + 6, 5, C.orange, 2);
    } else if (s.queue.length) {
      drawIcon(g, 'skull', 330, 8);
      drawNum(g, s.queue.length, 338, 5, C.red, 2);
    }
  }

  // Seasonal weather particles: petals, falling leaves, snow; summer has glints on the ponds.
  ambient(dt) {
    const W2 = COLS * TILE, H2 = ROWS * TILE;
    const sea = this.season;
    if (sea === "winter" && Math.random() < dt * 40) this.parts.push({ x: Math.random() * W2, y: -2, vx: Math.random() * 8 - 4, vy: 18 + Math.random() * 14, life: 14, c: C.white, s: Math.random() < 0.3 ? 2 : 1, keep: true });
    if (sea === "autumn" && Math.random() < dt * 6) this.parts.push({ x: Math.random() * W2, y: -2, vx: 10 + Math.random() * 10, vy: 14 + Math.random() * 8, life: 14, c: [C.orange, C.red, C.yellow][Math.floor(Math.random() * 3)], s: 2, keep: true, sway: Math.random() * 6 });
    if (sea === "spring" && Math.random() < dt * 5) this.parts.push({ x: Math.random() * W2, y: -2, vx: 12 + Math.random() * 8, vy: 10 + Math.random() * 6, life: 16, c: Math.random() < 0.7 ? "#f4b6d2" : C.white, s: 1, keep: true, sway: Math.random() * 6 });
    if (sea === "summer" && this.mapRef && this.mapRef.water.size && Math.random() < dt * 3) {
      const tiles = [...this.mapRef.water];
      const [tx, ty] = tiles[Math.floor(Math.random() * tiles.length)].split(",").map(Number);
      this.parts.push({ x: tx * TILE + Math.random() * TILE, y: ty * TILE + Math.random() * TILE, vx: 0, vy: 0, life: 0.4, c: C.white });
    }
    void H2;
  }

  updateFx(dt) {
    this.ambient(dt);
    for (const p of this.parts) {
      p.x += (p.vx + (p.sway ? Math.sin(p.life * 3 + p.sway) * 10 : 0)) * dt; p.y += p.vy * dt;
      if (!p.keep) { p.vx *= 0.92; p.vy *= 0.92; }
      p.life -= dt;
      if (p.keep && p.y > ROWS * TILE) p.life = 0; // weather leaves the map at the bottom
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 2000) this.parts.splice(0, this.parts.length - 2000);
    for (const t of this.texts) { t.y -= 22 * dt; t.life -= dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const ch of this.chests) ch.life -= dt;
    this.chests = this.chests.filter((c) => c.life > 0);
    for (const z of this.zaps) z.life -= dt;
    this.zaps = this.zaps.filter((z) => z.life > 0);
    for (const rg of this.rings) { rg.r += (rg.max - rg.r) * Math.min(1, dt * 14); rg.life -= dt * 3; }
    this.rings = this.rings.filter((rg) => rg.life > 0);
    this.shake = Math.max(0, this.shake - dt * 25);
    this.redFlash = Math.max(0, this.redFlash - dt);
    this.blueFlash = Math.max(0, this.blueFlash - dt * 1.2);
    this.quake = Math.max(0, this.quake - dt);
    for (const d of this.decals) d.life -= dt;
    this.decals = this.decals.filter((d) => d.life > 0);
    for (const b of this.speech) b.life -= dt;
    this.speech = this.speech.filter((b) => b.life > 0);
  }
}
