// All balance lives here. Simulation reads it, renderer never changes it.
// Distances/speeds are in world pixels (1 tile = 24 px).
import { rand } from './rng.js';
export const TILE = 24;
export const COLS = 26;
export const ROWS = 14;
export const TICK_RATE = 20;
// Bump on every change to sim/data: co-op peers refuse to play with a different version.
export const VERSION = 37;

export const CONFIG = {
  startGold: 160,
  startLives: 20,
  firstWaveDelay: 15, // s
  waveDelay: 15, // s between waves
  earlyBonus: 2, // gold per remaining second when calling a wave early
  steamRadius: 33,
  steamDmg: 14,
  rangePerLevel: 12,
  moveRange: 10, // tiles a tower can be relocated
  moveCd: 30, // s, per tower
  moveSetup: 1, // s without shooting after a move
  maxLevel: 3,
  winWave: 20, // survive this wave (final boss) to win
  sellRatio: 0.7,
};

// Active player abilities (hotkeys Q / W / E).
export const ABILITIES = {
  meteor: { name: 'Метеор', key: 'Q', cd: 30, radius: 54, desc: 'Клік по карті: вибух + підпал.' },
  nova: { name: 'Крижана нова', key: 'W', cd: 45, freeze: 2, wet: 5, desc: 'Заморожує ВСІХ ворогів на 2 с і робить їх мокрими.' },
  wall: { name: 'Барикада', key: 'E', cd: 35, hp: 80, hpPerWave: 15, desc: 'Клік по дорозі: стіна, яку вороги мусять зламати. Одна на гравця.' },
};

