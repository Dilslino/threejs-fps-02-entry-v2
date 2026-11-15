// main.js — boot + fixed-step loop for GLASSHOUSE.
// The starter's proven shape, extended: fixed-step sim at 60 Hz
// (FIXED_STEP = 1/60), accumulator, max 5 steps/frame, spiral-of-death
// guard. Rendering is decoupled at display rate. Bot AI ticks at 10 Hz,
// staggered; LOS checks are throttled 150 ms per bot, staggered.
// One seeded RNG (mulberry32); screenshot mode seed = 7. Single state
// store (state.js). No per-frame allocation in hot loops: pre-allocated
// vectors, one reused Raycaster is avoided entirely (hitscan is analytic),
// pooled tracers in render.js.

import * as THREE from 'three';
import { createRenderer } from './render.js';
import { createState, makePlayer, resetRound, aliveOnTeam, playerById, WIN_ROUNDS, ROUND_TIME, FREEZE_TIME, PLANT_TIME, FUSE_TIME, WIN_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS, KILL_REWARD, PLANT_REWARD, TEAM } from './state.js';
import { makeRng } from './rng.js';
import { makeBus } from './events.js';
import { SPAWNS, SITES, hasLOS } from './map.js';
import { WEAPONS, ARMOR, GRENADES, tryFire, applyDamage, startReload, finishReload, throwGrenade, smokeBlocks } from './weapons.js';
import { stepPlayer, recoverRecoil } from './player.js';
import { makeBot, assignRoles, updateBot, callout, heardShot, TIERS } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const EYE = 1.62;

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') ? parseInt(params.get('shot'), 10) : 0;
const DEBUG = params.get('debug') === '1';
const PERF = params.get('perf') === '1';
const AUTOPLAY = params.get('autoplay') === '1';
// ?ff=N fast-forwards the sim N× (test only — lets a full bot-only match
// finish in minutes instead of ~20). Rendering still runs every frame.
const FF = Math.max(1, parseInt(params.get('ff') || '1', 10));

const rng = makeRng(SHOT ? 7 : (Date.now() % 2147483647));
const bus = makeBus();
const state = createState();
const canvas = document.getElementById('game');
const view = createRenderer(canvas);
let me = null; // assigned by createPlayers() below; audio closes over it
const audio = createAudio(bus, () => (me ? { x: me.x, z: me.z } : { x: 0, z: 0 }));

function createPlayers() {
  const list = [];
  const you = makePlayer('p0', 'YOU', TEAM.THORNS, false, null);
  you.isPlayer = true;
  you['owned_s6'] = true;
  list.push(you);
  const thornTiers = ['veteran', 'veteran', 'recruit', 'veteran'];
  for (let i = 0; i < 4; i++) {
    const b = makePlayer(`t${i + 1}`, `THORN-${i + 2}`, TEAM.THORNS, true, thornTiers[i]);
    makeBot(b, thornTiers[i], 'mid', null);
    list.push(b);
  }
  const keeperTiers = ['veteran', 'veteran', 'elite', 'veteran', 'recruit'];
  for (let i = 0; i < 5; i++) {
    const b = makePlayer(`k${i + 1}`, `KEEPER-${i + 1}`, TEAM.KEEPERS, true, keeperTiers[i]);
    makeBot(b, keeperTiers[i], 'siteA', null);
    list.push(b);
  }
  return list;
}
let players = [];
players = createPlayers();
me = players[0];

// HUD + audio wiring.
const hud = createHud(document, state, {
  onBuy: (key) => buyItem(key),
});
bus.on('shot', (e) => {
  // Bot hearing: every bot within 25 m hears the shot (direction only).
  for (const p of players) {
    if (p.bot && p.team !== e.team) heardShot(state, p, e);
  }
  hud.addPing(e.x, e.z, 'shot');
});
bus.on('plant', (e) => hud.addPing(SITES[e.site].x, SITES[e.site].z, 'plant'));

// ---- Input ----
const keys = {};
let mouseDown = false;
let locked = false;
let scoped = false;

