// bots.js — bot AI for GLASSHOUSE.
// Bots navigate ONLY on the waypoint graph (map.js) with a small state
// machine: Advance / Hold / Rotate / Retreat / Plant / Defuse. No
// pathfinding library, no per-frame allocation.
//
// The anti-dumb-bot rule, in code: a bot that cannot see you cannot shoot
// you. Perception is a real line-of-sight raycast (canSee), throttled to
// one check per bot every 150 ms and staggered across frames. Hearing gives
// a direction and an approximate position only — never a wall-hack aim
// point. Last-seen memory expires after 2 s.

import { hasLOS, nearestWaypoint, findPath, moveCircle, SITES } from './map.js';
import { WEAPONS, tryFire, startReload, finishReload, applyDamage, throwGrenade, smokeBlocks } from './weapons.js';

export const TIERS = {
  recruit: { reaction: [700, 900], spread: 6.0, burst: 3, pause: [600, 900], buy: ['vx-9', 's6'] },
  veteran: { reaction: [350, 500], spread: 3.0, burst: 5, pause: [350, 550], buy: ['ar-55', 'vx-9'] },
  elite: { reaction: [200, 300], spread: 1.5, burst: 7, pause: [200, 350], buy: ['ar-55', 'dm-8'] },
};

const EYE = 1.62;
const LOS_INTERVAL = 0.15;   // seconds between LOS checks per bot
const MEMORY_TIME = 2.0;     // seconds a last-seen position is kept
const HEAR_RADIUS = 25;      // metres — gunshots are heard this far

export function makeBot(p, tier, role, site) {
  p.bot = {
    tier, role, site,           // role: 'fern' | 'mid' | 'pond' | 'siteA' | 'siteB' | 'roamer'
    state: 'advance',           // advance | hold | rotate | retreat | plant | defuse
    route: [], routeIdx: 0,
    holdUntil: 0, peekUntil: 0,
    nextThink: 0, nextLOS: 0,
    // Unstuck: if the bot barely moves for 0.6 s while advancing, it is
    // head-on against a wall (per-axis slide cannot help) — sidestep
    // perpendicular for 0.5 s, then retry the route.
    lastX: 0, lastZ: 0, stuckSince: 0, sidestepUntil: 0, sidestepDir: 1,
    visible: null,              // currently visible enemy (player object)
    lastSeen: null,             // { x, z, t }
    heard: null,                // { x, z, t, kind }
    reactAt: 0,                 // sim time when the bot may first shoot
    burstLeft: 0, nextBurstAt: 0,
    aimErr: 0,
    calloutAt: 0,
  };
  return p;
}

// Radio callout: short text into the HUD feed. Callouts are the visible
// proof that bots share information and coordinate.
export function callout(s, p, text) {
  const msg = `${p.name}: ${text}`;
  s.callouts.unshift({ text: msg, t: s.time });
  if (s.callouts.length > 6) s.callouts.length = 6;
}

// A bot that cannot see you cannot shoot you. LOS + smoke + range.
export function canSee(s, bot, target) {
  if (!target.alive) return false;
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 45 * 45) return false; // nobody sees past 45 m here
  if (!hasLOS(bot.x, bot.z, target.x, target.z)) return false;
  if (smokeBlocks(s, bot.x, bot.z, target.x, target.z)) return false;
  return true;
}

// Hearing: a shot is heard within 25 m, a plant beep everywhere.
export function heardShot(s, bot, e) {
  const dx = e.x - bot.x, dz = e.z - bot.z;
  if (dx * dx + dz * dz > HEAR_RADIUS * HEAR_RADIUS) return;
  bot.bot.heard = { x: e.x, z: e.z, t: s.time, kind: 'shot' };
}

export function heardPlant(s, bot, site) {
  bot.bot.heard = { x: SITES[site].x, z: SITES[site].z, t: s.time, kind: 'plant' };
}

