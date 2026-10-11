// Meta-progression between runs: crystals, permanent upgrades, difficulty unlocks, records.
// Stored per browser in localStorage (wrapped in try/catch: storage may be unavailable).
const KEY = 'pixeltd-meta-v1';

export const DIFFS = [
  { id: 'normal', name: 'Звичайна', hpMul: 1, reward: 1 },
  { id: 'hard', name: 'Важка', hpMul: 1.4, reward: 1.5, need: 'normal' },
  { id: 'nightmare', name: 'Кошмар', hpMul: 1.9, reward: 2.2, need: 'hard' },
];

export const SHOP = [
  { id: 'tesla', name: 'Вежа Тесла', desc: 'Відкрити Теслу (ланцюгова блискавка)', cost: [15] },
  { id: 'fire', name: 'Вежа Вогонь', desc: 'Відкрити Вогонь (горіння, вибух пари)', cost: [20] },
  { id: 'gold', name: 'Скарбниця', desc: '+30 стартового золота', cost: [10, 25, 50] },
  { id: 'lives', name: 'Мури', desc: '+3 життя на старті', cost: [10, 25, 50] },
  { id: 'meteor', name: 'Астрономія', desc: 'Метеор −15% перезарядки', cost: [20, 45] },
  { id: 'cards', name: 'Мудрість', desc: '4 картки на вибір замість 3', cost: [60] },
];

const empty = () => ({ crystals: 0, upgrades: {}, best: {}, wins: {}, runs: 0 });

export function load() {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return empty(); }
}
function save(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable: progress lives only this session */ }
}

export const level = (m, id) => m.upgrades[id] || 0;
export const unlockedDiff = (m, d) => !d.need || !!m.wins[d.need];

export function buy(m, id) {
  const item = SHOP.find((i) => i.id === id);
  const lv = level(m, id);
  if (!item || lv >= item.cost.length || m.crystals < item.cost[lv]) return false;
  m.crystals -= item.cost[lv];
  m.upgrades[id] = lv + 1;
  save(m);
  return true;
}

export function gameOpts(m, diffId) {
  const d = DIFFS.find((k) => k.id === diffId) || DIFFS[0];
  return {
    hpMul: d.hpMul,
    bonusGold: 30 * level(m, 'gold'),
    bonusLives: 3 * level(m, 'lives'),
    meteorCd: 1 - 0.15 * level(m, 'meteor'),
    cards: 3 + level(m, 'cards'),
    locked: ['tesla', 'fire'].filter((k) => !level(m, k)),
    diff: d.id,
  };
}

// Returns crystals earned and whether it's a new record.
export function finishRun(m, s) {
  const d = DIFFS.find((k) => k.id === s.opts.diff) || DIFFS[0];
  const earned = Math.round((s.wave + (s.won ? 15 : 0) + Math.floor(s.kills / 40)) * d.reward);
  const record = s.wave > (m.best[d.id] || 0);
  m.crystals += earned;
  m.runs++;
  if (record) m.best[d.id] = s.wave;
  if (s.won) m.wins[d.id] = (m.wins[d.id] || 0) + 1;
  save(m);
  return { earned, record };
}