export const TOWERS = {
  arrow: {
    name: 'Лучник', cost: 50, range: 84, rate: 2.2, dmg: 6, proj: 'arrow', speed: 390,
    desc: 'Швидкі постріли, шанс крита. Слабкий проти броні.',
  },
  cannon: {
    name: 'Гармата', cost: 90, range: 75, rate: 0.7, dmg: 16, proj: 'ball', speed: 225, splash: 30,
    desc: 'Вибух по площі, ігнорує броню.',
  },
  frost: {
    name: 'Крига', cost: 70, range: 72, rate: 1.1, dmg: 2, proj: 'ice', speed: 300, slow: 0.5, slowTime: 1.5, wetTime: 4,
    desc: 'Сповільнює і робить ворогів МОКРИМИ.',
  },
  tesla: {
    name: 'Тесла', cost: 110, range: 66, rate: 0.9, dmg: 9, chain: 2, chainRange: 60,
    desc: 'Ланцюгова блискавка. По мокрих x2 і +1 стрибок.',
  },
  fire: {
    name: 'Вогонь', cost: 80, range: 63, rate: 1.4, dmg: 3, proj: 'fire', speed: 255, burn: 6, burnTime: 3,
    desc: 'Підпалює. Мокрі вороги вибухають парою!',
  },
};
// Evolutions: at level 3 a tower can turn into one of two specialised types (from = base family).
Object.assign(TOWERS, {
  sniper: { from: 'arrow', name: 'Снайпер', cost: 160, range: 165, rate: 0.6, dmg: 60, proj: 'arrow', speed: 780, pierce: true, target: 'strong',
    desc: 'Величезний радіус, бʼє найсильнішого, ігнорує броню.' },
  ranger: { from: 'arrow', name: 'Рейнджер', cost: 140, range: 96, rate: 2.4, dmg: 9, proj: 'arrow', speed: 450, multi: 3,
    desc: 'Стріляє одразу в 3 цілі.' },
  mortar: { from: 'cannon', name: 'Мортира', cost: 170, range: 156, rate: 0.45, dmg: 45, proj: 'ball', speed: 180, splash: 45,
    desc: 'Бʼє через пів карти, величезний вибух.' },
  cluster: { from: 'cannon', name: 'Касетна', cost: 160, range: 84, rate: 0.7, dmg: 26, proj: 'ball', speed: 240, splash: 30, bomblets: 4,
    desc: 'Вибух розкидає 4 міні-бомби.' },
  blizzard: { from: 'frost', name: 'Хуртовина', cost: 150, range: 66, rate: 0.8, dmg: 4, pulse: true, slow: 0.45, slowTime: 1.2, wetTime: 5,
    desc: 'Хвилі холоду: всі навколо сповільнені й мокрі.' },
  glacier: { from: 'frost', name: 'Брила', cost: 150, range: 84, rate: 0.5, dmg: 20, proj: 'ice', speed: 330, slow: 0, slowTime: 1.2, wetTime: 5, freeze: true,
    desc: 'Заморожує ціль на місці.' },
  storm: { from: 'tesla', name: 'Грозовий шпиль', cost: 190, range: 84, rate: 1, dmg: 16, chain: 6, chainRange: 72,
    desc: 'Блискавка стрибає по 7 цілях.' },
  overload: { from: "tesla", name: "Перевантаження", cost: 150, range: 72, rate: 1.2, dmg: 14, chain: 0, chainRange: 0, overcharge: 0.4, overMax: 3,
    desc: "Одна ціль: кожен удар поспіль по ній +40% (до x3). Вбивця босів." },
  inferno: { from: 'fire', name: 'Пекло', cost: 170, range: 54, rate: 4, dmg: 3, pulse: true, burn: 10, burnTime: 2,
    desc: 'Безперервне полумʼя по всіх навколо.' },
  magma: { from: 'fire', name: 'Магма', cost: 160, range: 78, rate: 0.8, dmg: 8, proj: 'fire', speed: 225, burn: 8, burnTime: 3,
    puddle: { r: 21, dps: 16, time: 4 }, desc: 'Залишає на дорозі калюжі лави.' },
});
// Support tower: never shoots, gives auras to towers in range; each aura is upgraded separately.
TOWERS.totem = {
  name: "Тотем", cost: 90, range: 60, support: true,
  desc: "Не стріляє. Аури шкоди й швидкості для веж поруч — прокачуй кожну до 3 рівня.",
};
export const AURA = {
  dmg: { name: "Аура шкоди", bonus: [0.1, 0.2, 0.3], cost: [60, 110, 180] },
  rate: { name: "Аура швидкості", bonus: [0.1, 0.2, 0.3], cost: [60, 110, 180] },
};
export const TOWER_ORDER = ["arrow", "cannon", "frost", "tesla", "fire", "totem"];
export const BRANCHES = {
  arrow: ['sniper', 'ranger'], cannon: ['mortar', 'cluster'], frost: ['blizzard', 'glacier'],
  tesla: ["storm", "overload"], fire: ['inferno', 'magma'],
};

// Procedural map + interactive objects.
// Game modes. Circle: enemies loop forever and stack up; too many alive = defeat.
export const MODES = {
  classic: { name: "Класика", desc: "Вороги йдуть до замку. Пропустив — втратив життя." },
  circle: { name: "Коло", desc: "Вороги крутяться по колу й накопичуються. Забагато живих — поразка.", maxAlive: 45, lapSpeed: 0.06, lapHeal: 0.1, lapMax: 8, endlessBossEvery: 2, endlessHpGrowth: 1.12 },
};

export const MAPGEN = { lanes3Chance: 0.45, ponds: [1, 2], barrels: 4 };
// Seasons change the look and the landscape: pond count, how many obstacles and how many of them are trees.
export const SEASON_ORDER = ["spring", "summer", "autumn", "winter"];
export const SEASONS = {
  spring: { name: "Весна", ponds: [2, 3], obstacles: 28, trees: 0.7 },
  summer: { name: "Літо", ponds: [1, 2], obstacles: 30, trees: 0.65 },
  autumn: { name: "Осінь", ponds: [1, 2], obstacles: 36, trees: 0.85, chest: 0.4 },
  winter: { name: "Зима", ponds: [1, 3], obstacles: 30, trees: 0.4, frozen: true },
};
export const BARREL = { radius: 48, dmg: 30, dmgPerWave: 6 };
export const OBSTACLES = { count: 30, tree: 15, rock: 25, chestChance: 0.3, chestGold: 45 };
export const COIN = { chance: 0.1, life: 8, base: 4 };

