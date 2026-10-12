// Deterministic game simulation. No DOM, no Math.random, no Date.now.
// The client sends commands, step() advances one fixed tick and emits events for juice/sound.
// Every command carries `p` = player index (0 = host/solo); each player has own gold, talents, abilities.
//
// Layout (see docs/architecture.md): data -> rng -> mapgen -> queries -> combat -> waves -> commands -> sim.
// This file owns createGame/step and the per-tick entity updates, and re-exports the public API.
import {
  TILE, COLS, ROWS, TICK_RATE as T, CONFIG, TOWERS, ENEMIES,
  MAPGEN, SEASONS, SEASON_ORDER, MODES, TOWER_ORDER, brawlOf, CAMPAIGN, OBSTACLES, BOSSES, bossKey,
} from './data.js';
import { rand, randInt } from './rng.js';
import { center, key, genClassic, genCircle, placeFarm, posAt } from './mapgen.js';
import { isFree, player, family, towerStats, missionStars } from './queries.js';
import { spawn, ignite, damage, explode } from './combat.js';
import { planLanes, startWave, waveHpMul } from './waves.js';
import { applyCmd } from './commands.js';

export { posAt } from './mapgen.js';
export * from './queries.js';
export { pickCards } from './combat.js';

// i = player index; opts.perks[i] is that player's talent tree (src/meta.js perks()), applied once at start.
function newPlayer(opts, i = 0) {
  const k = (opts.perks && opts.perks[i]) || {};
  const dmg = { arrow: 1, cannon: 1, frost: 1, tesla: 1, fire: 1 };
  for (const f in k.dmg || {}) dmg[f] = (dmg[f] || 1) * k.dmg[f];
  const BR = opts.brawlRules || {};
  const dmgAll = (k.dmgAll ?? 1) * (BR.towerDmg || 1);
  for (const f in dmg) dmg[f] *= dmgAll;
  return {
    gold: (opts.brawlRules && opts.brawlRules.startGold) || CONFIG.startGold + (k.bonusGold ?? (i === 0 ? opts.bonusGold || 0 : 0)),
    mods: {
      dmg,
      rate: 1, range: BR.towerRange || 1, chain: k.chain || 0, wetChain: k.wetChain || 0, burn: k.burn || 1, wet: k.wet || 0,
      steam: k.steam || 1, steamR: k.steamR || 1, gold: k.gold || 1, interest: 0, wage: k.wage || 0, sell: k.sell || 0,
      crit: 0.1 + (k.crit || 0), critMul: 2 + (k.critMul || 0),
      // cooldown multipliers: each ability reads its own, cdAll applies to all (keystone Focus, tree)
      cdAll: k.cdAll ?? 1, meteorCd: (k.meteorCd || opts.meteorCd || 1) * (BR.meteorCd || 1), novaCd: k.novaCd || 1, wallCd: k.wallCd || 1,
      goldrainCd: 1, overdriveCd: 1, quakeCd: 1,
      wall: k.wall || 1, meteorDmg: k.meteorDmg || 1, novaFreeze: k.novaFreeze || 0, overSec: k.overSec || 0,
      aura: k.aura || 1, moveCd: k.moveCd || 1, barrel: 1, lapDmg: 0, hunter: 0, thief: 0,
      towerRate: { ...(k.rate || {}) }, towerRange: { ...(k.range || {}) }, multi: { ...(k.multi || {}) }, splash: k.splash || 1, discount: { ...(k.discount || {}) },
      cards: k.cards || opts.cards || 3,
    },
    picked: {}, // talent id -> times taken (cards have a max)
    // the loadout by slot (Q/W/E/R); null = empty slot. Casting is allowed only for abilities in it.
    abilities: k.abilities || ['meteor', 'nova', 'wall'],
    cds: { meteor: 0, nova: 0, wall: 0, goldrain: 0, overdrive: 0, quake: 0 },
    overT: 0, // ticks left of Overdrive
    drafts: [], // pending talent choices (arrays of card ids); picking never pauses the game
    rerolls: 0, // draft rerolls in stock (one per boss, see DRAFT.maxRerolls)
    kills: 0,
  };
}

