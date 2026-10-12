// Per-frame overlays drawn on top of the renderer's output: the other players' cursors, the magnet-dragged
// cursor, and the pooled HTML labels (speech bubbles, nicks, boss bar title).
import { W, MX, MY, PLAYER_COLORS } from '../../render.js';
import { C } from '../../sprites.js';
import { say, SAY } from '../../say.js';
import { app, ui, net, canvas, me, bus } from '../app.js';
import { $ } from '../dom.js';
import { nickOf } from '../roster.js';
import { toMap, magnetBoss, getLastMouseEv } from './input.js';

const ARROW = ['1', '11', '121', '1221', '12221', '122221', '1222221', '1221111', '11 121', '1  121', '    11'];

function drawArrow(g, x, y, fill) {
  ARROW.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === ' ') continue;
      g.fillStyle = row[i] === '1' ? C.ink : fill;
      g.fillRect(x + i, y + j, 1, 1);
    }
  });
}

// While the magnet is on the system cursor is hidden and a dragged pixel cursor is drawn instead.
function drawPulledCursor() {
  const on = !!magnetBoss();
  canvas.classList.toggle('magnet', on);
  const ev = getLastMouseEv();
  if (!on || !ev) return;
  const m = toMap(ev);
  ui.mouse = m;
  ui.hover = m.y >= 0 && m.x >= 0 ? { tx: m.tx, ty: m.ty } : null;
  drawArrow(canvas.getContext('2d'), Math.round(m.x) + MX, Math.round(m.y) + MY, C.silver);
}

function drawPartnerCursors() {
  if (!net.online || !app.running) return;
  const g = canvas.getContext('2d');
  for (const [idx, p] of Object.entries(ui.partners)) {
    if (+idx === me() || performance.now() - p.at > 3000) continue;
    const col = PLAYER_COLORS[idx] || C.white;
    drawArrow(g, Math.round(p.x) + MX, Math.round(p.y) + MY, col);
    say(p.x + 24, p.y + 22, nickOf(+idx), 'nick', col);
  }
}

// Elements are pooled and reused frame to frame.
const sayLayer = document.createElement('div');
sayLayer.id = 'sayLayer';
$('stage').append(sayLayer);
const sayPool = [];
function syncSay() {
  const scale = canvas.clientWidth / W;
  for (let i = 0; i < SAY.length; i++) {
    const s = SAY[i];
    let el = sayPool[i];
    if (!el) { el = document.createElement('div'); sayLayer.append(el); sayPool.push(el); }
    if (el.textContent !== s.text) el.textContent = s.text;
    const cls = 'say' + (s.cls ? ' ' + s.cls : '');
    if (el.className !== cls) el.className = cls;
    el.style.color = s.color || '';
    el.style.left = (MX + s.x) * scale + 'px';
    el.style.top = (MY + s.y) * scale + 'px';
    el.style.display = '';
  }
  for (let i = SAY.length; i < sayPool.length; i++) sayPool[i].style.display = 'none';
}

bus.on('frame', () => {
  drawPartnerCursors();
  drawPulledCursor();
  syncSay();
});