canvas.addEventListener('click', () => {
  audio.resume();
  audio.startAmbient();
  if (!locked) {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* lock denied: keep rendering */ });
  }
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  document.getElementById('lock-prompt').style.display = locked ? 'none' : 'block';
});
document.addEventListener('mousemove', (e) => {
  if (!locked || !me.alive) return;
  me.yaw -= e.movementX * 0.0022 * (scoped ? 0.4 : 1);
  me.pitch -= e.movementY * 0.0022 * (scoped ? 0.4 : 1);
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
});
canvas.addEventListener('mousedown', (e) => {
  audio.resume();
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) { scoped = true; setScope(true); }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) { scoped = false; setScope(false); }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') startReload(me, state.time);
  if (e.code === 'KeyB' && state.phase === 'freeze') {
    hud.showBuy(true, me);
  }
  if (e.code === 'Escape') hud.showBuy(false, me);
  if (e.code === 'Tab') { e.preventDefault(); hud.showScoreboard(true); }
  if (e.code === 'KeyG') throwPlayerGrenade();
  if (e.code === 'Digit1') switchWeapon('s6');
  if (e.code === 'Digit2') switchWeapon('vx-9');
  if (e.code === 'Digit3') switchWeapon('ar-55');
  if (e.code === 'Digit4') switchWeapon('dm-8');
  // Buy-menu number keys.
  if (buyOpen) {
    const items = [...Object.keys(WEAPONS), ...Object.keys(ARMOR), ...Object.keys(GRENADES)];
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
    if (idx >= 0 && idx < items.length) buyItem(items[idx]);
  }
  if (e.code === 'KeyR' && state.phase === 'matchEnd') restartMatch();
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') hud.showScoreboard(false);
});
document.addEventListener('wheel', (e) => {
  const order = ['s6', 'vx-9', 'ar-55', 'dm-8'];
  const owned = order.filter((id) => id === me.weaponId || (me['owned_' + id]));
  if (!owned.length) return;
  let i = owned.indexOf(me.weaponId);
  i = (i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length;
  switchWeapon(owned[i]);
}, { passive: true });

let buyOpen = false;
const _showBuy = hud.showBuy;
hud.showBuy = (show, p) => { buyOpen = show; _showBuy(show, p); };

function setScope(on) {
  const w = WEAPONS[me.weaponId];
  me.scoped = on && w && w.scoped;
  view.camera.fov = me.scoped ? 30 : 75;
  view.camera.updateProjectionMatrix();
}

function switchWeapon(id) {
  const w = WEAPONS[id];
  if (!w || !me['owned_' + id]) return;
  if (me.weaponId === id) return;
  me['mag_' + me.weaponId] = me.mag;
  me['res_' + me.weaponId] = me.reserve;
  me.weaponId = id;
  me.mag = me['mag_' + id] ?? w.mag;
  me.reserve = me['res_' + id] ?? w.reserve;
  me.reloadingUntil = -99;
  setScope(false);
}

function buyItem(key) {
  if (state.phase !== 'freeze' || !me.alive) return;
  const w = WEAPONS[key];
  if (w) {
    if (me['owned_' + key]) { switchWeapon(key); hud.markBuyDirty(); return; }
    if (me.money < w.price) return;
    // Stash the current weapon's ammo before switching.
    me['mag_' + me.weaponId] = me.mag;
    me['res_' + me.weaponId] = me.reserve;
    me.money -= w.price;
    me.weaponId = key;
    me.mag = w.mag; me.reserve = w.reserve;
    me['owned_' + key] = true;
    hud.markBuyDirty();
    return;
  }
  const a = ARMOR[key];
  if (a) {
    if (me.money < a.price || me.armor > 0) return;
    me.money -= a.price; me.armor = a.armor; me.helmet = a.helmet;
    hud.markBuyDirty();
    return;
  }
  const g = GRENADES[key];
  if (g) {
    if (me.money < g.price) return;
    me.money -= g.price; me.grenades[g.id] += 1;
    hud.markBuyDirty();
  }
}

function throwPlayerGrenade() {
  if (!me.alive || state.phase !== 'round') return;
  const kind = me.grenades.flash ? 'flash' : me.grenades.smoke ? 'smoke' : me.grenades.frag ? 'frag' : null;
  if (!kind) return;
  const g = throwGrenade(state, me, kind);
  if (g) pendingGrenades.push(g);
}

// ---- Round flow ----
function spawnAll() {
  for (const p of players) {
    const spawn = SPAWNS[p.team][players.filter((q) => q.team === p.team).indexOf(p)];
    p.x = spawn.x; p.y = 0; p.z = spawn.z; p.yaw = spawn.yaw; p.pitch = 0;
    p.vx = 0; p.vz = 0; p.vy = 0; p.onGround = true;
    p.crouched = false;
    if (p.bot) { p.bot.route = []; p.bot.routeIdx = 0; p.bot.state = 'advance'; p.bot.visible = null; p.bot.lastSeen = null; }
  }
}

function startRound() {
  resetRound(state);
  spawnAll();
  assignRoles(state, rng);
  state.roundStartMoney = me.money;
  // Player starts each round with the S6 unless they own more.
  if (!me['owned_ar-55'] && !me['owned_vx-9'] && !me['owned_dm-8']) {
    me.weaponId = 's6'; me.mag = 12; me.reserve = 36;
  }
  hud.banner(`ROUND ${state.round}`, state.round === 1 ? 'Thorns attack — plant the Canister' : '');
}

function endRound(winner, reason) {
  if (state.phase !== 'round') return;
  state.phase = 'roundEnd';
  state.phaseT = 0;
  state.roundWinner = winner;
  state.roundEndReason = reason;
  state.score[winner] += 1;
  // Economy: winners $3,250, losers $1,900 (+$500 loss-streak bonus, max 2).
  for (const p of players) {
    if (p.team === winner) {
      p.money += WIN_REWARD;
      state.lossStreak[p.team] = 0;
    } else {
      state.lossStreak[p.team] += 1;
      p.money += LOSS_REWARD + Math.min(2, state.lossStreak[p.team] - 1) * LOSS_STREAK_BONUS;
    }
  }
  const reasonText = {
    elimination: 'Enemy team eliminated',
    detonation: 'Canister detonated',
    defused: 'Canister defused',
    timeout: 'Time expired — no plant',
  }[reason] || reason;
  hud.banner(winner === 'thorns' ? 'THORNS WIN THE ROUND' : 'KEEPERS WIN THE ROUND', reasonText);
  audio.roundSting(winner === 'thorns');
  if (state.score[winner] >= WIN_ROUNDS || state.round >= 13) {
    state.matchWinner = winner;
    state.phase = 'matchEnd';
    hud.matchEnd();
  }
}

function restartMatch() {
  state.score = { thorns: 0, keepers: 0 };
  state.round = 1;
  state.matchWinner = null;
  for (const p of players) {
    p.money = 800; p.kills = 0; p.deaths = 0; p.damageDealt = 0; p.shots = 0; p.hits = 0;
    p.weaponId = 's6'; p.mag = 12; p.reserve = 36;
    p.armor = 0; p.helmet = false;
    p.grenades = { flash: 0, smoke: 0, frag: 0 };
    delete p.owned_vx_9; delete p['owned_vx-9']; delete p['owned_ar-55']; delete p['owned_dm-8'];
  }
  hud.hideMatchEnd();
  startRound();
}

// ---- Combat helpers ----
const pendingGrenades = []; // { kind, x, z, at, from }

function resolveGrenades() {
  for (let i = pendingGrenades.length - 1; i >= 0; i--) {
    const g = pendingGrenades[i];
    if (state.time < g.at) continue;
    pendingGrenades.splice(i, 1);
    if (g.kind === 'smoke') {
      state.smokes.push({ x: g.x, z: g.z, until: state.time + 12 });
      view.spawnPuff({ x: g.x, y: 1, z: g.z }, 0xC8C8C8);
    } else if (g.kind === 'flash') {
      state.flashes.push({ x: g.x, y: 1.5, z: g.z, at: state.time });
      for (const p of players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (d > 14) continue;
        if (!hasLOS(g.x, g.z, p.x, p.z)) continue;
        // Facing the flash blinds longer.
        const facing = Math.cos(p.yaw - Math.atan2(-(g.x - p.x), -(g.z - p.z)));
        p.flashUntil = state.time + (facing > 0 ? 2.5 : 1.0) * (1 - d / 16);
      }
    } else if (g.kind === 'frag') {
      view.spawnPuff({ x: g.x, y: 1, z: g.z }, 0xFF8A3D);
      for (const p of players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - g.x, p.z - g.z);
        if (d > 4) continue;
        const from = playerById(state, g.from);
        applyDamage(state, p, 60 * (1 - d / 4), false, from);
        if (p === me) hud.damageFlash();
      }
    }
  }
}

