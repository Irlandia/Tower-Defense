// Campaign presentation: intro story lines, live progress of the side objective.
import { app, bus, renderer, sfx } from '../app.js';
import { banner } from './banner.js';
import { hero } from '../../say.js';

/** Intro lines appear one by one as speech bubbles over the farmer (client-side only, never pauses co-op). */
export function tellStory(lines) {
  lines.forEach(([rawWho, rawText], i) => setTimeout(() => {
    const who = hero(rawWho), text = hero(rawText); // {hero} = the player's nickname
    if (!app.running) return;
    const F = renderer.critters.farm;
    const line = who === 'Дід Панас' ? text : `${who}: ${text}`;
    if (F) { F.farmer.say = line; F.farmer.sayT = 4; F.farmer.state = 'idle'; F.farmer.t = 4; }
    else banner(who, 'gold', text, 3500);
  }, 1800 + i * 4200));
}

/** Side objective as live progress for the panel (the win itself is surviving all waves). */
export function sideProgress(s) {
  const side = s.mission.side, st = s.stats;
  switch (side.type) {
    case 'coins': return { text: `Монети: ${Math.min(st.coins, side.n)} / ${side.n}`, ok: st.coins >= side.n };
    case 'noLeak': return { text: st.leaks ? `Пропущено ворогів: ${st.leaks} — зірку втрачено` : 'Жодного пропущеного ворога', ok: !st.leaks, lost: !!st.leaks };
    case 'farm': {
      const pct = Math.round((100 * s.farmHp) / (s.farmMax || 1));
      return { text: `Врожай: ${pct}% (треба від 50%)`, ok: pct >= side.pct * 100 };
    }
    case 'peak': return { text: `Найбільше живих: ${st.peak} / ${side.n}`, ok: st.peak <= side.n, lost: st.peak > side.n };
  }
  return { text: side.text, ok: false };
}

// a banner the moment a collectable objective is reached
let sideDone = false;
setInterval(() => {
  const s = app.state;
  if (!app.running || !s.mission) { sideDone = false; return; }
  const side = s.mission.side;
  if (side.type === 'coins' && !sideDone && s.stats.coins >= side.n) { sideDone = true; sfx.play('card'); banner('★ Ціль виконано!', 'gold', side.text, 1800); }
}, 250);

bus.on('run:start', () => {
  const s = app.state;
  if (s.mission) tellStory(s.mission.story.intro);
});
