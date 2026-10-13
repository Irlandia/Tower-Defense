// Meta-progression between runs: experience → level → talent points; the talent tree (4 branches × 4 tiers,
// up to 3 builds); the ability loadout; difficulty unlocks; records.
// Stored per browser in localStorage (wrapped in try/catch: storage may be unavailable).
const KEY = 'pixeltd-meta-v2';
const OLD_KEY = 'pixeltd-meta-v1'; // the pre-tree save, migrated once in load()
// Tests must never overwrite a player's real progress: they switch writes off.
let persist = true;
export const setPersist = (on) => { persist = on; };

export const DIFFS = [
  { id: 'normal', name: 'Звичайна', hpMul: 1, reward: 1 },
  { id: 'hard', name: 'Важка', hpMul: 1.4, reward: 1.5, need: 'normal' },
  { id: 'nightmare', name: 'Кошмар', hpMul: 1.9, reward: 2.2, need: 'hard' },
];

// ---------- levels: XP is earned for good and bad runs alike; every level gives one talent point ----------
export const MAX_LEVEL = 25;
export const levelCost = (n) => 10 + 3 * n; // XP to go from level n to n+1
export const xpForLevel = (L) => 10 * L + (3 * L * (L - 1)) / 2; // total XP needed to reach level L
export function levelOf(xp) {
  let L = 0;
  while (L < MAX_LEVEL && xp >= xpForLevel(L + 1)) L++;
  return L;
}
export const level = (m) => levelOf(m.xp);
// Tower unlocks by player level (not by the tree).
export const UNLOCK_LEVEL = { tesla: 3, fire: 6, spore: 9 };
// Builds: the 2nd opens at level 10, the 3rd at level 20. Each build spends its own points (up to the level).
export const BUILD_LEVEL = [1, 10, 20];
export const buildsOpen = (L) => BUILD_LEVEL.filter((need) => L >= need).length;