function playerShoot(moving, airborne) {
  if (!me.alive || state.phase !== 'round') return;
  const res = tryFire(state, me, state.time, rng, moving, airborne);
  if (!res) return;
  if (res.empty) { audio.reload(); startReload(me, state.time); return; }
  if (res.flashed) return;
  // Muzzle flash at the camera + tracer to the impact point.
  const flashPos = {
    x: me.x - Math.sin(me.yaw) * 0.6,
    y: me.y + EYE - 0.15,
    z: me.z - Math.cos(me.yaw) * 0.6,
  };
  view.muzzleFlash(flashPos);
  view.spawnTracer(res.origin, res.end, res.weapon.tracer);
  bus.emit('shot', { x: me.x, z: me.z, team: me.team, weapon: me.weaponId });
  if (res.hit) {
    const w = res.weapon;
    const dmg = w.damage * (res.hit.head ? w.headMult : 1);
    const out = applyDamage(state, res.hit.target, dmg, res.hit.head, me);
    me.hits += 1;
    hud.hitmarker(out.killed);
    view.spawnPuff(res.end, res.hit.head ? 0xFF5A4E : 0xD8C9A8);
    bus.emit('hit', { shooter: me, target: res.hit.target, killed: out.killed, head: res.hit.head });
    if (out.killed) {
      state.killFeed.unshift({ text: `YOU ▸ ${res.hit.target.name}`, t: state.time });
      if (state.killFeed.length > 5) state.killFeed.length = 5;
    }
  } else {
    view.spawnPuff(res.end, 0xD8C9A8);
  }
}

