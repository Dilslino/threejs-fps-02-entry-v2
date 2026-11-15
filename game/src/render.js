// render.js — the three.js scene for GLASSHOUSE.
// Bright midday sun, flat stylised colour, no textures: flat colour reads
// better in a 1280x720 still than noisy textures. One warm directional
// "sun" + cool hemisphere fill, very subtle fog for depth. No real-time
// shadow maps (perf) — fake contact shadows are dark decals under the
// planters. Glass dome: low-opacity panels, depthWrite off, drawn after
// opaque geometry; the opaque frame carries the silhouette even if the
// glass misbehaves. Draw calls stay under 100: shared unit-box geometry,
// one material per kind, players as two boxes each, pooled tracers.

import * as THREE from 'three';
import { BOXES, SITES } from './map.js';

const PALETTE = {
  grass: 0x6fae5f, gravel: 0xD9C9A8, wall: 0xEAF2EC, glass: 0xBFE0EA,
  bed: 0x3E7A4E, hedge: 0x2F6B3A, bench: 0x8A6B4A, pot: 0xC65D21,
  trunk: 0x6B4A2F, fountain: 0xE8E8E8, water: 0x2E8FA3, post: 0xF5F5F0,
  domeFrame: 0xF2F2EC, thorn: 0xE4572E, keeper: 0x4A90D9,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(1280, 720, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7FB3D5);
  scene.fog = new THREE.FogExp2(0xA8C8DC, 0.008);

  const camera = new THREE.PerspectiveCamera(75, 1280 / 720, 0.1, 200);
  camera.rotation.order = 'YXZ';

  // Midday sun: warm, high angle, short shadows (no shadow maps).
  const sun = new THREE.DirectionalLight(0xFFF2D9, 2.4);
  sun.position.set(20, 35, 12);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xBFD9E8, 0x5E7A4E, 1.1);
  scene.add(hemi);
  // Site lamps: one warm lamp at A, one cool lamp at B.
  const lampA = new THREE.PointLight(0xFFB347, 12, 14);
  lampA.position.set(SITES.A.x, 3, SITES.A.z);
  scene.add(lampA);
  const lampB = new THREE.PointLight(0x7FD4E8, 12, 14);
  lampB.position.set(SITES.B.x, 3, SITES.B.z);
  scene.add(lampB);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mats = {};
  function mat(color, opts) {
    const key = color + JSON.stringify(opts || {});
    if (!mats[key]) {
      mats[key] = new THREE.MeshLambertMaterial({ color, ...(opts || {}) });
    }
    return mats[key];
  }

  // ---- Floor: grass with a gravel central walk and cross paths ----
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 46),
    mat(PALETTE.grass),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const walk = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 46),
    mat(PALETTE.gravel),
  );
  walk.rotation.x = -Math.PI / 2; walk.position.y = 0.01;
  scene.add(walk);
  const cross = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 6),
    mat(PALETTE.gravel),
  );
  cross.rotation.x = -Math.PI / 2; cross.position.y = 0.01;
  scene.add(cross);

  // ---- Walls: pale glass panels in a white frame ----
  const wallMat = new THREE.MeshLambertMaterial({
    color: PALETTE.glass, transparent: true, opacity: 0.35, depthWrite: false,
  });
  const frameMat = mat(PALETTE.wall);
  function wallPanel(w, h, x, y, z, ry) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    p.position.set(x, y, z); p.rotation.y = ry;
    scene.add(p);
    const top = new THREE.Mesh(boxGeo, frameMat);
    top.scale.set(w, 0.25, 0.25); top.position.set(x, h, z);
    if (ry !== 0) top.rotation.y = ry;
    scene.add(top);
  }
  wallPanel(62, 5, 0, 2.5, -22.5, 0);
  wallPanel(62, 5, 0, 2.5, 22.5, Math.PI);
  wallPanel(46, 5, -30.5, 2.5, 0, Math.PI / 2);
  wallPanel(46, 5, 30.5, 2.5, 0, -Math.PI / 2);

  // ---- Map boxes (one mesh per box, shared geometry/material) ----
  const kindColor = {
    bed: PALETTE.bed, hedge: PALETTE.hedge, bench: PALETTE.bench,
    pot: PALETTE.pot, trunk: PALETTE.trunk, fountain: PALETTE.fountain,
    pond: 0x3A6B7A, post: PALETTE.post, wall: PALETTE.wall,
  };
  for (const b of BOXES) {
    if (b.kind === 'wall') continue; // walls are the glass panels above
    const m = new THREE.Mesh(boxGeo, mat(kindColor[b.kind] || 0x888888));
    m.scale.set(b.x1 - b.x0, b.h, b.z1 - b.z0);
    m.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
    scene.add(m);
  }

  // ---- Glass dome (north-centre): transparent hemisphere + frame ring ----
  const domeGlass = new THREE.Mesh(
    new THREE.SphereGeometry(9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({
      color: PALETTE.glass, transparent: true, opacity: 0.22,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  domeGlass.position.set(0, 0, -14);
  scene.add(domeGlass);
  const domeRing = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.25, 8, 32),
    mat(PALETTE.domeFrame),
  );
  domeRing.rotation.x = Math.PI / 2;
  domeRing.position.set(0, 0.1, -14);
  scene.add(domeRing);
  const domeTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    mat(0xFFD27A),
  );
  domeTop.position.set(0, 9, -14);
  scene.add(domeTop);

  // ---- Fountain: basin + water disc + centre column ----
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 1.9, 0.5, 20),
    mat(0xD8D8D8),
  );
  basin.position.set(0, 0.25, -2);
  scene.add(basin);
  const fwater = new THREE.Mesh(
    new THREE.CircleGeometry(1.6, 20),
    new THREE.MeshLambertMaterial({ color: PALETTE.water }),
  );
  fwater.rotation.x = -Math.PI / 2; fwater.position.set(0, 0.52, -2);
  scene.add(fwater);

  // ---- Lily pond water (the pond box is the low wall) ----
  const pondWater = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 10),
    new THREE.MeshLambertMaterial({ color: PALETTE.water }),
  );
  pondWater.rotation.x = -Math.PI / 2; pondWater.position.set(21, 1.02, 0);
  scene.add(pondWater);

  // ---- Site markers: emissive floor rings, amber A / aqua B ----
  const markers = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.0, 32),
      new THREE.MeshBasicMaterial({ color: site.color, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    scene.add(ring);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 32),
      new THREE.MeshBasicMaterial({
        color: site.color, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(site.x, 0.015, site.z);
    scene.add(disc);
    markers[key] = ring;
  }

  // ---- View model: a chunky readable low-poly rifle (~7 boxes) ----
  const vm = new THREE.Group();
  const vmMat = new THREE.MeshLambertMaterial({ color: 0x2B2B2B });
  const vmMat2 = new THREE.MeshLambertMaterial({ color: 0x4A4A4A });
  function vmBox(w, h, d, x, y, z, m) {
    const b = new THREE.Mesh(boxGeo, m || vmMat);
    b.scale.set(w, h, d); b.position.set(x, y, z);
    vm.add(b);
  }
  vmBox(0.09, 0.12, 0.55, 0, 0, -0.35);          // receiver
  vmBox(0.05, 0.05, 0.4, 0, 0.01, -0.75);        // barrel
  vmBox(0.07, 0.09, 0.3, 0, -0.01, -0.6, vmMat2); // handguard
  vmBox(0.06, 0.18, 0.1, 0, -0.14, -0.3);        // magazine
  vmBox(0.08, 0.1, 0.2, 0, -0.01, 0.05);         // stock
  vmBox(0.03, 0.06, 0.12, 0, 0.09, -0.35);       // sight
  vmBox(0.05, 0.12, 0.07, 0, -0.1, -0.12);       // grip
  vm.position.set(0.28, -0.24, -0.5);
  camera.add(vm);
  scene.add(camera);

  // ---- Muzzle flash: sprite + point light, 50 ms ----
  const flashLight = new THREE.PointLight(0xFFD27A, 0, 8);
  scene.add(flashLight);
  const flashQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({
      color: 0xFFD27A, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  scene.add(flashQuad);

  // ---- Tracers: pooled additive lines, 80 ms life, no allocation ----
  const tracerPool = [];
  for (let i = 0; i < 16; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xFFE08A, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerIdx = 0;
  function spawnTracer(from, to, color) {
    const t = tracerPool[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracerPool.length;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xFFE08A);
    t.line.material.opacity = 0.9;
    t.life = 0.08;
  }

  // ---- Impact puffs: pooled small quads that expand and fade ----
  const puffPool = [];
  for (let i = 0; i < 12; i++) {
    const q = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.4),
      new THREE.MeshBasicMaterial({
        color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false,
      }),
    );
    scene.add(q);
    puffPool.push({ mesh: q, life: 0 });
  }
  let puffIdx = 0;
  function spawnPuff(pos, color) {
    const p = puffPool[puffIdx];
    puffIdx = (puffIdx + 1) % puffPool.length;
    p.mesh.position.set(pos.x, pos.y, pos.z);
    p.mesh.material.color.setHex(color || 0xD8C9A8);
    p.mesh.material.opacity = 0.8;
    p.mesh.scale.setScalar(0.5);
    p.life = 0.35;
  }

  // ---- Players: two boxes each (body + head), team-coloured ----
  const playerMeshes = new Map();
  function syncPlayer(p) {
    let g = playerMeshes.get(p.id);
    if (!g) {
      g = new THREE.Group();
      const body = new THREE.Mesh(boxGeo, mat(p.team === 'thorns' ? PALETTE.thorn : PALETTE.keeper));
      body.scale.set(0.7, 1.1, 0.4); body.position.y = 0.85;
      const head = new THREE.Mesh(boxGeo, mat(0xE8C9A0));
      head.scale.set(0.4, 0.4, 0.4); head.position.y = 1.65;
      // Warm rim for enemies, cool trim for friendlies: a thin emissive
      // band on the body so teams read at a glance.
      const band = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
        color: p.team === 'thorns' ? 0xFF8A3D : 0x7FB8F0,
      }));
      band.scale.set(0.72, 0.12, 0.42); band.position.y = 1.25;
      g.add(body); g.add(head); g.add(band);
      g.userData.body = body; g.userData.head = head;
      scene.add(g);
      playerMeshes.set(p.id, g);
    }
    g.visible = p.alive;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw + Math.PI;
    // Crouch: squash the body.
    const sy = p.crouched ? 0.7 : 1;
    g.userData.body.scale.y = 1.1 * sy;
    g.userData.body.position.y = 0.85 * sy;
    g.userData.head.position.y = p.crouched ? 1.15 : 1.65;
  }

  // ---- Canister: small blinking box at the plant site ----
  const canister = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xFFD27A }));
  canister.scale.set(0.4, 0.3, 0.4);
  canister.visible = false;
  scene.add(canister);

  let flashT = 0;
  return {
    renderer, scene, camera,
    viewModel: vm,
    setCamera(x, y, z, yaw, pitch) {
      camera.position.set(x, y, z);
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    },
    syncPlayers(players) {
      for (const p of players) {
        if (p.isPlayer) continue; // the player is the camera
        syncPlayer(p);
      }
    },
    spawnTracer, spawnPuff,
    muzzleFlash(pos) {
      flashQuad.position.copy(pos);
      flashQuad.material.opacity = 0.95;
      flashLight.position.copy(pos);
      flashLight.intensity = 20;
      flashT = 0.05;
    },
    setCanister(x, z, visible, blink) {
      canister.visible = visible;
      if (visible) {
        canister.position.set(x, 0.15, z);
        canister.material.color.setHex(blink ? 0xFF3B30 : 0xFFD27A);
      }
    },
    update(dt, time) {
      // Tracer + puff decay.
      for (const t of tracerPool) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
        }
      }
      for (const p of puffPool) {
        if (p.life > 0) {
          p.life -= dt;
          p.mesh.material.opacity = Math.max(0, p.life / 0.35) * 0.8;
          p.mesh.scale.setScalar(p.mesh.scale.x + dt * 2);
          p.mesh.lookAt(camera.position);
        }
      }
      if (flashT > 0) {
        flashT -= dt;
        if (flashT <= 0) {
          flashQuad.material.opacity = 0;
          flashLight.intensity = 0;
        }
      }
      // Site rings pulse gently so the sites read from across the map.
      const pulse = 0.75 + Math.sin(time * 2) * 0.25;
      markers.A.material.opacity = pulse;
      markers.B.material.opacity = pulse;
    },
  };
}