// ---------- the talent tree ----------
// Branch = a column of 4 tiers. A tier opens after N points spent in the tiers below it (TIER_NEED).
// The 4th tier holds one keystone per branch (key); at most 2 keystones per build; excl = mutually exclusive group.
// ability = unlocks an ability for the loadout (Q/W/E/R). fx(perks, rank) adds the bonus to the perks read by the sim.
export const BRANCHES = [
  { id: 'archer', name: 'Стрілець', icon: '🏹' },
  { id: 'elem', name: 'Стихії', icon: '🔥' },
  { id: 'eng', name: 'Інженер', icon: '🔧' },
  { id: 'cmd', name: 'Командир', icon: '🎺' },
];
export const TIER_NEED = [0, 3, 6, 10];
const mul = (obj, k, v) => { obj[k] = (obj[k] || 1) * v; };
const add = (obj, k, v) => { obj[k] = (obj[k] || 0) + v; };
export const TREE = [
  // --- Стрілець: лучники ---
  { id: 'a1', branch: 'archer', tier: 1, max: 3, name: 'Сталеві наконечники', desc: 'Лучники: +12% шкоди за рівень', fx: (p, r) => mul(p.dmg, 'arrow', 1 + 0.12 * r) },
  { id: 'a2', branch: 'archer', tier: 1, max: 2, name: 'Гострий зір', desc: 'Лучники: +10% радіусу за рівень', fx: (p, r) => mul(p.range, 'arrow', 1 + 0.1 * r) },
  { id: 'a3', branch: 'archer', tier: 1, max: 2, name: 'Швидкі пальці', desc: 'Лучники: +10% швидкості атаки за рівень', fx: (p, r) => mul(p.rate, 'arrow', 1 + 0.1 * r) },
  { id: 'a4', branch: 'archer', tier: 2, max: 2, name: 'Оперення', desc: '+6% шансу крита за рівень', fx: (p, r) => { p.crit += 0.06 * r; } },
  { id: 'a5', branch: 'archer', tier: 2, max: 1, name: 'Подвійний залп', desc: 'Лучники б’ють по 2 цілях', fx: (p, r) => { p.multi.arrow = r; } },
  { id: 'a6', branch: 'archer', tier: 2, max: 3, name: 'Гартування', desc: 'Усі вежі: +4% шкоди за рівень', fx: (p, r) => { p.dmgAll *= 1 + 0.04 * r; } },
  { id: 'a7', branch: 'archer', tier: 3, max: 1, name: 'Снайперська стійка', desc: 'Лучники: +20% радіусу', fx: (p) => mul(p.range, 'arrow', 1.2) },
  { id: 'a8', branch: 'archer', tier: 3, max: 2, name: 'Град стріл', desc: 'Лучники: +12% швидкості за рівень', fx: (p, r) => mul(p.rate, 'arrow', 1 + 0.12 * r) },
  { id: 'a9', branch: 'archer', tier: 3, max: 1, name: 'Смертоносна точність', desc: 'Крит x2.5 замість x2', fx: (p) => { p.critMul += 0.5; } },
  { id: 'k_focus', branch: 'archer', tier: 4, max: 1, key: true, excl: 'slots', name: 'Фокус', desc: '2 слоти здібностей, перезарядка −40%', fx: (p) => { p.slots = 2; p.cdAll *= 0.6; } },
  // --- Стихії: крига, вогонь, тесла ---
  { id: 'e1', branch: 'elem', tier: 1, max: 2, name: 'Крижані уламки', desc: 'Крига: +15% шкоди за рівень', fx: (p, r) => mul(p.dmg, 'frost', 1 + 0.15 * r) },
  { id: 'e2', branch: 'elem', tier: 1, max: 2, name: 'Вічна мокрість', desc: 'Мокрі вороги довше: +1.5 с за рівень', fx: (p, r) => { p.wet += 1.5 * r; } },
  { id: 'e3', branch: 'elem', tier: 1, max: 2, name: 'Жарина', desc: 'Вогонь: +15% шкоди за рівень', fx: (p, r) => mul(p.dmg, 'fire', 1 + 0.15 * r) },
  { id: 'e4', branch: 'elem', tier: 2, max: 1, name: 'Полярне сяйво', desc: 'Крига: +15% радіусу', fx: (p) => mul(p.range, 'frost', 1.15) },
  { id: 'e5', branch: 'elem', tier: 2, max: 2, name: 'Смола', desc: 'Горіння: +25% за рівень', fx: (p, r) => { p.burn *= 1 + 0.25 * r; } },
  { id: 'e6', branch: 'elem', tier: 2, max: 1, ability: 'quake', name: 'Землетрус', desc: 'Відкриває здібність: удар по площі й сповільнення' },
  { id: 'e7', branch: 'elem', tier: 3, max: 1, name: 'Парова турбіна', desc: 'Вибух пари: +40%', fx: (p) => { p.steam *= 1.4; } },
  { id: 'e8', branch: 'elem', tier: 3, max: 2, name: 'Мідна обмотка', desc: 'Тесла: +15% шкоди за рівень', fx: (p, r) => mul(p.dmg, 'tesla', 1 + 0.15 * r) },
  { id: 'e9', branch: 'elem', tier: 3, max: 2, name: 'Розгалуження', desc: 'Тесла: +1 стрибок блискавки за рівень', fx: (p, r) => { p.chain += r; } },
  { id: 'e11', branch: 'elem', tier: 2, max: 2, name: 'Мікориза', desc: 'Грибниця: отрута +20% за рівень', fx: (p, r) => { p.spore *= 1 + 0.2 * r; } },
  { id: 'k_vortex', branch: 'elem', tier: 4, max: 1, key: true, name: 'Стихійний вир', desc: 'Пара ×1.5 сили й радіусу; Тесла на мокрих +1 стрибок', fx: (p) => { p.steam *= 1.5; p.steamR *= 1.5; p.wetChain += 1; } },
  // --- Інженер: вежі, тотеми, барикади ---
  { id: 'g1', branch: 'eng', tier: 1, max: 3, name: 'Дешева праця', desc: 'Вежі: −5% вартості за рівень', fx: (p, r) => add(p.discount, 'all', 0.05 * r) },
  { id: 'g2', branch: 'eng', tier: 1, max: 2, name: 'Перестановка', desc: 'Перезарядка переміщення веж −15% за рівень', fx: (p, r) => { p.moveCd *= 0.85 ** r; } },
  { id: 'g3', branch: 'eng', tier: 1, max: 2, name: 'Міцні барикади', desc: 'Барикада: +25% міцності за рівень', fx: (p, r) => { p.wall *= 1 + 0.25 * r; } },
  { id: 'g4', branch: 'eng', tier: 2, max: 2, name: 'Тотемні руни', desc: 'Аури тотемів: +15% за рівень', fx: (p, r) => { p.aura *= 1 + 0.15 * r; } },
  { id: 'g5', branch: 'eng', tier: 2, max: 1, ability: 'goldrain', name: 'Золотий дощ', desc: 'Відкриває здібність: монети на полі' },
  { id: 'g6', branch: 'eng', tier: 2, max: 2, name: 'Торг', desc: 'Продаж: повертаєш +5% вартості за рівень', fx: (p, r) => { p.sell += 0.05 * r; } },
  { id: 'g7', branch: 'eng', tier: 3, max: 2, name: 'Резерв', desc: '+40 стартового золота за рівень', fx: (p, r) => { p.bonusGold += 40 * r; } },
  { id: 'g8', branch: 'eng', tier: 3, max: 2, name: 'Швидкий монтаж', desc: 'Барикада: перезарядка −20% за рівень', fx: (p, r) => { p.wallCd *= 0.8 ** r; } },
  { id: 'g9', branch: 'eng', tier: 3, max: 1, name: 'Дешеві тотеми', desc: 'Тотем: −20% вартості', fx: (p) => add(p.discount, 'totem', 0.2) },
  { id: 'g10', branch: 'eng', tier: 3, max: 2, name: 'Майстер-зброяр', desc: 'Фінальне покращення веж (майстерність): −15% ціни за рівень', fx: (p, r) => { p.masterDisc += 0.15 * r; } },
  { id: 'k_forge', branch: 'eng', tier: 4, max: 1, key: true, name: 'Ковальня', desc: 'Продаж повертає 90% вартості; вежі −10%', fx: (p) => { p.sell += 0.2; add(p.discount, 'all', 0.1); } },
  // --- Командир: здібності, золото, життя ---
  { id: 'm1', branch: 'cmd', tier: 1, max: 3, name: 'Міцні мури', desc: '+3 життя замку за рівень', fx: (p, r) => { p.bonusLives += 3 * r; } },
  { id: 'm2', branch: 'cmd', tier: 1, max: 2, name: 'Податки', desc: '+10% золота за вбивства за рівень', fx: (p, r) => { p.gold *= 1 + 0.1 * r; } },
  { id: 'm3', branch: 'cmd', tier: 1, max: 2, name: 'Жалування', desc: '+12 золота на початку кожної хвилі за рівень', fx: (p, r) => { p.wage += 12 * r; } },
  { id: 'm4', branch: 'cmd', tier: 2, max: 2, name: 'Бойовий дух', desc: 'Перезарядка всіх здібностей −8% за рівень', fx: (p, r) => { p.cdAll *= 0.92 ** r; } },
  { id: 'm5', branch: 'cmd', tier: 2, max: 1, name: 'Сила Метеора', desc: 'Метеор: +25% шкоди', fx: (p, r) => { p.meteorDmg *= 1 + 0.25 * r; } },
  { id: 'm6', branch: 'cmd', tier: 2, max: 1, ability: 'overdrive', name: 'Овердрайв', desc: 'Відкриває здібність: твої вежі стріляють швидше' },
  { id: 'm7', branch: 'cmd', tier: 3, max: 2, name: 'Гучний клич', desc: 'Овердрайв: +2 с за рівень', fx: (p, r) => { p.overSec += 2 * r; } },
  { id: 'm8', branch: 'cmd', tier: 3, max: 2, name: 'Крижана тиша', desc: 'Крижана нова: +0.5 с заморозки за рівень', fx: (p, r) => { p.novaFreeze += 0.5 * r; } },
  { id: 'm9', branch: 'cmd', tier: 3, max: 1, name: 'Мудрість', desc: '+1 картка таланту на вибір', fx: (p, r) => { p.cards += r; } },
  { id: 'k_hand', branch: 'cmd', tier: 4, max: 1, key: true, excl: 'slots', ability: 'dragon', name: 'Вільна рука', desc: '4 слоти здібностей і здібність Дракон: летить уздовж дороги й випалює ворогів', fx: (p) => { p.slots = 4; } },
];
export const nodeOf = (id) => TREE.find((n) => n.id === id);

