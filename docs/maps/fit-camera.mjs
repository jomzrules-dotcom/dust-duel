// Fits one perspective camera to the painted house (client/assets/house.jpg, 2920 x 1774) so the game's
// floor lands on the painted floor. Prints the camera and the per-row correction used by game.js (houseView).
// Run: node docs/maps/fit-camera.mjs
//
// Measured on art/house/house-4rooms.png (see art/house/stitch/STITCH_NOTES.md). World: x right, z down
// (south), y up; floor inside the outer walls is x ±12.6, z ±7.6; walls are 0.4 thick.
const IMG_W = 2920, IMG_H = 1774;

// point: world (x, y, z) -> pixel (u, v).  lineX: the world line x = X, y = Y passes through pixel (u, v).
// lineZ: the world line z = Z, y = Y passes through pixel (u, v). H = wall height (fitted).
const C = [
  { t: 'point', w: [0, 0, 0], p: [1450, 821] },                     // seam cross (exact: the stitch cut)
  { t: 'lineZ', Z: 0, Y: 0, p: [600, 821] }, { t: 'lineZ', Z: 0, Y: 0, p: [2300, 821] },
  { t: 'lineX', X: 0, Y: 0, p: [1450, 300] }, { t: 'lineX', X: 0, Y: 0, p: [1450, 1300] },
  { t: 'lineZ', Z: -7.6, Y: 0, p: [600, 165] }, { t: 'lineZ', Z: -7.6, Y: 0, p: [1250, 175] }, { t: 'lineZ', Z: -7.6, Y: 0, p: [1550, 178] },   // back floor edge
  { t: 'point', w: [0, 'H', -7.6], p: [1450, 114] }, { t: 'point', w: [0, 'H', -8.0], p: [1450, 87] },     // back wall cap at x = 0
  { t: 'point', w: [0, 'H', 7.6], p: [1450, 1432] }, { t: 'point', w: [0, 'H', 8.0], p: [1450, 1474] },    // front wall cap at x = 0
  { t: 'point', w: [0, 0, 8.0], p: [1450, 1561] },                                                         // front wall foot, outside
  { t: 'lineX', X: -12.6, Y: 0, p: [285, 760] }, { t: 'lineX', X: -12.6, Y: 0, p: [286, 790] },          // left floor edge
  { t: 'lineX', X: 12.6, Y: 0, p: [2604, 720] },                                                           // right floor edge
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

export function makeCam([cx, cy, cz, tz, fov]) {
  const pos = [cx, cy, cz], fwd = norm(sub([cx, 0, tz], pos)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  const f = IMG_H / 2 / Math.tan(fov * Math.PI / 360);
  return {
    pos, fwd, right, up, f,
    project(P) { const d = sub(P, pos), zc = dot(d, fwd); return [IMG_W / 2 + f * dot(d, right) / zc, IMG_H / 2 - f * dot(d, up) / zc]; },
    // world point on the plane y = Y seen at pixel (u, v)
    unproject([u, v], Y = 0) {
      const xc = (u - IMG_W / 2) / f, yc = -(v - IMG_H / 2) / f;
      const dir = [fwd[0] + right[0] * xc + up[0] * yc, fwd[1] + right[1] * xc + up[1] * yc, fwd[2] + right[2] * xc + up[2] * yc];
      const s = (Y - pos[1]) / dir[1]; return [pos[0] + dir[0] * s, Y, pos[2] + dir[2] * s];
    },
  };
}

function residuals(params) {
  const cam = makeCam(params), H = params[5], out = [];
  for (const c of C) {
    if (c.t === 'point') { const w = c.w.map(v => v === 'H' ? H : v), q = cam.project(w); out.push(q[0] - c.p[0], q[1] - c.p[1]); continue; }
    const a = c.t === 'lineX' ? cam.project([c.X, c.Y, -20]) : cam.project([-30, c.Y, c.Z]);
    const b = c.t === 'lineX' ? cam.project([c.X, c.Y, 20]) : cam.project([30, c.Y, c.Z]);
    const n = norm([b[1] - a[1], a[0] - b[0], 0]);   // perpendicular distance from the pixel to the projected line
    out.push((c.p[0] - a[0]) * n[0] + (c.p[1] - a[1]) * n[1]);
  }
  return out;
}
const cost = p => (p[4] < 5 || p[4] > 90 || p[1] < 1 || p[5] < 0.3) ? 1e12 : residuals(p).reduce((s, r) => s + r * r, 0);

function nelderMead(f, x0, steps, iters = 20000) {
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => v + (i === j ? steps[j] : 0)))].map(x => ({ x, f: f(x) }));
  for (let k = 0; k < iters; k++) {
    S.sort((a, b) => a.f - b.f);
    const n = x0.length, c = S[0].x.map((_, j) => S.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const w = S[n], mv = (t) => c.map((v, j) => v + t * (w.x[j] - v)), ev = x => ({ x, f: f(x) });
    const r = ev(mv(-1));
    if (r.f < S[0].f) { const e = ev(mv(-2)); S[n] = e.f < r.f ? e : r; }
    else if (r.f < S[n - 1].f) S[n] = r;
    else { const k2 = ev(mv(0.5)); if (k2.f < w.f) S[n] = k2; else S = S.map((p, i) => i ? ev(p.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j]))) : p); }
  }
  return S.sort((a, b) => a.f - b.f)[0];
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fit-camera.mjs')) {
  // start: camera above the south edge looking down at ~60°
  let best = null;
  for (const start of [[0, 28, 14, 0, 30, 1.5], [0, 40, 20, -1, 22, 1.5], [0, 20, 10, 1, 40, 1.2]]) {
    const r = nelderMead(cost, start, [0.5, 3, 3, 1, 4, 0.2]);
    if (!best || r.f < best.f) best = r;
  }
  const p = best.x, cam = makeCam(p), res = residuals(p);
  console.log('camera pos', p.slice(0, 3).map(v => +v.toFixed(3)), 'target z', +p[3].toFixed(3), 'vfov', +p[4].toFixed(3), 'wall H', +p[5].toFixed(3));
  console.log('rms px', Math.sqrt(best.f / res.length).toFixed(2));
  let i = 0;
  for (const c of C) { const n = c.t === 'point' ? 2 : 1, r = res.slice(i, i + n).map(v => v.toFixed(1)); i += n; console.log(' ', c.t.padEnd(5), JSON.stringify(c.w || [c.X ?? '-', c.Y, c.Z ?? '-']), '->', c.p, 'err', r.join(', ')); }
  // where key floor points land
  for (const [x, z] of [[-12.6, -7.6], [12.6, -7.6], [-12.6, 0], [12.6, 0], [-12.6, 7.6], [12.6, 7.6], [0, 7.6]]) console.log(`  floor (${x}, ${z}) -> ${cam.project([x, 0, z]).map(v => v.toFixed(0))}`);
  console.log(JSON.stringify({ pos: p.slice(0, 3), targetZ: p[3], vfov: p[4], wallH: p[5] }));
}