export const ENEMIES = {
  slime: { name: 'Слиз', hp: 22, speed: 33, armor: 0, gold: 3, cost: 1, vs: { fire: 1.5, arrow: 0.75 } },
  runner: { name: 'Бігун', hp: 14, speed: 69, armor: 0, gold: 3, cost: 1.2, vs: { arrow: 1.5, cannon: 0.6 } },
  splitter: { name: 'Ділильник', hp: 40, speed: 30, armor: 0, gold: 4, cost: 2, splits: 'mini', vs: { cannon: 1.4, tesla: 0.7 } },
  knight: { name: 'Лицар', hp: 50, speed: 24, armor: 4, gold: 6, cost: 2.5, vs: { tesla: 1.5, fire: 0.6 } },
  healer: { name: 'Цілитель', hp: 35, speed: 30, armor: 0, gold: 6, cost: 3, heal: 5, healRange: 45, vs: { arrow: 1.3, frost: 0.5 } },
  mini: { name: 'Слизик', hp: 10, speed: 45, armor: 0, gold: 1, cost: 0.5, vs: { cannon: 1.5 } },
  goblin: { name: 'Гоблін-злодій', hp: 30, speed: 63, armor: 0, gold: 8, cost: 0, coins: 4, steal: 20, vs: { frost: 1.3, fire: 0.75 } },
  boss: { name: 'Бос', hp: 340, speed: 18, armor: 3, gold: 60, cost: 0, lives: 10, vs: { tesla: 1.2, frost: 0.7 } },
  king: { name: 'Король слизу', hp: 1400, speed: 14, armor: 5, gold: 0, cost: 0, lives: 20, heal: 20, healRange: 60, vs: { cannon: 1.2, fire: 0.7 } },
};
// Wave from which an enemy type can appear.
export const UNLOCKS = { slime: 1, runner: 2, splitter: 3, knight: 4, healer: 6 };