// Assign roles at round start. Thorns: 1 carrier (rotates), 2 Fern, 1 Mid,
// 1 Pond. Keepers: 2 Site A, 2 Site B, 1 Mid roamer.
export function assignRoles(s, rng) {
  const thorns = s.players.filter(p => p.team === 'thorns');
  const keepers = s.players.filter(p => p.team === 'keepers');
  // Carrier rotates among the Thorns by round number (player included).
  const carrier = thorns[(s.round - 1) % thorns.length];
  s.canister.carrierId = carrier.id;
  const tRoles = ['fern', 'fern', 'mid', 'pond'];
  let ti = 0;
  for (const p of thorns) {
    if (!p.bot) continue;
    p.bot.role = p === carrier ? 'carrier' : tRoles[ti++ % tRoles.length];
    p.bot.site = p.bot.role === 'fern' ? 'A' : p.bot.role === 'pond' ? 'B' : null;
  }
  const kRoles = ['siteA', 'siteA', 'siteB', 'siteB', 'roamer'];
  let ki = 0;
  for (const p of keepers) {
    if (!p.bot) continue;
    p.bot.role = kRoles[ki++ % kRoles.length];
    p.bot.site = p.bot.role === 'siteA' ? 'A' : p.bot.role === 'siteB' ? 'B' : null;
  }
  // Bot economy: bots buy by tier from the same price list as the player.
  for (const p of s.players) {
    if (!p.bot) continue;
    buyForBot(p, rng);
  }
}

function buyForBot(p, rng) {
  const tier = TIERS[p.bot.tier];
  const pick = rng.pick(tier.buy);
  const w = WEAPONS[pick];
  if (p.money >= w.price) {
    p.money -= w.price;
    p.weaponId = pick;
    p.mag = w.mag; p.reserve = w.reserve;
  }
  if (p.bot.tier !== 'recruit' && p.money >= 650) {
    p.money -= 650; p.armor = 50;
    if (p.bot.tier === 'elite' && p.money >= 350) {
      p.money -= 350; p.helmet = true;
    }
  }
  if (p.bot.tier === 'elite' && p.money >= 300) {
    p.money -= 300; p.grenades.smoke += 1;
  }
}

function routeTo(p, targetWpId) {
  const from = nearestWaypoint(p.x, p.z);
  const path = findPath(from, targetWpId);
  p.bot.route = path;
  p.bot.routeIdx = 0;
}

function routeTarget(p) {
  // Where this bot wants to go, from its role and the round state.
  const b = p.bot;
  if (p.team === 'thorns') {
    if (b.role === 'carrier' || b.role === 'fern') return b.site === 'A' ? 'siteA' : 'siteA';
    if (b.role === 'pond') return 'siteB';
    return 'domeN'; // mid
  }
  if (b.role === 'siteA') return 'holdA';
  if (b.role === 'siteB') return 'holdB';
  return 'holdDome'; // roamer
}

