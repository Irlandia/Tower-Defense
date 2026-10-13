// All balance lives here. Simulation reads it, renderer never changes it.
// Distances/speeds are in world pixels (1 tile = 24 px).
import { rand } from './rng.js';
export const TILE = 24;
export const COLS = 26;
export const ROWS = 14;
export const TICK_RATE = 20;
// Bump on every change to sim/data: co-op peers refuse to play with a different version.
export const VERSION = 51;

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

// Player abilities. A player's loadout (talent tree, src/meta.js) puts them in slots Q / W / E / R.
// Base: meteor, nova, wall. From the tree: goldrain, overdrive, quake.
export const ABILITIES = {
  meteor: { name: 'Метеор', cd: 30, radius: 54, desc: 'Клік по карті: вибух + підпал.' },
  nova: { name: 'Крижана нова', cd: 45, freeze: 2, wet: 5, desc: 'Заморожує ВСІХ ворогів на 2 с і робить їх мокрими.' },
  wall: { name: 'Барикада', cd: 35, hp: 80, hpPerWave: 15, desc: 'Клік по дорозі: стіна, яку вороги мусять зламати. Одна на гравця.' },
  goldrain: { name: 'Золотий дощ', cd: 40, radius: 60, coins: 5, value: 8, desc: 'Клік по карті: на полі падає 5 монет — збери мишкою.' },
  overdrive: { name: 'Овердрайв', cd: 60, dur: 6, bonus: 0.4, desc: 'Твої вежі стріляють на 40% швидше.' },
  dragon: { name: 'Дракон', cd: 60, speed: 320, width: 20, dmg: 30, dmgPerWave: 6, burn: 12, burnTime: 3,
    desc: 'Клік по дорозі: дракон пролітає всією цією лінією від замку до печери й випалює ворогів.' },
  quake: { name: 'Землетрус', cd: 40, radius: 70, dmg: 25, dmgPerWave: 4, slow: 2, slowF: 0.5, desc: 'Клік по карті: удар по площі (ігнорує броню) і сповільнення.' },
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
  mortar: { from: 'cannon', name: 'Мортира', cost: 170, range: 156, rate: 0.5, dmg: 70, proj: 'ball', speed: 180, splash: 45,
    desc: 'Бʼє через пів карти, величезний вибух.' },
  cluster: { from: 'cannon', name: 'Касетна', cost: 150, range: 84, rate: 0.9, dmg: 34, proj: 'ball', speed: 240, splash: 30, bomblets: 4,
    desc: 'Вибух розкидає 4 міні-бомби.' },
  blizzard: { from: 'frost', name: 'Хуртовина', cost: 150, range: 66, rate: 0.8, dmg: 4, pulse: true, slow: 0.45, slowTime: 1.2, wetTime: 5,
    desc: 'Хвилі холоду: всі навколо сповільнені й мокрі.' },
  glacier: { from: 'frost', name: 'Брила', cost: 150, range: 84, rate: 0.5, dmg: 20, proj: 'ice', speed: 330, slow: 0, slowTime: 1.2, wetTime: 5, freeze: true,
    desc: 'Заморожує ціль на місці.' },
  storm: { from: 'tesla', name: 'Грозовий шпиль', cost: 190, range: 84, rate: 1, dmg: 16, chain: 6, chainRange: 72,
    desc: 'Блискавка стрибає по 7 цілях.' },
  overload: { from: "tesla", name: "Перевантаження", cost: 150, range: 72, rate: 1.2, dmg: 14, chain: 0, chainRange: 0, overcharge: 0.4, overMax: 3,
    desc: "Одна ціль: кожен удар поспіль по ній +40% (до x3). Вбивця босів." },
  inferno: { from: 'fire', name: 'Пекло', cost: 170, range: 60, rate: 4, dmg: 5, pulse: true, burn: 10, burnTime: 2,
    desc: 'Безперервне полумʼя по всіх навколо.' },
  magma: { from: 'fire', name: 'Магма', cost: 160, range: 78, rate: 0.8, dmg: 8, proj: 'fire', speed: 225, burn: 8, burnTime: 3,
    puddle: { r: 21, dps: 12, time: 4 }, desc: 'Залишає на дорозі калюжі лави.' },
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

// Talents: after every boss kill each player picks one card from a personal draft (never pauses co-op).
// Three rarities: common (solid stat), rare (changes how a tower plays), epic (builds a run around it, max 1).
// Weight of a rarity = weight + perWave * wave: later boss drafts lean to rare and epic.
// A boss draft always holds at least one rare card, from wave 15 (and in endless) one epic. Every boss also
// gives one reroll (stored up to DRAFT.maxRerolls).
// max = how many times one player can take it; modes = where it can appear (default: everywhere);
// needs = tower that must be unlocked for the card to make sense; coop = only offered with two or more players.
export const RARITY = {
  common: { weight: 6, perWave: -0.15, name: 'Звичайний' },
  rare: { weight: 3, perWave: 0.05, name: 'Рідкісний' },
  epic: { weight: 0.6, perWave: 0.07, name: 'Епічний' },
};
export const DRAFT = { epicFrom: 15, maxRerolls: 2 };
export const CARDS = [
  // --- common: simple, always useful ---
  { id: 'sharp', name: 'Гострі стріли', desc: 'Лучники: +30% шкоди', rarity: 'common', max: 3, apply: (s, p) => { p.mods.dmg.arrow *= 1.3; } },
  { id: 'boom', name: 'Порох', desc: 'Гармати: +30% шкоди', rarity: 'common', max: 3, apply: (s, p) => { p.mods.dmg.cannon *= 1.3; } },
  { id: 'glacier', name: 'Льодовик', desc: 'Крига: +30% швидкості атаки, вороги мокрі на 2 с довше', rarity: 'common', max: 2,
    apply: (s, p) => { p.mods.towerRate.frost = (p.mods.towerRate.frost || 1) * 1.3; p.mods.wet += 2; } },
  { id: 'coils', name: 'Мідні котушки', desc: 'Тесла: +30% шкоди', rarity: 'common', max: 3, needs: 'tesla', apply: (s, p) => { p.mods.dmg.tesla *= 1.3; } },
  { id: 'napalm', name: 'Напалм', desc: 'Вогонь: горіння +50%', rarity: 'common', max: 3, needs: 'fire', apply: (s, p) => { p.mods.burn *= 1.5; } },
  { id: 'haste', name: 'Адреналін', desc: 'Усі вежі: +12% швидкості атаки', rarity: 'common', max: 3, apply: (s, p) => { p.mods.rate *= 1.12; } },
  { id: 'optics', name: 'Оптика', desc: 'Усі вежі: +12% радіусу', rarity: 'common', max: 2, apply: (s, p) => { p.mods.range *= 1.12; } },
  { id: 'bounty', name: 'Нагорода', desc: '+25% золота за вбивства', rarity: 'common', max: 2, apply: (s, p) => { p.mods.gold *= 1.25; } },
  { id: 'cash', name: 'Скарб', desc: 'Одразу +80 золота і ще +12 за кожну пройдену хвилю', rarity: 'common', max: 99, apply: (s, p) => { p.gold += 80 + 12 * s.wave; } },
  { id: 'cheap', name: 'Цехова знижка', desc: 'Нові вежі на 12% дешевші', rarity: 'common', max: 2, apply: (s, p) => { p.mods.discount.all = (p.mods.discount.all || 0) + 0.12; } },
  { id: 'mason', name: 'Каменяр', desc: 'Барикада: утричі міцніша і −30% перезарядки', rarity: 'common', max: 1, apply: (s, p) => { p.mods.wall *= 3; p.mods.wallCd *= 0.7; } },
  { id: 'repair', name: 'Ремонт барикади', desc: 'Твоя барикада лагодиться: +5% міцності щосекунди, а на початку хвилі — повністю', rarity: 'common', max: 2,
    apply: (s, p) => { p.mods.wallRegen += 0.05; } },
  // --- rare: change how a tower plays ---
  { id: 'crit', name: 'Око сокола', desc: 'Лучники: +12% шансу крита, крит ×2.5', rarity: 'rare', max: 2, apply: (s, p) => { p.mods.crit += 0.12; p.mods.critMul = Math.max(p.mods.critMul, 2.5); } },
  { id: 'volley', name: 'Залп', desc: 'Лучники стріляють ще в одну ціль', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.multi.arrow = (p.mods.multi.arrow || 0) + 1; } },
  { id: 'bigboom', name: 'Велика бомба', desc: 'Гармати: вибух на 35% ширший, +15% шкоди', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.splash *= 1.35; p.mods.dmg.cannon *= 1.15; } },
  { id: 'storm', name: 'Буря', desc: 'Тесла: +2 стрибки блискавки', rarity: 'rare', max: 1, needs: 'tesla', apply: (s, p) => { p.mods.chain += 2; } },
  { id: 'steam', name: 'Парова машина', desc: 'Вибух пари (вогонь по мокрих) ×2 і ширший', rarity: 'rare', max: 1, modes: ['classic'], needs: 'fire', apply: (s, p) => { p.mods.steam *= 2; p.mods.steamR *= 1.3; } },
  { id: 'veteran', name: 'Ветерани', desc: 'Усі вежі: +15% шкоди', rarity: 'rare', max: 2, apply: (s, p) => { for (const k in p.mods.dmg) p.mods.dmg[k] *= 1.15; } },
  { id: 'shaman', name: 'Шаман', desc: 'Аури твоїх тотемів сильніші на 60%', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.aura *= 1.6; } },
  { id: 'meteor', name: 'Зорепад', desc: 'Метеор: −30% перезарядки і +50% шкоди', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.meteorCd *= 0.7; p.mods.meteorDmg *= 1.5; } },
  { id: 'winter', name: 'Вічна зима', desc: 'Крижана нова: −30% перезарядки і +1 с заморозки', rarity: 'rare', max: 1, apply: (s, p) => { p.mods.novaCd *= 0.7; p.mods.novaFreeze += 1; } },
  { id: 'wage', name: 'Платня', desc: '+25 золота на початку кожної хвилі', rarity: 'rare', max: 2, apply: (s, p) => { p.mods.wage += 25; } },
  { id: 'trade', name: 'Торговець', desc: 'Продаж і переміщення: вежі повертають 90% ціни, переміщення вдвічі частіше', rarity: 'rare', max: 1,
    apply: (s, p) => { p.mods.sell += 0.2; p.mods.moveCd *= 0.5; } },
  // --- epic: build the run around it ---
  { id: 'frenzy', name: 'Лють', desc: 'Усі вежі: +25% шкоди і +15% швидкості атаки', rarity: 'epic', max: 1,
    apply: (s, p) => { for (const k in p.mods.dmg) p.mods.dmg[k] *= 1.25; p.mods.rate *= 1.15; } },
  { id: 'midas', name: 'Мідас', desc: '+50% золота за вбивства і +40 на початку кожної хвилі', rarity: 'epic', max: 1, apply: (s, p) => { p.mods.gold *= 1.5; p.mods.wage += 40; } },
  { id: 'deadeye', name: 'Соколиний зір', desc: 'Лучники: +20% крита, крит ×3, +25% радіусу', rarity: 'epic', max: 1,
    apply: (s, p) => { p.mods.crit += 0.2; p.mods.critMul = Math.max(p.mods.critMul, 3); p.mods.towerRange.arrow = (p.mods.towerRange.arrow || 1) * 1.25; } },
  { id: 'tempest', name: 'Вічна гроза', desc: 'Тесла: +1 стрибок, по мокрих ще +3, шкода +30%', rarity: 'epic', max: 1, needs: 'tesla',
    apply: (s, p) => { p.mods.chain += 1; p.mods.wetChain += 3; p.mods.dmg.tesla *= 1.3; } },
  { id: 'zero', name: 'Абсолютний нуль', desc: 'Крига: шкода ×2, мокрість +4 с; нова заморожує на 2 с довше', rarity: 'epic', max: 1,
    apply: (s, p) => { p.mods.dmg.frost *= 2; p.mods.wet += 4; p.mods.novaFreeze += 2; } },
  { id: 'hellfire', name: 'Пекельне полумʼя', desc: 'Вогонь: горіння ×2, пара ×2', rarity: 'epic', max: 1, needs: 'fire', apply: (s, p) => { p.mods.burn *= 2; p.mods.steam *= 2; } },
  { id: 'artillery', name: 'Артилерія', desc: 'Гармати: +40% шкоди, вибух +25% ширший, +20% радіусу', rarity: 'epic', max: 1,
    apply: (s, p) => { p.mods.dmg.cannon *= 1.4; p.mods.splash *= 1.25; p.mods.towerRange.cannon = (p.mods.towerRange.cannon || 1) * 1.2; } },
  { id: 'archmage', name: 'Архімаг', desc: 'Усі здібності перезаряджаються на 40% швидше', rarity: 'epic', max: 1, apply: (s, p) => { p.mods.cdAll *= 0.6; } },
  { id: 'wisdom', name: 'Мудрість', desc: 'Далі в кожному виборі талантів — 4 картки і +1 перекидання', rarity: 'epic', max: 1,
    apply: (s, p) => { p.mods.cards += 1; p.rerolls = Math.min(DRAFT.maxRerolls + 1, (p.rerolls || 0) + 1); } },
  // --- co-op only, just for fun ---
  { id: 'roulette', name: 'Рулетка дружби', desc: 'Рулетка: 250 золота отримає випадковий гравець — може, й ти', rarity: 'common', max: 2, coop: true,
    apply: (s, p) => { const i = Math.floor(rand(s) * s.players.length); s.players[i].gold += 250; s.events.push({ type: 'roulette', p: i, by: s.players.indexOf(p) }); } },
  { id: 'thief', name: 'Кишеньковий злодій', desc: 'Щохвилі тягнеш у друга 8% його золота (до 40). Хехе.', rarity: 'rare', max: 1, coop: true,
    apply: (s, p) => { p.mods.thief += 0.08; } },
  // --- classic only: castle and lives ---
  { id: 'walls', name: 'Мури', desc: '+6 життів замку', rarity: 'common', max: 2, modes: ['classic'], apply: (s) => { s.lives += 6; } },
  // --- circle only: the ring, laps and the alive limit ---
  { id: 'dam', name: 'Гребля', desc: 'Ліміт живих ворогів +8', rarity: 'common', max: 2, modes: ['circle'], apply: (s) => { s.limit += 8; } },
  { id: 'hunter', name: 'Мисливець', desc: '+5 золота за кожного ворога, що вже пройшов коло', rarity: 'common', max: 2, modes: ['circle'], apply: (s, p) => { p.mods.hunter += 5; } },
  { id: 'swamp', name: 'Болото', desc: 'Вороги швидшають за коло вдвічі повільніше', rarity: 'rare', max: 1, modes: ['circle'], apply: (s) => { s.lapSpeedMul *= 0.5; } },
  { id: 'reaper', name: 'Жнець', desc: 'Твої вежі: +50% шкоди ворогам на 3-му колі й далі', rarity: 'rare', max: 1, modes: ['circle'], apply: (s, p) => { p.mods.lapDmg += 0.5; } },
];

