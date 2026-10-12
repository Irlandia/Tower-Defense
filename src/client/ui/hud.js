// Heads-up display around the canvas: build bar, ability buttons, wave/gold counters, info panel.
// Every dynamic block is rebuilt only when its cache key changes.
import { TOWERS, TOWER_ORDER, ABILITIES, CONFIG, MODES, ENEMIES, TICK_RATE } from '../../sim/data.js';
import { placeCost, isLocked, abilityMax, hasWall } from '../../sim/sim.js';
import { PLAYER_COLORS } from '../../render.js';
import { app, ui, sfx, music, me, P, bus } from '../app.js';
import { $, esc } from '../dom.js';
import { nickOf } from '../roster.js';
import { towerIcon, pixelIcon, AB_ICONS } from './icons.js';
import { selectBuild, useAbility, nextWave, toggleSpeed, togglePause } from './actions.js';
import { openTalent, renderTalent } from './talents.js';
import { updatePop } from './popup.js';
import { sideProgress } from './story.js';

let infoKey = '';
export function resetInfo() { infoKey = ''; }

export function buildToolbar() {
  const bar = $('towers');
  bar.innerHTML = '';
  const s = app.state;
  TOWER_ORDER.forEach((kind, i) => {
    const def = TOWERS[kind];
    const locked = isLocked(s, me(), kind);
    const b = document.createElement('button');
    b.className = 'tower-btn' + (locked ? ' locked' : '');
    b.dataset.kind = kind;
    b.title = locked ? 'Відкривається в магазині за кристали' : `${def.name} [${i + 1}] — ${def.desc}`;
    b.append(towerIcon(kind));
    const label = document.createElement('span');
    label.className = 'label';
    label.innerHTML = `<b>${def.name}</b><span class="cost">${locked ? '🔒' : '● ' + placeCost(s, me(), kind)}</span>`;
    b.append(label);
    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = i + 1;
    b.append(key);
    b.addEventListener('click', () => selectBuild(kind));
    bar.append(b);
  });
}

// ability buttons (static) with pixel icons instead of emoji
for (const id of Object.keys(ABILITIES)) {
  const a = ABILITIES[id];
  const b = document.createElement('button');
  b.className = 'ability';
  b.id = 'ab-' + id;
  b.title = a.desc;
  b.dataset.ab = id;
  b.innerHTML = `<span class="ab-icon"></span><span class="ab-name">${a.name}</span><span class="key">${a.key}</span><span class="cd"></span>`;
  if (AB_ICONS[id]) b.querySelector('.ab-icon').append(pixelIcon(AB_ICONS[id]));
  b.addEventListener('click', () => useAbility(id));
  $('abilities').append(b);
}

$('next').addEventListener('click', nextWave);
$('talent').addEventListener('click', openTalent);
$('speed').addEventListener('click', toggleSpeed);
$('pause').addEventListener('click', togglePause);
$('mute').addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  $('mute').textContent = sfx.muted ? '🔇' : '🔊';
  if (sfx.muted) music.stop(); else if (app.running) music.play(app.state.season);
});
$('music').textContent = music.on ? '♪' : '♪̸';
$('music').addEventListener('click', () => {
  sfx.unlock();
  music.setOn(!music.on);
  $('music').textContent = music.on ? '♪' : '♪̸';
  if (music.on && app.running) music.play(app.state.season);
});