function readInput() {
  const input = {
    forward: !!keys.KeyW, back: !!keys.KeyS,
    left: !!keys.KeyA, right: !!keys.KeyD,
    crouch: !!keys.ControlLeft || !!keys.ControlRight,
    jump: !!keys.Space,
  };
  return input;
}

// ---- Per-step simulation ----
let stepCount = 0;
function step(dt) {
  state.time += dt;
  state.phaseT += dt;
  stepCount++;

  // Bloom + recoil recovery for every shooter.
  for (const p of players) recoverRecoil(p, dt);

  if (state.phase === 'freeze') {
    state.freezeTimer -= dt;
    if (state.freezeTimer <= 0) {
      state.phase = 'round';
      state.phaseT = 0;
      hud.banner('ROUND START', '');
      hud.showBuy(false, me);
    }
  } else if (state.phase === 'round') {
    state.roundTimer -= dt;
    // Fuse countdown.
    if (state.canister.state === 'planted') {
      state.canister.fuse -= dt;
      if (Math.ceil(state.canister.fuse) !== Math.ceil(state.canister.fuse + dt)) {
        audio.beep(1200);
      }
      if (state.canister.fuse <= 0) {
        state.canister.state = 'detonated';
        endRound('thorns', 'detonation');
      }
    }
    if (state.roundTimer <= 0 && state.canister.state !== 'planted') {
      endRound('keepers', 'timeout');
    }
    // Canister drop + pickup. If the carrier dies, the canister drops
    // where they fell; any alive Thorn who walks over it picks it up and
    // becomes the new carrier. Without this the round is unwinnable for
    // the Thorns the moment the first carrier dies.
    const can = state.canister;
    if (can.state === 'carried' && can.carrierId) {
      const carrier = playerById(state, can.carrierId);
      if (carrier && !carrier.alive) {
        can.state = 'dropped';
        can.x = carrier.x; can.z = carrier.z;
        can.carrierId = null;
        callout(state, carrier, 'canister down — pick it up');
      }
    }
    if (can.state === 'dropped') {
      for (const p of players) {
        if (p.team !== 'thorns' || !p.alive) continue;
        if (Math.hypot(p.x - can.x, p.z - can.z) < 1.5) {
          can.state = 'carried';
          can.carrierId = p.id;
          if (p.bot) {
            p.bot.role = 'carrier'; p.bot.site = 'A';
            p.bot.state = 'advance'; p.bot.route = [];
          }
          callout(state, p, 'got the canister');
          break;
        }
      }
    }
    // Player plant channel (hold E in the zone while carrying).
    // Guarded to the human carrier ONLY: a bot carrier's channel runs
    // in updateBot, and the else-branch below would reset its progress
    // to 0 every step, so a bot carrier could never plant.
    if (state.canister.carrierId === me.id) {
      if (keys.KeyE && me.alive && state.canister.state === 'carried') {
        const site = nearSite(me);
        if (site) {
          state.canister.plantProgress += dt / PLANT_TIME;
          state.canister.plantingId = me.id;
          if (state.canister.plantProgress >= 1) {
            state.canister.state = 'planted';
            state.canister.site = site;
            state.canister.fuse = FUSE_TIME;
            state.canister.plantProgress = 0;
            me.money += PLANT_REWARD;
            callout(state, me, `canister down ${site}`);
            bus.emit('plant', { site });
            // Tell every bot the plant happened (whole-map beep).
            for (const p of players) {
              if (p.bot) {
                const sitePos = SITES[site];
                p.bot.heard = { x: sitePos.x, z: sitePos.z, t: state.time, kind: 'plant' };
              }
            }
          }
        } else {
          state.canister.plantProgress = 0;
        }
      } else {
        state.canister.plantProgress = 0;
      }
    }

    // Player movement + shooting.
    if (me.alive && !AUTOPLAY) {
      const input = readInput();
      const mv = stepPlayer(me, input, dt);
      if (mouseDown) playerShoot(mv.moving, mv.airborne);
      if (state.time >= me.reloadingUntil && me.reloadingUntil > 0) finishReload(me);
      // Footsteps, timed to stride.
      if (mv.moving && stepCount % 24 === 0) audio.step();
    }

    // Bots.
    for (const p of players) {
      if (p.bot && p.alive) updateBot(state, p, dt, rng, bus);
    }

    resolveGrenades();

    // Round end by elimination.
    if (state.phase === 'round') {
      if (aliveOnTeam(state, 'keepers') === 0) endRound('thorns', 'elimination');
      else if (aliveOnTeam(state, 'thorns') === 0) endRound('keepers', 'elimination');
    }
  } else if (state.phase === 'roundEnd') {
    if (state.phaseT > 4) {
      if (state.matchWinner) { state.phase = 'matchEnd'; }
      else { state.round += 1; startRound(); }
    }
  }
}

