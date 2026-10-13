// Network message validation (pure, no DOM / net access — unit-tested in tests/client.html).
// Catalogue of messages: docs/net-protocol.md.
import { COMMANDS } from '../sim/commands.js';
import { validCode } from '../avatar.js';

const MAX_CMDS = 64; // per tick
const MSG_TYPES = new Set(['hello', 'cmd', 'cursor', 'ping', 'welcome', 'mismatch', 'full', 'roster', 'start', 'resync', 'tick', 'cmds', 'lobby', 'end', 'hash', 'desync']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clampNum = (v) => Math.max(-1000, Math.min(2000, Math.round(v)));

function validCmd(c) {
  return isObj(c) && typeof c.type === 'string' && (c.type === 'continue' || Object.prototype.hasOwnProperty.call(COMMANDS, c.type));
}

/**
 * Check and normalise an incoming message. Returns a safe copy, or null if it must be dropped.
 * Pure function (no DOM / net access) so it can be unit-tested in tests/client.html.
 */
export function validate(m) {
  if (!isObj(m) || typeof m.t !== 'string' || !MSG_TYPES.has(m.t)) return null;
  switch (m.t) {
    case 'hello':
      return { t: 'hello', v: m.v, nick: String(m.nick ?? '').slice(0, 16), perks: isObj(m.perks) ? m.perks : null, avatar: validCode(m.avatar) ? m.avatar : '' };
    case 'cmd':
      return validCmd(m.cmd) ? { t: 'cmd', cmd: m.cmd } : null;
    case 'cursor':
      return isNum(m.x) && isNum(m.y) ? { t: 'cursor', idx: isInt(m.idx) ? m.idx : undefined, x: clampNum(m.x), y: clampNum(m.y) } : null;
    case 'tick': case 'cmds':
      return Array.isArray(m.cmds) && m.cmds.length <= MAX_CMDS && m.cmds.every(isObj) ? { t: m.t, cmds: m.cmds } : null;
    case 'roster':
      return Array.isArray(m.list) && m.list.length <= 4
        ? { t: 'roster', list: m.list.filter(isObj).map((r) => ({ slot: r.slot, nick: String(r.nick ?? '').slice(0, 16), idx: r.idx, avatar: validCode(r.avatar) ? r.avatar : '' })) }
        : null;
    case 'start':
      return isNum(m.seed) && isObj(m.opts) && isInt(m.idx) ? { t: 'start', seed: m.seed, opts: m.opts, idx: m.idx, v: m.v } : null;
    case 'resync':
      return isNum(m.seed) && isObj(m.opts) && Array.isArray(m.log) && isInt(m.tick)
        ? { t: 'resync', seed: m.seed, opts: m.opts, log: m.log, tick: m.tick, idx: m.idx, v: m.v } : null;
    case 'end':
      return { t: 'end', won: !!m.won };
    case 'hash':
      return isInt(m.tick) && isInt(m.h) ? { t: 'hash', tick: m.tick, h: m.h } : null;
    case 'desync':
      return { t: 'desync', tick: isInt(m.tick) ? m.tick : 0 };
    default:
      return { t: m.t, v: m.v };
  }
}
