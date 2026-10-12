// Custom high-contrast pixel mouse cursors, readable on grass, snow and roads.
import { canvas, ui } from '../app.js';

const CURSOR_MAPS = {
  arrow: { hot: [0, 0], c: { K: '#1a1c2c', Y: '#ffcd75', W: '#f4f4f4' }, rows: ['K...........', 'KK..........', 'KWK.........', 'KYWK........', 'KYYYK.......', 'KYYYYK......', 'KYYYYYK.....', 'KYYYYYYK....', 'KYYYYKKKK...', 'KYKKYK......', 'KK..KYK.....', '.....KK.....'] },
  build: { hot: [5, 4], c: { K: '#1a1c2c', G: '#a7f070' }, rows: ['....KKK....', '....KGK....', '....KGK....', 'KKKK...KKKK', 'KGGG.G.GGGK', 'KKKK...KKKK', '....KGK....', '....KGK....', '....KKK....'] },
  target: { hot: [5, 5], c: { K: '#1a1c2c', R: '#ef7d57', Y: '#ffcd75' }, rows: ['...KKKKK...', '..KRRRRRK..', '.KRK...KRK.', 'KRK.....KRK', 'KRK..Y..KRK', 'KRK.YYY.KRK', 'KRK..Y..KRK', 'KRK.....KRK', '.KRK...KRK.', '..KRRRRRK..', '...KKKKK...'] },
  move: { hot: [5, 5], c: { K: '#1a1c2c', B: '#73eff7' }, rows: ['....KKK....', '...KBBBK...', '....KBK....', '.K..KBK..K.', 'KBKKKBKKKBK', 'KBBBBBBBBBK', 'KBKKKBKKKBK', '.K..KBK..K.', '....KBK....', '...KBBBK...', '....KKK....'] },
};

const CURSORS = {};
for (const [k, m] of Object.entries(CURSOR_MAPS)) {
  const S = 2; // drawn at 2x so they stay crisp and big enough
  const cv = document.createElement('canvas');
  cv.width = m.rows[0].length * S; cv.height = m.rows.length * S;
  const g = cv.getContext('2d');
  m.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const col = m.c[row[x]]; if (col) { g.fillStyle = col; g.fillRect(x * S, y * S, S, S); } } });
  CURSORS[k] = `url(${cv.toDataURL()}) ${m.hot[0] * S} ${m.hot[1] * S}, crosshair`;
}

let cursorKind = '';
function updateCursor() {
  const k = ui.moving ? 'move' : ui.build ? 'build' : ui.ability ? 'target' : 'arrow';
  if (k === cursorKind) return;
  cursorKind = k;
  canvas.style.cursor = CURSORS[k];
}
setInterval(updateCursor, 50);
updateCursor();
document.body.style.cursor = CURSORS.arrow; // menus and panels use the same arrow