// Boss intros by wave: name banner, a line on arrival and one when they drop below half HP.
export const BOSSES = {
  5: { about: 'Щокілька секунд кидається вперед утричі швидше. Жує мости, вежі вважає зубочистками, а гальма — вигадкою для слабаків.', name: 'Ґрок Гнилозуб', title: 'Пожирач Мостів', skill: { type: "dash", name: "Ривок", every: 6, dur: 1.2, mult: 3 }, lines: ['Ваші вежі — мої зубочистки!', 'Хрум-хрум... хто тут смачний?', 'Ґрок голодний!'], rage: ['Ґрок ЗЛИЙ!', 'Ай! Це було боляче!'] },
  10: { about: 'Народжує слизиків просто на ходу. Любить кожного й кожного назвала Слизиком.', name: 'Мама Слизу', title: 'Королева Калюж', skill: { type: "brood", name: "Виводок", every: 4, count: 2 }, lines: ['Діточки, мама прийшла!', 'Хто образив моїх слизиків?!', 'Буль-буль... зараз я вас обійму.'], rage: ['Ви за це заплатите!', 'МОЇ ДІТОЧКИ!'] },
  15: { about: 'Магнітом тягне на себе вогонь усіх веж. Дуже пишається обладунком, хоч той і трохи іржавий.', name: 'Барон Іржавий', title: 'Володар Брухту', skill: { type: "magnet", name: "Магніт", every: 9, dur: 3, range: 110 }, lines: ['Сталь не боїться ваших стріл!', 'Здавайтеся, і я буду милосердним. Жартую.', 'Мій обладунок древніший за ваш замок!'], rage: ['Подряпина? НА МОЇЙ БРОНІ?!', 'Досить ігор!'] },
  20: { about: 'Указом глушить вежі довкола, а поранений розколюється на слизиків. Фінал 20-ї хвилі — і він про це знає.', name: 'Король Слизу', title: 'Останній Прилив', skill: { type: "decree", name: "Указ і Розкол", every: 7, range: 72, stun: 2, split: 3 }, lines: ['На коліна перед королем!', 'Це королівство тепер моє.', 'Я — кінець вашої історії.'], rage: ['НЕМОЖЛИВО!', 'Я лише почав розминатися!'] },
};
// 15 more bosses: each regular boss wave draws a random one (seeded, no repeats until the pool runs out).
// map: 8x8 sprite (Sweetie 16 hex: 0 ink, 1 plum, 2 red, 3 orange, 4 yellow, 5 lime, 6 green, 7 teal, 8 navy,
// 9 blue, a sky, b cyan, c white, d silver, e slate, f dark). hp / speed: multipliers on the base boss.
// Skill types (sim.js bossSkill): summon, blink, rally, shield, haste, burrow, steal, heal, cleanse, shuffle, snipe,
// plus the classic dash, brood, magnet, decree.
Object.assign(BOSSES, {
  kvak: { about: 'Стрибає далеко вперед по дорозі. Ставок вважає королівством, а комарів — податком.', name: 'Квак Великий', title: 'Цар Ставка', color: '#38b764', skill: { type: 'blink', name: 'Стрибок', every: 5, dist: 55 },
    map: ['.4.44.4.', '.444444.', '06c66c60', '06066060', '06666660', '06222260', '.066660.', '06.00.60'],
    lines: ['Ква! На коліна, головастики!', 'Мій ставок — моє королівство!'], rage: ['КВА-А-А!', 'Ви намочили мою корону!'] },
  shroom: { about: 'Розпилює спори, що лікують усіх ворогів поруч. Апчхи — і пів хвилі знову свіженька.', name: 'Пані Поганка', title: 'Королева Спор', color: '#b13e53', skill: { type: 'rally', name: 'Цілющі спори', every: 6, range: 70, pct: 0.15 },
    map: ['..0000..', '.02c220.', '02222c20', '02c22220', '00000000', '.0cccc0.', '.0c0c00.', '..0000..'],
    lines: ['Мої спори всюди…', 'Вдихніть глибше, любі!'], rage: ['Ви потоптали мою грибницю!', 'Апчхи!'] },
  rat: { about: 'Швидкий і худий, щокілька секунд кличе зграю бігунів. Сиром не ділиться ні з ким.', name: 'Пискун', title: 'Щурячий Вождь', color: '#566c86', speed: 1.3, hp: 0.85, skill: { type: 'summon', name: 'Зграя', every: 5, what: 'runner', count: 3 },
    map: ['0......0', '0e0..0e0', '.0eeee0.', '0eceece0', '0eeeeee0', '.0e33e0.', '..0ee0..', '.0.00.0e'],
    lines: ['Пі-пі! Хлопці, за мною!', 'Ваш сир — наш сир!'], rage: ['Розбігайтеся!', 'ПІ-І-І!'] },
  golem: { about: 'Повільний і товстошкірий, час від часу кам’яніє ще більше. Думає довго, але й падає довго.', name: 'Брилл', title: 'Камінний Голем', color: '#94b0c2', speed: 0.8, hp: 1.3, skill: { type: 'shield', name: "Кам'яна шкіра", every: 8, dur: 3, armor: 10 },
    map: ['.000000.', '0dddddd0', '0dcddcd0', '0dddddd0', '0eddddde', '0deeeed0', '0dd00dd0', '0e0..0e0'],
    lines: ['Брилл… прийшов.', 'Камінь не відчуває болю.'], rage: ['Тріщина?..', 'БРИЛЛ ЗЛИЙ.'] },
  witch: { about: 'Поїть усіх довкола зіллям швидкості. Рецепт секретний, на смак — ожина з кропивою.', name: 'Відьма Ожина', title: 'Болотяна Знахарка', color: '#5d275d', skill: { type: 'haste', name: 'Зілля швидкості', every: 7, dur: 3, range: 80, mult: 1.6 },
    map: ['...00...', '..0110..', '.011110.', '00000000', '.05c5c0.', '.055550.', '.011110.', '0111111.'],
    lines: ['Хі-хі, ковток зілля — і вперед!', 'Котел уже кипить…'], rage: ['Моє зілля!', 'Прокляття на ваші вежі!'] },
  mole: { about: 'Пірнає під землю, і вежі його не бачать. Виринає завжди не там, де ти чекаєш.', name: 'Копач', title: 'Підземний Кріт', color: '#8a6248', skill: { type: 'burrow', name: 'Підкоп', every: 8, dur: 2.5 },
    map: ['........', '..0000..', '.033330.', '03c33c30', '0333c330', '03333330', '0c0330c0', '.0.00.0.'],
    lines: ['Під землею вас не чути…', 'Рий-рий-рий!'], rage: ['Світло! Очі!', 'Закопаю!'] },
  zlotko: { about: 'Регулярно витягає золото з кишень усіх гравців. Називає це «податком на вежі».', name: 'Злотко', title: 'Гоблін-Скарбник', color: '#ffcd75', skill: { type: 'steal', name: 'Кишеньки', every: 7, gold: 12 },
    map: ['..0..0..', '.050050.', '.055550.', '.5c55c5.', '0455554.', '04444440', '0444c440', '.044440.'],
    lines: ['Дзинь-дзинь! Це вже моє.', 'Податок на вежі!'], rage: ['Мої монетки!', 'Грабіж!'] },
  yeti: { about: 'Ревом заморожує вежі поруч. Товстий і неквапливий, бо зима — для відпочинку.', name: 'Бурул', title: 'Єті з Перевалу', color: '#f4f4f4', speed: 0.9, hp: 1.15, skill: { type: 'decree', name: 'Крижаний рик', every: 8, range: 60, stun: 1.5 },
    map: ['.0cccc0.', '0cccccc0', '0c0cc0c0', '0cccccc0', '0c2222c0', '0cccccc0', '.0cccc0.', '0c0..0c0'],
    lines: ['Гр-р-р… холодно?', 'Бурул любить сніг!'], rage: ['РРРОАР!', 'Бурул розтопився!'] },
  morok: { about: 'Кличе лицарську варту. Шолома не знімає навіть за обідом.', name: 'Морок', title: 'Чорний Лицар', color: '#29366f', hp: 1.2, skill: { type: 'summon', name: 'Варта', every: 7, what: 'knight', count: 2 },
    map: ['..0000..', '.088880.', '.080080.', '.0b88b0.', '08888880', '08e88e80', '.0e00e0.', '..0..0..'],
    lines: ['Варто, до зброї!', 'Темрява не відступає.'], rage: ['Мій шолом!', 'Ви пожалкуєте.'] },
  count: { about: 'Час від часу відпиває собі здоров’я. Вогню не боїться, а от сонячних днів уникає.', name: 'Граф Кровопивець', title: 'Нічний Гість', color: '#5d275d', skill: { type: 'heal', name: 'Ковток', every: 5, pct: 0.08 },
    map: ['..0000..', '.011110.', '01c11c10', '01111110', '01c00c10', '.011110.', '0222222.', '02.00.20'],
    lines: ['Добрий вечір… смачного мені.', 'Ваш замок — чудовий склеп.'], rage: ['Сонце?! Ні!', 'Мій плащ!'] },
  wisp: { about: 'Стає безтілесним: ні крига, ні вогонь, ні мокрість до нього не липнуть. Лякає навіть інших привидів.', name: 'Шепіт', title: 'Болотний Привид', color: '#73eff7', speed: 1.15, skill: { type: 'cleanse', name: 'Безтілесність', every: 6, dur: 3 },
    map: ['..0000..', '.0bbbb0.', '0bcbbcb0', '0b0bb0b0', '0bbbbbb0', '0bbbbbb0', '0b.bb.b0', '.0..0..0'],
    lines: ['Уууу… крига мене не тримає…', 'Ви мене бачите?'], rage: ['Я розвіюсь!', 'Уууу-у!'] },
  hive: { about: 'Випускає рій дрібних слизиків. Сама не працює — за неї гуде весь вулик.', name: 'Матка', title: 'Королева Вулика', color: '#ffcd75', skill: { type: 'summon', name: 'Рій', every: 4, what: 'mini', count: 4 },
    map: ['.c0..0c.', '.cc00cc.', '.044440.', '04c44c40', '00000000', '04444440', '.000000.', '..0..0..'],
    lines: ['Бззз! Діти, жальте!', 'Мед — тільки для своїх.'], rage: ['Вулик у небезпеці!', 'БЗЗЗЗ!'] },
  jester: { about: 'Міняється місцями з ворогом, що найдалі попереду. Вважає це дотепним. Ніхто не сміється.', name: 'Хіхо', title: 'Блазень Короля', color: '#ef7d57', speed: 1.1, skill: { type: 'shuffle', name: 'Фокус-покус', every: 6 },
    map: ['03....90', '.03..90.', '..0330..', '.0c33c0.', '0333333.', '03c22c30', '.033330.', '.0.00.0.'],
    lines: ['Хі-хі! Вгадай, де я?', 'Фокус-покус, вежі — в ступор!'], rage: ['Не смішно!', 'Хо-хо… ой.'] },
  zharik: { about: 'Плює вогнем у найдорожчу вежу й глушить її. Маленький, зате вже з характером.', name: 'Жарик', title: 'Дракончик', color: '#ef7d57', skill: { type: 'snipe', name: 'Вогнеплюй', every: 6, range: 110, stun: 3 },
    map: ['.0....0.', '.30..03.', '.033330.', '03c33c30', '03333330', '0332233.', '00333300', '.0.00.0.'],
    lines: ['Пф-ф! Зараз підсмажу!', 'Я ще маленький, але гарячий!'], rage: ['Кхе-кхе, дим!', 'Мама-дракон дізнається!'] },
  kistyak: { about: 'Піднімає мертвих слизиків, що діляться. Кістки скриплять, але він робить вигляд, що так і задумано.', name: 'Кістяк', title: 'Некромант', color: '#94b0c2', skill: { type: 'summon', name: 'Підняти мертвих', every: 6, what: 'splitter', count: 2 },
    map: ['..0000..', '.0cccc0.', '0c0cc0c0', '0cccccc0', '.0c00c0.', '.011110.', '01111110', '01.00.10'],
    lines: ['Вставайте, мої слизики…', 'Смерть — лише початок.'], rage: ['Мої кістки!', 'Я ще повернусь!'] },
  // passive / special skills: dark (night while alive), trail (slime road speeds up others), reverse (circle: the ring turns back),
  // disguise (looks like a slime in a pack until the first hit). modes = only drawn in these map modes.
  mara: { about: 'Поки вона жива, на мапі ніч: вежі бачать на 30% ближче. Вогняні вежі світять собі й сусідам — запаліть ліхтарики!',
    name: 'Нічна Мара', title: 'Пані Безсоння', color: '#3b5dc9', skill: { type: 'dark', name: 'Вічна ніч', every: 9, sight: 0.7 },
    map: ['..0000..', '.088880.', '08488480', '08888880', '.081180.', '08888880', '0888888.', '08.80.80'],
    lines: ['Тс-с-с… спіть, вежі…', 'Ніч — моя, і ця ніч — довга.'], rage: ['Світло?! Загасіть!', 'Я ще прийду у ваші сни!'] },
  ravlyk: { about: 'Повзе повільно, зате лишає слизьку доріжку: вороги на ній мчать у 1.5 раза швидше. Сам не поспішає — за нього біжать інші.',
    name: 'Пан Равлик', title: 'Слизький Вельможа', color: '#a7f070', hp: 2.2, speed: 0.45, skill: { type: 'trail', name: 'Слизька доріжка', every: 8, len: 130, mult: 1.5 },
    map: ['.....0.0', '.000.5.5', '03440.55', '04340c55', '03440555', '.0000555', '55555555', '.000000.'],
    lines: ['Не поспішаймо, панове…', 'Хто швидко бігає — той швидко падає.'], rage: ['Моя мушля!', 'Ой, слизько…'] },
  vyhor: { about: 'Лише в Колі: щокілька секунд розвертає всіх ворогів на кільці у зворотний бік. Від нього паморочиться навіть у веж.',
    modes: ['circle'], name: 'Вихор', title: 'Пан Круговерть', color: '#73eff7', speed: 1.2, skill: { type: 'reverse', name: 'Круговерть', every: 8 },
    map: ['0bbbbbb0', '0b2bb2b0', '.0bbcb0.', '.0bcbb0.', '..0bb0..', '..0cb0..', '...0b0..', '...00...'],
    lines: ['Вжу-у-ух! Кругом, марш!', 'Ліво, право — яка різниця?'], rage: ['Голова паморочиться!', 'Стоп-стоп-стоп!'] },
  pere: { about: 'Ховається серед звичайних слизів і виглядає як слиз — шукай легкий блиск. Від першого удару скидає личину й стає велетнем.',
    name: 'Перевертень', title: 'Майстер Личин', color: '#38b764', skill: { type: 'disguise', name: 'Личина', every: 999, pack: 4, speed: 1.15 },
    map: ['0......0', '060..060', '.066660.', '06266260', '06666660', '06c6c6c0', '.066660.', '0.0..0.0'],
    lines: ['Сюрприз!', 'Я тут весь час був, хе-хе.'], rage: ['Личина тріщить!', 'Ну все, без масок!'] },
});
// Regular boss waves draw from these (the King stays the final boss of wave 20; campaign generals stay fixed).
export const BOSS_POOL = Object.keys(BOSSES).filter((k) => k !== '20');

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
// limit (circle alive limit), npc (decorative character on the map, critters.js: "valeria"), bosses (wave -> BOSSES key). side = the second star's objective; early = early calls for the third star.
// story: intro lines (speaker: text) and an outro line.
export const CAMPAIGN = [
  { id: 1, title: 'Перші паростки', season: 'spring', map: 'classic', waves: 5, early: 1,
    rules: { towers: ['arrow'], hp: 0.8 }, side: { type: 'noLeak', text: 'не пропусти жодного ворога' },
    story: { intro: [['Дід Панас', '{hero}, з болота лізуть слизи! Став лучника біля дороги.'], ['Дід Панас', 'Бочки — вибухають, монети — збирай мишкою.']], outro: ['Дід Панас', 'Непогано для першого разу. Але це лише розвідка…'] } },
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
    rules: { killGold: 0, coinChance: 0.4, coinValue: 2 }, bosses: { 10: 10 }, npc: 'valeria', side: { type: 'coins', n: 25, text: 'збери 25 монет' },
    story: { intro: [['Дід Панас', 'Ярмарок! Золото не дають за вбивства — лише монети, що падають.'], ['Валерія Кудряшівна', 'Ярмарок не скасовується! Я тут з пиріжками й новинами — ви бийте слизів, а я покричу!'], ['Мама Слизу', 'Хто образив моїх слизиків?!']], outro: ['Валерія Кудряшівна', 'Ура! Пиріжки за мій рахунок! Ну… за половину.'] } },
  { id: 8, title: 'Залізний легіон', season: 'autumn', map: 'classic', waves: 12, early: 3,
    rules: { pool: ['knight', 'healer'] }, maxTowers: 6, bosses: { 12: 15 }, side: { type: 'noLeak', text: 'замок без втрат' },
    story: { intro: [['Дід Панас', 'Лицарі в броні. Веж — лише шість: кожну прокачуй до кінця.'], ['Барон Іржавий', 'Сталь не боїться ваших стріл!']], outro: ['Барон Іржавий', 'Король… він не пробачить старому Панасу…'] } },
  { id: 9, title: 'Вічна зима', season: 'winter', map: 'circle', waves: 12, early: 3,
    rules: { regen: 0.02 }, limit: 45, side: { type: 'peak', n: 35, text: 'не більше 35 живих ворогів' },
    story: { intro: [['{hero}', 'Діду, про що казав Барон?'], ['Дід Панас', '…Колись я загатив болото, щоб полити поле. Їхнє болото висохло. Це моя вина.'], ['Дід Панас', 'Але долину треба вберегти. Вони не вмирають від холоду — бий швидко!']], outro: ['{hero}', 'Після битви — відкриємо загату. Обіцяю.'] } },
  { id: 10, title: 'Останній прилив', season: 'winter', map: 'classic', waves: 12, early: 3,
    rules: {}, farmHp: 60, bosses: { 4: 5, 7: 10, 10: 15, 12: 20 }, side: { type: 'farm', pct: 0.5, text: 'збережи половину врожаю' },
    story: { intro: [['Король Слизу', 'Ви висушили мій дім. Тепер я затоплю ваш!'], ['Дід Панас', '{hero}… тримай долину. А потім — відкриємо загату.']], outro: ['Король Слизу', '…Загата відкрита? Тоді… ми повернемось на болото. Миру вам, люди.'] } },
];

// Time of day: every run starts at a phase picked from its seed and moves on every `every` waves.
// range / gold: multipliers while that phase lasts (campaign night missions keep their own harsher night).
export const DAY = {
  every: 5,
  phases: [
    { id: 'day', name: 'День', icon: '☀' },
    { id: 'evening', name: 'Вечір', icon: '🌇' },
    { id: 'night', name: 'Ніч', icon: '🌙', range: 0.9, gold: 1.25 },
    { id: 'dawn', name: 'Світанок', icon: '🌅' },
  ],
};