// opts come from meta-progression + difficulty (see src/meta.js); in co-op the host sends them to the guest.
export function createGame(seed, opts = {}) {
  const o = { hpMul: 1, cards: 3, locked: [], mode: "classic", players: 1, ...opts };
  // Weekly Brawl: a ruleset on top of a normal board; the same towers are open for everyone
  // Campaign missions reuse the brawl rule engine; boss waves come from the mission instead of "every 5th"
  const M = o.mode === "campaign" ? CAMPAIGN[Math.max(0, Math.min(CAMPAIGN.length - 1, (o.mission || 1) - 1))] : null;
  if (M) o.season = M.season;
  const B = o.mode === "brawl" ? brawlOf(o.week || 0) : M ? { ...M.rules, map: M.map, weather: M.weather, bossEvery: 999 } : null;
  if (B && B.towers) { const lock = TOWER_ORDER.filter((k) => !B.towers.includes(k)); o.locked = lock; o.lockedBy = Array.from({ length: o.players }, () => lock); }
  if (B && !B.towers) o.lockedBy = Array.from({ length: o.players }, () => []); // brawls open every tower
  if (B) o.brawlRules = B;
  const s = {
    rngState: seed >>> 0,
    dayStart: (seed >>> 0) % 4, // time of day the run starts at (DAY.phases), moves on every DAY.every waves
    opts: o,
    mode: B ? B.map : o.mode,
    brawl: B,
    mission: M,
    winWave: M ? M.waves : CONFIG.winWave,
    farmHp: M && M.farmHp ? M.farmHp : 0,
    farmMax: M && M.farmHp ? M.farmHp : 0,
    stats: { coins: 0, leaks: 0, peak: 0, early: 0 },
    stars: 0,
    won: false,
    lapSpeedMul: 1,
    tick: 0,
    lives: CONFIG.startLives + (o.bonusLives || 0),
    // alive limit depends on the board (brawls and missions can be played on the circle too)
    limit: (B ? B.map : o.mode) === 'circle' ? (M && M.limit ? M.limit : MODES.circle.maxAlive) + 15 * (o.players - 1) + 5 * Math.round((o.bonusLives || 0) / 3) : 0, // more players, bigger waves, more room
    wave: 0,
    countdown: CONFIG.firstWaveDelay * T,
    map: null,
    plan: [],
    players: Array.from({ length: o.players }, (_, i) => newPlayer(o, i)),
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
  // season: chosen in the menu, or random (from the seed, so co-op peers agree)
  s.season = SEASONS[o.season] ? o.season : SEASON_ORDER[randInt(s, SEASON_ORDER.length)];
  s.map = o.mode === "circle" ? genCircle(s, o.players) : genClassic(s);
  s.map.farm = placeFarm(s.map);
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
  const sea = SEASONS[s.season];
  while (s.obstacles.length < sea.obstacles && guard++ < 2000) {
    const tx = randInt(s, COLS), ty = randInt(s, ROWS);
    if (!isFree(s, tx, ty) || nearSpawn(tx, ty) || nearCastle(tx, ty)) continue;
    s.obstacles.push({ id: s.nextId++, tx, ty, kind: rand(s) < sea.trees ? "tree" : "rock", chest: rand(s) < (sea.chest || OBSTACLES.chestChance), v: randInt(s, 3) });
  }
  return s;
}

// ---------- step ----------

export function step(s, cmds = [], advance = true) {
  s.events = [];
  for (const c of cmds) applyCmd(s, c);
  if (!advance || s.over) return;

  s.tick++;
  for (const pl of s.players) {
    for (const k in pl.cds) if (pl.cds[k] > 0) pl.cds[k]--;
    if (pl.overT > 0) pl.overT--;
  }

  if (!s.queue.length && (s.wave < s.winWave || s.endless)) {
    s.countdown--;
    if (s.countdown <= 0) startWave(s);
  }
  while (s.queue.length && s.queue[0].at <= s.tick) {
    const q = s.queue.shift();
    const e = spawn(s, q.type, q.lane, 0, q.hpMul);
    e.bossWave = s.wave;
    if (ENEMIES[q.type].lives) {
      e.bk = q.bk || bossKey(s.wave);
      const bd = BOSSES[e.bk];
      e.abT = bd.skill.every * T;
      if (bd.hp) { e.hp = e.maxHp = Math.round(e.maxHp * bd.hp); }
      if (bd.speed) e.speedMul *= bd.speed;
      if (bd.skill.type === "disguise") { // Перевертень: walks as a slime inside a slime pack until the first hit
        e.disguised = true;
        e.disguiseMul = ENEMIES.slime.speed / ENEMIES[q.type].speed;
        e.speedMul *= e.disguiseMul;
        for (let i = 1; i <= bd.skill.pack; i++) spawn(s, "slime", e.lane, i * 9, waveHpMul(s, s.wave)).bossWave = s.wave;
      }
    }
    if (ENEMIES[q.type].lives) s.events.push({ type: "bossSpawn", id: e.id, kind: q.type, wave: s.wave, bk: e.bk, hidden: !!e.disguised });
  }

  // boss auras that change the whole map: Нічна Мара brings the night, Вихор turns the ring
  s.dark = s.enemies.some((e) => !e.dead && e.bk && BOSSES[e.bk].skill.type === "dark");
  if (s.ringRev && !s.enemies.some((e) => !e.dead && e.bk && BOSSES[e.bk].skill.type === "reverse")) s.ringRev = false;
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

  s.stats.peak = Math.max(s.stats.peak, s.enemies.length);
  // campaign: enemies passing by the farm trample it
  if (s.farmMax && s.map.farm) {
    const f = s.map.farm, fx = (f.x + f.w / 2) * TILE, fy = (f.y + f.h / 2) * TILE;
    for (const e of s.enemies) if (Math.hypot(e.x - fx, e.y - fy) < 34) s.farmHp -= 0.04 * (ENEMIES[e.type].lives ? 4 : 1); // ~0.8 HP/s per enemy nearby
    if (s.farmHp < 0) s.farmHp = 0;
  }
  const overrun = s.mode === "circle" && s.enemies.length >= s.limit;
  if (s.lives <= 0 || overrun || (s.farmMax && s.farmHp <= 0)) {
    s.lives = Math.max(0, s.lives);
    s.over = true;
    s.events.push({ type: 'gameover' });
  } else if (!s.endless && s.wave >= s.winWave && !s.queue.length && (s.mode === "circle" ? !s.enemies.some((e) => ENEMIES[e.type].lives) : !s.enemies.length)) {
    // circle: enemies pile up by design, so the win is "wave 20 fully out and its bosses dead"
    s.won = true;
    s.over = true;
    if (s.mission) s.stars = missionStars(s);
    s.events.push({ type: "victory", stars: s.stars });
  }
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
      damage(s, e, d, e.burnOwner, { pierce: true, quiet: true, src: e.burnSrc });
      if (e.dead) return;
    }
  }
  if (s.brawl) {
    if (s.brawl.alwaysWet) e.wetT = Math.max(e.wetT, 2); // the storm keeps everyone soaked
    if (s.brawl.regen && s.tick % T === 0) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * s.brawl.regen));
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
  if (e.bk) bossSkill(s, e);
  if (e.dead) return;
  if (e.hasteT > 0) e.hasteT--;
  const speed = def.speed * e.speedMul * (e.slowT > 0 ? e.slowF : 1) * (e.dashT > 0 ? BOSSES[e.bk].skill.mult : 1) * (e.hasteT > 0 ? e.hasteF : 1);
  // Вихор: enemies already on the ring walk it backwards (wrapping inside lap 0 never counts as a lap)
  const back = s.ringRev && L.loop && e.dist > L.loopStart;
  let nd = e.dist + (back ? -speed : speed) / T;
  if (back && nd <= L.loopStart) nd += L.loopLen;
  const next = posAt(s.map, e.lane, nd);
  // Barricades stop enemies walking into them; enemies chew through the wall.
  const wall = s.walls.find((w) => w.hp > 0 && Math.hypot(next.x - w.x, next.y - w.y) < 16 && Math.hypot(next.x - w.x, next.y - w.y) < Math.hypot(e.x - w.x, e.y - w.y));
  e.blocked = !!wall;
  if (wall) {
    wall.hp -= (def.lives || 1) * 0.5;
    if (wall.hp <= 0) s.events.push({ type: 'wallbreak', x: wall.x, y: wall.y });
    return;
  }
  e.dist = nd;
  e.x = next.x; e.y = next.y;
  if (L.loop) {
    // every full lap makes the monster faster and heals it a bit
    const lap = e.dist > L.loopStart ? Math.floor((e.dist - L.loopStart) / L.loopLen) : 0;
    if (lap > e.lap) {
      e.lap = lap;
      const cm = MODES.circle;
      if (lap <= cm.lapMax) e.speedMul += cm.lapSpeed * s.lapSpeedMul;
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
    s.stats.leaks++;
    s.events.push({ type: "leak", x: e.x, y: e.y, boss: !!def.lives });
  }
}

