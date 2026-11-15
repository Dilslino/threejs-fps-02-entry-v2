// map.js — GLASSHOUSE, a botanical conservatory in bright midday sun.
// Playable area ~60 x 45 m. x = east/west (-30..+30), z = north/south
// (-22..+22). South (z +22) is the Thorn spawn, north (z -22) the Keeper
// spawn. Three lanes: Fern House (west, close quarters), Central Walk
// (middle, the long axis), Pond Hall (east, medium range).
// Every sightline longer than ~25 m is broken by at least one piece of
// cover; every lane has two routes in/out. All cover is axis-aligned boxes,
// so collision is cheap 2D AABB work and the map reads as clean geometry.

// A box: { x0, z0, x1, z1, h, kind } — kind tells render.js what to draw.
export const BOXES = [
  // ---- Outer walls (h 5) ----
  { x0: -31, z0: -23, x1: 31, z1: -22, h: 5, kind: 'wall' }, // north
  { x0: -31, z0: 22, x1: 31, z1: 23, h: 5, kind: 'wall' },   // south
  { x0: -31, z0: -23, x1: -30, z1: 23, h: 5, kind: 'wall' }, // west
  { x0: 30, z0: -23, x1: 31, z1: 23, h: 5, kind: 'wall' },   // east

  // ---- Central Walk ----
  { x0: -1.5, z0: -3.5, x1: 1.5, z1: -0.5, h: 1.2, kind: 'fountain' }, // fountain (0,-2)
  { x0: -3.3, z0: -8.3, x1: -2.7, z1: -7.7, h: 5, kind: 'trunk' },     // palm (-3,-8)
  { x0: 2.7, z0: -8.3, x1: 3.3, z1: -7.7, h: 5, kind: 'trunk' },       // palm (3,-8)
  { x0: -3.3, z0: 7.7, x1: -2.7, z1: 8.3, h: 5, kind: 'trunk' },       // palm (-3,8)
  { x0: 2.7, z0: 7.7, x1: 3.3, z1: 8.3, h: 5, kind: 'trunk' },         // palm (3,8)
  { x0: -7, z0: -14.4, x1: -5, z1: -13.6, h: 0.6, kind: 'bench' },     // bench west-north
  { x0: 5, z0: -14.4, x1: 7, z1: -13.6, h: 0.6, kind: 'bench' },       // bench east-north
  { x0: -7, z0: 9.6, x1: -5, z1: 10.4, h: 0.6, kind: 'bench' },        // bench west-south
  { x0: 5, z0: 9.6, x1: 7, z1: 10.4, h: 0.6, kind: 'bench' },          // bench east-south
  // Dome door frame posts (gap at x +/-4, z 0 is the door)
  { x0: 3.6, z0: -1.4, x1: 4.4, z1: -0.6, h: 4, kind: 'post' },
  { x0: 3.6, z0: 0.6, x1: 4.4, z1: 1.4, h: 4, kind: 'post' },
  { x0: -4.4, z0: -1.4, x1: -3.6, z1: -0.6, h: 4, kind: 'post' },
  { x0: -4.4, z0: 0.6, x1: -3.6, z1: 1.4, h: 4, kind: 'post' },
  // Dome frame posts (north-centre dome)
  { x0: -6.4, z0: -14.4, x1: -5.6, z1: -13.6, h: 6, kind: 'post' },
  { x0: 5.6, z0: -14.4, x1: 6.4, z1: -13.6, h: 6, kind: 'post' },
  { x0: -6.4, z0: -18.4, x1: -5.6, z1: -17.6, h: 6, kind: 'post' },
  { x0: 5.6, z0: -18.4, x1: 6.4, z1: -17.6, h: 6, kind: 'post' },

  // ---- Fern House (west, Site A) — planting beds + hedges ----
  { x0: -27, z0: -12, x1: -20, z1: -8, h: 0.9, kind: 'bed' },
  { x0: -27, z0: 8, x1: -20, z1: 12, h: 0.9, kind: 'bed' },
  { x0: -19, z0: -4, x1: -13, z1: 0, h: 0.9, kind: 'bed' },
  { x0: -19, z0: 2, x1: -13, z1: 6, h: 0.9, kind: 'bed' },
  { x0: -25, z0: -16, x1: -23, z1: -12, h: 1.8, kind: 'hedge' },
  { x0: -25, z0: 12, x1: -23, z1: 16, h: 1.8, kind: 'hedge' },
  { x0: -15, z0: -18, x1: -13, z1: -14, h: 1.8, kind: 'hedge' },
  { x0: -15, z0: 14, x1: -13, z1: 18, h: 1.8, kind: 'hedge' },
  // Terracotta pots guarding Site A
  { x0: -22.5, z0: -4.5, x1: -21.5, z1: -3.5, h: 1.0, kind: 'pot' },
  { x0: -22.5, z0: 3.5, x1: -21.5, z1: 4.5, h: 1.0, kind: 'pot' },
  { x0: -26.5, z0: -2.5, x1: -25.5, z1: -1.5, h: 1.0, kind: 'pot' },
  { x0: -26.5, z0: 1.5, x1: -25.5, z1: 2.5, h: 1.0, kind: 'pot' },

  // ---- Pond Hall (east, Site B) — lily pond + arch ----
  { x0: 17, z0: -5, x1: 25, z1: 5, h: 1.0, kind: 'pond' }, // lily pond (blocked)
  { x0: 19.6, z0: -2.4, x1: 20.4, z1: -1.6, h: 4, kind: 'post' }, // arch post
  { x0: 19.6, z0: 1.6, x1: 20.4, z1: 2.4, h: 4, kind: 'post' },   // arch post
  { x0: 13, z0: -12, x1: 15, z1: -8, h: 0.9, kind: 'bed' },
  { x0: 13, z0: 8, x1: 15, z1: 12, h: 0.9, kind: 'bed' },
  { x0: 26, z0: -12, x1: 28, z1: -8, h: 0.9, kind: 'bed' },
  { x0: 26, z0: 8, x1: 28, z1: 12, h: 0.9, kind: 'bed' },
  // Terracotta pots guarding Site B
  { x0: 21.5, z0: -7.5, x1: 22.5, z1: -6.5, h: 1.0, kind: 'pot' },
  { x0: 21.5, z0: 6.5, x1: 22.5, z1: 7.5, h: 1.0, kind: 'pot' },
  { x0: 26.5, z0: -2.5, x1: 27.5, z1: -1.5, h: 1.0, kind: 'pot' },
  { x0: 26.5, z0: 1.5, x1: 27.5, z1: 2.5, h: 1.0, kind: 'pot' },

  // ---- Loose pots on the Central Walk ----
  { x0: 5.5, z0: -0.5, x1: 6.5, z1: 0.5, h: 1.0, kind: 'pot' },
  { x0: -6.5, z0: -0.5, x1: -5.5, z1: 0.5, h: 1.0, kind: 'pot' },
];