// The 10 Hz think: navigation, state changes, callouts. Firing is handled
// every fixed step in updateBot below (it is cheap once LOS is known).
function think(s, p, rng) {
  const b = p.bot;
  const now = s.time;
  // Plant / defuse take priority over everything else.
  if (s.canister.state === 'planted' && p.team === 'keepers') {
    const site = s.canister.site;
    if (b.state !== 'rotate' || b.site !== site) {
      b.state = 'rotate'; b.site = site;
      routeTo(p, site === 'A' ? 'siteA' : 'siteB');
      if (now - b.calloutAt > 8) { callout(s, p, `rotating ${site}`); b.calloutAt = now; }
    }
  }
  if (p.team === 'thorns' && s.canister.carrierId === p.id && s.canister.state === 'carried') {
    const site = b.site || 'A';
    const dSite = Math.hypot(SITES[site].x - p.x, SITES[site].z - p.z);
    const enemiesNear = s.players.some(e => e.team !== p.team && e.alive &&
      Math.hypot(e.x - SITES[site].x, e.z - SITES[site].z) < 15);
    if (dSite < 3 && !enemiesNear) { b.state = 'plant'; return; }
  }
  if (s.canister.state === 'planted' && p.team === 'keepers') {
    const dSite = Math.hypot(SITES[s.canister.site].x - p.x, SITES[s.canister.site].z - p.z);
    const enemiesNear = s.players.some(e => e.team !== p.team && e.alive &&
      Math.hypot(e.x - SITES[s.canister.site].x, e.z - SITES[s.canister.site].z) < 12);
    if (dSite < 3 && !enemiesNear) { b.state = 'defuse'; return; }
  }
  // Low HP + outnumbered -> fall back and hold the site.
  const allies = s.players.filter(e => e.team === p.team && e.alive).length;
  const foes = s.players.filter(e => e.team !== p.team && e.alive).length;
  if (p.hp < 30 && foes > allies && b.state !== 'retreat') {
    b.state = 'retreat';
    routeTo(p, p.team === 'thorns' ? 'thornSpawn' : 'keeperSpawn');
    return;
  }
  // Heard a shot recently with no visible target: peek toward it.
  if (!b.visible && b.heard && now - b.heard.t < 3 && b.state === 'advance') {
    const wp = nearestWaypoint(b.heard.x, b.heard.z);
    if (b.route.length === 0 || b.route[b.route.length - 1].id !== wp) {
      routeTo(p, wp);
    }
  }
  // Default: advance along the role route; arrive -> hold the angle.
  if (b.state === 'advance' || b.state === 'retreat' || b.state === 'rotate') {
    if (b.route.length === 0) {
      routeTo(p, routeTarget(p));
    }
    if (b.routeIdx >= b.route.length) {
      b.state = 'hold';
      b.holdUntil = now + rng.range(2, 5);
      // Hold angle: face the site / the lane we came from.
      const tgt = routeTarget(p);
      const wp = b.route.length ? b.route[b.route.length - 1] : null;
      if (wp) p.yaw = Math.atan2(-(wp.x - p.x), -(wp.z - p.z));
    }
  }
  if (b.state === 'hold' && now > b.holdUntil) {
    // Hold expired: re-route (patrol the same lane again).
    b.state = 'advance';
    routeTo(p, routeTarget(p));
  }
}

