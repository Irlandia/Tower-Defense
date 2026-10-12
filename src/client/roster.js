// Who is in the room. The host keeps the roster per guest slot and broadcasts it; player index is assigned at start.
import { app, bus, net, meta, me } from './app.js';
import * as Meta from '../meta.js';

export function myEntry() {
  return { slot: 0, nick: app.nick, perks: Meta.perks(meta), idx: 0 };
}

/** host: rebuild the roster with ourselves first, send it to the guests and tell the UI. */
export function broadcastRoster() {
  if (net.role !== 'host') return;
  app.roster = [myEntry(), ...app.roster.filter((r) => r.slot > 0)];
  net.send({ t: 'roster', list: app.roster.map(({ slot, nick, idx }) => ({ slot, nick, idx })) });
  bus.emit('roster:changed');
}

export const nickOf = (idx) => (app.roster.find((r) => r.idx === idx) || {}).nick || (idx === me() ? app.nick : 'Гравець ' + (idx + 1));
export const others = () => app.roster.filter((r) => r.idx !== me()).map((r) => r.nick || 'Гравець').join(', ');
