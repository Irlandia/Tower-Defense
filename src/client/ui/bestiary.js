// Bestiary tab: every boss of BOSSES as a card — a silhouette until met, a portrait once seen,
// a medal frame (bronze / silver / gold) for the hardest difficulty it was beaten on. Data: meta.bestiary.
import { BOSSES } from '../../sim/data.js';
import { bossPortrait } from '../../sprites.js';
import * as Meta from '../../meta.js';
import { app, meta } from '../app.js';
import { esc } from '../dom.js';

const MEDALS = ['bronze', 'silver', 'gold'];
// the classic bosses first (by wave), then the random pool in data order; the King closes the book
const ORDER = [...['5', '10', '15'], ...Object.keys(BOSSES).filter((k) => !/^\d+$/.test(k)), '20'];
const where = (k) => (k === '20' ? 'фінал 20-ї хвилі' : /^\d+$/.test(k) ? `класичний бос ${k}-ї хвилі, генерал кампанії` : BOSSES[k].modes ? 'лише в режимі Коло' : 'трапляється на хвилях з босом');

export function bestiaryCounts(m = meta) {
  let seen = 0, killed = 0;
  for (const k of ORDER) { const b = Meta.bossEntry(m, k); if (b.seen) seen++; if (b.kills) killed++; }
  return { seen, killed, total: ORDER.length };
}

export function renderBestiary(el) {
  const { seen, killed, total } = bestiaryCounts();
  el.innerHTML = `<p class="bst-head">Зустрінуто <b>${seen}/${total}</b> · Переможено <b>${killed}/${total}</b>
    <span class="hint">Рамка — найважча складність перемоги: бронза, срібло, золото</span></p><div class="bst-grid"></div><div class="bst-info"></div>`;
  const grid = el.querySelector('.bst-grid');
  if (!ORDER.includes(app.bestiaryPick)) app.bestiaryPick = ORDER.find((k) => Meta.bossEntry(meta, k).seen) || null;
  for (const k of ORDER) {
    const def = BOSSES[k], b = Meta.bossEntry(meta, k);
    const card = document.createElement('button');
    card.className = 'bst-card' + (b.seen ? '' : ' unknown') + (b.best >= 0 ? ' ' + MEDALS[b.best] : '') + (k === app.bestiaryPick ? ' active' : '');
    card.dataset.boss = k;
    card.append(bossPortrait(k, def, 5, b.seen ? null : '#333c57'));
    const name = document.createElement('small');
    name.textContent = b.seen ? def.name : '???';
    card.append(name);
    card.disabled = !b.seen;
    card.addEventListener('click', () => { app.bestiaryPick = k; renderBestiary(el); });
    grid.append(card);
  }
  const info = el.querySelector('.bst-info');
  const k = app.bestiaryPick;
  if (!k) { info.innerHTML = `<p class="hint">Тут з'являтимуться боси, яких ти зустрінеш. Їх ${ORDER.length} — на хвилях з босом випадає будь-хто з них.</p>`; return; }
  const def = BOSSES[k], b = Meta.bossEntry(meta, k);
  const medal = b.best >= 0 ? `переможено на складності «${Meta.DIFFS[b.best].name}»` : 'ще не переможено';
  info.innerHTML = `<b>${esc(def.name)}</b> <span class="hint">— ${esc(def.title || 'бос')}</span>
    <p>Уміння: <b>${esc(def.skill.name)}</b> · ${esc(where(k))}</p>
    ${def.about ? `<p class="bst-about">${esc(def.about)}</p>` : ''}
    <p>Зустрічей: <b>${b.seen}</b> · Перемог: <b>${b.kills}</b> · ${medal}</p>
    ${b.kills ? `<p class="bst-quote">«${esc(def.lines[0])}»</p>` : ''}`;
}
