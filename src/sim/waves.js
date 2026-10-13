// Wave planning and composition (enemy packs, bosses, goblin thief).
import { ENEMIES, UNLOCKS, ROTATION, MODES, CONFIG, BOSSES, BOSS_POOL, ENDLESS, CASINO, TICK_RATE as T } from './data.js';
import { rand, randInt } from './rng.js';
import { player, endlessMods } from './queries.js';

// HP multiplier of the regular enemies of wave w (also used for packs that bosses bring along).
export function waveHpMul(s, w) {
  const over20 = Math.max(0, w - s.winWave);
  const curve = s.casino ? 1 + CASINO.hpLin * (w - 1) + CASINO.hpSq * (w - 1) * (w - 1) : 1 + 0.22 * (w - 1) + 0.017 * (w - 1) * (w - 1); // casino: 60 waves, gentler
  return ((s.brawl && s.brawl.hp) || 1) * curve * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20;
}

// Which lanes the next wave will use (shown to the player in advance).
export function planLanes(s) {
  const n = s.map.lanes.length;
  if (s.mode === "circle") return [...Array(n).keys()]; // every entry, every wave
  const all = [...Array(n).keys()];
  const count = s.wave >= 4 && rand(s) < 0.5 ? Math.min(n, 2) : 1;
  const out = [];
  while (out.length < count) out.push(all.splice(randInt(s, all.length), 1)[0]);
  return out.sort();
}

