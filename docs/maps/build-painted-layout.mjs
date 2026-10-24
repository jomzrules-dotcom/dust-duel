// Builds client/assets/layout.json for the painted house: house v2's walls + furniture measured on the painting
// (client/assets/house.jpg), docks and power-up spots, then runs the fairness check (port of check.py; Python isn't
// needed). Run: node docs/maps/build-painted-layout.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { makeCam } from './fit-camera.mjs';
import { rectOf, blockerOf, insideBlocker } from '../../client/sim.js';

const readJSON = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8').replace(/^﻿/, ''));   // files saved by Windows tools may start with a BOM
const fit = readJSON('./painted-camera.json');
const cam = makeCam([...fit.pos, fit.targetZ, fit.vfov]);
const v2 = readJSON('./house-v2.json');

// Painted furniture: where each piece stands on the floor, in painting pixels [u0, v0, u1, v1] (its feet, not its top),
// and the height (m) of everything painted on it (lamps, plants, the TV) for the depth occluder that keeps it in front
// of the grime behind it. Read on house-4rooms.png.
// A piece's top is drawn higher than its feet (~33 px per metre of height), so the back edge of a footprint is the
// painted top edge pushed down by that much. Tables, chairs and the sofa are separate pieces (boss: "cut it out
// cleanly"), so the vacuum can drive right up to each of them.
const PAINTED = [
  // bedroom
  ['wardrobe', [300, 285, 470, 569], 2.5], ['basket + plant', [290, 640, 445, 737], 1.2],
  ['nightstand', [693, 270, 796, 321], 1.15], ['nightstand', [1083, 270, 1186, 321], 1.15], ['bed', [790, 205, 1080, 560], 0.9],
  // living room
  ['bookshelf', [1610, 260, 1840, 299], 1.75], ['floor lamp', [1880, 280, 1930, 300], 1.6], ['plant', [2370, 250, 2440, 292], 1.2],
  ['tv stand', [2470, 380, 2600, 686], 1.6],
  ['sofa', [1815, 396, 2165, 558], 0.85], ['coffee table', [1885, 575, 2100, 690], 0.75],
  // bathroom
  ['sink', [250, 930, 390, 1105], 0.9], ['towel rack', [390, 905, 490, 935], 0.9], ['toilet', [245, 1160, 385, 1255], 0.75],
  ['plant', [235, 1330, 335, 1405], 1.2], ['bathtub', [680, 1000, 1075, 1185], 0.6], ['basket', [1245, 1340, 1360, 1430], 0.6],
  // kitchen
  ['fridge', [2500, 845, 2650, 990], 1.9], ['counter', [2540, 950, 2700, 1380], 1.2], ['counter', [2025, 1360, 2720, 1432], 0.95],
  ['dining table', [1812, 1033, 2142, 1240], 0.9],
  ['chair', [1855, 978, 1945, 1035], 0.9], ['chair', [1995, 978, 2085, 1035], 0.9],     // back chairs
  ['chair', [1745, 1060, 1812, 1190], 0.9], ['chair', [2142, 1060, 2200, 1190], 0.9],   // side chairs
  ['chair', [1862, 1235, 1955, 1292], 0.9], ['chair', [2003, 1235, 2100, 1292], 0.9],   // front chairs
];
// Where the painted floor meets the walls (bottom of the baseboard; the front wall's cap hides the floor from
// v 1430), in painting pixels, unprojected with the fitted camera. The camera can't match the painting's walls
// exactly (the AI painting isn't a true perspective view), so the outer walls' collision follows these lines
// instead of the 26 x 16 box: back z -6.8 (was -7.6), front 6.85 (was 7.6), sides ±12.45 (was ±12.6).
// Measured with art/house/stitch/Runs.cs: back v 242 (bedroom) / 248 (living), left u 315 @ v 600, 305 @ 850,
// 281 @ 1140; right u 2580 @ 330, 2600 @ 720, 2602 @ 770.
const FLOOR = { x0: -12.45, z0: -6.8, x1: 12.45, z1: 6.85 };
const r2 = v => Math.round(v * 100) / 100;
function footprint([u0, v0, u1, v1]) {
  const pts = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(p => cam.unproject(p, 0));
  const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), z0 = Math.min(...pts.map(p => p[2])), z1 = Math.max(...pts.map(p => p[2]));
  return { x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(x1 - x0), d: r2(z1 - z0) };
}
// keep furniture inside the floor so nothing pokes into an outer wall
function clampToFloor(f) {
  let x0 = f.x - f.w / 2, x1 = f.x + f.w / 2, z0 = f.z - f.d / 2, z1 = f.z + f.d / 2;
  x0 = Math.max(x0, FLOOR.x0); x1 = Math.min(x1, FLOOR.x1); z0 = Math.max(z0, FLOOR.z0); z1 = Math.min(z1, FLOOR.z1);
  return { ...f, x: r2((x0 + x1) / 2), z: r2((z0 + z1) / 2), w: r2(x1 - x0), d: r2(z1 - z0) };
}
const OVAL = new Set(['bathtub', 'basket + plant', 'basket', 'plant']);   // round pieces get an oval occluder (a box would hide grime in its empty corners)
const furniture = PAINTED.map(([name, px, h]) => clampToFloor({ model: null, name, ...footprint(px), rot: 0, h, blocks: true, ...(OVAL.has(name) && { shape: 'oval' }) }));

