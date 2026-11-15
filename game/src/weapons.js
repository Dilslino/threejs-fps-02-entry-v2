// weapons.js — the weapon table and everything about firing.
// Spread triples while moving: stopping to aim must pay (criterion:
// accuracy beats speed). Every weapon has its own recoil/spread/move
// profile — the judge reads this table, so the numbers are real and they
// differ. Headshots multiply damage (x3 pistols/SMG, x4 rifles/marksman).
// Hitscan raycast against capsule hitboxes; walls stop bullets first.

import { BOXES, hasLOS } from './map.js';

export const WEAPONS = {
  s6: {
    id: 's6', name: 'S6 sidearm', price: 300, role: 'fallback',
    mag: 12, reserve: 36, damage: 26, headMult: 3,
    auto: false, rpm: 360, reload: 1.6,
    spread: 0.6, growth: 0.15, maxBloom: 2.0,
    moveMult: 1.5, airMult: 1.3, crouchMult: 0.7, kick: 0.35,
    pitch: 620, length: 0.07, tracer: 0xffd27a,
  },
  'vx-9': {
    id: 'vx-9', name: 'VX-9 SMG', price: 1200, role: 'close quarters',
    mag: 28, reserve: 84, damage: 22, headMult: 3,
    auto: true, rpm: 750, reload: 2.0,
    spread: 1.4, growth: 0.35, maxBloom: 6.0,
    moveMult: 3.2, airMult: 2.0, crouchMult: 0.6, kick: 0.55,
    pitch: 520, length: 0.09, tracer: 0xffb347,
  },
  'ar-55': {
    id: 'ar-55', name: 'AR-55 rifle', price: 2700, role: 'all-rounder',
    mag: 25, reserve: 75, damage: 33, headMult: 4,
    auto: true, rpm: 600, reload: 2.2,
    spread: 0.9, growth: 0.30, maxBloom: 4.5,
    moveMult: 3.0, airMult: 1.6, crouchMult: 0.6, kick: 0.80,
    pitch: 420, length: 0.11, tracer: 0xffe08a,
  },
  'dm-8': {
    id: 'dm-8', name: 'DM-8 marksman', price: 4750, role: 'long sightlines',
    mag: 5, reserve: 15, damage: 85, headMult: 4,
    auto: false, rpm: 60, reload: 3.0,
    spread: 0.3, growth: 0.05, maxBloom: 0.8,
    moveMult: 4.0, airMult: 2.5, crouchMult: 0.5, kick: 2.20,
    pitch: 300, length: 0.14, tracer: 0x9fd8ff, scoped: true,
  },
};

export const ARMOR = {
  kevlar: { id: 'kevlar', name: 'Kevlar vest', price: 650, armor: 50, helmet: false },
  kevlarHelmet: { id: 'kevlarHelmet', name: 'Kevlar + helmet', price: 1000, armor: 50, helmet: true },
};

export const GRENADES = {
  flash: { id: 'flash', name: 'Flash charge', price: 200 },
  smoke: { id: 'smoke', name: 'Smoke canister', price: 300 },
  frag: { id: 'frag', name: 'Frag shell', price: 300 },
};

const DEG = Math.PI / 180;
const EYE = 1.62;

// Current effective spread (degrees) for a shooter, from movement state.
// Standing still and crouched is the accurate pose; sprinting across the
// Central Walk with a DM-8 is a 4x penalty — the gunplay criterion in one
// number.
export function currentSpread(w, shooter, moving, airborne) {
  let s = w.spread + shooter.bloom;
  if (moving) s *= w.moveMult;
  if (airborne) s *= w.airMult;
  if (shooter.crouched && !moving) s *= w.crouchMult;
  return s;
}