// Talents: each player picks one after every boss kill (one card in each offer is guaranteed rare). rarity: common / rare (rare is stronger and drawn less often);
// max = how many times one player can take it; modes = where it can appear (default: everywhere);
// needs = tower that must be unlocked for the card to make sense. coop = only offered with two players.
export const RARITY = { common: { weight: 3, name: 'Звичайний' }, rare: { weight: 1, name: 'Рідкісний' } };
export const CARDS = [
  // --- towers (common) ---
  { id: 'sharp', name: 'Гострі стріли', desc: "Лучники: +40% шкоди", rarity: "common", max: 2, apply: (s, p) => { p.mods.dmg.arrow *= 1.4; } },
  { id: 'boom', name: 'Порох', desc: "Гармати: +40% шкоди", rarity: "common", max: 2, apply: (s, p) => { p.mods.dmg.cannon *= 1.4; } },
  { id: 'glacier', name: 'Льодовик', desc: "Крига: +50% шкоди, вороги мокрі на 3 с довше", rarity: "common", max: 2, apply: (s, p) => { p.mods.dmg.frost *= 1.5; p.mods.wet += 3; } },
  { id: 'coils', name: 'Мідні котушки', desc: "Тесла: +40% шкоди", rarity: "common", max: 2, needs: "tesla", apply: (s, p) => { p.mods.dmg.tesla *= 1.4; } },
  { id: 'napalm', name: 'Напалм', desc: "Вогонь: горіння +60%", rarity: "common", max: 2, needs: "fire", apply: (s, p) => { p.mods.burn *= 1.6; } },
  { id: 'haste', name: 'Адреналін', desc: "Усі вежі: +15% швидкості атаки", rarity: "common", max: 2, apply: (s, p) => { p.mods.rate *= 1.15; } },
  { id: 'optics', name: 'Оптика', desc: "Усі вежі: +12% радіусу", rarity: "common", max: 2, apply: (s, p) => { p.mods.range *= 1.12; } },
  // --- economy (common) ---
  { id: 'bounty', name: 'Нагорода', desc: "+30% золота за вбивства", rarity: "common", max: 2, apply: (s, p) => { p.mods.gold *= 1.3; } },
  { id: 'cash', name: 'Скарб', desc: "Одразу +100 золота і ще +15 за кожну пройдену хвилю", rarity: "common", max: 99, apply: (s, p) => { p.gold += 100 + 15 * s.wave; } },
  // --- rare ---
  { id: 'crit', name: 'Око сокола', desc: "Лучники: +15% шансу крита, крит x2.5", rarity: "rare", max: 2, apply: (s, p) => { p.mods.crit += 0.15; p.mods.critMul = 2.5; } },
  { id: 'storm', name: 'Буря', desc: "Тесла: +2 стрибки блискавки", rarity: "rare", max: 1, needs: "tesla", apply: (s, p) => { p.mods.chain += 2; } },
  { id: 'steam', name: 'Парова машина', desc: "Вибух пари (вогонь по мокрих) x2", rarity: "rare", max: 1, modes: ["classic"], needs: "fire", apply: (s, p) => { p.mods.steam *= 2; } },
  { id: 'veteran', name: 'Ветерани', desc: "Усі вежі: +20% шкоди", rarity: "rare", max: 2, apply: (s, p) => { for (const k in p.mods.dmg) p.mods.dmg[k] *= 1.2; } },
  { id: 'shaman', name: 'Шаман', desc: 'Аури твоїх тотемів сильніші на 50%', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.aura *= 1.5; } },
  { id: 'nomad', name: 'Кочівники', desc: 'Перезарядка переміщення веж −60%', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.moveCd *= 0.4; } },
  { id: 'meteor', name: 'Зорепад', desc: 'Метеор заряджається на 30% швидше', rarity: 'rare', max: 2, apply: (s, p) => { p.mods.meteorCd *= 0.7; } },
  { id: 'winter', name: 'Вічна зима', desc: 'Крижана нова: −30% перезарядки', rarity: 'rare', max: 2, apply: (s, p) => { p.mods.novaCd *= 0.7; } },
  { id: 'mason', name: 'Каменяр', desc: 'Твоя барикада вдвічі міцніша', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.wall *= 2; } },
  // --- co-op only, just for fun ---
  { id: "roulette", name: "Рулетка дружби", desc: "Рулетка: 250 золота отримає випадковий гравець — може, й ти", rarity: "common", max: 2, coop: true,
    apply: (s, p) => { const i = Math.floor(rand(s) * s.players.length); s.players[i].gold += 250; s.events.push({ type: "roulette", p: i, by: s.players.indexOf(p) }); } },
  { id: "thief", name: "Кишеньковий злодій", desc: "Щохвилі тягнеш у друга 4% його золота (до 20). Хехе.", rarity: "rare", max: 1, coop: true,
    apply: (s, p) => { p.mods.thief += 0.04; } },
  // --- classic only: castle, lives, barrels ---
  { id: 'walls', name: 'Мури', desc: "+8 життів замку", rarity: "common", max: 2, modes: ['classic'], apply: (s) => { s.lives += 8; } },
  { id: 'powder', name: 'Порохові бочки', desc: 'Бочки на карті: x2 шкоди', rarity: 'common', max: 1, modes: ['classic'], apply: (s, p) => { p.mods.barrel *= 2; } },
  { id: 'bank', name: 'Банкір', desc: 'На початку хвилі +4% від твого золота (до 25)', rarity: 'rare', max: 1, modes: ['classic'], apply: (s, p) => { p.mods.interest += 0.04; } },
  // --- circle only: the ring, laps and the alive limit ---
  { id: 'dam', name: 'Гребля', desc: "Ліміт живих ворогів +10", rarity: "common", max: 2, modes: ["circle"], apply: (s) => { s.limit += 10; } },
  { id: 'swamp', name: 'Болото', desc: 'Вороги швидшають за коло вдвічі повільніше', rarity: 'rare', max: 1, modes: ['circle'], apply: (s) => { s.lapSpeedMul *= 0.5; } },
  { id: 'reaper', name: 'Жнець', desc: "Твої вежі: +50% шкоди ворогам на 3-му колі й далі", rarity: "rare", max: 1, modes: ["circle"], apply: (s, p) => { p.mods.lapDmg += 0.5; } },
  { id: 'hunter', name: 'Мисливець', desc: "+5 золота за кожного ворога, що вже пройшов коло", rarity: "common", max: 2, modes: ["circle"], apply: (s, p) => { p.mods.hunter += 5; } },
];

