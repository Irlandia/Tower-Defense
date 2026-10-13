// On-map popup for the selected tower / obstacle: stats, upgrade, evolve, aura, move, sell, clear.
// The HTML is rebuilt only when `key` changes, so it does not flicker or eat clicks.
import { TICK_RATE, TOWERS, BRANCHES, CONFIG, AURA, MASTERY } from '../../sim/data.js';
import { family, towerStats, upgradeCost, canEvolve, sellValue, sellRatioOf, clearCost, auraCost, canMaster, masterCost, towerDef } from '../../sim/sim.js';
import { W, MX, MY, PLAYER_COLORS } from '../../render.js';
import { TILE } from '../../sim/data.js';
import { app, ui, canvas, me, P } from '../app.js';
import { $, esc } from '../dom.js';
import { nickOf } from '../roster.js';
import { send } from '../session.js';
import { towerIcon } from './icons.js';
import { selTower, selObstacle, upgradeSel, sellSel, startMove } from './actions.js';

let popKey = '';
export function resetPopup() { popKey = ''; }

$('pop').addEventListener('mousedown', (ev) => ev.stopPropagation());
$('pop').addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const t = selTower();
  if (a.dataset.act === 'upgrade') upgradeSel();
  if (a.dataset.act === 'sell') sellSel();
  if (a.dataset.act === 'move') startMove();
  if (a.dataset.act === 'aura' && t) send({ type: 'aura', id: t.id, aura: a.dataset.aura });
  if (a.dataset.act === 'evolve' && t) send({ type: 'evolve', id: t.id, kind: a.dataset.kind });
  if (a.dataset.act === 'master' && t) send({ type: 'master', id: t.id });
  if (a.dataset.act === 'clear') { const o = selObstacle(); if (o) send({ type: 'clear', id: o.id }); ui.selected = null; }
});

function placePop(tx, ty) {
  const pop = $('pop');
  const scale = canvas.clientWidth / W;
  const cx = (MX + tx * TILE + 12) * scale;
  const H = canvas.clientHeight;
  // never taller than the field; scrolls if it really cannot fit
  pop.style.maxHeight = H - 8 + 'px';
  const h = pop.offsetHeight;
  const topAbove = (MY + ty * TILE - 12) * scale - h - 6; // above the tower
  const topBelow = (MY + (ty + 1) * TILE) * scale + 6; // below the tower
  // prefer above; otherwise below; otherwise pinned so the whole menu (incl. evolution) stays visible
  const top = topAbove >= 4 ? topAbove : topBelow + h <= H - 4 ? topBelow : Math.max(4, H - h - 4);
  pop.style.left = Math.max(0, Math.min(canvas.clientWidth - pop.offsetWidth, cx - pop.offsetWidth / 2)) + 'px';
  pop.style.top = top + 'px';
}

// one action row: label (+ small detail line) on the left, a price chip on the right
const act = (attr, cls, label, sub, price, off) =>
  `<button ${attr} class="pa ${cls}" ${off ? 'disabled' : ''}><span class="pa-txt">${label}${sub ? `<small>${sub}</small>` : ''}</span>${price ? `<i class="pa-cost">${price}</i>` : ''}</button>`;

