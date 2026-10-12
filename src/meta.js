// Meta-progression between runs: experience (XP), the talent tree, difficulty unlocks, records.
// Stored per browser in localStorage (wrapped in try/catch: storage may be unavailable).
const KEY = 'pixeltd-meta-v1';

export const DIFFS = [
  { id: 'normal', name: 'Звичайна', hpMul: 1, reward: 1 },
  { id: 'hard', name: 'Важка', hpMul: 1.4, reward: 1.5, need: 'normal' },
  { id: 'nightmare', name: 'Кошмар', hpMul: 1.9, reward: 2.2, need: 'hard' },
];

// Talent tree. Each node: branch, cost per level (XP), optional req (node id that must be taken first),
// fx(perks, level) adds its bonus to the perks object the simulation reads at game start.
export const BRANCHES = [
  { id: 'general', name: 'Загальне', icon: '✦' },
  { id: 'arrow', name: 'Лучник', icon: '🏹' },
  { id: 'cannon', name: 'Гармата', icon: '💣' },
  { id: 'frost', name: 'Крига', icon: '❄' },
  { id: 'tesla', name: 'Тесла', icon: '⚡' },
  { id: 'fire', name: 'Вогонь', icon: '🔥' },
  { id: 'totem', name: 'Тотем', icon: '🗿' },
];
const mul = (obj, k, v) => { obj[k] = (obj[k] || 1) * v; };
export const TREE = [
  // --- universal ---
  { id: 'gold', branch: 'general', name: 'Скарбниця', desc: '+30 стартового золота за рівень', cost: [10, 25, 50], fx: (p, l) => { p.bonusGold += 30 * l; } },
  { id: 'lives', branch: 'general', name: 'Мури', desc: '+3 життя замку за рівень', cost: [10, 25, 50], fx: (p, l) => { p.bonusLives += 3 * l; } },
  { id: 'meteor', branch: 'general', name: 'Астрономія', desc: 'Метеор −15% перезарядки за рівень', cost: [20, 45], req: 'gold', fx: (p, l) => { p.meteorCd *= 0.85 ** l; } },
  { id: 'chill', branch: 'general', name: 'Холодна голова', desc: 'Крижана нова −15% перезарядки за рівень', cost: [20, 45], req: 'lives', fx: (p, l) => { p.novaCd *= 0.85 ** l; } },
  { id: 'stride', branch: 'general', name: 'Легкий крок', desc: 'Перезарядка переміщення веж −30%', cost: [25], req: 'meteor', fx: (p) => { p.moveCd *= 0.7; } },
  { id: 'cards', branch: 'general', name: 'Мудрість', desc: '4 картки таланту на вибір замість 3', cost: [60], req: 'chill', fx: (p) => { p.cards = 4; } },
  // --- archer ---
  { id: 'a1', branch: 'arrow', name: 'Сталеві наконечники', desc: 'Лучники: +15% шкоди за рівень', cost: [10, 25], fx: (p, l) => mul(p.dmg, 'arrow', 1.15 ** l) },
  { id: 'a2', branch: 'arrow', name: 'Орлине око', desc: 'Лучники: +10% радіусу, +5% шансу крита', cost: [20], req: 'a1', fx: (p) => { mul(p.range, 'arrow', 1.1); p.crit += 0.05; } },
  { id: 'a3', branch: 'arrow', name: 'Град стріл', desc: 'Лучники: +20% швидкості атаки', cost: [35], req: 'a2', fx: (p) => mul(p.rate, 'arrow', 1.2) },
  // --- cannon ---
  { id: 'c1', branch: 'cannon', name: 'Важкі ядра', desc: 'Гармати: +15% шкоди за рівень', cost: [10, 25], fx: (p, l) => mul(p.dmg, 'cannon', 1.15 ** l) },
  { id: 'c2', branch: 'cannon', name: 'Більший заряд', desc: 'Гармати: +25% радіусу вибуху', cost: [20], req: 'c1', fx: (p) => { p.splash *= 1.25; } },
  { id: 'c3', branch: 'cannon', name: 'Швидке заряджання', desc: 'Гармати: +20% швидкості атаки', cost: [35], req: 'c2', fx: (p) => mul(p.rate, 'cannon', 1.2) },
  // --- frost ---
  { id: 'f1', branch: 'frost', name: 'Крижані уламки', desc: 'Крига: +20% шкоди за рівень', cost: [10, 25], fx: (p, l) => mul(p.dmg, 'frost', 1.2 ** l) },
  { id: 'f2', branch: 'frost', name: 'Вічна мокрість', desc: 'Вороги мокрі на 2 с довше', cost: [20], req: 'f1', fx: (p) => { p.wet += 2; } },
  { id: 'f3', branch: 'frost', name: 'Полярне сяйво', desc: 'Крига: +15% радіусу', cost: [35], req: 'f2', fx: (p) => mul(p.range, 'frost', 1.15) },
  // --- tesla ---
  { id: 't0', branch: 'tesla', name: 'Вежа Тесла', desc: 'Відкрити Теслу (ланцюгова блискавка)', cost: [15], unlock: 'tesla' },
  { id: 't1', branch: 'tesla', name: 'Мідна обмотка', desc: 'Тесла: +15% шкоди за рівень', cost: [15, 30], req: 't0', fx: (p, l) => mul(p.dmg, 'tesla', 1.15 ** l) },
  { id: 't2', branch: 'tesla', name: 'Розгалуження', desc: 'Тесла: +1 стрибок блискавки', cost: [30], req: 't1', fx: (p) => { p.chain += 1; } },
  { id: 't3', branch: 'tesla', name: 'Висока напруга', desc: 'Тесла: +20% швидкості атаки', cost: [45], req: 't2', fx: (p) => mul(p.rate, 'tesla', 1.2) },
  // --- fire ---
  { id: 'r0', branch: 'fire', name: 'Вежа Вогонь', desc: 'Відкрити Вогонь (горіння, вибух пари)', cost: [20], unlock: 'fire' },
  { id: 'r1', branch: 'fire', name: 'Смола', desc: 'Горіння +25% за рівень', cost: [15, 30], req: 'r0', fx: (p, l) => { p.burn *= 1.25 ** l; } },
  { id: 'r2', branch: 'fire', name: 'Парова турбіна', desc: 'Вибух пари +40%', cost: [30], req: 'r1', fx: (p) => { p.steam *= 1.4; } },
  { id: 'r3', branch: 'fire', name: 'Пекельний жар', desc: 'Вогонь: +15% шкоди', cost: [45], req: 'r2', fx: (p) => mul(p.dmg, 'fire', 1.15) },
  // --- totem ---
  { id: 'o1', branch: 'totem', name: 'Рунічний камінь', desc: 'Аури тотемів +15%', cost: [15], fx: (p) => { p.aura *= 1.15; } },
  { id: 'o2', branch: 'totem', name: 'Дешеві тотеми', desc: 'Тотем коштує на 25% менше', cost: [20], req: 'o1', fx: (p) => { p.discount.totem = 0.25; } },
  { id: 'o3', branch: 'totem', name: 'Древні руни', desc: 'Аури тотемів ще +15%', cost: [40], req: 'o2', fx: (p) => { p.aura *= 1.15; } },
];