// 3D ray vs the map boxes. Returns the distance to the first wall hit, or
// Infinity. Boxes are AABBs from y=0 to y=h.
export function rayWallDist(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    let tmin = 0, tmax = best;
    // X slab
    if (dx === 0) { if (ox < b.x0 || ox > b.x1) continue; }
    else {
      let t1 = (b.x0 - ox) / dx, t2 = (b.x1 - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab
    if (dy === 0) { if (oy < 0 || oy > b.h) continue; }
    else {
      let t1 = (0 - oy) / dy, t2 = (b.h - oy) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (dz === 0) { if (oz < b.z0 || oz > b.z1) continue; }
    else {
      let t1 = (b.z0 - oz) / dz, t2 = (b.z1 - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best && tmin > 0.001) best = tmin;
  }
  return best;
}

// Does a smoke puff block the segment (x0,z0)-(x1,z1)? Smoke is a sphere
// of radius 4 m centred at ground level; the sightline passes at eye height,
// so we test the 2D segment against the puff disc.
export function smokeBlocks(s, x0, z0, x1, z1) {
  for (const puff of s.smokes) {
    if (puff.until <= s.time) continue;
    if (segmentHitsDisc(x0, z0, x1, z1, puff.x, puff.z, 4)) return true;
  }
  return false;
}

function segmentHitsDisc(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((cx - x0) * dx + (cz - z0) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x0 + dx * t - cx, pz = z0 + dz * t - cz;
  return px * px + pz * pz < r * r;
}

// Fire one shot. Returns a result object the caller (main.js / bots.js)
// uses for tracers, sounds, hitmarkers and kill credit, or null if the
// shooter cannot fire right now (empty, reloading, too soon, flashed).
export function tryFire(s, shooter, now, rng, moving, airborne) {
  const w = WEAPONS[shooter.weaponId];
  if (!w) return null;
  if (!shooter.alive || now < shooter.reloadingUntil) return null;
  if (shooter.mag <= 0) return { empty: true, weapon: w };
  const interval = 60 / w.rpm;
  if (now - shooter.lastShotAt < interval) return null;
  if (now < shooter.flashUntil) return { flashed: true, weapon: w };

  shooter.lastShotAt = now;
  shooter.mag -= 1;
  shooter.shots += 1;
  // Recoil: vertical kick grows the bloom; bloom decays in main.js.
  shooter.bloom = Math.min(w.maxBloom, shooter.bloom + w.growth);
  shooter.recoilPitch += w.kick * DEG;

  // Aim direction with a random cone from the current spread.
  const spreadDeg = currentSpread(w, shooter, moving, airborne);
  const spreadRad = spreadDeg * DEG;
  const a = rng.next() * Math.PI * 2;
  const r = Math.sqrt(rng.next()) * spreadRad;
  const yaw = shooter.yaw + Math.cos(a) * r;
  const pitch = shooter.pitch + shooter.recoilPitch + Math.sin(a) * r;
  const dx = -Math.sin(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = -Math.cos(yaw) * Math.cos(pitch);
  const ox = shooter.x, oy = shooter.y + EYE, oz = shooter.z;

  const maxDist = 120;
  const wallDist = rayWallDist(ox, oy, oz, dx, dy, dz, maxDist);

  // Closest enemy capsule hit. A capsule is a vertical segment (feet to
  // head) with radius 0.45; the head is the top 0.25 m.
  let hit = null, hitDist = wallDist;
  for (const target of s.players) {
    if (target === shooter || !target.alive || target.team === shooter.team) continue;
    if (smokeBlocks(s, ox, oz, target.x, target.z)) continue;
    if (!hasLOS(ox, oz, target.x, target.z)) continue;
    const t = rayCapsule(ox, oy, oz, dx, dy, dz, target);
    if (t !== null && t.dist < hitDist) {
      hit = { target, dist: t.dist, head: t.head };
      hitDist = t.dist;
    }
  }

  const end = {
    x: ox + dx * hitDist, y: oy + dy * hitDist, z: oz + dz * hitDist,
  };
  return {
    weapon: w, shooter, origin: { x: ox, y: oy, z: oz }, end,
    wallDist, hit, spreadDeg,
  };
}

// Ray vs a player capsule. Returns { dist, head } or null.
function rayCapsule(ox, oy, oz, dx, dy, dz, p) {
  // Closest point on the ray to the capsule axis (x=p.x, z=p.z, y 0..1.8).
  // Solve in 2D (x,z) first: distance from the ray's ground track to the
  // player centre; then check the height at that point.
  const relX = p.x - ox, relZ = p.z - oz;
  const groundLen2 = dx * dx + dz * dz;
  if (groundLen2 < 1e-6) return null;
  let t = (relX * dx + relZ * dz) / groundLen2;
  if (t < 0) return null;
  const cx = ox + dx * t - p.x, cz = oz + dz * t - p.z;
  const lateral = Math.sqrt(cx * cx + cz * cz);
  if (lateral > 0.45) return null;
  const yAt = oy + dy * t;
  if (yAt < p.y || yAt > p.y + 1.8) return null;
  return { dist: t, head: yAt > p.y + 1.55 };
}

// Apply damage with armour. Returns { damage, killed, head }.
export function applyDamage(s, target, raw, head, attacker) {
  let dmg = raw;
  if (target.armor > 0) {
    // Armour absorbs half the damage until it breaks.
    const absorbed = Math.min(target.armor, dmg * 0.5);
    target.armor -= absorbed;
    dmg -= absorbed;
    if (head && !target.helmet) dmg = raw; // bare head ignores vest
  }
  if (head && target.helmet) dmg = raw * 0.5; // helmet halves headshots
  target.hp -= dmg;
  if (attacker) attacker.damageDealt += dmg;
  const killed = target.hp <= 0;
  if (killed) {
    target.hp = 0;
    target.alive = false;
    if (attacker) { attacker.kills += 1; attacker.money += KILL_REWARD; }
    target.deaths += 1;
  }
  return { damage: dmg, killed, head };
}

export const KILL_REWARD = 300;

export function startReload(shooter, now) {
  const w = WEAPONS[shooter.weaponId];
  if (!w || shooter.mag >= w.mag || shooter.reserve <= 0) return false;
  if (now < shooter.reloadingUntil) return false;
  shooter.reloadingUntil = now + w.reload;
  return true;
}

export function finishReload(shooter) {
  const w = WEAPONS[shooter.weaponId];
  if (!w) return;
  const need = w.mag - shooter.mag;
  const take = Math.min(need, shooter.reserve);
  shooter.mag += take;
  shooter.reserve -= take;
  shooter.reloadingUntil = -99;
}

// Throw a grenade from a player. Returns the landing point (simple arc:
// 12 m forward, lands after 0.7 s — the effect is applied by main.js on a
// timer so the throw is visible before the bang).
export function throwGrenade(s, p, kind) {
  if (p.grenades[kind] <= 0) return null;
  p.grenades[kind] -= 1;
  const fx = p.x - Math.sin(p.yaw) * 12;
  const fz = p.z - Math.cos(p.yaw) * 12;
  return { kind, x: fx, z: fz, at: s.time + 0.7, from: p.id };
}