function towerHtml(t, gold) {
  const s = app.state;
  const def = towerDef(t);
  const st = towerStats(s, t);
  const mine = t.owner === me();
  const ms = MASTERY[t.kind];
  const up = upgradeCost(t);
  const evo = canEvolve(t);
  let key = `t${t.id}:${t.kind}:${t.level}:${t.master ? 1 : 0}:${Math.floor(gold / 5)}:${Math.round(st.dmg)}:${st.buff}:${Math.ceil((t.moveCd || 0) / TICK_RATE)}:${sellValue(t, sellRatioOf(s, t.owner))}`;
  // header: tower icon on a family-coloured tile, name, level badge
  let html = `<div class="pop-title" style="--fam: var(--fam-${family(t.kind)})"><span class="pop-ico" data-icon="${t.kind}"></span>
      <b>${def.name}</b><span class="lvl-badge">${t.master ? "♛ майстерність" : def.from ? "★ еволюція" : def.support ? "тотем" : "рів. " + t.level}</span></div>
    ${def.support
      ? `<div class="pop-stats"><span>◎ ${def.range}</span><span class="buff">⚔ +${Math.round((t.aura.dmg ? AURA.dmg.bonus[t.aura.dmg - 1] : 0) * 100)}%</span><span>⏱ +${Math.round((t.aura.rate ? AURA.rate.bonus[t.aura.rate - 1] : 0) * 100)}%</span></div>`
      : `<div class="pop-stats"><span>⚔ ${Math.round(st.dmg)}</span><span>◎ ${Math.round(st.range)}</span><span>⏱ ${(TICK_RATE / st.period).toFixed(1)}/с</span>${st.buff ? `<span class="buff">⚡+${Math.round(st.buff * 100)}%</span>` : ''}</div>`}`;
  if (def.support) key += `:${t.aura.dmg}${t.aura.rate}`;
  if (!mine) {
    html += `<div class="pop-stats"><span style="color:${PLAYER_COLORS[t.owner]}">Вежа гравця ${esc(nickOf(t.owner))}</span></div>`;
    return { key, html };
  }
  if (up) html += act('data-act="upgrade"', 'pa-up', '▲ Покращити', `рівень ${t.level} → ${t.level + 1}`, `● ${up}`, gold < up);
  if (def.support) {
    for (const k of ['dmg', 'rate']) {
      const lv = t.aura[k], cost = auraCost(t, k), a = AURA[k];
      const label = `${k === 'dmg' ? '⚔' : '⏱'} ${a.name}`;
      html += cost
        ? act(`data-act="aura" data-aura="${k}"`, `pa-${k}`, label, `рівень ${lv} → ${lv + 1} · +${Math.round(a.bonus[lv] * 100)}%`, `● ${cost}`, gold < cost)
        : act('', `pa-${k}`, label, 'максимальний рівень', '✓', true);
    }
  }
  if (evo) {
    html += '<div class="evo-title">Еволюція — обери шлях:</div><div class="evo">';
    for (const k of BRANCHES[t.kind]) {
      const d = TOWERS[k];
      html += `<button class="evo-btn" data-act="evolve" data-kind="${k}" ${gold < d.cost ? 'disabled' : ''}>
        <span class="icon" data-icon="${k}"></span><b>${d.name}</b><span>${d.desc}</span><i>● ${d.cost}</i></button>`;
    }
    html += '</div>';
  }
  // the final upgrade: shown as a goal once the tower is evolved (Totem: an aura at level 3), then as done
  if (ms && !t.master && (canMaster(t) || def.from)) {
    const cost = masterCost(s, me(), t);
    html += act('data-act="master"', 'pa-master', `♛ ${ms.name}`, ms.desc, `● ${cost}`, !canMaster(t) || gold < cost);
  } else if (ms && def.support && !t.master) {
    html += act('', 'pa-master', `♛ ${ms.name}`, 'спершу прокачай одну з аур до 3 рівня', '', true);
  } else if (t.master) html += `<div class="pop-stats master-done"><span>♛ ${ms.name}: ${ms.desc}</span></div>`;
  const mcd = Math.ceil((t.moveCd || 0) / TICK_RATE);
  html += '<div class="pa-row">'
    + act('data-act="move"', 'pa-move', '↔ Перемістити', mcd ? `зачекай ${mcd} с` : `до ${CONFIG.moveRange} клітинок · M`, '', mcd)
    + act('data-act="sell"', 'pa-sell', 'Продати', '', `+${sellValue(t, sellRatioOf(s, me()))}`, false)
    + '</div>';
  return { key, html };
}

function obstacleHtml(o, gold) {
  const cost = clearCost(o);
  return {
    key: `o${o.id}:${gold >= cost}`,
    html: `<div class="pop-title"><b>${o.kind === 'tree' ? 'Дерево' : 'Камінь'}</b></div>
      <div class="pop-stats"><span>Звільняє місце під вежу. Іноді там скарб!</span></div>
      <button data-act="clear" class="pa pa-up" ${gold < cost ? 'disabled' : ''}><span class="pa-txt">⛏ Розчистити</span><i class="pa-cost">● ${cost}</i></button>`,
  };
}

export function updatePop() {
  const pop = $('pop');
  const t = selTower();
  const o = selObstacle();
  if (!t && !o) { if (popKey) { pop.className = 'hidden'; popKey = ''; } return; }
  const gold = P().gold;
  const { key, html } = t ? towerHtml(t, gold) : obstacleHtml(o, gold);
  if (key !== popKey) {
    popKey = key;
    pop.innerHTML = html;
    pop.className = '';
    for (const el of pop.querySelectorAll('[data-icon]')) el.replaceWith(towerIcon(el.dataset.icon, 4));
  }
  placePop(t ? t.tx : o.tx, t ? t.ty : o.ty);
}

export function hidePop() {
  $('pop').className = 'hidden';
}