// Boss intros by wave: name banner, a line on arrival and one when they drop below half HP.
export const BOSSES = {
  5: { name: 'Ґрок Гнилозуб', title: 'Пожирач Мостів', skill: { type: "dash", name: "Ривок", every: 6, dur: 1.2, mult: 3 }, lines: ['Ваші вежі — мої зубочистки!', 'Хрум-хрум... хто тут смачний?', 'Ґрок голодний!'], rage: ['Ґрок ЗЛИЙ!', 'Ай! Це було боляче!'] },
  10: { name: 'Мама Слизу', title: 'Королева Калюж', skill: { type: "brood", name: "Виводок", every: 4, count: 2 }, lines: ['Діточки, мама прийшла!', 'Хто образив моїх слизиків?!', 'Буль-буль... зараз я вас обійму.'], rage: ['Ви за це заплатите!', 'МОЇ ДІТОЧКИ!'] },
  15: { name: 'Барон Іржавий', title: 'Володар Брухту', skill: { type: "magnet", name: "Магніт", every: 9, dur: 3, range: 110 }, lines: ['Сталь не боїться ваших стріл!', 'Здавайтеся, і я буду милосердним. Жартую.', 'Мій обладунок древніший за ваш замок!'], rage: ['Подряпина? НА МОЇЙ БРОНІ?!', 'Досить ігор!'] },
  20: { name: 'Король Слизу', title: 'Останній Прилив', skill: { type: "decree", name: "Указ і Розкол", every: 7, range: 72, stun: 2, split: 3 }, lines: ['На коліна перед королем!', 'Це королівство тепер моє.', 'Я — кінець вашої історії.'], rage: ['НЕМОЖЛИВО!', 'Я лише почав розминатися!'] },
};
// Endless waves reuse the boss roster in rotation.
export function bossKey(w) {
  return BOSSES[w] ? w : [5, 10, 15, 20][Math.floor(w / 2) % 4];
}
export function bossFor(w) {
  return BOSSES[bossKey(w)];
}