function nearSite(p) {
  for (const key of ['A', 'B']) {
    if (Math.abs(p.x - SITES[key].x) < 2 && Math.abs(p.z - SITES[key].z) < 2) return key;
  }
  return null;
}

// ---- Render + main loop ----
let last = performance.now();
let acc = 0;
let fpsFrames = 0, fpsTime = 0, fps = 0;
let simMs = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - last;
  last = now;
  const dt = Math.min(0.1, dtMs / 1000);

  if (!SHOT) {
    const t0 = performance.now();
    acc += dt * FF;
    let n = 0;
    const maxSteps = 5 * FF;
    while (acc >= FIXED_STEP && n < maxSteps) {
      step(FIXED_STEP);
      acc -= FIXED_STEP;
      n++;
    }
    if (n === maxSteps) acc = 0; // spiral-of-death guard
    simMs = performance.now() - t0;
  }

  // Camera follows the player (first person), or the staged overview.
  if (SHOT === 4) {
    view.setCamera(0, 9, 20, 0, -0.35);
  } else {
    view.setCamera(me.x, me.y + EYE - (me.crouched ? 0.4 : 0), me.z, me.yaw, me.pitch + me.recoilPitch);
  }
  view.viewModel.visible = SHOT !== 4 && me.alive;
  view.syncPlayers(players);
  // Canister blink.
  const c = state.canister;
  view.setCanister(
    c.state === 'planted' ? SITES[c.site].x : c.state === 'dropped' ? c.x : me.x,
    c.state === 'planted' ? SITES[c.site].z : c.state === 'dropped' ? c.z : me.z,
    c.state === 'planted' || c.state === 'dropped',
    c.state === 'planted' && Math.floor(state.time * 2) % 2 === 0,
  );
  if (!SHOT) view.update(dt, state.time);
  view.syncSmokes(state.smokes, state.time);
  view.renderer.render(view.scene, view.camera);
  hud.update(me);

  // Perf overlay.
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
  if (PERF) {
    const el = document.getElementById('perf-overlay');
    el.style.display = 'block';
    el.textContent = `fps ${fps} · draw calls ${view.renderer.info.render.calls} · sim ${simMs.toFixed(1)} ms · ${players.filter((p) => p.alive).length} alive`;
  }
  if (DEBUG) {
    const el = document.getElementById('debug-overlay');
    el.style.display = 'block';
    el.textContent = players.filter((p) => p.bot).map((p) =>
      `${p.name} [${p.bot.tier}] ${p.bot.state} ${p.bot.role || ''} hp${Math.round(p.hp)} ${p.bot.visible ? 'ENGAGING ' + p.bot.visible.name : ''}`).join('\n');
  }
}

