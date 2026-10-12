// Lobby / main menu: mode tiles, campaign road, difficulty, talent tree, leaderboard, nick, co-op room buttons.
import { TOWERS, MODES, CONFIG, BOSSES, CAMPAIGN, brawlWeek, brawlOf, VERSION } from '../../sim/data.js';
import { PLAYER_COLORS } from '../../render.js';
import * as Meta from '../../meta.js';
import * as Api from '../../api.js';
import { renderTreeView } from '../../treeui.js';
import { app, bus, net, meta, sfx } from '../app.js';
import { $, esc, hide, show } from '../dom.js';
import { myEntry } from '../roster.js';
import { newRun, enterLobby, resumeGame, canResume } from '../session.js';
import { pixelIcon, MODE_ICONS } from './icons.js';
import { hidePop } from './popup.js';

// ---------- rendering ----------
const DIFF_NAMES = Object.fromEntries(Meta.DIFFS.map((d) => [d.id, d.name]));
const SEASON_ICON = { spring: '🌸', summer: '☀', autumn: '🍂', winter: '❄' };

function renderModes() {
  const wk = brawlWeek(Date.now()), br = brawlOf(wk);
  const msLeft = Date.UTC(2024, 0, 1) + (wk + 1) * 7 * 86400000 - Date.now();
  const left = msLeft > 86400000 ? `${Math.ceil(msLeft / 86400000)} дн.` : `${Math.ceil(msLeft / 3600000)} год.`;
  const stars = CAMPAIGN.reduce((a, x) => a + Meta.missionStars(meta, x.id), 0);
  const TILES = [
    { id: 'classic', name: 'Класика', sub: 'до замку' },
    { id: 'circle', name: 'Коло', sub: 'кружляють' },
    { id: 'brawl', name: 'Бійка', sub: br.name },
    { id: 'campaign', name: 'Кампанія', sub: `★ ${stars}/${CAMPAIGN.length * 3}` },
  ];
  const ml = $('modes');
  ml.innerHTML = '';
  for (const t of TILES) {
    const b = document.createElement('button');
    b.className = `mode-tile mode-${t.id}` + (app.mode === t.id ? ' active' : '');
    b.innerHTML = `<span class="mt-ico"></span><b>${t.name}</b><small>${esc(t.sub)}</small>`;
    b.querySelector('.mt-ico').append(pixelIcon(MODE_ICONS[t.id]));
    b.addEventListener('click', () => { app.mode = t.id; renderMenu(); });
    ml.append(b);
  }
  const info = $('modeInfo');
  info.className = `mode-info mode-${app.mode}`;
  if (app.mode === 'brawl') info.innerHTML = `<b>${br.icon} Тижнева бійка: ${esc(br.name)}</b><span>${esc(br.desc)}</span><small>${br.map === 'circle' ? 'Коло' : 'Класика'} · нова бійка через ${left}</small>`;
  else if (app.mode === 'campaign') info.innerHTML = '<b>📜 Кампанія «Останній прилив»</b><span>10 місій крізь рік. Обери відкриту місію нижче.</span>';
  else info.innerHTML = `<b>${MODES[app.mode].name}</b><span>${esc(MODES[app.mode].desc)}</span>`;
}