// Each boss has a signature move on a timer (see BOSSES[].skill in data.js).
function bossSkill(s, e) {
  const sk = BOSSES[e.bk].skill;
  if (e.disguised) return; // Перевертень keeps quiet until unmasked
  if (sk.type === "trail" && s.tick % 5 === 0) { // Пан Равлик: everyone on the slime road behind him runs faster
    const L = s.map.lanes[e.lane];
    for (const o of s.enemies) {
      if (o === e || o.dead || o.lane !== e.lane) continue;
      let d = e.dist - o.dist;
      if (L.loop && o.dist > L.loopStart && e.dist > L.loopStart) d = ((d % L.loopLen) + L.loopLen) % L.loopLen;
      if (d < 0 || d > sk.len) continue;
      o.hasteF = Math.max(o.hasteT > 0 ? o.hasteF : 1, sk.mult);
      o.hasteT = Math.max(o.hasteT || 0, 6);
    }
  }
  if (e.dashT > 0) e.dashT--;
  if (e.magnetT > 0) e.magnetT--;
  if (e.hideT > 0) e.hideT--;
  if (e.shieldT > 0 && --e.shieldT === 0) e.armor = ENEMIES[e.type].armor;
  if (e.immuneT > 0) { e.immuneT--; e.slowT = 0; e.wetT = 0; e.burnT = 0; } // ghost: nothing sticks
  if (e.slowT > 0 && e.slowF === 0) return; // frozen bosses cannot act
  if (--e.abT > 0) return;
  e.abT = sk.every * T;
  switch (sk.type) {
    case "dash": // Grok charges forward
      e.dashT = Math.round(sk.dur * T);
      break;
    case "brood": // Slime Mother births slimes right behind her
      for (let i = 0; i < sk.count; i++) spawn(s, "slime", e.lane, Math.max(0, e.dist - 10 - i * 9), e.hpMul * 0.5);
      break;
    case "magnet": // Baron drags every tower's fire (and the players' cursors) to himself
      e.magnetT = Math.round(sk.dur * T);
      break;
    case "decree": // the King stuns towers around him
      for (const t of s.towers) if (Math.hypot(t.x - e.x, t.y - e.y) <= sk.range) t.stunT = Math.round(sk.stun * T);
      break;
    case "summon": // calls a pack of `what` right behind
      for (let i = 0; i < sk.count; i++) {
        const m = spawn(s, sk.what, e.lane, Math.max(0, e.dist - 10 - i * 9), e.hpMul * 0.25);
        m.lap = e.lap;
      }
      break;
    case "blink": { // leaps forward along the road (never past the end)
      const L = s.map.lanes[e.lane];
      e.dist = L.loop ? e.dist + sk.dist : Math.min(L.total - 30, e.dist + sk.dist);
      const p = posAt(s.map, e.lane, e.dist);
      e.x = e.px = p.x; e.y = e.py = p.y;
      break;
    }
    case "rally": // heals every enemy around
      for (const o of s.enemies) if (!o.dead && o !== e && Math.hypot(o.x - e.x, o.y - e.y) <= sk.range) o.hp = Math.min(o.maxHp, o.hp + Math.round(o.maxHp * sk.pct));
      break;
    case "shield":
      e.armor = ENEMIES[e.type].armor + sk.armor;
      e.shieldT = Math.round(sk.dur * T);
      break;
    case "haste": // everyone around (and the boss) runs faster for a while
      for (const o of s.enemies) if (!o.dead && Math.hypot(o.x - e.x, o.y - e.y) <= sk.range) { o.hasteT = Math.round(sk.dur * T); o.hasteF = sk.mult; }
      break;
    case "burrow": // underground: towers cannot target it
      e.hideT = Math.round(sk.dur * T);
      break;
    case "steal":
      for (const pl of s.players) pl.gold -= Math.min(pl.gold, sk.gold);
      break;
    case "heal":
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * sk.pct));
      break;
    case "cleanse":
      e.immuneT = Math.round(sk.dur * T);
      break;
    case "shuffle": { // swaps places with the enemy furthest ahead on its lane
      const lead = s.enemies.filter((o) => !o.dead && o !== e && o.lane === e.lane && o.dist > e.dist).sort((a, b) => b.dist - a.dist || a.id - b.id)[0];
      if (!lead) break;
      [e.dist, lead.dist] = [lead.dist, e.dist];
      for (const o of [e, lead]) { const p = posAt(s.map, o.lane, o.dist); o.x = o.px = p.x; o.y = o.py = p.y; }
      break;
    }
    case "reverse": // Вихор: the whole ring turns back (until he dies)
      s.ringRev = !s.ringRev;
      break;
    case "snipe": { // spits at the strongest tower in range: stunned
      const t = s.towers.filter((k) => !TOWERS[k.kind].support && Math.hypot(k.x - e.x, k.y - e.y) <= sk.range)
        .sort((a, b) => b.spent - a.spent || a.id - b.id)[0];
      if (!t) break;
      t.stunT = Math.round(sk.stun * T);
      s.events.push({ type: "bossSkill", kind: "snipeHit", id: e.id, x: t.x, y: t.y, r: 0 });
      break;
    }
  }
  s.events.push({ type: "bossSkill", kind: sk.type, id: e.id, x: e.x, y: e.y, r: sk.range || 0 });
}