const empty = () => ({ xp: 0, tree: {}, best: {}, wins: {}, runs: 0 });

export function load() {
  let m;
  try { m = { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { m = empty(); }
  // migrate the old crystal shop: crystals become XP, bought upgrades become tree nodes
  if (m.crystals !== undefined || m.upgrades) {
    const up = m.upgrades || {};
    m.xp = (m.xp || 0) + (m.crystals || 0);
    const map = { tesla: 't0', fire: 'r0', gold: 'gold', lives: 'lives', meteor: 'meteor', cards: 'cards' };
    for (const [old, node] of Object.entries(map)) if (up[old]) m.tree[node] = Math.max(m.tree[node] || 0, up[old]);
    // old 'cards' did not need 'chill'; keep prerequisites consistent
    if (m.tree.cards && !m.tree.chill) m.tree.chill = 1;
    if (m.tree.meteor && !m.tree.gold) m.tree.gold = 1;
    delete m.crystals;
    delete m.upgrades;
    save(m);
  }
  return m;
}
function save(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable: progress lives only this session */ }
}

export const level = (m, id) => m.tree[id] || 0;
export const nodeOf = (id) => TREE.find((n) => n.id === id);
export const canBuy = (m, n) => level(m, n.id) < n.cost.length && (!n.req || level(m, n.req) > 0) && m.xp >= n.cost[level(m, n.id)];
// a win on the previous difficulty in either mode unlocks the next one
export const unlockedDiff = (m, d) => !d.need || !!m.wins[d.need] || !!m.wins['circle-' + d.need];
export const bestKey = (mode, diff) => (mode === 'circle' ? 'circle-' : '') + diff;

export function buy(m, id) {
  const n = nodeOf(id);
  if (!n || !canBuy(m, n)) return false;
  m.xp -= n.cost[level(m, id)];
  m.tree[id] = level(m, id) + 1;
  save(m);
  return true;
}

// Everything the tree gives this player, in the shape the simulation reads (createGame opts.perks[i]).
export function perks(m) {
  const p = {
    bonusGold: 0, bonusLives: 0, meteorCd: 1, novaCd: 1, moveCd: 1, cards: 3,
    dmg: {}, rate: {}, range: {}, discount: {}, crit: 0, wet: 0, chain: 0, burn: 1, steam: 1, aura: 1, splash: 1,
    locked: ['tesla', 'fire'],
  };
  for (const n of TREE) {
    const l = level(m, n.id);
    if (!l) continue;
    if (n.unlock) p.locked = p.locked.filter((k) => k !== n.unlock);
    if (n.fx) n.fx(p, l);
  }
  return p;
}

// guestsPerks: the guests' trees (sent in the co-op handshake), in seat order; each player plays with their own tree.
export function gameOpts(m, diffId, mode = "classic", players = 1, season = "random", guestsPerks = []) {
  const d = DIFFS.find((k) => k.id === diffId) || DIFFS[0];
  const mine = perks(m);
  const all = [mine];
  for (let i = 1; i < players; i++) all.push(guestsPerks[i - 1] || perks(empty()));
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

// Returns XP earned and whether it's a new record.
export function finishRun(m, s) {
  const d = DIFFS.find((k) => k.id === s.opts.diff) || DIFFS[0];
  // endless run after a win: only the extra waves pay (the win itself was already paid)
  const earned = s.endless && !s.won
    ? Math.round(Math.max(0, s.wave - 20) * 2 * d.reward)
    : Math.round((s.wave + (s.won ? 15 : 0) + Math.floor(s.kills / 40)) * d.reward);
  const key = s.opts.mode === 'brawl' ? 'brawl-' + s.opts.week + '-' + d.id : (s.mode === 'circle' ? 'circle-' : '') + d.id;
  const record = s.wave > (m.best[key] || 0);
  m.xp += earned;
  m.runs++;
  if (record) m.best[key] = s.wave;
  if (s.won) m.wins[key] = (m.wins[key] || 0) + 1;
  save(m);
  return { earned, record };
}
