// Seeded RNG (mulberry32). State lives in the game object so it can be serialized/synced.
export function rand(s) {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s, n) {
  return Math.floor(rand(s) * n);
}
