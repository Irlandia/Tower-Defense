// Talent tree screen: level bar, build tabs, four branch columns (4 tiers each), ability loadout (Q/W/E/R).
// Plain DOM over src/meta.js: every click changes meta (which saves) and calls onChange() to redraw.
import * as Meta from './meta.js';
import { ABILITIES } from './sim/data.js';

const KEYS = ['Q', 'W', 'E', 'R'];
const TIER_TITLE = ['Ярус 1', 'Ярус 2', 'Ярус 3', '★ Кейстоун'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let pickSlot = -1; // the slot whose ability is being chosen (-1 = none)

export function renderTreeView(el, m, onChange) {
  const L = Meta.level(m), open = Meta.buildsOpen(L), act = Meta.activeIdx(m);
  if (pickSlot >= 0 && pickSlot >= Meta.perks(m).abilities.length) pickSlot = -1;
  el.replaceChildren(head(m, L, open, act, onChange), builds(m, open, act, onChange), columns(m, onChange), loadout(m, onChange));
}

function head(m, L, open, act, onChange) {
  const div = document.createElement('div');
  div.className = 'tv-head';
  const next = Meta.xpForLevel(L + 1), cur = Meta.xpForLevel(L);
  const pct = L < Meta.MAX_LEVEL ? Math.round((100 * (m.xp - cur)) / (next - cur)) : 100;
  div.innerHTML = `<div class="tv-lvl">Рівень <b>${L}</b> / ${Meta.MAX_LEVEL} · вільних очок <b class="tv-pts">${Meta.points(m)}</b></div>
    <div class="tv-bar"><i style="width:${pct}%"></i></div>
    <small class="hint">${L < Meta.MAX_LEVEL ? `${m.xp - cur} / ${next - cur} досвіду до рівня ${L + 1}` : 'Максимальний рівень'} · Тесла — з рівня ${Meta.UNLOCK_LEVEL.tesla}, Вогонь — з рівня ${Meta.UNLOCK_LEVEL.fire}</small>`;
  return div;
}

function builds(m, open, act, onChange) {
  const bar = document.createElement('div');
  bar.className = 'tv-builds';
  Meta.BUILD_LEVEL.forEach((need, i) => {
    const b = document.createElement('button');
    const ok = i < open;
    b.className = 'tv-build' + (i === act ? ' active' : '') + (ok ? '' : ' locked');
    b.textContent = ok ? `Білд ${i + 1}` : `🔒 Білд ${i + 1} · рів. ${need}`;
    b.disabled = !ok;
    b.addEventListener('click', () => { Meta.setActive(m, i); pickSlot = -1; onChange(); });
    bar.append(b);
  });
  const reset = document.createElement('button');
  reset.className = 'tv-reset';
  reset.title = 'Безкоштовно: усі вкладені очки цього білда повертаються';
  reset.textContent = '↺ Скинути білд';
  reset.addEventListener('click', () => { Meta.resetBuild(m); onChange(); });
  bar.append(reset);
  return bar;
}

function columns(m, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'tv-cols';
  for (const br of Meta.BRANCHES) {
    const col = document.createElement('div');
    col.className = 'tv-col';
    const spent = Meta.TREE.filter((n) => n.branch === br.id).reduce((a, n) => a + Meta.rankOf(m, n.id), 0);
    col.innerHTML = `<div class="tv-col-head"><span>${br.icon}</span><b>${esc(br.name)}</b><small>${spent} очок</small></div>`;
    // trunk: the branch grows upward from the root (tier 1) to the keystone (tier 4); a line joins each tier
    for (let t = 4; t >= 1; t--) {
      const need = Meta.TIER_NEED[t - 1], below = Meta.spentBelow(m, br.id, t), isOpen = below >= need;
      const row = document.createElement('div');
      row.className = 'tv-tier' + (isOpen ? '' : ' closed') + (t === 4 ? ' top' : '');
      row.dataset.tier = t;
      row.innerHTML = `<div class="tv-tier-label">${TIER_TITLE[t - 1]}${isOpen ? '' : ` · ще ${need - below} очок у нижчих`}</div>`;
      const nodes = document.createElement('div');
      nodes.className = 'tv-tier-nodes';
      for (const n of Meta.TREE.filter((k) => k.branch === br.id && k.tier === t)) nodes.append(node(m, n, onChange));
      row.append(nodes);
      col.append(row);
    }
    const root = document.createElement('div');
    root.className = 'tv-root';
    root.textContent = 'корінь';
    col.append(root);
    wrap.append(col);
  }
  return wrap;
}

function node(m, n, onChange) {
  const r = Meta.rankOf(m, n.id);
  const b = document.createElement('button');
  b.className = 'tv-node' + (n.key ? ' key' : '') + (n.ability ? ' ability' : '') + (r ? ' owned' : '') + (r >= n.max ? ' max' : '')
    + (!r && !Meta.canBuy(m, n.id) ? ' blocked' : '');
  b.dataset.id = n.id;
  const tag = n.key ? '<em>кейстоун</em>' : n.ability ? '<em>здібність</em>' : '';
  b.innerHTML = `<span class="tv-node-top"><b>${esc(n.name)}</b><i>${r}/${n.max}</i></span>${tag}<span>${esc(n.desc)}</span>`;
  b.title = 'ЛКМ — вкласти очко · ПКМ — зняти ранг';
  b.addEventListener('click', () => { if (Meta.buy(m, n.id)) onChange(); });
  b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (Meta.refund(m, n.id)) onChange(); });
  return b;
}

function loadout(m, onChange) {
  const div = document.createElement('div');
  div.className = 'tv-slots';
  const shown = Meta.perks(m).abilities; // what the next game really gets (closed slots are hidden)
  const build = Meta.activeBuild(m);
  div.innerHTML = `<div class="tv-slots-title">Здібності: слот Q, W, E, R (зліва направо)</div>`;
  const row = document.createElement('div');
  row.className = 'tv-slot-row';
  for (let i = 0; i < 4; i++) {
    const id = shown[i];
    const closed = i >= shown.length;
    const b = document.createElement('button');
    b.className = 'tv-slot' + (closed ? ' closed' : '') + (pickSlot === i ? ' picking' : '');
    b.disabled = closed;
    b.innerHTML = `<i>${KEYS[i]}</i><b>${closed ? '🔒' : id ? esc(ABILITIES[id].name) : '—'}</b>`;
    b.addEventListener('click', () => { pickSlot = pickSlot === i ? -1 : i; onChange(); });
    row.append(b);
  }
  div.append(row);
  if (pickSlot >= 0) {
    const pick = document.createElement('div');
    pick.className = 'tv-pick';
    const empty = document.createElement('button');
    empty.textContent = 'Порожньо';
    empty.addEventListener('click', () => { Meta.setSlot(m, pickSlot, null); pickSlot = -1; onChange(); });
    pick.append(empty);
    for (const id of Meta.abilityPool(m)) {
      const b = document.createElement('button');
      b.className = 'tv-pick-item' + (build.slots[pickSlot] === id ? ' current' : '');
      b.innerHTML = `<b>${esc(ABILITIES[id].name)}</b><span>${esc(ABILITIES[id].desc)}</span>`;
      b.addEventListener('click', () => { Meta.setSlot(m, pickSlot, id); pickSlot = -1; onChange(); });
      pick.append(b);
    }
    div.append(pick);
  }
  const note = document.createElement('small');
  note.className = 'hint';
  note.textContent = 'Зміни білда діють з наступної гри. Слот, закритий кейстоуном, зберігає здібність — вона повернеться, коли кейстоун буде знято.';
  div.append(note);
  return div;
}