// Objective sites. Plant zone is a 4x4 m square, colour-coded in every frame.
export const SITES = {
  A: { x: -24, z: 0, color: 0xC65D21, css: '#C65D21', name: 'Palm House' },
  B: { x: 24, z: 0, color: 0x2E8FA3, css: '#2E8FA3', name: 'Lily Pond' },
};

export const SPAWNS = {
  thorns: [
    { x: -4, z: 20, yaw: 0 }, { x: 0, z: 20, yaw: 0 },
    { x: 4, z: 20, yaw: 0 }, { x: -2, z: 19, yaw: 0 },
    { x: 2, z: 19, yaw: 0 },
  ],
  keepers: [
    { x: -4, z: -20, yaw: Math.PI }, { x: 0, z: -20, yaw: Math.PI },
    { x: 4, z: -20, yaw: Math.PI }, { x: -2, z: -19, yaw: Math.PI },
    { x: 2, z: -19, yaw: Math.PI },
  ],
};

// Waypoint graph. Bots navigate ONLY on this graph — no pathfinding library.
// Nodes are hand-placed; edges are walkable straight lines (checked against
// the box list when the graph was designed).
export const WAYPOINTS = [
  { id: 'thornSpawn', x: 0, z: 20 },
  { id: 'thornW', x: -8, z: 18 },
  { id: 'thornE', x: 8, z: 18 },
  { id: 'midS', x: 0, z: 14 },
  { id: 'midS2', x: 0, z: 8 },
  { id: 'domeDoorS', x: 0, z: 2 },
  { id: 'fountainW', x: -5, z: -2 },
  { id: 'fountainE', x: 5, z: -2 },
  { id: 'midN', x: 0, z: -8 },
  { id: 'domeN', x: 0, z: -14 },
  { id: 'keeperSpawn', x: 0, z: -20 },
  { id: 'keeperW', x: -8, z: -18 },
  { id: 'keeperE', x: 8, z: -18 },
  { id: 'fernEntry', x: -10, z: 0 },
  { id: 'fernMid', x: -18, z: 0 },
  { id: 'fernN', x: -18, z: -10 },
  { id: 'fernS', x: -18, z: 10 },
  { id: 'siteA', x: -24, z: 0 },
  { id: 'fernGap', x: -14, z: 0 },
  { id: 'fernNW', x: -24, z: -14 },
  { id: 'fernSW', x: -24, z: 14 },
  { id: 'pondEntry', x: 10, z: 0 },
  { id: 'pondN', x: 18, z: -10 },
  { id: 'pondS', x: 18, z: 10 },
  { id: 'pondArch', x: 20, z: 0 },
  { id: 'siteB', x: 24, z: 0 },
  { id: 'pondNE', x: 27, z: -10 },
  { id: 'pondSE', x: 27, z: 10 },
  { id: 'holdDome', x: 0, z: -6 },
  { id: 'holdMidS', x: 0, z: 12 },
  { id: 'holdA', x: -21, z: -6 },
  { id: 'holdB', x: 21, z: -8 },
];

