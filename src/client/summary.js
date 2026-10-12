// Run summary: one client-side tally of what happened in the current run, built from sim events.
// Meta features (bestiary, later quests and tower mastery) read it at the end of the run instead of counting on their own.
// Fed by loop.js for every tick (also during silent catch-ups) and by session.resync while replaying.
import { ENEMIES } from '../sim/data.js';
import { me } from './app.js';

export function newSummary() {
  return {
    kills: 0, // everyone's kills
    myKills: 0,
    byFamily: {}, // my kills by tower family ('ability' = meteor / quake / barrel / other non-tower blows)
    bossesSeen: [], // boss keys (BOSSES) that appeared in this run, in order
    bossesKilled: [], // boss keys killed by the team
    cards: [], // talent cards I picked
    coins: 0, // coins and chests I collected
    built: 0, // towers I placed
    abilities: 0, // abilities I used
    leaks: 0, // enemies that reached the castle
  };
}

export const summary = newSummary();

export function resetSummary() {
  Object.assign(summary, newSummary());
}

const ABILITY_EVENTS = ['meteor', 'nova', 'wallup', 'goldrain', 'overdrive', 'quake'];

export function collect(events) {
  const my = me();
  for (const e of events) {
    const mine = e.p === my;
    switch (e.type) {
      case 'death':
        summary.kills++;
        if (e.bk !== undefined && ENEMIES[e.kind].lives) summary.bossesKilled.push(String(e.bk));
        if (mine) { summary.myKills++; const f = e.by || 'ability'; summary.byFamily[f] = (summary.byFamily[f] || 0) + 1; }
        break;
      case 'bossSpawn': if (e.bk !== undefined && !e.hidden) summary.bossesSeen.push(String(e.bk)); break;
      case 'bossReveal': summary.bossesSeen.push(String(e.bk)); break; // a disguised boss counts once unmasked
      case 'picked': if (mine) summary.cards.push(e.card); break;
      case 'coin': case 'chest': if (mine) summary.coins++; break;
      case 'build': if (mine) summary.built++; break;
      case 'leak': summary.leaks++; break;
      default: if (mine && ABILITY_EVENTS.includes(e.type)) summary.abilities++;
    }
  }
}
