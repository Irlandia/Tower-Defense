// Pixel-art icons drawn from small character maps (towers, abilities, lobby mode tiles).
import { drawTower } from '../../sprites.js';

/** A canvas with the tower sprite, for the build bar and the popup. */
export function towerIcon(kind, level = 1) {
  const cv = document.createElement('canvas');
  cv.width = 28; cv.height = 40;
  drawTower(cv.getContext('2d'), kind, 2, 14, level);
  return cv;
}

/** 2x canvas of an icon map with a dark outline around every filled pixel. */
export function pixelIcon({ rows, c }) {
  const S = 2, W2 = rows[0].length, H2 = rows.length;
  const cv = document.createElement('canvas');
  cv.width = (W2 + 2) * S; cv.height = (H2 + 2) * S;
  const g = cv.getContext('2d');
  const filled = (x, y) => rows[y] && rows[y][x] && rows[y][x] !== '.';
  g.fillStyle = '#1a1c2c';
  for (let y = -1; y <= H2; y++) for (let x = -1; x <= W2; x++) {
    if (filled(x, y)) continue;
    if (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1)) g.fillRect((x + 1) * S, (y + 1) * S, S, S);
  }
  rows.forEach((row, y) => { for (let x = 0; x < W2; x++) if (c[row[x]]) { g.fillStyle = c[row[x]]; g.fillRect((x + 1) * S, (y + 1) * S, S, S); } });
  return cv;
}

export const AB_ICONS = {
  meteor: {
    c: { o: '#ef7d57', y: '#ffcd75', w: '#fff4d6', r: '#b13e53', k: '#1a1c2c' },
    rows: ['.........w.w', '........ywy.', '.......yoy..', '...rrrr.y...', '..royyor....', '.royyyyor...', '.roykykor...', '.royyyyor...', '..royyor....', '...rrrr.....', '............'],
  },
  nova: {
    c: { c: '#73eff7', b: '#41a6f6', w: '#f4f4f4' },
    rows: ['.....w......', '...w.c.w....', '....ccc.....', '.w.c.b.c.w..', '..ccwwwcc...', 'wcbbwwwbbcw.', '..ccwwwcc...', '.w.c.b.c.w..', '....ccc.....', '...w.c.w....', '.....w......'],
  },
  wall: {
    c: { B: '#c28569', b: '#8a6248', D: '#5a3e2c', s: '#94b0c2' },
    rows: ['.B...B...B..', 'BbB.BbB.BbB.', 'BbB.BbB.BbB.', 'DDDDDDDDDDD.', 'BsB.BsB.BsB.', 'BbB.BbB.BbB.', 'DDDDDDDDDDD.', 'BbB.BbB.BbB.', 'BbB.BbB.BbB.', 'bbb.bbb.bbb.', '............'],
  },
  goldrain: {
    c: { y: '#ffcd75', o: '#c28569', w: '#fff4d6' },
    rows: ['....oooo....', '..oowyyyoo..', '.oyywyyyyo.', '.oyywyyyyo.', 'oyyywyyyyyo.', 'oyyyyyyyyyo.', 'oyyyyyyyyyo.', '.oyyyyyyyo..', '..oyyyyyo...', '....oooo....', '............'],
  },
  overdrive: {
    c: { w: '#fff4d6', y: '#ffcd75', o: '#ef7d57' },
    rows: ['.......ww...', '......wy....', '.....wyy....', '....wyyyyy..', '.....yyyyy..', '......yyo...', '.....yy.....', '....yy......', '...yy.......', '..yo........', '............'],
  },
  dragon: {
    c: { g: '#38b764', d: '#257179', y: '#ffcd75', o: '#ef7d57', w: '#f4f4f4' },
    rows: ['..d.........', '..dg...d....', '..ggg.dg....', '.gwggggg....', 'ggggggggg...', 'gggg..dggg..', '.oo....dgg..', 'oyyo....gg..', '.oyo...ggd..', '..o...ggd...', '......dd....'],
  },
  quake: {
    c: { s: '#94b0c2', d: '#566c86', k: '#5a3e2c' },
    rows: ['.....ss.....', '...sssss....', '.sssssssss..', 'ssssssssssss', 'sssskssssss.', 'dddkdddddddd', '.....kd.....', '....kk......', '...kk.......', '..kd........', '............'],
  },
};

export const MODE_ICONS = {
  classic: { c: { s: '#94b0c2', d: '#566c86', r: '#b13e53', y: '#ffcd75', k: '#1a1c2c' },
    rows: ['.r.......r..', 'rrr.....rrr.', '.s...y...s..', '.s..yyy..s..', 'sssssssssss.', 'sdsdsdsdsds.', 'sssssssssss.', 'ssss.k.ssss.', 'ssss.k.ssss.', 'dddd.k.dddd.', '............'] },
  circle: { c: { c: '#73eff7', b: '#41a6f6', w: '#f4f4f4', y: '#ffcd75' },
    rows: ['...cccc.....', '..c....c....', '.c......cy..', 'c.......cyy.', 'c........c..', 'c........c..', 'c........c..', '.c......c...', '..c....c....', '...cccc.....', '............'] },
  brawl: { c: { s: '#f4f4f4', m: '#94b0c2', y: '#ffcd75', o: '#ef7d57' },
    rows: ['s.........s.', '.s.......s..', '..s.....s...', '...s...s....', '....s.s.....', '.....m......', '....s.s.....', '..yo...oy...', '.yy.....yy..', 'yy.......yy.', '............'] },
  campaign: { c: { p: '#f4e1b6', d: '#c29a6b', b: '#8a6248', r: '#b13e53' },
    rows: ['.dpppppppd..', 'dppppppppd..', '.pbbbbbp....', '.pppppppp...', '.pbbbbp.....', '.pppppppp...', '.pbbbbbbp...', '.ppppppprr..', 'dpppppppprr.', '.dppppppd...', '............'] },
};
