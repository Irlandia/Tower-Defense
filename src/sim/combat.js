// Combat primitives: spawning, damage, kills, burning, explosions, talent draws.
// Everything here mutates the state passed in and draws randomness only from state.rngState.
import { ENEMIES, BOSSES, MODES, CARDS, RARITY, DRAFT, DAY, COIN, SPORE_CAP, TICK_RATE as T } from './data.js';
import { rand, randInt } from './rng.js';
import { posAt } from './mapgen.js';
import { player, isLocked, vsMult, family, dayPhase } from './queries.js';


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
    leapT: 0, leapCd: 0, shellT: 0, shellCd: 0, rollV: 0, pile: 0, risen: false, mist: !!ENEMIES[type].mist, blastTick: -1, slowT: 0, slowF: 1, wetT: 0, burnT: 0, burnDps: 0, burnAcc: 0, burnOwner: 0, flash: 0, dead: false, blocked: false,
    sporeT: 0, sporeStacks: 0, sporeGen: 0, sporeDps: 0, sporeAcc: 0, sporeSeen: -1, sporeOwner: 0, sporeMul: 1, sporeCfg: null,
  };
  if (ENEMIES[type].magpie) e.loot = [];
  s.enemies.push(e);
  return e;
}

export function explode(s, x, y, r, dmg, owner, src = null) {
  for (const e of s.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) <= r) damage(s, e, ENEMIES[e.type].flying ? dmg * 0.3 : dmg, owner, { pierce: true, src, blast: true }); // flyers: only grazed
  }
  s.events.push({ type: 'explode', x, y, r });
}


export function ignite(s, e, dps, time, owner, src = null) {
  if (e.dead) return;
  e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps * player(s, owner).mods.burn);
  e.burnT = Math.round(time * T);
  e.burnOwner = owner;
  e.burnSrc = src;
  e.sporeT = 0; e.sporeStacks = 0; // fire burns the spores away: nothing left to spread
}

// Spores: poison stacks (ignores armour). A tower gives generation 0; spread from a dying neighbour is generation + 1.
// A fresh infection starts at its generation; re-hits only add a stack and refresh the timer.
export function infect(s, e, cfg, owner, mul, gen) {
  if (e.dead || ENEMIES[e.type].sporeImmune) return; // Мухоморчик: spores do not take
  const m = player(s, owner).mods;
  if (!(e.sporeT > 0)) { e.sporeStacks = 0; e.sporeGen = gen; }
  e.sporeStacks = Math.min(cfg.stacks, e.sporeStacks + 1);
  e.sporeT = Math.round(cfg.time * m.sporeTime * T);
  e.sporeDps = cfg.dps * e.sporeStacks * mul * m.spore;
  e.sporeCfg = cfg; e.sporeOwner = owner; e.sporeMul = mul;
}

// Infected enemies that died this tick burst (Споровий вибух) or pass the spores on to neighbours.
// Deterministic: enemies in array order, neighbours by distance then id, at most SPORE_CAP new infections per tick.
// Bosses are never infected by spread, so a boss can't start a chain.
export function resolveSpores(s) {
  let left = SPORE_CAP;
  for (const e of s.enemies) {
    if (!e.dead || !(e.sporeT > 0) || !e.sporeCfg) continue;
    const cfg = e.sporeCfg, m = player(s, e.sporeOwner).mods;
    e.sporeT = 0;
    if (cfg.burst) {
      const dmg = cfg.burst.dmg * e.sporeStacks * e.sporeMul * m.sporeBurst;
      for (const o of s.enemies) {
        if (o.dead || Math.hypot(o.x - e.x, o.y - e.y) > cfg.burst.r) continue;
        damage(s, o, ENEMIES[o.type].lives ? dmg / 2 : dmg, e.sporeOwner, { pierce: true, src: 'spore', blast: true });
      }
      s.events.push({ type: 'spores', x: e.x, y: e.y, r: cfg.burst.r, burst: true });
    } else if (cfg.spread) {
      const gen = e.sporeGen + 1;
      if (gen > cfg.spread.gen + m.sporeGen) continue;
      const r = cfg.spread.r;
      const near = s.enemies
        .filter((o) => !o.dead && o !== e && !ENEMIES[o.type].lives && !(o.sporeT > 0) && o.sporeSeen !== s.wave)
        .map((o) => ({ o, d: Math.hypot(o.x - e.x, o.y - e.y) }))
        .filter((x) => x.d <= r)
        .sort((a, b) => a.d - b.d || a.o.id - b.o.id)
        .slice(0, cfg.spread.n + m.sporeN);
      let passed = 0;
      for (const { o } of near) {
        if (left <= 0) break;
        left--; passed++;
        o.sporeSeen = s.wave; // one infection per enemy per wave
        infect(s, o, cfg, e.sporeOwner, e.sporeMul, gen);
      }
      if (passed) s.events.push({ type: 'spores', x: e.x, y: e.y, r, n: passed });
    }
  }
}


// Туманець becomes visible for good (area, chain, water, fire, spores, abilities all call this).
export function reveal(s, e) {
  if (!e.mist) return;
  e.mist = false;
  s.events.push({ type: 'reveal', id: e.id, x: e.x, y: e.y });
}