const layout = {
  name: 'Painted house',
  size: v2.size, wallHeight: r2(fit.wallH), spawnOffset: v2.spawnOffset,
  painting: { file: 'house.jpg', width: 2920, height: 1774, camera: fit },
  // outer walls run from the map edge to the painted floor edge (they aren't drawn: the painting has them);
  // inner walls stay as in v2 (3D, drawn by the game)
  rooms: v2.rooms, walls: [
    { x0: -13, z0: -8, x1: 13, z1: FLOOR.z0 }, { x0: -13, z0: FLOOR.z1, x1: 13, z1: 8 },
    { x0: -13, z0: FLOOR.z0, x1: FLOOR.x0, z1: FLOOR.z1 }, { x0: FLOOR.x1, z0: FLOOR.z0, x1: 13, z1: FLOOR.z1 },
    ...v2.walls.filter(w => !(w.x0 <= -13 || w.x1 >= 13 || w.z0 <= -8 || w.z1 >= 8)),
  ], furniture,
  // Docks stand against a wall on the north side of a room: the camera looks from the south, so floor right
  // behind (north of) any wall is hidden. Both sit on the inner wall, facing south: Blue in the bathroom, Orange in
  // the kitchen. Picked by sweeping positions for the fairest split (1.3%; bedroom/kitchen pairs gave 3.2–10%).
  docks: [{ x: -0.7, z: 0.7, rot: 90 }, { x: 4.5, z: 0.7, rot: 90 }],
  powerupSpots: [
    { x: -3, z: -4.3 }, { x: -9.6, z: -1.6 }, { x: 1.6, z: -4.6 }, { x: 9.6, z: -1.4 },
    { x: -2.4, z: 4.2 }, { x: -6.5, z: 5.6 }, { x: 2.2, z: 4.4 }, { x: 9.8, z: 4.6 },
  ],
};
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--(blue|orange)=(-?[\d.]+),(-?[\d.]+)$/); if (m) Object.assign(layout.docks[m[1] === 'blue' ? 0 : 1], { x: +m[2], z: +m[3] });
}