// Weekly Brawl: a special ruleset that rotates every week (the same for everyone that week).
// map: which board it uses; towers: the only towers allowed (they are unlocked for everyone);
// the rest are modifiers read by the simulation.
export const BRAWLS = [
  { id: 'storm', icon: '⛈', name: 'Гроза', map: 'classic', weather: 'rain',
    desc: 'Злива: усі вороги завжди мокрі. Доступні лише Лучник, Тесла й Тотем.', towers: ['arrow', 'tesla', 'totem'], alwaysWet: true },
  { id: 'greed', icon: '💰', name: 'Золота лихоманка', map: 'classic',
    desc: '400 золота на старті, за вбивства — 0, зате монети сиплються з кожного третього ворога.', startGold: 400, killGold: 0, coinChance: 0.35, coinValue: 2 },
  { id: 'slime', icon: '🟢', name: 'Ніч слизу', map: 'circle',
    desc: 'Лише слизи й ділильники — їх у 1.5 рази більше, ділильники розпадаються на трьох.', pool: ['slime', 'splitter'], budget: 1.5, hp: 0.8, split: 3 },
  { id: 'bossrush', icon: '👑', name: 'Бос-раш', map: 'classic',
    desc: 'Бос кожні 2 хвилі (слабший), дрібноти вдвічі менше, за вбивства +50% золота.', bossEvery: 2, bossHp: 0.6, budget: 0.5, killGold: 1.5 },
  { id: 'rush', icon: '⚡', name: 'Швидкі й люті', map: 'classic',
    desc: 'Вороги на 60% швидші, але на третину крихкіші. Метеор заряджається вдвічі швидше.', speed: 1.6, hp: 0.65, meteorCd: 0.5 },
  { id: 'undying', icon: '💀', name: 'Невмирущі', map: 'circle',
    desc: 'Вороги відновлюють 3% здоровʼя щосекунди. Вежі: +35% шкоди, +20% радіусу.', regen: 0.03, towerDmg: 1.35, towerRange: 1.2 },
];
// Week number since a Monday epoch (UTC); the brawl of the week is BRAWLS[week % length].
export function brawlWeek(now) {
  return Math.floor((now - Date.UTC(2024, 0, 1)) / (7 * 24 * 3600 * 1000));
}
export const brawlOf = (week) => BRAWLS[((week % BRAWLS.length) + BRAWLS.length) % BRAWLS.length];

