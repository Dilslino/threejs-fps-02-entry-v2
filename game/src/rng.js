// rng.js — one seeded RNG for the whole game (mulberry32).
// Determinism rule: gameplay randomness comes ONLY from this module, never
// from Math.random(). The screenshot mode fixes the seed to 7, so a staged
// frame is reproducible; a live round seeds from the round number.
export function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // Float in [min, max).
    range(min, max) { return min + (max - min) * this.next(); },
    // Integer in [min, max] inclusive.
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    // Pick one element of a non-empty array.
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    // True with probability p.
    chance(p) { return this.next() < p; },
    // Fisher-Yates, in place, using this RNG.
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    },
  };
}
