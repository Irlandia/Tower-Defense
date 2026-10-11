// All balance lives here. Simulation reads it, renderer never changes it.
// Distances/speeds are in world pixels (1 tile = 24 px).
export const TILE = 24;
export const COLS = 26;
export const ROWS = 14;
export const TICK_RATE = 20;
// Bump on every change to sim/data: co-op peers refuse to play with a different version.
export const VERSION = 13;

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
  circle: { name: "Коло", desc: "Вороги крутяться по колу й накопичуються. Забагато живих — поразка.", maxAlive: 40, lapSpeed: 0.06, lapHeal: 0.1, lapMax: 8, endlessBossEvery: 2, endlessHpGrowth: 1.12 },
};

export const MAPGEN = { lanes3Chance: 0.45, ponds: [1, 2], barrels: 4 };
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
  boss: { name: 'Бос', hp: 420, speed: 18, armor: 3, gold: 60, cost: 0, lives: 10, vs: { tesla: 1.2, frost: 0.7 } },
  king: { name: 'Король слизу', hp: 1400, speed: 14, armor: 5, gold: 0, cost: 0, lives: 20, heal: 20, healRange: 60, vs: { cannon: 1.2, fire: 0.7 } },
};
// Wave from which an enemy type can appear.
export const UNLOCKS = { slime: 1, runner: 2, splitter: 3, knight: 4, healer: 6 };

// Roguelite draft cards offered after each cleared wave.
export const CARDS = [
  { id: 'sharp', name: 'Гострі стріли', desc: '+25% шкоди лучників', apply: (s, p) => { p.mods.dmg.arrow *= 1.25; } },
  { id: 'crit', name: 'Око сокола', desc: '+10% шансу крита лучників', apply: (s, p) => { p.mods.crit += 0.1; } },
  { id: 'boom', name: 'Порох', desc: '+30% шкоди гармат', apply: (s, p) => { p.mods.dmg.cannon *= 1.3; } },
  { id: 'storm', name: 'Буря', desc: 'Тесла: +1 стрибок блискавки', apply: (s, p) => { p.mods.chain += 1; } },
  { id: 'napalm', name: 'Напалм', desc: 'Горіння +50% шкоди', apply: (s, p) => { p.mods.burn *= 1.5; } },
  { id: 'glacier', name: 'Льодовик', desc: 'Крига: +50% шкоди, довше мокрі', apply: (s, p) => { p.mods.dmg.frost *= 1.5; p.mods.wet += 2; } },
  { id: 'steam', name: 'Парова машина', desc: 'Вибух пари +60% шкоди', apply: (s, p) => { p.mods.steam *= 1.6; } },
  { id: 'haste', name: 'Адреналін', desc: '+12% швидкості атаки всіх веж', apply: (s, p) => { p.mods.rate *= 1.12; } },
  { id: 'optics', name: 'Оптика', desc: '+10% радіусу всіх веж', apply: (s, p) => { p.mods.range *= 1.1; } },
  { id: 'bounty', name: 'Нагорода', desc: '+20% золота за вбивства', apply: (s, p) => { p.mods.gold *= 1.2; } },
  { id: 'bank', name: 'Банкір', desc: '+5% від золота на початку хвилі', apply: (s, p) => { p.mods.interest += 0.05; } },
  { id: 'cash', name: 'Скарб', desc: '+120 золота одразу', apply: (s, p) => { p.gold += 120; } },
  { id: 'walls', name: 'Мури', desc: '+5 життів', apply: (s) => { s.lives += 5; } },
  { id: 'meteor', name: 'Зорепад', desc: 'Метеор заряджається на 30% швидше', apply: (s, p) => { p.mods.meteorCd *= 0.7; } },
  { id: "veteran", name: "Ветерани", desc: "+10% шкоди всіх веж", apply: (s, p) => { for (const k in p.mods.dmg) p.mods.dmg[k] *= 1.1; } },
  { id: 'mason', name: 'Каменяр', desc: 'Барикада вдвічі міцніша', apply: (s, p) => { p.mods.wall *= 2; } },
];

// Boss intros by wave: name banner, a line on arrival and one when they drop below half HP.
export const BOSSES = {
  5: { name: 'Ґрок Гнилозуб', title: 'Пожирач Мостів', lines: ['Ваші вежі — мої зубочистки!', 'Хрум-хрум... хто тут смачний?', 'Ґрок голодний!'], rage: ['Ґрок ЗЛИЙ!', 'Ай! Це було боляче!'] },
  10: { name: 'Мама Слизу', title: 'Королева Калюж', lines: ['Діточки, мама прийшла!', 'Хто образив моїх слизиків?!', 'Буль-буль... зараз я вас обійму.'], rage: ['Ви за це заплатите!', 'МОЇ ДІТОЧКИ!'] },
  15: { name: 'Барон Іржавий', title: 'Володар Брухту', lines: ['Сталь не боїться ваших стріл!', 'Здавайтеся, і я буду милосердним. Жартую.', 'Мій обладунок древніший за ваш замок!'], rage: ['Подряпина? НА МОЇЙ БРОНІ?!', 'Досить ігор!'] },
  20: { name: 'Король Слизу', title: 'Останній Прилив', lines: ['На коліна перед королем!', 'Це королівство тепер моє.', 'Я — кінець вашої історії.'], rage: ['НЕМОЖЛИВО!', 'Я лише почав розминатися!'] },
};
// Endless waves reuse the boss roster in rotation.
export function bossFor(w) {
  return BOSSES[w] || BOSSES[[5, 10, 15, 20][Math.floor(w / 2) % 4]];
}