// ---------- Campaign «Останній прилив»: 10 missions played in order ----------
// rules: same engine as brawls (towers, alwaysWet, pool, split, killGold, coinChance, speed, regen, hp, budget)
// plus mission mechanics: farmHp (protect the farm), maxTowers, night (shorter tower sight), goblins (a thief every wave),
// limit (circle alive limit), bosses (wave -> BOSSES key). side = the second star's objective; early = early calls for the third star.
// story: intro lines (speaker: text) and an outro line.
export const CAMPAIGN = [
  { id: 1, title: 'Перші паростки', season: 'spring', map: 'classic', waves: 5, early: 1,
    rules: { towers: ['arrow'], hp: 0.8 }, side: { type: 'noLeak', text: 'не пропусти жодного ворога' },
    story: { intro: [['Дід Панас', 'Тарасе, з болота лізуть слизи! Став лучника біля дороги.'], ['Дід Панас', 'Бочки — вибухають, монети — збирай мишкою.']], outro: ['Дід Панас', 'Непогано для першого разу. Але це лише розвідка…'] } },
  { id: 2, title: 'Брід', season: 'spring', map: 'classic', waves: 8, early: 2,
    rules: { towers: ['arrow', 'frost'] }, farmHp: 40, side: { type: 'farm', pct: 0.5, text: 'збережи половину врожаю' },
    story: { intro: [['Дід Панас', 'Вони йдуть повз мою ферму! Не дай їм потоптати посіви.'], ['Дід Панас', 'Крига робить їх мокрими — запамʼятай, знадобиться.']], outro: ['Бровко', 'Гав! (Посіви цілі)'] } },
  { id: 3, title: 'Гоблінський базар', season: 'summer', map: 'classic', waves: 8, early: 2,
    rules: { towers: ['arrow', 'frost', 'cannon'] }, goblins: true, side: { type: 'coins', n: 10, text: 'збери 10 монет' },
    story: { intro: [['Дід Панас', 'Слизи найняли гоблінів-злодіїв. Ті тягнуть золото!'], ['Дід Панас', 'Гармата бʼє по площі — для натовпу саме те.']], outro: ['Гоблін', 'Нечесно! Ми ж лише позичали…'] } },
  { id: 4, title: 'Гроза над пагорбами', season: 'summer', map: 'classic', waves: 10, early: 3,
    rules: { towers: ['arrow', 'frost', 'cannon', 'tesla'], alwaysWet: true }, bosses: { 10: 5 }, weather: 'rain', side: { type: 'noLeak', text: 'замок без втрат' },
    story: { intro: [['Дід Панас', 'Злива! Мокрі слизи — найкраща мішень для Тесли.'], ['Ґрок', 'Хрум-хрум… ваші вежі — мої зубочистки!']], outro: ['Дід Панас', 'Ґрок — лише перший з генералів Короля.'] } },
  { id: 5, title: 'Кругообіг', season: 'summer', map: 'circle', waves: 8, early: 2,
    rules: { hp: 0.8 }, limit: 30, side: { type: 'peak', n: 18, text: 'не більше 18 живих ворогів' },
    story: { intro: [['Дід Панас', 'Ці не йдуть до замку — кружляють довкола, доки не впадуть.'], ['Дід Панас', 'Не дай їм розплодитися: забагато живих — і ми пропали.']], outro: ['Дід Панас', 'Добре кружляєш! А тепер… стемніло.'] } },
  { id: 6, title: 'Ніч слизу', season: 'autumn', map: 'classic', waves: 10, early: 2,
    rules: { pool: ['slime', 'splitter'], split: 3, budget: 1.3 }, night: true, side: { type: 'noLeak', text: 'замок без втрат' },
    story: { intro: [['Дід Панас', 'Вночі вежі бачать лише поруч. Став їх ближче до дороги.'], ['Мама Слизу', 'Діточки, ховайтесь у темряві…']], outro: ['Дід Панас', 'Світанок. Ти вистояв ніч, хлопче.'] } },
  { id: 7, title: 'Осінній ярмарок', season: 'autumn', map: 'classic', waves: 10, early: 3,
    rules: { killGold: 0, coinChance: 0.4, coinValue: 2 }, bosses: { 10: 10 }, side: { type: 'coins', n: 25, text: 'збери 25 монет' },
    story: { intro: [['Дід Панас', 'Ярмарок! Золото не дають за вбивства — лише монети, що падають.'], ['Мама Слизу', 'Хто образив моїх слизиків?!']], outro: ['Дід Панас', 'Мама Слизу відступила. Але на півночі брязкає залізо…'] } },
  { id: 8, title: 'Залізний легіон', season: 'autumn', map: 'classic', waves: 12, early: 3,
    rules: { pool: ['knight', 'healer'] }, maxTowers: 6, bosses: { 12: 15 }, side: { type: 'noLeak', text: 'замок без втрат' },
    story: { intro: [['Дід Панас', 'Лицарі в броні. Веж — лише шість: кожну прокачуй до кінця.'], ['Барон Іржавий', 'Сталь не боїться ваших стріл!']], outro: ['Барон Іржавий', 'Король… він не пробачить старому Панасу…'] } },
  { id: 9, title: 'Вічна зима', season: 'winter', map: 'circle', waves: 12, early: 3,
    rules: { regen: 0.02 }, limit: 45, side: { type: 'peak', n: 35, text: 'не більше 35 живих ворогів' },
    story: { intro: [['Тарас', 'Діду, про що казав Барон?'], ['Дід Панас', '…Колись я загатив болото, щоб полити поле. Їхнє болото висохло. Це моя вина.'], ['Дід Панас', 'Але долину треба вберегти. Вони не вмирають від холоду — бий швидко!']], outro: ['Тарас', 'Після битви — відкриємо загату. Обіцяю.'] } },
  { id: 10, title: 'Останній прилив', season: 'winter', map: 'classic', waves: 12, early: 3,
    rules: {}, farmHp: 60, bosses: { 4: 5, 7: 10, 10: 15, 12: 20 }, side: { type: 'farm', pct: 0.5, text: 'збережи половину врожаю' },
    story: { intro: [['Король Слизу', 'Ви висушили мій дім. Тепер я затоплю ваш!'], ['Дід Панас', 'Тарасе… тримай долину. А потім — відкриємо загату.']], outro: ['Король Слизу', '…Загата відкрита? Тоді… ми повернемось на болото. Миру вам, люди.'] } },
];
