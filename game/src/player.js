// player.js — movement for the human player (and the shared step bots use).
// Acceleration + friction, no instant stops: a tactical pace, not a slide.
// Walk 4.5 m/s, crouch -40% speed and tighter spread, jump with gravity.
// Collision is AABB via map.moveCircle, per-axis so you slide along walls.

import { moveCircle } from './map.js';

export const WALK_SPEED = 4.5;
export const CROUCH_SPEED = 2.7;
export const PLAYER_RADIUS = 0.45;
const ACCEL = 40;      // m/s^2 toward the desired velocity
const FRICTION = 12;   // 1/s decay when no input
const GRAVITY = 18;
const JUMP_VEL = 6.5;

// input: { forward, back, left, right, crouch, jump } (booleans)
// dt: fixed step seconds. Mutates p.x/z/y/vx/vz and returns whether the
// player is moving (for spread) and airborne (for spread).
export function stepPlayer(p, input, dt) {
  const speed = input.crouch ? CROUCH_SPEED : WALK_SPEED;
  let ix = 0, iz = 0;
  if (input.forward) iz -= 1;
  if (input.back) iz += 1;
  if (input.left) ix -= 1;
  if (input.right) ix += 1;
  const len = Math.hypot(ix, iz);
  if (len > 0) { ix /= len; iz /= len; }
  // Rotate the input vector by the view yaw.
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wx = ix * cos - iz * sin;
  const wz = ix * sin + iz * cos;
  const tx = wx * speed, tz = wz * speed;

  // Accelerate toward the target velocity, then friction when idle.
  p.vx += (tx - p.vx) * Math.min(1, ACCEL * dt / speed * 4.5);
  p.vz += (tz - p.vz) * Math.min(1, ACCEL * dt / speed * 4.5);
  if (len === 0) {
    const f = Math.max(0, 1 - FRICTION * dt);
    p.vx *= f; p.vz *= f;
    if (Math.abs(p.vx) < 0.02) p.vx = 0;
    if (Math.abs(p.vz) < 0.02) p.vz = 0;
  }

  const moved = moveCircle(p.x, p.z, p.vx * dt, p.vz * dt, PLAYER_RADIUS);
  p.x = moved.x; p.z = moved.z;

  // Jump / gravity. The map is flat (y = 0 ground), so this is simple.
  if (input.jump && p.onGround) { p.vy = JUMP_VEL; p.onGround = false; }
  if (!p.onGround) {
    p.vy = (p.vy || 0) - GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
  }

  p.crouched = !!input.crouch;
  const moving = Math.hypot(p.vx, p.vz) > 0.5;
  return { moving, airborne: !p.onGround };
}

// Recoil recovery: bloom decays and the view pitch eases back after each
// shot. Called every fixed step for every shooter.
export function recoverRecoil(p, dt) {
  p.bloom = Math.max(0, p.bloom - 3.5 * dt);
  p.recoilPitch *= Math.max(0, 1 - 8 * dt);
  if (Math.abs(p.recoilPitch) < 0.0005) p.recoilPitch = 0;
}