// Per-fixed-step update: think (10 Hz), move along the route, aim, fire.
export function updateBot(s, p, dt, rng, bus) {
  const b = p.bot;
  if (!b || !p.alive) return;
  const now = s.time;

  // --- Perception (throttled, staggered by bot id) ---
  if (now >= b.nextLOS) {
    b.nextLOS = now + LOS_INTERVAL;
    const wasVisible = b.visible;
    b.visible = null;
    let best = null, bestD = Infinity;
    for (const e of s.players) {
      if (e.team === p.team || !e.alive) continue;
      if (!canSee(s, p, e)) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      if (!wasVisible) {
        // New target: reaction time before the first shot.
        const t = TIERS[b.tier];
        b.reactAt = now + rng.range(t.reaction[0], t.reaction[1]) / 1000;
        b.burstLeft = t.burst;
      }
      b.visible = best;
      b.lastSeen = { x: best.x, z: best.z, t: now };
    } else if (b.lastSeen && now - b.lastSeen.t > MEMORY_TIME) {
      b.lastSeen = null;
    }
  }

  // --- Think (10 Hz) ---
  if (now >= b.nextThink) {
    b.nextThink = now + 0.1;
    think(s, p, rng);
  }

  // --- Plant / defuse channel ---
  if (b.state === 'plant') {
    const c = s.canister;
    if (c.state === 'carried' && c.carrierId === p.id) {
      c.plantProgress += dt / 3.5;
      c.plantingId = p.id;
      if (c.plantProgress >= 1) {
        c.state = 'planted';
        c.site = b.site || 'A';
        c.fuse = 40;
        c.plantProgress = 0;
        p.money += 300;
        callout(s, p, `canister down ${c.site}`);
        bus.emit('plant', { site: c.site });
        for (const q of s.players) if (q.bot) heardPlant(s, q, c.site);
      }
    } else b.state = 'advance';
    return; // planting bots stand still
  }
  if (b.state === 'defuse') {
    const c = s.canister;
    if (c.state === 'planted') {
      const rate = p.hasKit ? 2 : 1;
      c.defuseProgress += (dt / 5) * rate;
      c.defusingId = p.id;
      if (c.defuseProgress >= 1) {
        c.state = 'defused';
        b.state = 'advance';
      }
    } else b.state = 'advance';
    return;
  }

  // --- Movement along the route ---
  if ((b.state === 'advance' || b.state === 'rotate' || b.state === 'retreat') && b.route.length) {
    const wp = b.route[b.routeIdx];
    if (wp) {
      const dx = wp.x - p.x, dz = wp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        b.routeIdx++;
        // Strafe-peek at corners: brief pause, look around.
        if (rng.chance(0.35)) b.peekUntil = now + rng.range(0.3, 0.7);
      } else if (now > b.peekUntil) {
        // Unstuck check: barely moved in the last 0.6 s?
        const moved = Math.hypot(p.x - b.lastX, p.z - b.lastZ);
        if (moved < 0.05) {
          if (b.stuckSince === 0) b.stuckSince = now;
          else if (now - b.stuckSince > 0.6 && now > b.sidestepUntil) {
            b.sidestepUntil = now + 0.5;
            b.sidestepDir = rng.chance(0.5) ? 1 : -1;
            b.stuckSince = 0;
          }
        } else {
          b.stuckSince = 0;
          b.lastX = p.x; b.lastZ = p.z;
        }
        const sp = 4.5;
        let mx = (dx / d) * sp * dt, mz = (dz / d) * sp * dt;
        if (now < b.sidestepUntil) {
          // Move perpendicular to the route direction instead.
          mx = (-dz / d) * sp * b.sidestepDir * dt;
          mz = (dx / d) * sp * b.sidestepDir * dt;
        }
        const step = moveCircle(p.x, p.z, mx, mz, 0.45);
        p.x = step.x; p.z = step.z;
        // Face where we walk, unless we have a target.
        if (!b.visible) p.yaw = Math.atan2(-dx, -dz);
      }
    }
  }

  // --- Aim + fire ---
  const target = b.visible || (b.lastSeen && now - b.lastSeen.t < MEMORY_TIME
    ? { x: b.lastSeen.x, z: b.lastSeen.z, alive: true, team: 'none' } : null);
  if (target && target.alive !== false) {
    const tx = target.x, tz = target.z;
    const wantYaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    // Aim error by tier: the bot aims at the target plus a fixed error.
    const tier = TIERS[b.tier];
    const err = (tier.spread * Math.PI / 180) * 0.5;
    // Smooth turn toward the target (bots do not snap).
    let dy = wantYaw - p.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    p.yaw += dy * Math.min(1, dt * 8);
    if (now >= b.reactAt && now >= b.nextBurstAt && b.burstLeft > 0) {
      // Apply the tier aim error as a one-shot offset, then fire.
      const saveYaw = p.yaw;
      p.yaw += (rng.next() - 0.5) * 2 * err;
      const res = tryFire(s, p, now, rng, false, false);
      p.yaw = saveYaw;
      if (res && res.hit) {
        const w = WEAPONS[p.weaponId];
        const dmg = w.damage * (res.hit.head ? w.headMult : 1);
        const out = applyDamage(s, res.hit.target, dmg, res.hit.head, p);
        bus.emit('hit', { shooter: p, target: res.hit.target, killed: out.killed, head: res.hit.head });
        if (out.killed) {
          s.killFeed.unshift({ text: `${p.name} ▸ ${res.hit.target.name}`, t: now });
          if (s.killFeed.length > 5) s.killFeed.length = 5;
        }
      } else if (res) {
        bus.emit('shot', { x: p.x, z: p.z, team: p.team, weapon: p.weaponId });
      }
      if (res) {
        b.burstLeft--;
        if (b.burstLeft <= 0) {
          const t2 = TIERS[b.tier];
          b.nextBurstAt = now + rng.range(t2.pause[0], t2.pause[1]) / 1000;
          b.burstLeft = t2.burst;
        }
      }
    }
    if (p.mag === 0) startReload(p, now);
  }

  // Reload completion.
  if (now >= p.reloadingUntil && p.reloadingUntil > 0) finishReload(p);
  // Smoke when the site is hot and we are Elite (cheap utility use).
  if (p.bot.tier === 'elite' && p.grenades.smoke > 0 && b.visible && rng.chance(0.002)) {
    const g = throwGrenade(s, p, 'smoke');
    if (g) bus.emit('grenade', g);
  }
}