// ---------- builds ----------
const BASE_ABILITIES = ['meteor', 'nova', 'wall'];
const DEFAULT_SLOTS = [...BASE_ABILITIES, null];
const newBuild = () => ({ tree: {}, slots: [...DEFAULT_SLOTS] });
export function newMeta() {
  return { v: 2, xp: 0, builds: [newBuild(), newBuild(), newBuild()], active: 0, best: {}, wins: {}, runs: 0, campaign: {}, bestiary: {}, avatar: { code: '', set: false } };
}

const spentOf = (tree) => Object.values(tree).reduce((a, r) => a + r, 0);
const below = (tree, branch, tier) => TREE.reduce((a, n) => a + (n.branch === branch && n.tier < tier ? tree[n.id] || 0 : 0), 0);
// A tree is legal when it fits the level, every rank sits in an open tier, no more than 2 keystones and no excl clash.
export function treeValid(tree, L) {
  if (spentOf(tree) > L) return false;
  const groups = {};
  for (const id in tree) {
    const r = tree[id];
    if (!r) continue;
    const n = nodeOf(id);
    if (!n || r > n.max) return false;
    if (n.excl) { groups[n.excl] = (groups[n.excl] || 0) + 1; if (groups[n.excl] > 1) return false; }
    if (n.key) { groups.key = (groups.key || 0) + 1; if (groups.key > 2) return false; }
    if (below(tree, n.branch, n.tier) < TIER_NEED[n.tier - 1]) return false;
  }
  return true;
}