function renderCampaign() {
  const cw = $('campaign');
  cw.classList.toggle('hidden', app.mode !== 'campaign');
  if (app.mode !== 'campaign') return;
  if (!Meta.missionOpen(meta, app.selectedMission)) app.selectedMission = 1;
  cw.innerHTML = '<div class="camp-road">' + CAMPAIGN.map((x) => {
    const open = Meta.missionOpen(meta, x.id), st = Meta.missionStars(meta, x.id);
    return `<button class="camp-node${x.id === app.selectedMission ? ' active' : ''}${st ? ' done' : ''}" data-mission="${x.id}" ${open ? '' : 'disabled'} title="${esc(x.title)}">
      <b>${open ? x.id : '🔒'}</b><small>${SEASON_ICON[x.season]}</small><i>${'★'.repeat(st)}${'☆'.repeat(open ? 3 - st : 0)}</i></button>`;
  }).join('') + '</div>';
  const M = CAMPAIGN.find((x) => x.id === app.selectedMission);
  const rules = [`${M.waves} хвиль`, M.map === 'circle' ? 'Коло' : 'Класика'];
  if (M.rules.towers) rules.push('вежі: ' + M.rules.towers.map((k) => TOWERS[k].name).join(', '));
  if (M.farmHp) rules.push('бережи врожай');
  if (M.maxTowers) rules.push(`до ${M.maxTowers} веж`);
  if (M.night) rules.push('ніч');
  if (M.goblins) rules.push('гобліни');
  if (M.rules.alwaysWet) rules.push('злива');
  if (M.bosses) rules.push('генерали: ' + Object.values(M.bosses).map((k) => BOSSES[k].name).join(', '));
  const brief = document.createElement('details');
  brief.className = 'camp-brief';
  brief.open = true;
  brief.innerHTML = `<summary><b>Місія ${M.id}. ${esc(M.title)}</b> <span class="hint">${rules.join(' · ')}</span></summary>
    ${M.story.intro.map(([who, t]) => `<p><i>${esc(who)}:</i> «${esc(t)}»</p>`).join('')}
    <span class="hint">Перемога — вистояти всі хвилі. ★ ${esc(M.side.text)} · ★ ранній виклик хвиль ×${M.early}</span>`;
  cw.append(brief);
  for (const n of cw.querySelectorAll('[data-mission]')) n.addEventListener('click', () => { app.selectedMission = +n.dataset.mission; renderMenu(); });
}

function renderDifficulty() {
  const ds = $('diffSel');
  ds.innerHTML = '';
  for (const d of Meta.DIFFS) {
    const ok = Meta.unlockedDiff(meta, d);
    const k = Meta.bestKey(app.mode, d.id);
    const o = document.createElement('option');
    o.value = d.id;
    o.disabled = !ok;
    o.selected = app.diff === d.id;
    o.textContent = ok ? `${d.name} — рекорд ${meta.best[k] || 0}/${CONFIG.winWave}${meta.wins[k] ? ' 🏆' + meta.wins[k] : ''}` : `🔒 ${d.name} (переможи на попередній)`;
    ds.append(o);
  }
}

function renderTree() {
  renderTreeView($('shop'), meta, renderMenu);
}

export function renderMenu() {
  const L = Meta.level(meta);
  $('lvl').textContent = L;
  $('xpLine').textContent = L < Meta.MAX_LEVEL ? `${meta.xp - Meta.xpForLevel(L)} / ${Meta.levelCost(L)} до рівня ${L + 1}` : 'максимальний рівень';
  for (const t of document.querySelectorAll('.menu-tabs [data-tab]')) t.classList.toggle('active', t.dataset.tab === app.menuTab);
  for (const s of document.querySelectorAll('.menu-tab')) s.classList.toggle('hidden', s.dataset.tab !== app.menuTab);
  renderModes();
  renderCampaign();
  renderDifficulty();
  renderTree();
  for (const b of document.querySelectorAll('[data-board]')) b.classList.toggle('active', b.dataset.board === app.boardMode);
}

// ---------- leaderboard ----------
async function loadBoard() {
  const el = $('board');
  el.innerHTML = '<p class="hint">Завантаження…</p>';
  try {
    const rows = await Api.scores(app.boardMode, brawlWeek(Date.now()));
    if (!rows.length) { el.innerHTML = '<p class="hint">Ще ніхто не зіграв у цьому режимі. Стань першим!</p>'; return; }
    el.innerHTML = '<table><tr><th>#</th><th>Гравець</th><th>Хвиля</th><th>Склад.</th><th>Очки</th></tr>' + rows.map((r, i) => `
      <tr class="${r.nick === app.nick ? 'me' : ''}"><td>${i + 1}</td>
      <td>${r.won ? '🏆 ' : ''}${esc(r.nick)}${r.coop ? ` <small>+ ${esc(r.partner || 'друг')}</small>` : ''}</td>
      <td>${esc(r.wave)}</td><td>${DIFF_NAMES[r.diff] || ''}</td><td>${esc(r.score)}</td></tr>`).join('') + '</table>';
  } catch (e) {
    el.innerHTML = `<p class="hint">Таблиця лідерів недоступна (${esc(e.message)})</p>`;
  }
}
for (const b of document.querySelectorAll('[data-board]')) {
  b.addEventListener('click', () => { app.boardMode = b.dataset.board; renderMenu(); loadBoard(); });
}

