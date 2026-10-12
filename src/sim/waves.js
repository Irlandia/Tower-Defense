// Wave planning and composition (enemy packs, bosses, goblin thief).
import { ENEMIES, UNLOCKS, MODES, CONFIG, BOSSES, BOSS_POOL, TICK_RATE as T } from './data.js';
import { rand, randInt } from './rng.js';
import { player } from './queries.js';

// HP multiplier of the regular enemies of wave w (also used for packs that bosses bring along).
export function waveHpMul(s, w) {
  const over20 = Math.max(0, w - s.winWave);
  return ((s.brawl && s.brawl.hp) || 1) * (1 + 0.22 * (w - 1) + 0.017 * (w - 1) * (w - 1)) * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20;
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

export function startWave(s) {
  s.wave++;
  const w = s.wave;
  for (const b of s.barrels) b.ready = true;
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
  const B = s.brawl || {};
  const hpMul = waveHpMul(s, w);
  const pool = B.pool || Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] <= w);
  // co-op: a bit more enemies so two players still have to work
  const budget = (B.budget || 1) * (8 + w * 6) * (1 + 0.5 * (s.players.length - 1)); // +50% per extra player
  // Every planned lane gets its own stream starting at the same moment (two entries = two
  // simultaneous attacks, not alternating packs); the wave budget is split between them.
  for (const lane of lanes) {
    let left = budget / lanes.length;
    let at = s.tick + T;
    // small packs of one type: readable and interesting to counter
    while (left > 0) {
      const type = pool[randInt(s, pool.length)];
      const pack = 2 + randInt(s, 3);
      for (let i = 0; i < pack && left > 0; i++) {
        s.queue.push({ type, lane, at, hpMul });
        at += type === "runner" ? 7 : 12;
        left -= ENEMIES[type].cost;
      }
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
  const bossHp = (B.bossHp || 1) * (1 + Math.max(0, w / 5 - 1) * 0.9) * s.opts.hpMul * MODES.circle.endlessHpGrowth ** over20;
  // Bosses: one per player, arriving 3 s into the wave (right with the announcement), staggered by 2 s
  // and spread over the lanes. Endless: every couple of waves, more of them the deeper you go.
  let bosses = 0, kind = () => "boss";
  if (over20 > 0) {
    if (over20 % MODES.circle.endlessBossEvery === 0) { bosses = (1 + Math.floor(over20 / 6)) * s.players.length; kind = (i) => (i % 2 ? "king" : "boss"); }
  } else if (w % (B.bossEvery || 5) === 0) {
    bosses = s.players.length;
    kind = () => (w === s.winWave ? "king" : "boss");
  }
  for (let i = 0; i < bosses; i++) {
    const type = kind(i);
    s.queue.push({ type, bk: type === "king" ? 20 : drawBoss(s), lane: lanes[i % lanes.length], at: s.tick + 3 * T + i * 2 * T, hpMul: bossHp });
  }
  // campaign: the mission names its generals by wave (one per player)
  const mk = s.mission && s.mission.bosses && s.mission.bosses[w];
  if (mk) for (let i = 0; i < s.players.length; i++) {
    s.queue.push({ type: mk === 20 ? "king" : "boss", bk: mk, lane: lanes[i % lanes.length], at: s.tick + 3 * T + i * 2 * T, hpMul: (B.bossHp || 1) * (1 + Math.max(0, mk / 5 - 1) * 0.9) * s.opts.hpMul });
  }
  s.queue.sort((a, b) => a.at - b.at);
  s.countdown = CONFIG.waveDelay * T;
  s.events.push({ type: "wave", wave: w, boss: over20 ? over20 % MODES.circle.endlessBossEvery === 0 : w % 5 === 0, final: w === s.winWave, lanes });
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