export const activeIdx = (m) => Math.max(0, Math.min(m.active || 0, buildsOpen(level(m)) - 1));
export const activeBuild = (m) => m.builds[activeIdx(m)];
export function setActive(m, i) {
  if (i < 0 || i >= buildsOpen(level(m))) return false;
  m.active = i;
  save(m);
  return true;
}
export const points = (m) => level(m) - spentOf(activeBuild(m).tree); // free points in the active build
export const rankOf = (m, id) => activeBuild(m).tree[id] || 0;
export const spentBelow = (m, branch, tier) => below(activeBuild(m).tree, branch, tier);
export function canBuy(m, id) {
  const n = nodeOf(id);
  if (!n || rankOf(m, id) >= n.max) return false;
  return treeValid({ ...activeBuild(m).tree, [id]: rankOf(m, id) + 1 }, level(m));
}
export function buy(m, id) {
  if (!canBuy(m, id)) return false;
  activeBuild(m).tree[id] = rankOf(m, id) + 1;
  save(m);
  return true;
}
// Take back one rank for free, as long as the build stays legal (no higher tier loses its points).
export function canRefund(m, id) {
  const r = rankOf(m, id);
  return r > 0 && treeValid({ ...activeBuild(m).tree, [id]: r - 1 }, level(m));
}
export function refund(m, id) {
  if (!canRefund(m, id)) return false;
  const tree = activeBuild(m).tree, r = rankOf(m, id) - 1;
  if (r) tree[id] = r; else delete tree[id];
  save(m);
  return true;
}
export function resetBuild(m) {
  activeBuild(m).tree = {};
  save(m);
}

// Abilities: the base three plus every ability a tree node has unlocked in the active build.
export const abilityPool = (m) => poolOf(activeBuild(m));
function poolOf(b) {
  return [...BASE_ABILITIES, ...TREE.filter((n) => n.ability && b.tree[n.id]).map((n) => n.ability)];
}
// Slot i (0..3 = Q/W/E/R) gets an ability from the pool, or null. An ability already in another slot is swapped.
export function setSlot(m, i, id) {
  const b = activeBuild(m);
  if (i < 0 || i > 3) return false;
  if (id !== null && !poolOf(b).includes(id)) return false;
  const j = id ? b.slots.indexOf(id) : -1;
  if (j >= 0 && j !== i) b.slots[j] = b.slots[i];
  b.slots[i] = id;
  save(m);
  return true;
}

