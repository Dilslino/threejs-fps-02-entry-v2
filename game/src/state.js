// state.js — the ONE state store for GLASSHOUSE.
// Every system reads and writes this object; nothing keeps a parallel copy
// of round/phase/money/health. If it is not in here, it is not game state
// (render-only data lives in render.js, DOM-only data lives in hud.js).
//
// Teams: Thorns (attackers, warm orange) vs Keepers (defenders, cool blue).
// The player is always a Thorn. First to 7 round wins takes the match.

export const WIN_ROUNDS = 7;
export const ROUND_TIME = 100;     // seconds per round
export const FREEZE_TIME = 5;      // freeze time at the start of every round
export const PLANT_TIME = 3.5;     // seconds to plant the Canister
export const FUSE_TIME = 40;       // seconds from plant to detonation
export const DEFUSE_TIME = 5;      // seconds to defuse (2.5 with a kit)
export const START_MONEY = 800;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;

export const TEAM = { THORNS: 'thorns', KEEPERS: 'keepers' };

export function makePlayer(id, name, team, isBot, tier) {
  return {
    id, name, team, isBot, tier: tier || null,
    alive: true, hp: 100, armor: 0, helmet: false,
    // Position and view. y is feet height; eye is y + 1.62.
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    // Movement state.
    vx: 0, vz: 0, crouched: false, onGround: true,
    // Loadout.
    weaponId: 's6', mag: 12, reserve: 36,
    grenades: { flash: 0, smoke: 0, frag: 0 },
    hasKit: false,
    money: START_MONEY,
    // Round stats.
    kills: 0, deaths: 0, damageDealt: 0, shots: 0, hits: 0,
    // Bot-only fields (filled by bots.js).
    bot: null,
    // Shooting state (per-frame, reset by weapons.js).
    spread: 0, bloom: 0, recoilPitch: 0, lastShotAt: -99, reloadingUntil: -99,
    flashUntil: -99, // blinded until this sim time
    smokeUntil: -99,
  };
}

export function createState() {
  const s = {
    phase: 'freeze',        // freeze | round | roundEnd | matchEnd
    phaseT: 0,              // seconds spent in the current phase
    round: 1,
    score: { thorns: 0, keepers: 0 },
    roundTimer: ROUND_TIME,
    freezeTimer: FREEZE_TIME,
    roundWinner: null,      // 'thorns' | 'keepers' | null
    roundEndReason: '',     // 'elimination' | 'detonation' | 'defused' | 'timeout'
    matchWinner: null,
    lossStreak: { thorns: 0, keepers: 0 },
    players: [],
    // The Canister (bomb analogue). One carrier at a time.
    canister: {
      state: 'carried',     // carried | dropped | planted | defused | detonated
      carrierId: null,
      site: null,           // 'A' | 'B' | null
      x: 0, z: 0,           // drop position when dropped
      plantProgress: 0,     // 0..1 while channeling
      plantingId: null,
      fuse: 0,              // seconds left after plant
      defuseProgress: 0,    // 0..1 while channeling
      defusingId: null,
    },
    // Feeds shown in the HUD (newest first, capped by hud.js).
    killFeed: [],           // { text, t }
    callouts: [],           // { text, t }
    // Grenade effects live in world state: smoke puffs block sight.
    smokes: [],             // { x, z, until }
    flashes: [],            // { x, y, z, at } (kept for the debug overlay)
    // Sim clock (seconds since match start). Never Date.now().
    time: 0,
    // Round-start snapshot for the round-end summary.
    roundStartMoney: 0,
  };
  return s;
}

// Reset everything that is per-round, keeping match score and money.
export function resetRound(s) {
  s.phase = 'freeze';
  s.phaseT = 0;
  s.roundTimer = ROUND_TIME;
  s.freezeTimer = FREEZE_TIME;
  s.roundWinner = null;
  s.roundEndReason = '';
  s.canister = {
    state: 'carried', carrierId: null, site: null, x: 0, z: 0,
    plantProgress: 0, plantingId: null, fuse: 0,
    defuseProgress: 0, defusingId: null,
  };
  for (const p of s.players) {
    p.alive = true;
    p.hp = 100;
    p.armor = 0;
    p.helmet = false;
    p.flashUntil = -99;
    p.smokeUntil = -99;
    p.spread = 0; p.bloom = 0; p.recoilPitch = 0;
    p.reloadingUntil = -99;
    p.lastShotAt = -99;
  }
}

export function aliveOnTeam(s, team) {
  let n = 0;
  for (const p of s.players) if (p.team === team && p.alive) n++;
  return n;
}

export function playerById(s, id) {
  for (const p of s.players) if (p.id === id) return p;
  return null;
}