// ---- Screenshot staging (?shot=1..4) ----
// Fixed seed 7, scripted bot positions, frozen timer, scripted shot in
// shots 1–2. The same game code, same renderer, same HUD — a staged
// moment, not a mockup.
function stageShot(n) {
  startRound();
  // Freeze the sim: place everyone, then stop stepping (frame() skips
  // step() when SHOT is set).
  if (n === 1) {
    // Mid-round firefight on the Central Walk.
    state.phase = 'round';
    state.roundTimer = 47;
    state.score = { thorns: 3, keepers: 2 };
    me.money = 2400;
    me.weaponId = 'ar-55'; me.mag = 17; me.reserve = 75;
    me.x = 0; me.z = 14; me.yaw = 0; me.pitch = 0;
    const k1 = players.find((p) => p.id === 'k1');
    k1.x = 2.5; k1.z = -4; k1.yaw = Math.PI;
    const k2 = players.find((p) => p.id === 'k2');
    k2.x = 6; k2.z = 1; k2.yaw = Math.PI * 0.75;
    const t2 = players.find((p) => p.id === 't1');
    t2.x = -3; t2.z = 10; t2.yaw = 0;
    // Scripted shot: aim at k1 and fire once (muzzle flash + tracer).
    me.yaw = Math.atan2(-(k1.x - me.x), -(k1.z - me.z));
    const res = tryFire(state, me, state.time, rng, false, false);
    if (res && !res.empty) {
      view.muzzleFlash({ x: me.x - Math.sin(me.yaw) * 0.6, y: me.y + EYE - 0.15, z: me.z - Math.cos(me.yaw) * 0.6 });
      view.spawnTracer(res.origin, res.end, res.weapon.tracer);
      // Let the flash die (50 ms) while the tracer is still visible.
      view.update(0.06, state.time);
    }
  } else if (n === 2) {
    // Site A plant moment: Canister down, fuse running, smoke drifting.
    state.phase = 'round';
    state.roundTimer = 32;
    state.score = { thorns: 2, keepers: 2 };
    state.canister.state = 'planted';
    state.canister.site = 'A';
    state.canister.fuse = 32;
    state.canister.carrierId = null;
    state.smokes.push({ x: -21, z: -3, until: state.time + 12 });
    me.money = 1800;
    me.weaponId = 'ar-55'; me.mag = 20; me.reserve = 50;
    me.x = -17; me.z = 4; me.yaw = Math.atan2(-(-24 - me.x), -(0 - me.z));
    const k3 = players.find((p) => p.id === 'k3');
    k3.x = -22; k3.z = -4; k3.yaw = Math.PI * 0.5;
    const t2 = players.find((p) => p.id === 't1');
    t2.x = -18; t2.z = 6; t2.yaw = 0;
    state.killFeed.unshift({ text: 'THORN-3 ▸ KEEPER-2', t: state.time });
    state.callouts.unshift({ text: 'THORN-2: rotating B', t: state.time });
    // Scripted shot toward the rotating Keeper.
    me.yaw = Math.atan2(-(k3.x - me.x), -(k3.z - me.z));
    const res = tryFire(state, me, state.time, rng, false, false);
    if (res && !res.empty) {
      view.muzzleFlash({ x: me.x - Math.sin(me.yaw) * 0.6, y: me.y + EYE - 0.15, z: me.z - Math.cos(me.yaw) * 0.6 });
      view.spawnTracer(res.origin, res.end, res.weapon.tracer);
      // Let the flash die (50 ms) while the tracer is still visible.
      view.update(0.06, state.time);
    }
  } else if (n === 3) {
    // Freeze time: buy menu open, AR-55 highlighted.
    state.phase = 'freeze';
    state.freezeTimer = 3;
    state.round = 5;
    state.score = { thorns: 2, keepers: 2 };
    me.money = 4150;
    me.weaponId = 'ar-55'; me.mag = 25; me.reserve = 75;
    me['owned_ar-55'] = true;
    me.x = 0; me.z = 18; me.yaw = 0;
    hud.showBuy(true, me);
    buyOpen = true;
  } else if (n === 4) {
    // High spawn-side view down the map: all three lanes, both sites.
    state.phase = 'round';
    state.roundTimer = 85;
    state.score = { thorns: 0, keepers: 0 };
    me.x = 0; me.z = 18; me.yaw = 0;
    const t1 = players.find((p) => p.id === 't1');
    t1.x = -2; t1.z = 12; t1.yaw = 0;
    const t2 = players.find((p) => p.id === 't2');
    t2.x = 2; t2.z = 10; t2.yaw = 0;
    const t3 = players.find((p) => p.id === 't3');
    t3.x = -6; t3.z = 14; t3.yaw = 0;
    const t4 = players.find((p) => p.id === 't4');
    t4.x = 6; t4.z = 14; t4.yaw = 0;
  }
  hud.update(me);
  // No round banner in a staged shot — it would cover the firefight.
  const banner = document.getElementById('banner');
  if (banner) banner.style.display = 'none';
  window.__shotReady = true;
}

// ---- Boot ----
state.players = players;
// Test handle (also used by the finalist review to inspect state).
window.__glasshouse = { state, players, version: 'glasshouse-v2' };
if (AUTOPLAY) {
  // Bot-only match: the player gets a bot brain too.
  makeBot(me, 'veteran', 'mid', null);
}
startRound();
if (SHOT) {
  stageShot(SHOT);
} else {
  requestAnimationFrame(frame);
  // In shot mode the frame loop still runs for rendering, but step() is
  // skipped — the staged frame is static. Start it now.
}
// Shot mode still needs one render pass + the ready flag; the loop above
// only starts in non-shot mode, so start it here too.
if (SHOT) {
  requestAnimationFrame(frame);
}