// Everything the tree gives this player, in the shape the simulation reads (createGame opts.perks[i]).
export function perks(m) {
  const L = level(m), b = activeBuild(m);
  const p = {
    bonusGold: 0, bonusLives: 0, cards: 3, slots: 3,
    cdAll: 1, meteorCd: 1, novaCd: 1, wallCd: 1, moveCd: 1, wall: 1, meteorDmg: 1, novaFreeze: 0, overSec: 0,
    gold: 1, wage: 0, sell: 0, dmgAll: 1, crit: 0, critMul: 0, wet: 0, wetChain: 0, chain: 0, burn: 1,
    steam: 1, steamR: 1, aura: 1, splash: 1, multi: {}, masterDisc: 0,
    spore: 1, sporeTime: 1, sporeGen: 0, sporeN: 0, sporeBurst: 1,
    dmg: {}, rate: {}, range: {}, discount: {},
    locked: Object.keys(UNLOCK_LEVEL).filter((k) => L < UNLOCK_LEVEL[k]),
  };
  for (const n of TREE) {
    const r = b.tree[n.id] || 0;
    if (r && n.fx) n.fx(p, r);
  }
  const pool = poolOf(b);
  // the loadout keeps its positions: slot 2 empty leaves a gap, so keys stay where the player put them
  p.abilities = b.slots.slice(0, p.slots).map((id) => (id && pool.includes(id) ? id : null));
  return p;
}

// ---------- progression storage ----------
export const save = (m) => {
  if (!persist) return;
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable: progress lives only this session */ }
};
// Old save (pixeltd-meta-v1): every XP ever earned becomes XP again. Spent XP comes back, so nobody loses progress.
const LEGACY_COST = {
  gold: [10, 25, 50], lives: [10, 25, 50], meteor: [20, 45], chill: [20, 45], stride: [25], cards: [60],
  a1: [10, 25], a2: [20], a3: [35], c1: [10, 25], c2: [20], c3: [35], f1: [10, 25], f2: [20], f3: [35],
  t0: [15], t1: [15, 30], t2: [30], t3: [45], r0: [20], r1: [15, 30], r2: [30], r3: [45], o1: [15], o2: [20], o3: [40],
};
export function migrateLegacy(old) {
  const m = newMeta();
  const tree = { ...(old.tree || {}) };
  // the even older crystal shop: crystals were XP, bought upgrades became tree nodes
  const up = old.upgrades || {};
  const map = { tesla: 't0', fire: 'r0', gold: 'gold', lives: 'lives', meteor: 'meteor', cards: 'cards' };
  for (const [o, node] of Object.entries(map)) if (up[o]) tree[node] = Math.max(tree[node] || 0, up[o]);
  let xp = (old.xp || 0) + (old.crystals || 0);
  for (const [id, lv] of Object.entries(tree)) for (let i = 0; i < lv; i++) xp += (LEGACY_COST[id] || [])[i] || 0;
  m.xp = xp;
  m.best = old.best || {};
  m.wins = old.wins || {};
  m.runs = old.runs || 0;
  m.campaign = old.campaign || {};
  return m;
}
export function load() {
  let m = null;
  try { m = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { m = null; }
  if (!m) {
    try { const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); if (old) m = migrateLegacy(old); } catch { /* unreadable old save: start fresh */ }
  }
  const base = newMeta();
  m = { ...base, ...(m || {}) };
  // normalise: always 3 builds with 4 slots, whatever an older version stored
  m.builds = base.builds.map((_, i) => {
    const src = (m.builds && m.builds[i]) || {};
    return { tree: { ...(src.tree || {}) }, slots: [0, 1, 2, 3].map((j) => (src.slots ? src.slots[j] ?? null : DEFAULT_SLOTS[j])) };
  });
  save(m);
  return m;
}

