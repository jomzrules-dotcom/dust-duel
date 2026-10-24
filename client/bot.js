// Dust Duel — computer opponent. Reads the sim state, returns an input like a player would.
// Navigation: BFS on a coarse grid (0.5 units) built from the same blockers as the sim.
import { C, BLOCKED, makeInput, insideBlocker } from './sim.js';

const NAV = 0.5;

export function createBot(sim, idx, opts = {}) {
  const { state, grid, GW, GH, MAP_W, MAP_H, blockers } = sim;
  const me = idx + 1, foe = 2 - idx;
  const reaction = opts.reaction ?? 0.12;        // seconds between decisions
  const NW = Math.round(MAP_W / NAV), NH = Math.round(MAP_H / NAV);
  const pass = new Uint8Array(NW * NH);
  const pad = C.VAC_R - 0.08;
  for (let nz = 0; nz < NH; nz++) for (let nx = 0; nx < NW; nx++) {
    const x = -MAP_W / 2 + (nx + 0.5) * NAV, z = -MAP_H / 2 + (nz + 0.5) * NAV;
    let ok = x > -MAP_W / 2 + pad && x < MAP_W / 2 - pad && z > -MAP_H / 2 + pad && z < MAP_H / 2 - pad;
    for (const b of blockers) if (ok && insideBlocker(b, x, z, pad)) ok = false;
    pass[nz * NW + nx] = ok ? 1 : 0;
  }
  const navOf = (x, z) => [Math.max(0, Math.min(NW - 1, Math.floor((x + MAP_W / 2) / NAV))), Math.max(0, Math.min(NH - 1, Math.floor((z + MAP_H / 2) / NAV)))];
  const navCenter = i => [-MAP_W / 2 + ((i % NW) + 0.5) * NAV, -MAP_H / 2 + (Math.floor(i / NW) + 0.5) * NAV];
  // value of a nav cell for cleaning: how many of the sim cells inside it are not mine
  function cellValue(ni, wantOwner) {
    const nx = ni % NW, nz = Math.floor(ni / NW);
    const cx0 = nx * 2, cz0 = nz * 2; let v = 0;
    for (let cz = cz0; cz < cz0 + 2; cz++) for (let cx = cx0; cx < cx0 + 2; cx++) {
      const g = grid[cz * GW + cx];
      if (g === BLOCKED) continue;
      if (wantOwner === 'notmine' ? g !== me : g === wantOwner) v++;
    }
    return v;
  }
  const prev = new Int32Array(NW * NH), dist = new Int32Array(NW * NH), queue = new Int32Array(NW * NH);
  // BFS from start; stops at the first cell where `goal(i)` is true (or explores everything). Returns that cell or -1.
  function bfs(start, goal, maxDist = 1e9) {
    prev.fill(-1); dist.fill(-1);
    let qh = 0, qt = 0; queue[qt++] = start; dist[start] = 0;
    while (qh < qt) {
      const i = queue[qh++];
      if (goal(i) && i !== start) return i;
      if (dist[i] >= maxDist) continue;
      const x = i % NW, z = (i / NW) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= NW || nz >= NH) continue;
        const j = nz * NW + nx;
        if (!pass[j] || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1; prev[j] = i; queue[qt++] = j;
      }
    }
    return -1;
  }
  function nearestPassable(ni) {
    if (pass[ni]) return ni;
    const x = ni % NW, z = (ni / NW) | 0;
    for (let r = 1; r < 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < NW && nz < NH && pass[nz * NW + nx]) return nz * NW + nx;
    }
    return ni;
  }
  // first waypoint along the path from start to goal that is at least ~1 unit away
  function waypoint(start, goal) {
    const path = []; for (let i = goal; i !== -1 && i !== start; i = prev[i]) path.push(i);
    path.reverse();
    return path[Math.min(path.length - 1, 1)] ?? goal;
  }

  let clock = 0, target = null, wander = 0, wanderDir = 0, lastX = 0, lastZ = 0, stillFor = 0, dumping = false;
  const input = makeInput();

  function think(dt) {
    const v = state.vacs[idx], o = state.vacs[foe - 1], t = state.time;
    if (state.phase !== 'playing') { input.ix = input.iz = 0; return input; }
    clock -= dt;
    // stuck detection: barely moved for a second → wander
    const moved = Math.hypot(v.x - lastX, v.z - lastZ); lastX = v.x; lastZ = v.z;
    stillFor = moved < 0.02 && (input.ix || input.iz) ? stillFor + dt : 0;
    if (stillFor > 0.8) { wander = 0.6; wanderDir = Math.random() * Math.PI * 2; stillFor = 0; }
    if (wander > 0) { wander -= dt; input.ix = Math.cos(wanderDir); input.iz = Math.sin(wanderDir); return input; }
    if (clock > 0) return input;
    clock = reaction;

    // decide mode: dump when the bin is (nearly) full, clean again once it is empty
    if (v.bin >= C.BIN_CAP * 0.95) dumping = true;
    if (v.bin <= 0) dumping = false;
    const wantMode = dumping ? 'dump' : 'clean';
    input.toggle = v.mode !== wantMode;

    // use items
    input.use = false;
    const dFoe = Math.hypot(o.x - v.x, o.z - v.z);
    if (v.item === 'shield') input.use = dFoe < 4 || state.timeLeft < 12;
    else if (v.item === 'cables') input.use = dFoe < 3.5;
    else if (v.item === 'spill') {
      // throw when there is a lot of the opponent's floor ~2.5 units ahead
      const ax = v.x + Math.cos(v.h) * 2.5, az = v.z + Math.sin(v.h) * 2.5;
      const [nx, nz] = navOf(ax, az); let foeCells = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const i = (nz + dz) * NW + nx + dx; if (i >= 0 && i < NW * NH) foeCells += cellValue(i, foe);
      }
      input.use = foeCells > 40;
    }

    // pick a target
    const [sx, sz] = navOf(v.x, v.z); const start = nearestPassable(sz * NW + sx);
    let goal = -1;
    if (!v.item) {   // a power-up close by is worth a detour
      const near = state.pickups.map(p => { const [a, b] = navOf(p.x, p.z); return nearestPassable(b * NW + a); });
      if (near.length) goal = bfs(start, i => near.includes(i), 14);
    }
    if (goal < 0) {
      if (dumping) goal = bfs(start, i => cellValue(i, foe) >= 2);          // nearest opponent floor
      else {
        goal = bfs(start, i => cellValue(i, 'notmine') >= 3 && dist[i] >= 2); // nearest patch that is not mine
        if (goal < 0) goal = bfs(start, i => cellValue(i, 'notmine') >= 1);
      }
    }
    if (goal < 0) { input.ix = input.iz = 0; return input; }
    const wp = waypoint(start, goal), [wx, wz] = navCenter(wp);
    const dx = wx - v.x, dz = wz - v.z, len = Math.hypot(dx, dz) || 1;
    input.ix = dx / len; input.iz = dz / len;
    target = goal;
    return input;
  }
  return { think, input, pass, NW, NH };
}