export const EDGES = [
  ['thornSpawn', 'thornW'], ['thornSpawn', 'thornE'], ['thornSpawn', 'midS'],
  ['thornW', 'midS'], ['thornE', 'midS'], ['thornW', 'fernS'], ['thornE', 'pondS'],
  ['midS', 'midS2'], ['midS', 'holdMidS'], ['midS2', 'domeDoorS'],
  ['midS2', 'fernEntry'], ['midS2', 'pondEntry'],
  ['domeDoorS', 'fountainW'], ['domeDoorS', 'fountainE'], ['domeDoorS', 'holdDome'],
  ['fountainW', 'midN'], ['fountainE', 'midN'], ['fountainW', 'fernEntry'],
  ['fountainE', 'pondEntry'], ['midN', 'domeN'], ['midN', 'holdDome'],
  ['domeN', 'keeperSpawn'], ['domeN', 'keeperW'], ['domeN', 'keeperE'],
  ['keeperW', 'fernN'], ['keeperE', 'pondN'],
  ['fernEntry', 'fernGap'], ['fernEntry', 'fernMid'],
  ['fernGap', 'fernMid'], ['fernGap', 'fernN'], ['fernGap', 'fernS'],
  ['fernMid', 'siteA'], ['fernMid', 'fernN'], ['fernMid', 'fernS'],
  ['fernN', 'fernNW'], ['fernS', 'fernSW'], ['fernNW', 'siteA'], ['fernSW', 'siteA'],
  ['fernN', 'holdA'], ['holdA', 'siteA'],
  ['pondEntry', 'pondArch'], ['pondEntry', 'pondN'], ['pondEntry', 'pondS'],
  ['pondArch', 'siteB'], ['pondArch', 'pondN'], ['pondArch', 'pondS'],
  ['pondN', 'pondNE'], ['pondS', 'pondSE'], ['pondNE', 'siteB'], ['pondSE', 'siteB'],
  ['pondN', 'holdB'], ['holdB', 'siteB'],
  ['holdMidS', 'thornSpawn'],
];

// ---- Collision: 2D AABB, per-axis resolution (test x, then z). ----
function hitsBox(x, z, r, b) {
  return x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;
}

export function blockedAt(x, z, r) {
  for (let i = 0; i < BOXES.length; i++) {
    if (hitsBox(x, z, r, BOXES[i])) return true;
  }
  return false;
}

// Move a circle (radius r) by (dx, dz), sliding along walls. Returns the
// new position as {x, z}. Per-axis: try x first, then z.
export function moveCircle(x, z, dx, dz, r) {
  const nx = x + dx;
  if (!blockedAt(nx, z, r)) x = nx;
  const nz = z + dz;
  if (!blockedAt(x, nz, r)) z = nz;
  return { x, z };
}

// Line-of-sight test between two points at eye height, against the boxes.
// A box blocks LOS only if its height reaches the sightline (eye 1.62 m);
// low beds (0.9 m) and benches do not block sight, hedges (1.8 m) do.
export function hasLOS(x0, z0, x1, z1) {
  const EYE = 1.62;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (b.h < EYE) continue;
    // 2D segment vs expanded box (slab test).
    if (segmentHitsBox(x0, z0, x1, z1, b)) return false;
  }
  return true;
}

function segmentHitsBox(x0, z0, x1, z1, b) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  // X slab
  if (dx === 0) {
    if (x0 < b.x0 || x0 > b.x1) return false;
  } else {
    let t1 = (b.x0 - x0) / dx, t2 = (b.x1 - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  // Z slab
  if (dz === 0) {
    if (z0 < b.z0 || z0 > b.z1) return false;
  } else {
    let t1 = (b.z0 - z0) / dz, t2 = (b.z1 - z0) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Nearest waypoint id to a position.
export function nearestWaypoint(x, z) {
  let best = null, bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// Shortest path (BFS, unweighted) between two waypoint ids. Returns an
// array of waypoint objects, start inclusive, goal inclusive.
const ADJ = new Map();
for (const w of WAYPOINTS) ADJ.set(w.id, []);
for (const [a, b] of EDGES) { ADJ.get(a).push(b); ADJ.get(b).push(a); }

export function findPath(fromId, toId) {
  if (fromId === toId) return [byId(fromId)];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const nxt of ADJ.get(cur)) {
      if (prev.has(nxt)) continue;
      prev.set(nxt, cur);
      if (nxt === toId) {
        const path = [toId];
        let node = cur;
        while (node) { path.unshift(node); node = prev.get(node); }
        return path.map(byId);
      }
      queue.push(nxt);
    }
  }
  return [byId(fromId), byId(toId)];
}

function byId(id) {
  for (const w of WAYPOINTS) if (w.id === id) return w;
  return WAYPOINTS[0];
}