// ---------------------------------------------------------------- fairness check (same method as check.py)
const RES = 0.1, VAC_R = 0.5, BRUSH_R = 0.8, W = layout.size.w, H = layout.size.h, NX = Math.round(W / RES), NZ = Math.round(H / RES);
const blockers = [...layout.walls, ...layout.furniture.map(blockerOf)];
const solid = new Uint8Array(NX * NZ);
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
  const x = -W / 2 + (i + 0.5) * RES, z = -H / 2 + (k + 0.5) * RES;
  if (blockers.some(b => insideBlocker(b, x, z))) solid[k * NX + i] = 1;
}
const disc = r => { const o = [], n = Math.ceil(r / RES); for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) { const d = Math.hypot(a, b) * RES; if (d <= r) o.push([a, b, d]); } return o; };
const DV = disc(VAC_R - 1e-6), DB = disc(BRUSH_R);
const ok = new Uint8Array(NX * NZ);
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
  let good = !solid[k * NX + i];
  for (const [a, b] of DV) { if (!good) break; const kk = k + a, ii = i + b; if (kk < 0 || ii < 0 || kk >= NZ || ii >= NX || solid[kk * NX + ii]) good = false; }
  ok[k * NX + i] = good ? 1 : 0;
}
const cellOf = (x, z) => [Math.floor((x + W / 2) / RES), Math.floor((z + H / 2) / RES)];
function field(sx, sz) {
  const D = new Float64Array(NX * NZ).fill(Infinity), [i0, k0] = cellOf(sx, sz), heap = [[0, k0 * NX + i0]]; D[k0 * NX + i0] = 0;
  const nb = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [1, 1, Math.SQRT2]];
  const push = e => { heap.push(e); let c = heap.length - 1; while (c) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  heap.length = 0; push([0, k0 * NX + i0]);
  while (heap.length) {
    const [d, idx] = pop(); if (d > D[idx]) continue;
    const k = Math.floor(idx / NX), i = idx % NX;
    for (const [a, b, c] of nb) { const kk = k + a, ii = i + b; if (kk < 0 || ii < 0 || kk >= NZ || ii >= NX || !ok[kk * NX + ii]) continue; const nd = d + c * RES, j = kk * NX + ii; if (nd < D[j]) { D[j] = nd; push([nd, j]); } }
  }
  return D;
}
const OFF = layout.spawnOffset, spawns = layout.docks.map(d => { const r = d.rot * Math.PI / 180; return [d.x + Math.cos(r) * OFF, d.z + Math.sin(r) * OFF]; });
const issues = [];
spawns.forEach(([x, z], n) => { const [i, k] = cellOf(x, z); if (!ok[k * NX + i]) issues.push(`P${n + 1} spawn (${x.toFixed(2)}, ${z.toFixed(2)}) has no room for the vacuum`); });
layout.docks.forEach((d, n) => { for (const f of layout.furniture) { const b = rectOf(f); if (b.x0 < d.x + 0.5 && b.x1 > d.x - 0.5 && b.z0 < d.z + 0.45 && b.z1 > d.z - 0.45) issues.push(`P${n + 1} dock overlaps ${f.name}`); } });
const F = spawns.map(([x, z]) => field(x, z));
const area = n => (n * RES * RES);
let free = 0, cleanable = 0, p1 = 0, p2 = 0;
const perRoom = layout.rooms.map(r => ({ name: r.name, c: 0, a: 0, b: 0 }));
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
  if (solid[k * NX + i]) continue; free++;
  let d0 = Infinity, d1 = Infinity;
  for (const [a, b, dd] of DB) { const kk = k + a, ii = i + b; if (kk < 0 || ii < 0 || kk >= NZ || ii >= NX) continue; const j = kk * NX + ii; if (F[0][j] + dd < d0) d0 = F[0][j] + dd; if (F[1][j] + dd < d1) d1 = F[1][j] + dd; }
  if (!isFinite(d0) && !isFinite(d1)) continue;
  cleanable++; const x = -W / 2 + (i + 0.5) * RES, z = -H / 2 + (k + 0.5) * RES;
  const room = perRoom.find((_, n) => { const r = layout.rooms[n]; return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1; });
  if (room) room.c++;
  if (d0 < d1) { p1++; if (room) room.a++; } else if (d1 < d0) { p2++; if (room) room.b++; } else { p1 += 0.5; p2 += 0.5; }
}
const diff = Math.abs(p1 - p2) / (p1 + p2) * 100;
console.log(`floor ${area(free).toFixed(1)} m², cleanable ${area(cleanable).toFixed(1)}, unreachable ${area(free - cleanable).toFixed(1)}`);
console.log(`split: Blue ${area(p1).toFixed(1)}  Orange ${area(p2).toFixed(1)}  diff ${diff.toFixed(2)}%`);
for (const r of perRoom) console.log(`  ${r.name.padEnd(16)} cleanable ${area(r.c).toFixed(1).padStart(5)} | Blue ${area(r.a).toFixed(1).padStart(5)}  Orange ${area(r.b).toFixed(1).padStart(5)}`);
console.log('power-up spots (drive from Blue / Orange):');
for (const s of layout.powerupSpots) { const [i, k] = cellOf(s.x, s.z), j = k * NX + i; console.log(`  (${s.x}, ${s.z})  ${F[0][j].toFixed(1)} / ${F[1][j].toFixed(1)}${ok[j] ? '' : '  <-- not reachable'}`); }
for (const f of layout.furniture) console.log(`  ${f.name.padEnd(22)} x ${f.x} z ${f.z}  ${f.w} x ${f.d}`);
console.log(issues.length ? 'issues:\n  - ' + issues.join('\n  - ') : 'issues: none');
if (process.argv.includes('--write')) {
  writeFileSync(new URL('../../client/assets/layout.json', import.meta.url), JSON.stringify(layout, null, 2) + '\n');
  console.log('wrote client/assets/layout.json');
}
