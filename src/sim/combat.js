// Combat primitives: spawning, damage, kills, burning, explosions, talent draws.
// Everything here mutates the state passed in and draws randomness only from state.rngState.
import { ENEMIES, BOSSES, MODES, CARDS, RARITY, DRAFT, COIN, TICK_RATE as T } from './data.js';
import { rand, randInt } from './rng.js';
import { posAt } from './mapgen.js';
import { player, isLocked, vsMult, family } from './queries.js';


// Weighted draw without repeats from the cards valid for this mode and not maxed out by this player.
// guarantee: true / 'rare' = at least one rare-or-better card, 'epic' = at least one epic (falls back to rare).
const RANK = { common: 0, rare: 1, epic: 2 };
export function rarityWeight(s, r) {
  return Math.max(0.2, RARITY[r].weight + RARITY[r].perWave * s.wave);
}
export function pickCards(s, n, pl, guarantee = false) {
  const pool = CARDS.filter((c) => (!c.modes || c.modes.includes(s.mode)) && !(c.needs && isLocked(s, s.players.indexOf(pl), c.needs)) && !(c.coop && s.players.length < 2) && (pl.picked[c.id] || 0) < c.max);
  const out = [];
  const draw = (list) => {
    const total = list.reduce((a, c) => a + rarityWeight(s, c.rarity), 0);
    let r = rand(s) * total, i = 0;
    while (i < list.length - 1 && (r -= rarityWeight(s, list[i].rarity)) > 0) i++;
    return list[i];
  };
  if (guarantee) {
    const min = guarantee === 'epic' ? 2 : 1;
    let best = pool.filter((c) => RANK[c.rarity] >= min);
    if (!best.length) best = pool.filter((c) => RANK[c.rarity] >= 1);
    if (best.length) { const c = best[randInt(s, best.length)]; out.push(c.id); pool.splice(pool.indexOf(c), 1); }
  }
  while (out.length < n && pool.length) out.push(pool.splice(pool.indexOf(draw(pool)), 1)[0].id);
  if (guarantee && out.length > 1) { const j = randInt(s, out.length); [out[0], out[j]] = [out[j], out[0]]; }
  return out;
}

export function spawn(s, type, lane, dist, hpMul) {
  const hp = Math.round(ENEMIES[type].hp * hpMul);
  const p = posAt(s.map, lane, dist);
  const e = {
    id: s.nextId++, type, lane, hp, maxHp: hp, armor: ENEMIES[type].armor, hpMul,
    dist, x: p.x, y: p.y, px: p.x, py: p.y, lap: 0, speedMul: (s.brawl && s.brawl.speed) || 1,
    slowT: 0, slowF: 1, wetT: 0, burnT: 0, burnDps: 0, burnAcc: 0, burnOwner: 0, flash: 0, dead: false, blocked: false,
  };
  s.enemies.push(e);
  return e;
}

export function explode(s, x, y, r, dmg, owner, src = null) {
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) <= r) damage(s, e, dmg, owner, { pierce: true, src });
  }
  s.events.push({ type: 'explode', x, y, r });
}


export function ignite(s, e, dps, time, owner, src = null) {
  if (e.dead) return;
  e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps * player(s, owner).mods.burn);
  e.burnT = Math.round(time * T);
  e.burnOwner = owner;
  e.burnSrc = src;
}


export function damage(s, e, amount, owner, { pierce = false, crit = false, big = false, quiet = false, src = null } = {}) {
  if (e.dead) return;
  const om = player(s, owner).mods;
  const mult = vsMult(e.type, src);
  amount *= mult * (src && e.lap >= 3 ? 1 + om.lapDmg : 1);
  let d = pierce ? amount : amount - e.armor;
  if (crit) d *= om.critMul;
  d = Math.max(1, Math.round(d));
  e.hp -= d;
  e.flash = 2;
  if (!quiet) s.events.push({ type: "hit", id: e.id, x: e.x, y: e.y, dmg: d, crit: crit || big, eff: mult > 1 ? 1 : mult < 1 ? -1 : 0 });
  if (ENEMIES[e.type].lives && !e.raged && e.hp > 0 && e.hp < e.maxHp / 2) {
    e.raged = true;
    // the King splits when wounded
    if (e.bk && BOSSES[e.bk].skill.split) for (let i = 0; i < BOSSES[e.bk].skill.split; i++) spawn(s, "splitter", e.lane, Math.max(0, e.dist - 8 - i * 10), e.hpMul * 0.6);
    s.events.push({ type: "bossRage", id: e.id, wave: e.bossWave || s.wave });
  }
  if (e.hp <= 0) kill(s, e, owner);
}

// The player who lands the killing blow gets the gold.
export function kill(s, e, owner) {
  e.dead = true;
  const def = ENEMIES[e.type];
  let pl = player(s, owner);
  if (pl.left) pl = s.players.find((q) => !q.left) || pl; // a disconnected player's towers earn for the team
  const killGold = s.brawl && s.brawl.killGold !== undefined ? s.brawl.killGold : 1;
  const gold = Math.round(def.gold * pl.mods.gold * killGold) + (e.lap >= 1 ? pl.mods.hunter : 0);
  pl.gold += gold;
  pl.kills++;
  s.kills++;
  s.events.push({ type: 'death', x: e.x, y: e.y, kind: e.type, gold, p: s.players[owner] ? owner : 0 });
  // Talents come only from bosses: every player gets a personal choice (never pauses co-op)
  if (def.lives) {
    for (let i = 0; i < s.players.length; i++) {
      const q = s.players[i];
      q.drafts.push(pickCards(s, q.mods.cards, q, s.wave >= DRAFT.epicFrom || s.endless ? "epic" : "rare"));
      q.rerolls = Math.min(DRAFT.maxRerolls + (q.picked.wisdom ? 1 : 0), (q.rerolls || 0) + 1); // every boss: one more reroll
      s.events.push({ type: "draft", p: i });
    }
  }
  // Coins drop on the map and must be picked up with the mouse (by anyone).
  const n = def.coins || (rand(s) < ((s.brawl && s.brawl.coinChance) || COIN.chance) ? 1 : 0);
  for (let i = 0; i < n; i++) {
    s.coins.push({
      id: s.nextId++, x: e.x + (rand(s) * 24 - 12), y: e.y + (rand(s) * 18 - 9),
      value: Math.round((COIN.base + Math.floor(s.wave / 2)) * ((s.brawl && s.brawl.coinValue) || 1)), life: COIN.life * T,
    });
  }
  if (def.splits) {
    const parts = (s.brawl && s.brawl.split) || 2;
    for (let pi = 0; pi < parts; pi++) {
      const off = (pi - (parts - 1) / 2) * 9;
      const m = spawn(s, def.splits, e.lane, Math.max(0, e.dist + off), e.hpMul);
      m.lap = e.lap; m.speedMul = e.speedMul;
    }
  }
}
