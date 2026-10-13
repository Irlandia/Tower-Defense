// Canvas renderer + visual juice. Reads sim state, never mutates it.
import { TILE, COLS, ROWS, TICK_RATE, TOWERS, CONFIG, ABILITIES, BARREL, BOSSES, bossFor, DAY } from './sim/data.js';
import { towerStats, canPlace, posAt, isRoad, canMove, dayPhase, family } from './sim/sim.js';
import {
  C, SPRITES, FLASH, FROZEN, ENEMY_COLOR, drawTower, drawCastle, drawCave, drawNum, numWidth, drawIcon,
  drawObstacle, drawBarrel, drawCoin, drawChest, drawWall, ellipse, drawFarmHouse, drawField, bossSprites,
} from './sprites.js';
import { say, SAY } from "./say.js";
import { Critters } from './critters.js';
import { makeBackground, edgeOf } from './background.js';

export const PLAYER_COLORS = [C.yellow, C.cyan, C.lime, "#f4b6d2"];
const ABILITY_COLOR = { meteor: C.orange, goldrain: C.yellow, quake: '#8a6248' };
// where a spawn tile sits on the map edge: cave and "!" marker positions

const SHAKE = 0.35; // global screen-shake strength (1 = old, very shaky)
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
    this.labels = []; // short HTML callouts (combo names) that float up
    this.comboAt = {}; // kind -> time of the last callout, so combos are announced, not spammed
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

  // ---------- events -> effects ----------
  onEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          // colour = effectiveness vs this enemy type: green weak spot, grey resisted
          {
            const c = e.crit ? C.yellow : e.eff > 0 ? C.lime : e.eff < 0 ? C.slate : C.white, sc = e.crit || e.eff > 0 ? 2 : 1;
            // rapid hits on one enemy (inferno, chains) add up into one rising number instead of noise
            const prev = !e.crit && e.id !== undefined && this.texts.find((t) => t.hid === e.id && t.life > 0.5);
            if (prev) { prev.sum += e.dmg; prev.str = prev.sum; prev.x = e.x; prev.life = 0.8; prev.y = Math.min(prev.y, e.y - 18); }
            else { this.text(e.x, e.y - 18, e.dmg, c, sc); const t = this.texts[this.texts.length - 1]; if (!e.crit) { t.hid = e.id; t.sum = e.dmg; } }
          }
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
          this.combo('steam', e.x, e.y, 'Мокрий + вогонь: ПАРА!', '#f4f4f4');
          this.rings.push({ x: e.x, y: e.y, r: 2, max: CONFIG.steamRadius, c: C.white, life: 1 });
          this.burst(e.x, e.y, 18, C.silver, 60, -30);
          this.text(e.x, e.y - 28, 'x2', C.cyan, 2);
          this.shake = Math.max(this.shake, 2.5);
          break;
        case 'goldrain':
          // coins rain down over the circle, sparkling as they land
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.yellow, life: 1 });
          for (let i = 0; i < 12; i++) this.burst(e.x + Math.random() * e.r - e.r / 2, e.y + Math.random() * e.r / 2, 3, C.yellow, 30, -40);
          break;
        case 'quake':
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: '#8a6248', life: 1 });
          this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.6, c: C.orange, life: 0.8 });
          this.burst(e.x, e.y + 4, 30, '#8a6248', 70, -20);
          this.shake = Math.max(this.shake, 5);
          break;
        case 'zap':
          this.zaps.push({ pts: e.pts, life: 0.18 });
          if (e.wet) this.combo('shock', e.pts[1].x, e.pts[1].y, 'Мокрий + блискавка ×2', '#73eff7');
          if (e.over >= 2) this.burst(e.pts[1].x, e.pts[1].y, 10, C.orange, 60);
          for (const p of e.pts.slice(1)) this.burst(p.x, p.y, 4, C.cyan, 50);
          break;
        case 'spores': // a green cloud where spores burst (bloom) or pass to the neighbours (spread)
          this.rings.push({ x: e.x, y: e.y, r: 3, max: e.r, c: e.burst ? C.plum : C.lime, life: 0.7 });
          this.burst(e.x, e.y, e.burst ? 24 : 8, e.burst ? C.plum : C.lime, 60, -20);
          if (e.burst) this.shake = Math.max(this.shake, 3);
          break;
        case 'meteor':
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.yellow, life: 1 });
          this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.7, c: C.red, life: 1 });
          this.burst(e.x, e.y, 60, C.orange, 120);
          this.burst(e.x, e.y, 30, C.yellow, 90);
          this.shake = 8;
          break;
        case "bossSpawn": case "bossReveal": {
          const info = e.bk ? BOSSES[e.bk] : bossFor(e.wave);
          this.bossInfo[e.id] = info;
          if (e.hidden) break; // Перевертень walks in as a slime
          if (e.type === "bossReveal") { this.burst(e.x, e.y - 8, 40, C.green, 110, -20); this.rings.push({ x: e.x, y: e.y, r: 4, max: 40, c: C.lime, life: 0.8 }); this.shake = Math.max(this.shake, 6); }
          this.quake = 2.2;
          this.say(e.id, info.lines[Math.floor(Math.random() * info.lines.length)], 3.5);
          break;
        }
        case "bossSkill": {
          // name the move above the boss so players learn what each one does
          const bi = this.bossInfo[e.id];
          if (bi && e.kind !== "snipeHit") this.labels.push({ x: e.x, y: e.y - 44, text: bi.skill.name + '!', color: bi.color || '#ffcd75', life: 1.2 });
          const col = (bi && bi.color) || C.white;
          if (e.kind === "summon") { this.burst(e.x, e.y, 22, col, 60, -20); this.rings.push({ x: e.x, y: e.y, r: 2, max: 24, c: col, life: 0.8 }); }
          if (e.kind === "blink") { this.burst(e.x, e.y, 18, C.lime, 70, -25); this.rings.push({ x: e.x, y: e.y + 4, r: 2, max: 18, c: C.lime, life: 0.6 }); }
          if (e.kind === "rally") this.rings.push({ x: e.x, y: e.y, r: 4, max: 70, c: C.lime, life: 1 });
          if (e.kind === "shield") { this.burst(e.x, e.y - 8, 14, C.silver, 40); this.shake = Math.max(this.shake, 2); }
          if (e.kind === "haste") this.rings.push({ x: e.x, y: e.y, r: 4, max: 80, c: C.plum, life: 1 });
          if (e.kind === "burrow" || e.kind === "steal") this.burst(e.x, e.y + 2, 24, e.kind === "steal" ? C.yellow : "#8a6248", 70, -30);
          if (e.kind === "heal") { this.burst(e.x, e.y - 8, 16, C.red, 40, -30); this.text(e.x, e.y - 30, '+', C.red, 2); }
          if (e.kind === "cleanse") this.rings.push({ x: e.x, y: e.y - 8, r: 2, max: 26, c: C.cyan, life: 0.8 });
          if (e.kind === "shuffle") { this.burst(e.x, e.y - 8, 20, C.orange, 60); this.burst(e.x, e.y - 8, 10, C.blue, 60); }
          if (e.kind === "reverse") { this.rings.push({ x: e.x, y: e.y - 8, r: 4, max: 60, c: C.cyan, life: 0.9 }); this.rings.push({ x: e.x, y: e.y - 8, r: 60, max: 4, c: C.white, life: 0.9 }); this.shake = Math.max(this.shake, 3); }
          if (e.kind === "dark") this.rings.push({ x: e.x, y: e.y - 8, r: 4, max: 90, c: C.navy, life: 1.2 });
          if (e.kind === "trail") this.burst(e.x, e.y + 4, 14, C.lime, 40, -10);
          if (e.kind === "snipeHit") { this.burst(e.x, e.y - 10, 20, C.orange, 60); this.burst(e.x, e.y - 10, 10, C.yellow, 40); this.shake = Math.max(this.shake, 2); }
        }
          if (e.kind === "dash") { this.burst(e.x, e.y + 4, 20, "#a8805e", 70, -10); this.text(e.x, e.y - 34, "!!", C.red, 2); this.shake = Math.max(this.shake, 3); }
          if (e.kind === "brood") { this.burst(e.x, e.y, 24, C.lime, 60, -20); this.rings.push({ x: e.x, y: e.y, r: 2, max: 20, c: C.green, life: 0.8 }); }
          if (e.kind === "magnet") { this.rings.push({ x: e.x, y: e.y - 8, r: 60, max: 4, c: C.silver, life: 1 }); this.burst(e.x, e.y - 8, 16, C.silver, 50); }
          if (e.kind === "decree") { this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.plum, life: 1 }); this.rings.push({ x: e.x, y: e.y, r: 2, max: e.r * 0.6, c: C.yellow, life: 1 }); this.shake = Math.max(this.shake, 4); }
          break;
        case "bossRage": {
          const info = this.bossInfo[e.id] || (e.bk ? BOSSES[e.bk] : bossFor(e.wave));
          this.say(e.id, info.rage[Math.floor(Math.random() * info.rage.length)], 2.5);
          this.shake = Math.max(this.shake, 4);
          break;
        }
        case 'rain': // Дощова хмарка: a ring of drops and steam where fire was put out
          this.rings.push({ x: e.x, y: e.y, r: 4, max: e.r, c: C.sky, life: 0.6 });
          this.burst(e.x, e.y - 4, 6, C.cyan, 30, 20);
          break;
        case 'shed': // Бляшаний солдатик: a tin plate flies off
          this.burst(e.x, e.y - 8, 6, C.silver, 70, -30);
          this.text(e.x, e.y - 26, '-1🛡', C.silver, 1);
          break;
        case 'leap': // Жабка: dust where she pushes off
          this.burst(e.x, e.y + 4, 8, '#a8805e', 40, -10);
          this.text(e.x, e.y - 22, '!', C.lime, 2);
          break;
        case 'shell': // Мушляк shuts / opens
          this.burst(e.x, e.y - 4, e.on ? 8 : 5, e.on ? C.orange : C.yellow, 40, -15);
          this.rings.push({ x: e.x, y: e.y, r: 2, max: 14, c: e.on ? C.orange : C.yellow, life: 0.4 });
          break;
        case 'reveal': // Туманець is seen for good
          this.burst(e.x, e.y - 6, 10, C.cyan, 50, -10);
          this.rings.push({ x: e.x, y: e.y, r: 2, max: 18, c: C.cyan, life: 0.5 });
          this.text(e.x, e.y - 24, '!', C.cyan, 2);
          break;
        case 'pile': // Кістлявчик collapses
          this.burst(e.x, e.y - 4, 14, C.white, 60, -20);
          this.text(e.x, e.y - 22, '+' + e.gold, C.yellow, 1);
          break;
        case 'rise':
          this.burst(e.x, e.y - 6, 10, C.white, 50, -30);
          this.rings.push({ x: e.x, y: e.y, r: 2, max: 16, c: C.white, life: 0.5 });
          break;
        case 'magpie': // a coin snatched from the map
          this.burst(e.x, e.y, 6, C.yellow, 40, -30);
          break;
        case 'magpieDrop':
          this.burst(e.x, e.y - 4, 8 + e.n * 2, C.yellow, 80, -35);
          break;
        case 'drum': // Барабанщик: a note over the ones he speeds up
          this.text(e.x, e.y - 26, '♪', C.blue, 2);
          this.rings.push({ x: e.x, y: e.y, r: 4, max: 36, c: C.blue, life: 0.4 });
          break;
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
        case 'master': // the final upgrade: a bigger golden burst
          this.rings.push({ x: e.x, y: e.y, r: 2, max: 56, c: C.orange, life: 1.2 });
          this.burst(e.x, e.y - 8, 30, C.orange, 110, -30);
          this.labels.push({ x: e.x, y: e.y - 40, text: '♛ Майстерність!', color: '#ffcd75', life: 1.6 });
        // falls through: plus the evolution sparkle
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

  // Name a synergy when it fires (at most every few seconds per kind) so players learn the combos.
  combo(kind, x, y, text, color) {
    const now = performance.now();
    if (now - (this.comboAt[kind] || -1e9) < 4000) return;
    this.comboAt[kind] = now;
    this.labels.push({ x, y: y - 26, text, color, life: 1.4 });
  }

  text(x, y, str, c, scale) {
    this.texts.push({ x: x + (Math.random() * 8 - 4), y, str, c, scale, life: 0.8 });
  }

  // ---------- draw ----------
  draw(s, alpha, ui, dt) {
    SAY.length = 0; // HTML labels are re-queued every frame
    const g = this.g;
    if (this.mapRef !== s.map) { this.mapRef = s.map; this.bg = makeBackground(s.map, s.season); this.critters.reset(s.map, s.season, s.mission && s.mission.npc); this.season = s.season; this.weather = s.brawl && s.brawl.weather; }
    this.critters.update(Math.min(dt, 0.1), s.enemies);
    this.updateFx(dt);
    g.save();
    g.fillStyle = C.ink;
    g.fillRect(0, 0, W, H);
    // screen shake is toned down globally (SHAKE) and capped, so heavy fights stay readable
    const amp = Math.min(3, this.shake * SHAKE);
    const sx = amp >= 0.5 ? Math.round((Math.random() * 2 - 1) * amp) : 0;
    let sy = amp >= 0.5 ? Math.round((Math.random() * 2 - 1) * amp) : 0;
    let qx = 0;
    if (this.quake > 0) {
      // slow rolling sway instead of jitter: feels like the ground moves
      const k = Math.min(1, this.quake), t = performance.now();
      qx = Math.round(Math.sin(t * 0.04) * 1.2 * k);
      sy += Math.round(Math.sin(t * 0.065) * 0.6 * k);
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
    // targeted abilities: the blast circle under the cursor (its colour says what it does)
    if (ui.ability && ui.ability !== 'wall' && ui.mouse && ABILITIES[ui.ability].radius) {
      this.rangeCircle(ui.mouse.x, ui.mouse.y, ABILITIES[ui.ability].radius, true, ABILITY_COLOR[ui.ability] || C.orange);
    }
    if ((ui.ability === 'wall' || ui.ability === 'dragon') && ui.hover) {
      g.fillStyle = isRoad(s, ui.hover.tx, ui.hover.ty) ? 'rgba(255,205,117,0.35)' : 'rgba(177,62,83,0.4)';
      g.fillRect(ui.hover.tx * TILE, ui.hover.ty * TILE, TILE, TILE);
    }

    for (const z of s.zones) this.drawZone(z, s.tick);
    this.drawDecals();
    this.drawSlimeTrails(s);
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
    if (s.map.farm) items.push({ y: (s.map.farm.house[1] + 1) * TILE - 2, house: true });
    for (const k of this.critters.farmItems()) items.push(k);
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
      } else if (it.house) {
        drawFarmHouse(g, s.map.farm.house[0] * TILE, s.map.farm.house[1] * TILE, s.season, s.tick);
      } else if (it.farmer || it.dog || it.bowl || it.valeria) {
        this.critters.drawFarm(g, it);
      } else if (it.castle) {
        drawCastle(g, s.map.castle[0] * TILE, s.map.castle[1] * TILE);
      } else if (it.t) {
        const t = it.t;
        const lvl = TOWERS[t.kind].support ? t.aura.dmg + t.aura.rate : TOWERS[t.kind].from ? 4 : t.level;
        if (t.master) this.drawMasterTower(t, lvl, s.tick); // the final upgrade: golden outline, orbiting lights, family sparks, crown
        else drawTower(g, t.kind, t.tx * TILE, t.ty * TILE, lvl, t.aim, s.tick, s.tick - t.fired < 2);
        if (s.players.length > 1) this.ownerMark(t.tx * TILE, t.ty * TILE, t.owner);
        if (s.players[t.owner] && s.players[t.owner].overT > 0 && !TOWERS[t.kind].support) this.buffMark(t.tx * TILE, t.ty * TILE, s.tick); // Overdrive sparks
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
    // tutorial: a pulsing frame on a good first spot
    if (ui.tutorTile) {
      const { tx, ty } = ui.tutorTile, o = Math.round(1 + Math.sin(performance.now() / 160) * 1.5);
      g.fillStyle = C.yellow;
      for (const [x, y, w, h] of [[-o, -o, 8, 2], [-o, -o, 2, 8], [TILE + o - 8, -o, 8, 2], [TILE + o - 2, -o, 2, 8],
        [-o, TILE + o - 2, 8, 2], [-o, TILE + o - 8, 2, 8], [TILE + o - 8, TILE + o - 2, 8, 2], [TILE + o - 2, TILE + o - 8, 2, 8]]) {
        g.fillRect(tx * TILE + x, ty * TILE + y, w, h);
      }
    }
    // co-op guest: towers just ordered but not yet confirmed by the host
    if (ui.pendingPlace && ui.pendingPlace.length) {
      const now = performance.now();
      ui.pendingPlace = ui.pendingPlace.filter((q) => now - q.at < 1500 && canPlace(s, q.tx, q.ty));
      for (const q of ui.pendingPlace) {
        g.globalAlpha = 0.45 + 0.15 * Math.sin(now / 90);
        drawTower(g, q.kind, q.tx * TILE, q.ty * TILE, 1, 0, s.tick);
        g.globalAlpha = 1;
      }
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
    if (s.dragons) for (const d of s.dragons) this.drawDragon(d, alpha, s.tick);
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
      if (p.streak) { g.globalAlpha = 0.5; g.fillRect(Math.round(p.x), Math.round(p.y), 1, 4); g.globalAlpha = 1; continue; } // rain
      g.fillRect(Math.round(p.x), Math.round(p.y), p.s || 1, p.s || 1);
    }
    for (const l of this.labels) say(l.x, Math.max(14, l.y), l.text, "bar combo", l.color); // never above the map
    for (const t of this.texts) {
      g.globalAlpha = Math.min(1, t.life * 3);
      drawNum(g, t.str, t.x - numWidth(t.str, t.scale) / 2, t.y, t.c, t.scale, C.ink);
      g.globalAlpha = 1;
    }
    this.drawDaylight(s, ui, dt);
    if (s.farmMax && s.map.farm) this.drawFarmBar(s);
    this.critters.drawFarmSay(g);
    this.drawSpeech(s, alpha);
    this.drawBossBar(s);
    g.restore();

    if (this.redFlash > 0) { g.fillStyle = `rgba(177,62,83,${this.redFlash})`; g.fillRect(0, 0, W, H); }
    if (this.blueFlash > 0) { g.fillStyle = `rgba(115,239,247,${this.blueFlash})`; g.fillRect(0, 0, W, H); }
    this.drawHud(s, ui.me || 0);
  }

  // Night (campaign): darkness over the map with pools of light around towers, the castle, the farm and the cursor.
  // Time of day (sim dayPhase): a colour wash + darkness with pools of light, faded smoothly between phases.
  drawDaylight(s, ui, dt) {
    const LOOK = { // dark = darkness strength, tint = rgba wash over everything
      day: { dark: 0, tint: [0, 0, 0, 0] },
      evening: { dark: 0.24, tint: [239, 125, 87, 0.24] },
      night: { dark: s.mission && s.mission.night ? 0.62 : 0.5, tint: [59, 93, 201, 0.1] },
      dawn: { dark: 0.12, tint: [244, 182, 210, 0.14] },
    };
    const target = LOOK[DAY.phases[dayPhase(s)].id];
    const cur = this.daylight || (this.daylight = { dark: target.dark, tint: [...target.tint] });
    if (this.dayMap !== s.map) { this.dayMap = s.map; cur.dark = target.dark; cur.tint = [...target.tint]; } // new run: no fade
    const k = Math.min(1, (dt || 0) * 0.6); // ~3 s cross-fade
    cur.dark += (target.dark - cur.dark) * k;
    for (let i = 0; i < 4; i++) cur.tint[i] += (target.tint[i] - cur.tint[i]) * k;
    const g = this.g;
    if (cur.tint[3] > 0.01) {
      g.fillStyle = `rgba(${cur.tint[0] | 0},${cur.tint[1] | 0},${cur.tint[2] | 0},${cur.tint[3].toFixed(3)})`;
      g.fillRect(0, 0, COLS * TILE, ROWS * TILE);
    }
    if (cur.dark > 0.02) this.drawNight(s, ui, cur.dark);
    // fireflies on warm nights
    if (cur.dark > 0.35 && s.season !== 'winter' && Math.random() < 0.25) {
      this.parts.push({ x: Math.random() * COLS * TILE, y: Math.random() * ROWS * TILE, vx: Math.random() * 10 - 5, vy: -4, life: 1.2, c: Math.random() < 0.5 ? '#c7f59a' : C.yellow });
    }
  }

  drawNight(s, ui, dark = 0.62) {
    const w = COLS * TILE, h = ROWS * TILE;
    if (!this.nightCv) { this.nightCv = document.createElement("canvas"); this.nightCv.width = w; this.nightCv.height = h; }
    const n = this.nightCv.getContext("2d");
    n.globalCompositeOperation = "source-over";
    n.clearRect(0, 0, w, h);
    n.fillStyle = `rgba(10,12,34,${dark.toFixed(3)})`;
    n.fillRect(0, 0, w, h);
    n.globalCompositeOperation = "destination-out";
    const light = (x, y, r) => {
      const gr = n.createRadialGradient(x, y, r * 0.35, x, y, r);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      n.fillStyle = gr; n.beginPath(); n.arc(x, y, r, 0, Math.PI * 2); n.fill();
    };
    for (const t of s.towers) light(t.x, t.y, towerStats(s, t).range || 40);
    if (s.map.castle) light(s.map.castle[0] * TILE + 12, s.map.castle[1] * TILE + 12, 50);
    if (s.map.farm) light(s.map.farm.house[0] * TILE + 12, s.map.farm.house[1] * TILE + 12, 34);
    for (const e of s.enemies) if (e.burnT > 0) light(e.x, e.y, 18); // burning enemies glow
    if (ui.mouse) light(ui.mouse.x, ui.mouse.y, 30);
    this.g.drawImage(this.nightCv, 0, 0);
  }

  // Campaign: the farm's harvest over the field (enemies passing by trample it).
  drawFarmBar(s) {
    const g = this.g, f = s.map.farm;
    const x = f.x * TILE + 4, y = f.y * TILE - 6, w = f.w * TILE - 8;
    const k = Math.max(0, s.farmHp / s.farmMax);
    g.fillStyle = C.ink; g.fillRect(x - 1, y - 1, w + 2, 5);
    g.fillStyle = C.plum; g.fillRect(x, y, w, 3);
    g.fillStyle = k > 0.5 ? C.lime : k > 0.25 ? C.yellow : C.red; g.fillRect(x, y, Math.round(w * k), 3);
    // wheat-ear icon: this bar is the harvest, not anyone's health
    g.fillStyle = C.yellow; g.fillRect(x - 6, y - 3, 1, 6); g.fillRect(x - 8, y - 2, 2, 1); g.fillRect(x - 5, y - 2, 2, 1); g.fillRect(x - 8, y, 2, 1); g.fillRect(x - 5, y, 2, 1);
  }

  // Comic-style bubbles above talking bosses.
  drawSpeech(s, alpha) {
    for (const b of this.speech) {
      const e = s.enemies.find((k) => k.id === b.id);
      if (!e) { b.life = 0; continue; }
      say(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha - 38, b.text, "boss");
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
    say(x + w / 2, y + 9, `${info.name} — ${info.title} · ${info.skill.name}`, "bar");
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

  // Dragon ability: a little green dragon flapping along the road, breathing fire downward.
  drawDragon(d, alpha, tick) {
    const g = this.g;
    const x = Math.round(d.px + (d.x - d.px) * alpha), y = Math.round(d.py + (d.y - d.py) * alpha) - 22;
    const dir = d.x < d.px ? -1 : 1; // faces where it flies
    const flap = (tick >> 1) % 2;
    const P = (px, py, w, h, c) => { g.fillStyle = c; g.fillRect(x + (dir > 0 ? px : -px - w), y + py, w, h); };
    ellipse(g, x, y + 30, 10, 3, 'rgba(0,0,0,0.3)'); // shadow on the ground
    // wings
    P(-6, flap ? -9 : -3, 10, 3, C.teal); P(-4, flap ? -12 : -1, 6, 3, C.teal);
    // body, tail, head
    P(-10, 0, 18, 7, C.green); P(-14, 2, 5, 3, C.green); P(-17, 0, 4, 3, C.teal);
    P(7, -4, 8, 7, C.green); P(13, -2, 3, 4, C.green);
    P(9, -3, 2, 2, C.white); P(10, -3, 1, 1, C.ink); // eye
    P(-8, 6, 14, 2, C.lime); // belly
    P(8, -6, 2, 2, C.yellow); P(11, -6, 2, 2, C.yellow); // horns
    // fire breath onto the road
    for (let i = 0; i < 3; i++) this.parts.push({ x: x + dir * (15 + Math.random() * 6), y: y + 2 + Math.random() * 4, vx: dir * (20 + Math.random() * 30), vy: 40 + Math.random() * 40, life: 0.35, c: Math.random() < 0.5 ? C.orange : C.yellow, s: 2 });
    if (Math.random() < 0.5) this.parts.push({ x: x + Math.random() * 16 - 8, y: y + 28, vx: 0, vy: -10, life: 0.6, c: C.dark, s: 2 });
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
        case 'spore':
          g.fillStyle = C.plum; g.fillRect(x - 2, y - 2, 4, 4);
          g.fillStyle = C.lime; g.fillRect(x - 1, y - 1, 2, 2);
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
    const look = e.disguised ? "slime" : e.shellT > 0 ? e.type + "_c" : e.pile > 0 ? "bonepile_pile" : e.type; // Перевертень in disguise looks like a plain slime; Мушляк in his shell
    const bs = e.bk && e.type === "boss" && !e.disguised ? bossSprites(e.bk, BOSSES[e.bk]) : null; // bosses with their own look
    const spr = bs ? (e.flash > 0 ? bs.f : bs.n) : (e.flash > 0 ? FLASH : SPRITES)[look];
    const heavy = !e.disguised && (e.type === "boss" || e.type === "king");
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
    if (e.pile > 0) bob = e.pile < 12 ? (e.pile & 1) : 0; // the heap trembles before he gets up
    if (e.leapT > 0) bob = Math.round(Math.sin(Math.PI * (1 - e.leapT / 8)) * 10); // Жабка: a hop arc
    const dx = Math.round(x - spr.width / 2), dy = Math.round(y - spr.height + 6 - bob);
    ellipse(g, Math.round(x), Math.round(y) + 6, Math.max(2, Math.round(spr.width / 2.6) - (heavy ? Math.floor(bob / 2) : 0)), heavy ? 3 : 2, heavy ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.3)");
    if (hovered) ellipse(g, Math.round(x), Math.round(y) + 6, Math.round(spr.width / 2) + 2, 3, 'rgba(255,205,117,0.6)');
    if (e.hideT > 0) { // burrowed: only a moving mound of earth
      ellipse(g, Math.round(x), Math.round(y) + 4, 9, 4, "#8a6248"); ellipse(g, Math.round(x), Math.round(y) + 3, 6, 2, "#c28569");
      if ((tick >> 1) % 2) this.parts.push({ x: x + Math.random() * 12 - 6, y: y + 2, vx: Math.random() * 30 - 15, vy: -30, life: 0.3, c: "#8a6248" });
      return;
    }
    if (e.immuneT > 0) g.globalAlpha = 0.55 + 0.25 * Math.sin(tick / 2); // ghostly
    if (e.mist) g.globalAlpha = 0.4 + 0.1 * Math.sin(tick / 4); // Туманець: half see-through until something touches him
    g.drawImage(spr, dx, dy);
    g.globalAlpha = 1;
    if (frozen) g.drawImage(bs ? bs.z : FROZEN[look], dx, dy);
    if (e.disguised && (tick + e.id) % 23 < 2) { g.fillStyle = C.yellow; g.fillRect(dx + 2 + ((tick >> 3) % 4) * 2, dy + 2, 1, 1); } // the only tell: a faint glint
    // state icons of the rotation mobs
    if (e.type === "tinman" && e.armor > 0) { g.fillStyle = C.orange; for (let i = 0; i < e.armor; i += 2) g.fillRect(dx + 3 + i, dy - 1, 2, 1); } // plates left
    if (e.type === "drummer") { const nx = dx + spr.width - 2, ny = dy - 4 - ((tick >> 3) % 2); g.fillStyle = C.ink; g.fillRect(nx - 1, ny + 3, 4, 3); g.fillRect(nx + 2, ny, 1, 5); g.fillStyle = C.yellow; g.fillRect(nx, ny + 3, 2, 2); g.fillRect(nx + 2, ny + 1, 1, 3); } // ♪
    if (e.mist) { g.fillStyle = C.ink; g.fillRect(dx + 5, dy - 8, 5, 7); g.fillStyle = C.cyan; for (const [qx, qy, qw, qh] of [[6, -7, 3, 1], [8, -6, 1, 2], [7, -4, 1, 1], [7, -2, 1, 1]]) g.fillRect(dx + qx, dy + qy, qw, qh); } // «?»
    if (e.type === "roller" && e.rollV > 14 && (tick >> 1) % 2) this.parts.push({ x: x - 5, y: y + 5, vx: -20 - e.rollV, vy: -6, life: 0.25, c: "#a8805e" }); // dust of the roll
    if (e.loot && e.loot.length) { g.fillStyle = C.yellow; for (let i = 0; i < Math.min(4, e.loot.length); i++) g.fillRect(dx + 1 + i * 3, dy - 3, 2, 2); } // the stash
    if (e.type === "cloud" && (tick + e.id) % 3 === 0) this.parts.push({ x: x + Math.random() * 10 - 5, y: y - 2, vx: 0, vy: 40, life: 0.25, c: C.cyan });
    if (e.shieldT > 0) { g.strokeStyle = (tick >> 1) % 2 ? C.white : C.silver; g.strokeRect(dx - 2.5, dy - 2.5, spr.width + 5, spr.height + 5); }
    if (e.hasteT > 0 && (tick >> 1) % 2) this.parts.push({ x: x - 6 + Math.random() * 4, y: y + Math.random() * 6 - 4, vx: -40, vy: 0, life: 0.2, c: C.lime });
    if (e.wetT > 0 && (tick >> 2) % 3 === 0) { g.fillStyle = C.sky; g.fillRect(dx + 2 + (e.id % 9), dy + spr.height, 1, 3); }
    if (e.wetT > 0) { // status: a little droplet over the head = "wet", Tesla x2 / fire makes steam
      const wx = dx + (spr.width >> 1), wy = dy - 6 + ((tick >> 3) % 2);
      g.fillStyle = C.ink; g.fillRect(wx - 2, wy, 5, 4); g.fillRect(wx - 1, wy - 2, 3, 2);
      g.fillStyle = C.sky; g.fillRect(wx - 1, wy, 3, 3); g.fillRect(wx, wy - 1, 1, 1); g.fillStyle = C.white; g.fillRect(wx - 1, wy, 1, 1);
    }
    if (e.slowT > 0 && !frozen) { g.fillStyle = C.cyan; g.fillRect(dx, dy + spr.height - 1, spr.width, 1); }
    if (e.burnT > 0 && Math.random() < 0.6) this.parts.push({ x: x + Math.random() * 10 - 5, y: dy + 4, vx: 0, vy: -24, life: 0.3, c: Math.random() < 0.5 ? C.orange : C.yellow, s: 2 });
    if (e.sporeT > 0 && (tick >> 2) % 2 === 0) this.parts.push({ x: x + Math.random() * 10 - 5, y: dy + 8, vx: 0, vy: -14, life: 0.4, c: Math.random() < 0.5 ? C.lime : C.green, s: 1 }); // poisoned: green spores drift up
    if (e.blocked && (tick >> 2) % 2) this.parts.push({ x: x + Math.random() * 8 - 4, y: y + 4, vx: Math.random() * 20 - 10, vy: -10, life: 0.3, c: '#c28569' });
    if (e.hp < e.maxHp && !e.disguised) {
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

  // Пан Равлик: a glossy slime road behind him (the stretch where other enemies speed up).
  drawSlimeTrails(s) {
    const g = this.g;
    for (const e of s.enemies) {
      if (e.dead || !e.bk || BOSSES[e.bk].skill.type !== "trail") continue;
      const len = BOSSES[e.bk].skill.len;
      for (let d = 0; d <= len; d += 4) {
        if (e.dist - d < 0) break;
        const p = posAt(s.map, e.lane, e.dist - d);
        g.globalAlpha = 0.55 * (1 - d / len);
        g.fillStyle = (d >> 2) % 3 ? C.lime : C.green;
        g.fillRect(Math.round(p.x) - 3, Math.round(p.y) + 3, 6, 3);
      }
    }
    g.globalAlpha = 1;
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
    if (z.src === 'spore') return this.drawSporeZone(z, tick);
    g.globalAlpha = 0.85 * Math.min(1, z.life / 20);
    ellipse(g, Math.round(z.x), Math.round(z.y), z.r, Math.round(z.r * 0.55), C.red);
    ellipse(g, Math.round(z.x), Math.round(z.y), Math.round(z.r * 0.6), Math.round(z.r * 0.3), C.orange);
    g.globalAlpha = 1;
    if ((tick + Math.round(z.x)) % 3 === 0) this.parts.push({ x: z.x + Math.random() * z.r - z.r / 2, y: z.y, vx: 0, vy: -18, life: 0.4, c: C.yellow });
  }

  // Spore puddle (Чумна хмара): a "witch ring" of tiny mushrooms around a patch of mycelium with soft gas puffs
  // drifting over it. Mushrooms sprout as the puddle appears and wilt as it ends, so the remaining time reads at a glance.
  // Shape (ring, not a filled blob), motion (slow drift, not rising sparks) and palette (plum/lime) differ from fire.
  drawSporeZone(z, tick) {
    const g = this.g;
    const cx = Math.round(z.x), cy = Math.round(z.y), rx = Math.round(z.r), ry = Math.max(2, Math.round(z.r * 0.55));
    const age = 1 - z.life / z.max;
    const k = Math.max(0, Math.min(1, age * 6, z.life / (z.max * 0.25))); // 0..1: sprouting in, wilting out

    // mycelium: a sparse dithered patch under the ring
    g.globalAlpha = 0.5 * k;
    g.fillStyle = C.teal;
    for (let dy = -ry; dy <= ry; dy++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
      for (let dx = -w; dx <= w; dx++) if (((dx + dy * 2) & 3) === 0) g.fillRect(cx + dx, cy + dy, 1, 1);
    }

    // the ring of mushrooms: positions are a fixed function of the puddle, so they don't flicker
    const n = Math.max(8, Math.round(z.r * 0.8)), shown = Math.ceil(n * k);
    g.globalAlpha = 1;
    for (let i = 0; i < shown; i++) {
      const h = Math.sin((i + 1) * 12.9898 + z.x * 0.37 + z.y * 0.71) * 43758.5453;
      const jit = h - Math.floor(h);
      const a = ((i + jit * 0.6) / n) * Math.PI * 2;
      const mx = Math.round(cx + Math.cos(a) * rx * 0.92), my = Math.round(cy + Math.sin(a) * ry * 0.92);
      if (k < 0.5) { g.fillStyle = C.lime; g.fillRect(mx, my, 1, 1); continue; } // still a sprout
      g.fillStyle = C.silver; g.fillRect(mx, my, 1, 1); // stem
      g.fillStyle = jit < 0.5 ? C.plum : C.red; g.fillRect(mx - 1, my - 2, 3, 2); // cap
      g.fillStyle = C.lime; g.fillRect(mx, my - 2, 1, 1); // spot
    }

    // gas: three translucent puffs orbiting slowly over the centre
    for (let i = 0; i < 3; i++) {
      const a = tick * 0.03 + i * 2.1;
      const px = Math.round(cx + Math.cos(a) * z.r * 0.35), py = Math.round(cy - 3 + Math.sin(a * 1.3) * ry * 0.4);
      g.globalAlpha = 0.28 * k;
      ellipse(g, px, py, Math.round(z.r * 0.3), Math.round(z.r * 0.2), C.lime);
      g.globalAlpha = 0.25 * k;
      ellipse(g, px, py, Math.round(z.r * 0.15), Math.round(z.r * 0.1), C.green);
    }
    g.globalAlpha = 1;
    // spores creep sideways and up, slowly
    if ((tick + cx) % 4 === 0 && k > 0) this.parts.push({ x: z.x + (Math.random() - 0.5) * z.r * 1.4, y: z.y + (Math.random() - 0.5) * ry, vx: (Math.random() - 0.5) * 10, vy: -6, life: 0.9, c: Math.random() < 0.5 ? C.lime : C.plum, s: 1 });
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

  // Mastered tower: drawn off-screen first so it can get a pulsing golden outline from its own silhouette,
  // stands on a glowing plinth, has three family-coloured lights orbiting it, family sparks and a small crown.
  drawMasterTower(t, lvl, tick) {
    const g = this.g, x = t.tx * TILE, y = t.ty * TILE;
    const W2 = 48, H2 = 72, ox = 12, oy = 44; // off-screen canvas, the tile's top-left lands at (ox, oy)
    if (!this.mCv) {
      this.mCv = document.createElement('canvas'); this.mCv.width = W2; this.mCv.height = H2;
      this.mSil = document.createElement('canvas'); this.mSil.width = W2; this.mSil.height = H2;
    }
    const m = this.mCv.getContext('2d'), sl = this.mSil.getContext('2d');
    m.clearRect(0, 0, W2, H2);
    drawTower(m, t.kind, ox, oy, lvl, t.aim, tick, tick - t.fired < 2);
    sl.globalCompositeOperation = 'source-over'; sl.clearRect(0, 0, W2, H2);
    sl.drawImage(this.mCv, 0, 0);
    sl.globalCompositeOperation = 'source-in'; sl.fillStyle = C.yellow; sl.fillRect(0, 0, W2, H2);
    const fam = family(t.kind);
    const col = { arrow: C.yellow, cannon: C.orange, frost: C.cyan, tesla: C.sky, fire: C.red, totem: C.lime }[fam] || C.yellow;
    const cx = x + 12, cy = y + 6, pulse = 0.5 + 0.5 * Math.sin(tick / 5);
    // glowing plinth
    g.globalAlpha = 0.35 + 0.25 * pulse;
    ellipse(g, cx, y + 23, 14, 5, C.yellow);
    g.globalAlpha = 1;
    ellipse(g, cx, y + 23, 11, 3, col);
    // orbiting lights: the ones behind the tower first, dimmer
    const orbs = [0, 1, 2].map((i) => { const a = tick * 0.09 + i * 2.094; return { x: cx + Math.cos(a) * 15, y: cy + Math.sin(a) * 5, front: Math.sin(a) > 0 }; });
    const orb = (o) => { g.fillStyle = C.ink; g.fillRect(Math.round(o.x) - 2, Math.round(o.y) - 2, 4, 4); g.fillStyle = col; g.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 2, 2); g.fillStyle = C.white; g.fillRect(Math.round(o.x) - 1, Math.round(o.y) - 1, 1, 1); };
    g.globalAlpha = 0.6; for (const o of orbs) if (!o.front) orb(o); g.globalAlpha = 1;
    // golden outline from the silhouette, then the tower itself
    g.globalAlpha = 0.55 + 0.45 * pulse;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.drawImage(this.mSil, x - ox + dx, y - oy + dy);
    g.globalAlpha = 1;
    g.drawImage(this.mCv, x - ox, y - oy);
    for (const o of orbs) if (o.front) orb(o);
    // a small crown on top
    const top = y - 22 + ((tick >> 4) % 2);
    g.fillStyle = C.ink; g.fillRect(cx - 4, top - 1, 9, 5);
    g.fillStyle = C.yellow; g.fillRect(cx - 3, top + 1, 7, 2); g.fillRect(cx - 3, top - 1, 1, 2); g.fillRect(cx, top - 2, 1, 3); g.fillRect(cx + 3, top - 1, 1, 2);
    g.fillStyle = C.red; g.fillRect(cx, top + 1, 1, 1);
    // family sparks
    if ((tick + t.id) % 6 === 0) {
      const px = x + 3 + Math.random() * 18, py = y - 8 + Math.random() * 20;
      if (fam === 'arrow') this.parts.push({ x: px, y: py, vx: Math.random() * 10 - 5, vy: 12, life: 0.9, c: C.yellow, s: 2 }); // golden feathers drift down
      else if (fam === 'cannon') this.parts.push({ x: cx + Math.random() * 6 - 3, y: y - 12, vx: Math.random() * 6 - 3, vy: -12, life: 1, c: C.slate, s: 2 }); // smoke from the barrel
      else if (fam === 'frost') this.parts.push({ x: px, y: py, vx: 0, vy: 8, life: 1, c: C.white }); // snowflakes
      else if (fam === 'tesla') { this.parts.push({ x: cx + Math.random() * 10 - 5, y: y - 14, vx: Math.random() * 60 - 30, vy: Math.random() * 30 - 20, life: 0.15, c: C.cyan, s: 2 }); }
      else if (fam === 'fire') this.parts.push({ x: px, y: py + 8, vx: Math.random() * 8 - 4, vy: -26, life: 0.7, c: Math.random() < 0.5 ? C.orange : C.yellow }); // embers
      else this.parts.push({ x: cx + Math.cos(tick) * 14, y: cy + 6, vx: 0, vy: -16, life: 0.8, c: C.lime, s: 2 }); // totem runes
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
    drawNum(g, s.wave + '/' + s.winWave, 168, 5, C.white, 2);
    drawIcon(g, 'skull', 250, 8);
    drawNum(g, s.kills, 258, 5, C.silver, 2);
    if (!s.queue.length && !s.over && s.wave < s.winWave) {
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
    if (this.weather === "rain") for (let i = 0; i < 3; i++) if (Math.random() < dt * 30) this.parts.push({ x: Math.random() * W2, y: -4, vx: -40, vy: 260, life: 3, c: "#73eff7", s: 1, keep: true, streak: true });
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
    for (const l of this.labels) { l.y -= 14 * dt; l.life -= dt; }
    this.labels = this.labels.filter((l) => l.life > 0);
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
