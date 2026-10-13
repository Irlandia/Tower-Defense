// Speech bubbles and labels as crisp HTML above the canvas: tiny canvas text gets blurry when the
// pixel art is scaled up. Drawing code queues text in map coordinates; main.js lays it out each frame.
export const SAY = [];

// x, y: map pixels (bubble is centred on x, its bottom at y); cls: 'boss' | 'gold' | 'nick' | 'bar' | ''
export function say(x, y, text, cls = '', color = '') {
  SAY.push({ x, y, text, cls, color });
}

// The player is the hero of the story: lines are written with {hero}, which becomes the player's nickname
// (the client sets HERO.name; without a nick the hero is «Тарас»).
export const HERO = { name: '' };
export const hero = (text) => String(text).replace(/\{hero\}/g, HERO.name || 'Тарас');
