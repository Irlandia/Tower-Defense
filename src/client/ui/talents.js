// Talent draft window (per player; in co-op it never pauses the game, solo pauses).
import { CARDS, RARITY } from '../../sim/data.js';
import { app, net, sfx, P } from '../app.js';
import { $, hide } from '../dom.js';
import { send } from '../session.js';

let talentKey = '';

export function openTalent() {
  if (!P().drafts.length) return;
  app.talentOpen = true;
  talentKey = '';
  if (!net.online) app.draftPause = true;
  renderTalent();
}

export function closeTalent() {
  if (!app.talentOpen) return;
  app.talentOpen = false;
  app.draftPause = false;
  hide('modal');
}

export function renderTalent() {
  const draft = P().drafts[0];
  if (!draft) { closeTalent(); return; }
  const k = draft.join() + P().drafts.length;
  if (k === talentKey) return;
  talentKey = k;
  const m = $('modal');
  m.innerHTML = `<h2>Обери талант</h2><p>${net.online ? 'Твій особистий вибір — гра не зупиняється' : 'Гра на паузі'} · Esc — пізніше</p><div class="cards"></div>`;
  draft.forEach((id, i) => {
    const c = CARDS.find((x) => x.id === id);
    const el = document.createElement('button');
    el.className = 'card ' + c.rarity;
    const taken = P().picked[c.id] || 0;
    const count = c.max > 1 && c.max < 99 ? ` · ${taken}/${c.max}` : '';
    el.innerHTML = `<span class="key">${i + 1}</span><span class="rar">${RARITY[c.rarity].name}${count}</span><b>${c.name}</b><span>${c.desc}</span>`;
    el.addEventListener('click', () => pickCard(i));
    m.querySelector('.cards').append(el);
  });
  m.classList.remove('hidden');
}

export function pickCard(i) {
  if (!P().drafts.length) return;
  send({ type: 'pick', index: i });
  sfx.play('card');
  talentKey = '';
  // the pick lands next tick; close now if this was the last pending choice
  if (P().drafts.length <= 1) closeTalent();
}