// ---------- unchanged parts: missions, difficulty, records ----------
// campaign: mission id -> best stars (1..3). Mission 1 is always open, the next opens after a win.
export const missionStars = (m, id) => (m.campaign && m.campaign[id]) || 0;
export const missionOpen = (m, id) => id === 1 || missionStars(m, id - 1) > 0;

// a win on the previous difficulty in either mode unlocks the next one
export const unlockedDiff = (m, d) => !d.need || !!m.wins[d.need] || !!m.wins['circle-' + d.need];
export const bestKey = (mode, diff) => (mode === 'circle' ? 'circle-' : '') + diff;

// guestsPerks: the guests' trees (sent in the co-op handshake), in seat order; each player plays with their own tree.
export function gameOpts(m, diffId, mode = "classic", players = 1, season = "random", guestsPerks = []) {
  const d = DIFFS.find((k) => k.id === diffId) || DIFFS[0];
  const mine = perks(m);
  const all = [mine];
  for (let i = 1; i < players; i++) all.push(guestsPerks[i - 1] || perks(newMeta()));
  return {
    hpMul: d.hpMul,
    perks: all,
    lockedBy: all.map((p) => p.locked),
    locked: mine.locked,
    bonusLives: Math.max(...all.map((p) => p.bonusLives)), // shared castle: the stronger walls count
    cards: mine.cards,
    diff: d.id,
    mode,
    players,
    season,
  };
}

// ---------- bestiary: every boss met (BOSSES key -> { seen, kills, best }) ----------
// best = index in DIFFS of the hardest difficulty the boss was beaten on (-1: never beaten). Co-op kills count for everyone.
export const bossEntry = (m, k) => (m.bestiary && m.bestiary[k]) || { seen: 0, kills: 0, best: -1 };
// sum: the client's run summary (bossesSeen / bossesKilled keys). Returns what is new for the end screen.
export function recordBosses(m, sum, diffId) {
  m.bestiary = m.bestiary || {};
  const rank = Math.max(0, DIFFS.findIndex((d) => d.id === diffId));
  const out = { seen: [], killed: [], medal: [] };
  const entry = (k) => (m.bestiary[k] = m.bestiary[k] || { seen: 0, kills: 0, best: -1 });
  for (const k of sum.bossesSeen) { const b = entry(k); if (!b.seen && !out.seen.includes(k)) out.seen.push(k); b.seen++; }
  for (const k of sum.bossesKilled) {
    const b = entry(k);
    if (!b.seen) b.seen = 1;
    if (!b.kills && !out.killed.includes(k)) out.killed.push(k);
    else if (rank > b.best && !out.medal.includes(k)) out.medal.push(k);
    b.kills++;
    b.best = Math.max(b.best, rank);
  }
  return out;
}

// Returns XP earned, whether it's a new record, and the level after the run (levelUp = a new talent point).
// sum (optional): the run summary from the client (src/client/summary.js) — feeds the bestiary.
export function finishRun(m, s, sum = null) {
  const d = DIFFS.find((k) => k.id === s.opts.diff) || DIFFS[0];
  // endless run after a win: only the extra waves pay (the win itself was already paid)
  const earned = s.endless && !s.won
    ? Math.round(Math.max(0, s.wave - 20) * 2 * d.reward)
    : Math.round((s.wave + (s.won ? 15 : 0) + Math.floor(s.kills / 40)) * d.reward);
  const key = s.opts.mode === 'campaign' ? 'campaign-' + s.mission.id : s.opts.mode === 'brawl' ? 'brawl-' + s.opts.week + '-' + d.id : (s.mode === 'circle' ? 'circle-' : '') + d.id;
  if (s.mission && s.won) { m.campaign = m.campaign || {}; m.campaign[s.mission.id] = Math.max(m.campaign[s.mission.id] || 0, s.stars || 1); }
  const record = s.wave > (m.best[key] || 0);
  const before = level(m);
  m.xp += earned;
  m.runs++;
  if (record) m.best[key] = s.wave;
  if (s.won) m.wins[key] = (m.wins[key] || 0) + 1;
  const bestiary = sum ? recordBosses(m, sum, d.id) : null;
  save(m);
  const after = level(m);
  return { earned, record, level: after, levelUp: after > before, bestiary };
}