/** The info panel text for the current context: building, hovered enemy, moving, ability, or the default tip. */
function infoContent(s) {
  if (ui.build) {
    const def = TOWERS[ui.build];
    return { key: 'b' + ui.build, html: `<b>${def.name}</b><br>${def.desc}<br><span class="hint">Shift — ставити кілька · ПКМ — скасувати</span>` };
  }
  const en = ui.hoverEnemy && s.enemies.find((e) => e.id === ui.hoverEnemy);
  if (en) {
    const def = ENEMIES[en.type];
    const vs = Object.entries(def.vs || {});
    const fam = (k) => TOWERS[k].name;
    const weak = vs.filter(([, v]) => v > 1).map(([k, v]) => `${fam(k)} x${v}`).join(', ');
    const res = vs.filter(([, v]) => v < 1).map(([k, v]) => `${fam(k)} x${v}`).join(', ');
    return {
      key: `e${en.id}:${Math.ceil(en.hp / 10)}`,
      html: `<b>${def.name}</b> · ❤ ${Math.max(0, Math.round(en.hp))}/${en.maxHp}${en.armor ? ` · 🛡 ${en.armor}` : ''}<br>`
        + (weak ? `<span style="color:#a7f070">Слабкий до: ${weak}</span><br>` : '')
        + (res ? `<span style="color:#94b0c2">Опір: ${res}</span>` : '')
        + (!weak && !res ? '<span class="hint">Без особливих слабкостей</span>' : ''),
    };
  }
  if (ui.moving) {
    return { key: 'mv', html: `<b>Переміщення вежі</b><br>Клікни по підсвіченій клітинці (до ${CONFIG.moveRange} клітинок). Після переїзду вежа 1 с розгортається, перезарядка ${CONFIG.moveCd} с.<br><span class="hint">ПКМ / Esc — скасувати</span>` };
  }
  if (ui.ability) {
    const a = ABILITIES[ui.ability];
    return { key: 'a' + ui.ability, html: `<b>${a.name}</b><br>${a.desc}<br><span class="hint">ПКМ — скасувати</span>` };
  }
  let key = 'h' + s.mode + (s.brawl ? s.brawl.id : '');
  let html = s.mode === 'circle'
    ? `<b>Коло</b><br>Вороги не доходять до замку — вони крутяться по колу і з кожним колом швидшають. Живих більше <b>${s.limit}</b> — поразка.`
    : '<b>Порада</b><br>Крига робить ворогів <span class="wet">мокрими</span>: Тесла бʼє їх x2, а Вогонь викликає вибух пари.';
  if (s.mission) {
    const M = s.mission, mine = s.towers.filter((t) => t.owner === me()).length;
    const sp = sideProgress(s), ep = s.stats.early, en2 = M.early || 0;
    html = `<b>Місія ${M.id}: ${esc(M.title)}</b><br>Головне: вистояти ${s.winWave} хвиль`
      + `<br><span class="${sp.ok ? 'done' : ''}">★ ${sp.text} ${sp.ok ? '✓' : ''}</span>`
      + `<br><span class="${ep >= en2 ? 'done' : ''}">★ Ранні виклики хвиль: ${Math.min(ep, en2)} / ${en2} ${ep >= en2 ? '✓' : ''}</span>`
      + (M.maxTowers ? `<br>Веж: ${mine} / ${M.maxTowers}` : '')
      + (s.farmMax ? `<br>🌾 Врожай: ${Math.ceil(s.farmHp)} / ${s.farmMax}<br><span class="hint">Вороги, що проходять повз поле, топчуть посіви. Врожай знищено — поразка.</span>` : '')
      + (M.night ? '<br>Ніч: вежі бачать на 30% ближче' : '');
    key += ':' + mine + ':' + Math.ceil(s.farmHp) + ':' + sp.text + sp.ok + ep;
  } else if (s.brawl) html = `<b>${s.brawl.icon} Бійка: ${s.brawl.name}</b><br>${s.brawl.desc}`;
  if (!s.mission) {
    html += s.mode === 'circle'
      ? '<br><span class="hint">🌳 дерева — скарби · монети — наводь мишку. Удвох: кожен тримає свій вхід (печери зліва і справа).</span>'
      : '<br><span class="hint">🛢 бочки — вибух · 🌳 дерева — скарби · монети — наводь мишку · стрілки показують, звідки піде хвиля.</span>';
  }
  return { key, html };
}

/** Per-frame refresh of every HUD element (cheap: DOM is touched only when a value changed). */
export function updateUI() {
  const s = app.state;
  const pl = P();
  for (const b of document.querySelectorAll('.tower-btn')) {
    b.classList.toggle('active', ui.build === b.dataset.kind);
    b.classList.toggle('poor', pl.gold < placeCost(s, me(), b.dataset.kind));
  }
  for (const id of Object.keys(ABILITIES)) {
    const b = $('ab-' + id);
    b.classList.toggle('active', ui.ability === id);
    b.classList.toggle('cooling', pl.cds[id] > 0 || (id === 'wall' && hasWall(s, me())));
    b.style.setProperty('--cd', (pl.cds[id] / abilityMax(s, id, me())).toFixed(3));
  }
  const early = s.wave > 0 && !s.queue.length ? Math.ceil(s.countdown / TICK_RATE) * CONFIG.earlyBonus : 0;
  const last = s.wave >= s.winWave;
  $('next').textContent = last ? 'Фінал!' : s.queue.length ? 'Хвиля йде…' : early ? `Хвиля ▶ +${early}●` : 'Почати ▶';
  $('next').disabled = s.queue.length > 0 || last;
  const n = pl.drafts.length;
  $('talent').classList.toggle('off', !n); // keep its slot so the panel never jumps
  $('talent').textContent = `✦ Талант${n > 1 ? ' x' + n : ''} [T]`;
  $('waveInfo').textContent = `${s.mission ? '📜 Місія ' + s.mission.id : s.brawl ? s.brawl.icon + ' ' + s.brawl.name : MODES[s.mode].name} · Хвиля ${s.wave} / ${s.winWave}`;
  $('waveBar').style.width = (100 * s.wave) / s.winWave + '%';
  const coop = s.players.length > 1;
  $('coopInfo').classList.toggle('hidden', !coop);
  if (coop) {
    $('coopInfo').innerHTML = s.players.map((q, i) => `<span style="color:${PLAYER_COLORS[i]}">■ ${esc(i === me() ? app.nick || 'Ти' : nickOf(i))}: ${q.gold}●</span>`).join(' ');
  }
  const { key, html } = infoContent(s);
  if (key !== infoKey) { infoKey = key; $('info').innerHTML = html; }
  updatePop();
  if (app.talentOpen) renderTalent();
}

bus.on('frame', () => { if (app.running) updateUI(); });