// blast = an explosion (cannon, barrel, meteor, quake, steam, spore burst): resets Котун's roll, stops Кістлявчик from rising.
export function damage(s, e, amount, owner, { pierce = false, crit = false, big = false, quiet = false, blast = false, src = null } = {}) {
  if (e.dead) return;
  if (e.mist) reveal(s, e);
  if (blast) { e.blastTick = s.tick; e.rollV = 0; }
  if (e.disguised) { // Перевертень drops the mask at the first hit
    e.disguised = false;
    e.speedMul *= BOSSES[e.bk].skill.speed / e.disguiseMul;
    s.events.push({ type: "bossReveal", id: e.id, bk: e.bk, wave: e.bossWave || s.wave, x: e.x, y: e.y });
  }
  const om = player(s, owner).mods;
  const mult = vsMult(e.type, src);
  amount *= mult * (src && e.lap >= 3 ? 1 + om.lapDmg : 1);
  const bounced = !pierce && amount <= e.armor; // a blow that did not get through the armour
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
  if (e.hp > 0) hitReactions(s, e, bounced, quiet);
  if (e.hp <= 0) kill(s, e, owner, src);
}

// What a survivor does after being hit (rotation mobs): Бляшаний солдатик loses a plate on a bounced blow,
// Жабка hops forward, Мушляк hides in his shell. Only direct hits count (burning, spores and puddles are quiet).
function hitReactions(s, e, bounced, quiet) {
  const def = ENEMIES[e.type];
  if (def.shed && bounced && e.armor > 0) {
    e.armor = Math.max(0, e.armor - def.shed);
    s.events.push({ type: 'shed', id: e.id, x: e.x, y: e.y, armor: e.armor });
  }
  if (quiet) return;
  if (def.leap && !(e.leapT > 0) && e.leapCd <= 0 && !(e.slowT > 0) && e.shellT <= 0) {
    e.leapT = def.leap.ticks;
    e.leapCd = Math.round(def.leap.cd * T);
    s.events.push({ type: 'leap', id: e.id, x: e.x, y: e.y });
  }
  if (def.shell && !(e.shellT > 0) && e.shellCd <= 0) {
    e.shellT = Math.round(def.shell.hide * T);
    e.armor = def.armor + def.shell.armor;
    s.events.push({ type: 'shell', id: e.id, x: e.x, y: e.y, on: true });
  }
}

// The player who lands the killing blow gets the gold.
// src = tower family of the blow (null: ability, barrel); goes into the death event for run summaries.
export function kill(s, e, owner, src = null) {
  const def = ENEMIES[e.type];
  let pl = player(s, owner);
  if (pl.left) pl = s.players.find((q) => !q.left) || pl; // a disconnected player's towers earn for the team
  // Кістлявчик falls apart into a pile of bones and gets up once, unless he died burning, poisoned or in an explosion.
  // The pile (hp 1) can only be hit by area damage; any such hit finishes it.
  if (def.rise && !e.risen && !(e.pile > 0) && !(e.burnT > 0) && !(e.sporeT > 0) && e.blastTick !== s.tick) {
    e.risen = true;
    e.hp = 1;
    e.pile = Math.round((s.mode === 'circle' ? def.rise.timeCircle : def.rise.time) * T);
    e.slowT = 0; e.wetT = 0;
    const g = Math.round(def.gold * pl.mods.gold * ((s.brawl && s.brawl.killGold !== undefined) ? s.brawl.killGold : 1));
    pl.gold += g;
    s.events.push({ type: 'pile', id: e.id, x: e.x, y: e.y, gold: g, p: s.players[owner] ? owner : 0 });
    return;
  }
  e.dead = true;
  const killGold = s.brawl && s.brawl.killGold !== undefined ? s.brawl.killGold : 1;
  const night = DAY.phases[dayPhase(s)].gold || 1; // night pays more
  const gold = Math.round(def.gold * pl.mods.gold * killGold * night) + (e.lap >= 1 ? pl.mods.hunter : 0);
  pl.gold += gold;
  pl.kills++;
  s.kills++;
  s.events.push({ type: 'death', x: e.x, y: e.y, kind: e.type, bk: e.bk, by: src, gold, p: s.players[owner] ? owner : 0 });
  if (def.deathStun) { // Пухир: popping stuns the towers around it
    for (const t of s.towers) if (Math.hypot(t.x - e.x, t.y - e.y) <= def.deathStun.r) t.stunT = Math.max(t.stunT || 0, Math.round(def.deathStun.time * T));
    s.events.push({ type: 'pop', x: e.x, y: e.y, r: def.deathStun.r });
  }
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
  if (e.loot && e.loot.length) { // Сорока spills everything she collected, plus one coin of her own
    const one = Math.round((COIN.base + Math.floor(s.wave / 2)) * ((s.brawl && s.brawl.coinValue) || 1));
    const vals = [...e.loot, one];
    vals.forEach((value, i) => s.coins.push({ id: s.nextId++, x: e.x + ((i % 3) - 1) * 9, y: e.y + (Math.floor(i / 3) % 3 - 1) * 7, value, life: COIN.life * T }));
    s.events.push({ type: 'magpieDrop', x: e.x, y: e.y, n: vals.length });
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
