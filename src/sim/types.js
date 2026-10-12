// JSDoc type definitions for the simulation contract (no runtime code).
// Used by editors for completion/type-checking and as the reference for network commands.

/**
 * A player command. `p` is stamped by the host/solo client — never trusted from a guest.
 * @typedef {(
 *   {type:'place', kind:string, tx:number, ty:number} |
 *   {type:'upgrade', id:number} |
 *   {type:'evolve', id:number, kind:string} |
 *   {type:'aura', id:number, aura:'dmg'|'rate'} |
 *   {type:'move', id:number, tx:number, ty:number} |
 *   {type:'sell', id:number} |
 *   {type:'clear', id:number} |
 *   {type:'barrel', id:number} |
 *   {type:'collect', id:number} |
 *   {type:'nextWave'} |
 *   {type:'leave'} | {type:'rejoin'} |
 *   {type:'meteor', x:number, y:number} |
 *   {type:'nova'} |
 *   {type:'wall', tx:number, ty:number} |
 *   {type:'pick', index:number} |
 *   {type:'continue'}
 * ) & {p?:number}} Command
 */

/**
 * @typedef {Object} Player
 * @property {number} gold
 * @property {Object} mods     talent-derived multipliers (see newPlayer in sim.js)
 * @property {Object<string,number>} picked   card id -> times taken
 * @property {{meteor:number, nova:number, wall:number}} cds   ability cooldowns in ticks
 * @property {string[][]} drafts   pending talent choices (card id lists)
 * @property {number} kills
 */

/**
 * @typedef {Object} GameEvent  Transient notification for rendering/sound: `{type, x?, y?, p?, ...}`.
 *   Rebuilt every step(); never read by the simulation itself.
 */

/**
 * @typedef {Object} GameState
 * @property {number} rngState        seeded RNG state (the only source of randomness)
 * @property {Object} opts            options the game was created with (identical on every peer)
 * @property {'classic'|'circle'} mode
 * @property {number} tick
 * @property {number} wave
 * @property {number} winWave
 * @property {number} lives
 * @property {Player[]} players
 * @property {Object[]} enemies
 * @property {Object[]} towers
 * @property {Object[]} projs
 * @property {Object[]} zones
 * @property {Object[]} coins
 * @property {Object[]} walls
 * @property {Object[]} obstacles
 * @property {Object[]} barrels
 * @property {Object[]} queue         enemies scheduled to spawn: `{type, lane, at, hpMul}`
 * @property {GameEvent[]} events
 * @property {boolean} over
 * @property {boolean} won
 */

export {};