// Session rotation: the run picks which rotation mobs it meets and on which wave each arrives (seeded, so co-op peers agree).
// A mob never arrives before its own `from` wave. Unpicked mobs join in endless mode, one every few waves.
// Called once at the end of createGame: s.rot = [{ wave, type }].
export function planRotation(s) {
  const all = Object.keys(ENEMIES).filter((k) => ENEMIES[k].from !== undefined);
  const slots = ROTATION.slots.slice(0, all.length);
  const shuffled = () => {
    const a = [...all];
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(s, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const feasible = (set) => set.map((k) => ENEMIES[k].from).sort((a, b) => a - b).every((f, i) => f <= slots[i]);
  let pick = null;
  for (let tries = 0; tries < 30 && !pick; tries++) { const c = shuffled().slice(0, slots.length); if (feasible(c)) pick = c; }
  if (!pick) pick = shuffled().slice(0, slots.length);
  const rest = [...pick], rot = [];
  for (const wave of slots) {
    const ok = rest.filter((k) => ENEMIES[k].from <= wave);
    const from = ok.length ? ok : rest;
    const k = from[randInt(s, from.length)];
    rest.splice(rest.indexOf(k), 1);
    rot.push({ wave, type: k });
  }
  shuffled().filter((k) => !pick.includes(k)).forEach((k, i) => rot.push({ wave: s.winWave + ROTATION.endlessEvery * (i + 1), type: k }));
  s.rot = rot;
}

// Weighted draw of an enemy type (ENEMIES[].weight, default 1).
function drawType(s, pool) {
  let total = 0;
  for (const k of pool) total += ENEMIES[k].weight ?? 1;
  let r = rand(s) * total;
  for (const k of pool) { r -= ENEMIES[k].weight ?? 1; if (r < 0) return k; }
  return pool[pool.length - 1];
}

export function startWave(s) {
  s.wave++;
  const w = s.wave;
  for (const b of s.barrels) b.ready = true;
  for (const wl of s.walls) if (player(s, wl.owner).mods.wallRegen > 0) wl.hp = wl.max; // «Ремонт барикади»: fixed up between waves
  // co-op prank: pickpockets take a cut of their partner's gold at every wave start
  for (let i = 0; i < s.players.length; i++) {
    const pl = s.players[i], other = s.players[(i + 1) % s.players.length]; // picks the next player's pocket
    if (!pl.mods.thief || !other) continue;
    const cut = Math.min(40, Math.floor(other.gold * pl.mods.thief));
    if (cut > 0) { other.gold -= cut; pl.gold += cut; s.events.push({ type: "steal", p: i, from: s.players.indexOf(other), gold: cut }); }
  }
  for (let i = 0; i < s.players.length; i++) {
    const pl = s.players[i];
    if (pl.mods.interest > 0) {
      const gain = Math.min(25, Math.floor(pl.gold * pl.mods.interest));
      if (gain) { pl.gold += gain; s.events.push({ type: 'bonus', gold: gain, p: i }); }
    }
    if (pl.mods.wage > 0) { pl.gold += pl.mods.wage; s.events.push({ type: "bonus", gold: pl.mods.wage, p: i }); } // tree: wage
  }
  const lanes = s.plan;
  const over20 = Math.max(0, w - s.winWave);
  // endless circle: every few waves a new curse that stays; then this wave's pressure (armour, speed, gold, ...)
  if (s.endless && over20 > 0 && over20 % ENDLESS.curseEvery === 0) {
    const have = s.curses || (s.curses = []);
    const fresh = ENDLESS.curses.filter((c) => !have.includes(c.id));
    const c = (fresh.length ? fresh : ENDLESS.curses)[randInt(s, (fresh.length ? fresh : ENDLESS.curses).length)];
    have.push(c.id);
    if (c.limit) s.limit = Math.max(10, s.limit + c.limit);
    s.events.push({ type: 'curse', id: c.id, wave: w });
  }
  s.endMods = endlessMods(s);
  const B = s.brawl || {};
  const hpMul = waveHpMul(s, w);
  const rot = B.pool ? [] : s.rot || [];
  const pool = B.pool || [...Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] <= w), ...rot.filter((r) => r.wave <= w).map((r) => r.type)];
  for (const r of rot) if (r.wave === w) s.events.push({ type: 'newEnemy', kind: r.type, wave: w }); // «Новий ворог» banner
  // co-op: a bit more enemies so two players still have to work
  const budget = (B.budget || 1) * (s.casino ? CASINO.budget : 1) * (8 + w * 6) * (1 + 0.5 * (s.players.length - 1)) * (s.endless ? ENDLESS.budgetGrowth ** over20 : 1); // +50% per extra player; endless: ever more
  // Every planned lane gets its own stream starting at the same moment (two entries = two
  // simultaneous attacks, not alternating packs); the wave budget is split between them.
  for (const lane of lanes) {
    let left = budget / lanes.length;
    let at = s.tick + T;
    // small packs of one type: readable and interesting to counter
    const follow = pool.filter((k) => !ENEMIES[k].lead);
    const put = (type) => { // one queue item (a group of `count` units); cost is for the whole group
      const d = ENEMIES[type];
      for (let n = 0; n < (d.count || 1); n++) s.queue.push({ type, lane, at: at + n * 2, hpMul });
      at += d.gap ?? 12;
      left -= d.cost;
    };
    while (left > 0) {
      let type = drawType(s, pool);
      const pack = 2 + randInt(s, 3);
      if (ENEMIES[type].lead && follow.length) { // a leader (Барабанщик) walks first, then a pack of someone else
        put(type);
        type = drawType(s, follow);
      }
      for (let i = 0; i < pack && left > 0; i++) put(type);
      at += T;
    }
  }
  s.queue.sort((a, b) => a.at - b.at || a.lane - b.lane);
  // A rare gold thief: kill it for a pile of coins, or it steals from you.
  if ((s.mission && s.mission.goblins) || (w >= 3 && rand(s) < 0.4)) {
    const mid = s.queue[Math.floor(s.queue.length / 2)].at;
    s.queue.push({ type: 'goblin', lane: lanes[randInt(s, lanes.length)], at: mid, hpMul });
    s.queue.sort((a, b) => a.at - b.at);
  }
  const bossHp = (B.bossHp || 1) * (1 + Math.max(0, w / 5 - 1) * 0.9) * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20 * s.endMods.bossHp;
  // Bosses: one per player, arriving 3 s into the wave (right with the announcement), staggered by 2 s
  // and spread over the lanes. Endless: every couple of waves, more of them the deeper you go.
  let bosses = 0, kind = () => "boss", late = false;
  if (s.casino && w >= 20 && over20 === 0) { // casino: from wave 20 a boss closes every wave
    bosses = s.players.length; late = true;
    kind = () => (w === s.winWave ? "king" : "boss");
  } else if (over20 > 0) {
    if (over20 % MODES.circle.endlessBossEvery === 0) { bosses = (1 + Math.floor(over20 / 6)) * s.players.length; kind = (i) => (i % 2 ? "king" : "boss"); }
  } else if (w % (B.bossEvery || 5) === 0) {
    bosses = s.players.length;
    kind = () => (w === s.winWave ? "king" : "boss");
  }
  const lastAt = s.queue.reduce((m, q) => Math.max(m, q.at), s.tick);
  for (let i = 0; i < bosses; i++) {
    const type = kind(i);
    // usually right with the announcement; a "late" boss follows the last of the pack
    s.queue.push({ type, bk: type === "king" ? 20 : drawBoss(s), lane: lanes[i % lanes.length], at: (late ? lastAt + 2 * T : s.tick + 3 * T) + i * 2 * T, hpMul: bossHp });
  }
  // campaign: the mission names its generals by wave (one per player)
  const mk = s.mission && s.mission.bosses && s.mission.bosses[w];
  if (mk) for (let i = 0; i < s.players.length; i++) {
    s.queue.push({ type: mk === 20 ? "king" : "boss", bk: mk, lane: lanes[i % lanes.length], at: s.tick + 3 * T + i * 2 * T, hpMul: (B.bossHp || 1) * (1 + Math.max(0, mk / 5 - 1) * 0.9) * s.opts.hpMul });
  }
  s.queue.sort((a, b) => a.at - b.at);
  s.countdown = CONFIG.waveDelay * T;
  s.events.push({ type: "wave", wave: w, boss: over20 ? over20 % MODES.circle.endlessBossEvery === 0 : (s.casino && w >= 20) || w % 5 === 0, final: w === s.winWave, lanes });
  s.plan = planLanes(s);
}

// A random boss from the pool, without repeats until every one has been met in this run.
function drawBoss(s) {
  const seen = s.bossSeen || (s.bossSeen = []);
  const fits = BOSS_POOL.filter((k) => !BOSSES[k].modes || BOSSES[k].modes.includes(s.mode)); // e.g. Вихор: circle only
  let pool = fits.filter((k) => !seen.includes(k));
  if (!pool.length) { seen.length = 0; pool = [...fits]; }
  const k = pool[randInt(s, pool.length)];
  seen.push(k);
  return k;
}