function updateZone(s, z) {
  z.life--;
  if (z.life % 5) return;
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - z.x, e.y - z.y) <= z.r) damage(s, e, z.dps / 4, z.owner, { pierce: true, quiet: true, src: z.src });
  }
}

function inRange(s, x, y, range) {
  return s.enemies.filter((e) => !e.dead && e.dist >= 0 && !(e.hideT > 0) && Math.hypot(e.x - x, e.y - y) <= range);
}

function updateTower(s, t) {
  if (t.moveCd > 0) t.moveCd--;
  if (TOWERS[t.kind].support) return;
  if (t.stunT > 0) { t.stunT--; return; } // stunned by the King's decree
  if (t.cd > 0) { t.cd--; return; }
  const def = TOWERS[t.kind];
  const st = towerStats(s, t);
  const targets = inRange(s, t.x, t.y, st.range);
  if (!targets.length) return;
  // "first" = furthest along its lane; snipers pick the toughest
  targets.sort(def.target === 'strong' ? (a, b) => b.hp - a.hp || a.id - b.id : (a, b) => b.dist - a.dist || a.id - b.id);
  // a magnetised boss in range pulls every tower's fire
  const mag = targets.find((e) => e.magnetT > 0);
  if (mag) { targets.splice(targets.indexOf(mag), 1); targets.unshift(mag); }
  const target = targets[0];
  t.cd = st.period;
  t.aim = Math.atan2(target.y - t.y, target.x - t.x);
  t.fired = s.tick;

  if (def.pulse) { pulse(s, t, def, st, targets); return; }
  if (def.chain !== undefined) { zap(s, t, target, st, def); return; }
  // tree: extra targets per shot for a family
  const extra = player(s, t.owner).mods.multi[family(t.kind)] || 0;
  for (const e of targets.slice(0, (def.multi || 1) + extra)) {
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
    damage(s, e, st.dmg, t.owner, { quiet: def.burn !== undefined, src: family(t.kind) });
    if (e.dead) continue;
    if (def.slow !== undefined) applyCold(e, def, m);
    if (def.burn) ignite(s, e, def.burn, def.burnTime, t.owner, "fire");
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
  const om = player(s, t.owner).mods;
  let jumps = def.chain + om.chain + (first.wetT > 0 ? 1 + om.wetChain : 0);
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
  // Overload: consecutive hits on the same target build up charge
  let over = 1;
  if (def.overcharge) {
    t.charge = t.lastTarget === first.id ? (t.charge || 0) + 1 : 0;
    t.lastTarget = first.id;
    over = Math.min(def.overMax, 1 + def.overcharge * t.charge);
  }
  const pts = [{ x: t.x, y: t.y - 20 }];
  for (const e of hit) {
    pts.push({ x: e.x, y: e.y - 6 });
    const wet = e.wetT > 0;
    damage(s, e, st.dmg * (wet ? 2 : 1) * (e === first ? over : 1), t.owner, { big: wet || over >= 2, src: family(t.kind) });
  }
  s.events.push({ type: "zap", pts, over, wet: hit.some((e) => e.wetT > 0) });
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


function hit(s, p, target) {
  const def = TOWERS[p.tower];
  const m = player(s, p.owner).mods;
  const src = family(p.tower);
  const lvMul = def.from ? 1.6 : 1 + 0.6 * (p.level - 1);
  switch (p.kind) {
    case 'arrow':
      if (target) damage(s, target, p.dmg, p.owner, { pierce: def.pierce, crit: rand(s) < m.crit, src });
      break;
    case 'ball':
      explode(s, p.x, p.y + 6, def.splash * m.splash, p.dmg, p.owner, src);
      for (let i = 0; i < (def.bomblets || 0); i++) {
        const a = rand(s) * Math.PI * 2, r = 15 + rand(s) * 21;
        explode(s, p.x + Math.cos(a) * r, p.y + 6 + Math.sin(a) * r, 18, p.dmg * 0.4, p.owner, src);
      }
      break;
    case 'ice':
      if (!target) break;
      damage(s, target, p.dmg, p.owner, { src });
      if (!target.dead) applyCold(target, def, m);
      break;
    case 'fire':
      if (def.puddle) {
        s.zones.push({ x: p.x, y: p.y + 6, r: def.puddle.r, dps: def.puddle.dps * m.burn, life: def.puddle.time * T, max: def.puddle.time * T, owner: p.owner, src });
      }
      if (!target) break;
      if (target.wetT > 0) {
        // Synergy: fire + wet = steam explosion.
        target.wetT = 0;
        const dmg = CONFIG.steamDmg * lvMul * m.steam;
        const radius = CONFIG.steamRadius * m.steamR;
        for (const e of s.enemies) {
          if (!e.dead && Math.hypot(e.x - target.x, e.y - target.y) <= radius) damage(s, e, dmg, p.owner, { pierce: true, src });
        }
        s.events.push({ type: 'steam', x: target.x, y: target.y });
      } else {
        damage(s, target, p.dmg, p.owner, { src });
        ignite(s, target, def.burn * lvMul, def.burnTime, p.owner, src);
      }
      break;
  }
}