// ---------- nick ----------
async function saveNick() {
  const v = $('nick').value.trim();
  if (v.length < 2) { $('nickMsg').textContent = 'Мінімум 2 символи'; return; }
  try {
    app.nick = await Api.setNick(v);
    $('nick').value = app.nick;
    $('nickMsg').textContent = '✓ збережено';
    net.send({ t: 'hello', nick: app.nick, v: VERSION, perks: Meta.perks(meta) });
  } catch (e) { $('nickMsg').textContent = e.message; }
}
$('nickSave').addEventListener('click', saveNick);
$('nick').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveNick(); });
Api.getNick().then((n) => { app.nick = n; $('nick').value = n; });

// ---------- room / start buttons ----------
function updatePlayButton() {
  $('resume').classList.toggle('hidden', !canResume());
  const b = $('playSolo');
  if (net.role === 'host' && net.connected) { b.textContent = `▶ Почати (${net.guestSlots().length + 1} гравці)`; b.disabled = false; }
  else if (net.role === 'guest' && net.connected) { b.textContent = 'Чекаємо, поки хост почне…'; b.disabled = true; }
  else { b.textContent = '▶ Грати соло'; b.disabled = false; }
  const host = net.role === 'host' && net.connected;
  $('coopStart').classList.toggle('hidden', !host);
  if (host) $('coopStart').textContent = b.textContent;
}
setInterval(updatePlayButton, 300);

$('resume').addEventListener('click', () => { sfx.unlock(); resumeGame(); });
$('playSolo').addEventListener('click', () => {
  sfx.unlock();
  if (net.role === 'host' && net.connected) { newRun(); return; } // keep the room, start with the chosen mode
  net.leave();
  $('netStatus').textContent = '';
  newRun();
});
$('coopStart').addEventListener('click', () => $('playSolo').click());

$('hostBtn').addEventListener('click', async () => {
  sfx.unlock();
  net.leave();
  $('lobbyStatus').textContent = 'Створюємо кімнату…';
  try {
    const code = await net.host();
    $('roomCode').textContent = code;
    show('roomBox');
    app.roster = [myEntry()];
    bus.emit('roster:changed');
  } catch (e) { $('lobbyStatus').textContent = e.message || 'Не вдалося створити кімнату'; }
});
$('joinBtn').addEventListener('click', async () => {
  sfx.unlock();
  const code = $('joinCode').value.trim();
  if (code.length < 4) { $('lobbyStatus').textContent = 'Введи код кімнати'; return; }
  net.leave();
  $('lobbyStatus').textContent = 'Підключаємось…';
  try { await net.join(code); $('lobbyStatus').textContent = 'Підключено! Чекаємо старт від хоста…'; } catch { /* status already shown */ }
});
$('copyCode').addEventListener('click', () => { navigator.clipboard?.writeText($('roomCode').textContent); $('copyCode').textContent = '✓'; });

for (const t of document.querySelectorAll('.menu-tabs [data-tab]')) {
  t.addEventListener('click', () => { app.menuTab = t.dataset.tab; sfx.unlock(); sfx.play('click'); renderMenu(); });
}
$('diffSel').addEventListener('change', (e) => { app.diff = e.target.value; renderMenu(); });
$('toMenu').addEventListener('click', () => enterLobby()); // the run is kept: 'Повернутися до гри' resumes it

// ---------- bus ----------
bus.on('menu:show', () => {
  document.body.classList.add('in-menu');
  hide('modal');
  hidePop();
  renderMenu();
  loadBoard();
  show('menu');
});

bus.on('run:start', () => { hide('menu'); });
bus.on('run:resume', () => { hide('menu'); });

bus.on('net:status', (text, kind = '') => {
  $('netStatus').textContent = text;
  $('netStatus').className = kind;
  $('lobbyStatus').textContent = text;
});

bus.on('roster:changed', () => {
  const el = $('roster');
  if (!el) return;
  el.classList.toggle('hidden', !net.online);
  el.innerHTML = app.roster.map((r) => `<span style="color:${PLAYER_COLORS[r.idx ?? r.slot] || '#fff'}">■ ${esc(r.nick || 'Гравець')}${r.slot === 0 ? ' (хост)' : ''}</span>`).join('');
});
