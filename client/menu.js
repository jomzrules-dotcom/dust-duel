// Dust Duel — the attract scene behind the main menu.
// A flat dirty floor fills the screen. Opening: Blue drives down the left edge and Orange up the right edge,
// painting stripes; a yellow pace vacuum drives left to right and "prints" the game's name on the floor.
// Then Blue and Orange bounce around the screen like the old Windows screensaver, leaving their trails,
// which slowly fade back to dirt. Purely visual: nothing here touches the game rules.
import * as THREE from 'three';
import { makeTopper, animateTopper, bumpTopper } from './toppers.js';

const PPU = 24;                       // texture pixels per world unit
const PX = 6;                         // pixels per dirt cell (0.25 u), same grime density as the house floor
const PLANE_W = 44, PLANE_H = 26;     // floor big enough for any screen shape
const VIEW_H = 13;                    // world units visible from the top to the bottom of the screen
const VAC_R = 0.5, BRUSH = 0.8;
const BOUNCE_SPEED = 5.5, GIANT_SPEED = 12, GIANT_BODY = 0.42;   // the opening pass: two giant vacuums, each 42% of the screen wide (a gap between them)
const FADE_EVERY = 0.1, FADE_ALPHA = 0.022, FADE_PRINT = 0.09;   // trails fade back to dirt over ~12 s; the opening's paint clears fast while the title prints
const TITLE = ['DUST', 'DUEL'];
const DIRT_BASE = ['#7d7466', '#857b6c', '#746a5c', '#8c8273'], CRUMBS = ['#4e463c', '#b9ae9a', '#5c5247', '#a39786', '#3f382f'];
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createMenu({ scene, camera, vacuumModel, colors, css, trails, burst }) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);

  // ---- floor: dirt layer (static) + trail layer (what is shown) ----
  const W = PLANE_W * PPU, H = PLANE_H * PPU;
  const dirt = document.createElement('canvas'); dirt.width = W; dirt.height = H;
  const dctx = dirt.getContext('2d');
  for (let cz = 0; cz < H / PX; cz++) for (let cx = 0; cx < W / PX; cx++) {
    const x = cx * PX, y = cz * PX, blot = hash(cx >> 2, cz >> 2, 7);
    dctx.fillStyle = DIRT_BASE[Math.floor(blot * DIRT_BASE.length)]; dctx.fillRect(x, y, PX, PX);
    if (blot < 0.3) { dctx.fillStyle = 'rgba(60,50,40,.18)'; dctx.fillRect(x, y, PX, PX); }
    const n = 2 + Math.floor(hash(cx, cz, 1) * 4);
    for (let i = 0; i < n; i++) {
      const r1 = hash(cx, cz, 10 + i), r2 = hash(cx, cz, 20 + i), size = r2 < 0.2 ? 2.5 : 1.3;
      dctx.fillStyle = CRUMBS[Math.floor(hash(cx, cz, 30 + i) * CRUMBS.length)];
      dctx.fillRect(x + r1 * (PX - size), y + r2 * (PX - size), size, size);
    }
    if (hash(cx, cz, 99) < 0.06) {
      dctx.strokeStyle = 'rgba(70,60,50,.7)'; dctx.lineWidth = 0.8; dctx.beginPath();
      const a = hash(cx, cz, 98) * Math.PI; dctx.moveTo(x + 1, y + PX / 2); dctx.quadraticCurveTo(x + PX / 2, y + PX / 2 + Math.sin(a) * 3, x + PX - 1, y + PX / 2 - Math.cos(a) * 2); dctx.stroke();
    }
  }
  const trail = document.createElement('canvas'); trail.width = W; trail.height = H;
  const tctx = trail.getContext('2d');
  const floorTex = new THREE.CanvasTexture(trail); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 4;
  floorTex.generateMipmaps = false; floorTex.minFilter = THREE.LinearFilter;   // repainted constantly: skip mipmap rebuilds
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_W, PLANE_H), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
  const toPx = (x, z) => [(x + PLANE_W / 2) * PPU, (z + PLANE_H / 2) * PPU];
  let floorDirty = false, frameNo = 0;
  function paint(x, z, r, color) {
    const [px, py] = toPx(x, z);
    tctx.fillStyle = color; tctx.beginPath(); tctx.arc(px, py, r * PPU, 0, Math.PI * 2); tctx.fill();
    floorDirty = true;
  }
  function resetFloor() { tctx.globalAlpha = 1; tctx.drawImage(dirt, 0, 0); floorDirty = true; }

  // ---- title plane: the name printed on the floor, revealed behind the pace vacuum ----
  const TW_PX = 1024, TH_PX = 320;
  const full = document.createElement('canvas'); full.width = TW_PX; full.height = TH_PX;
  const shown = document.createElement('canvas'); shown.width = TW_PX; shown.height = TH_PX;
  const sctx = shown.getContext('2d');
  const titleTex = new THREE.CanvasTexture(shown); titleTex.colorSpace = THREE.SRGBColorSpace; titleTex.anisotropy = 8;
  titleTex.generateMipmaps = false; titleTex.minFilter = THREE.LinearFilter;
  const title = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: titleTex, transparent: true, depthWrite: false }));
  title.rotation.x = -Math.PI / 2; title.position.y = 0.012; title.renderOrder = 1; group.add(title);
  function drawTitle() {
    const c = full.getContext('2d'); c.clearRect(0, 0, TW_PX, TH_PX);
    const size = 250; c.font = `${size}px "Luckiest Guy", "Arial Black", Impact, sans-serif`; c.textBaseline = 'middle';
    const gap = size * 0.22, widths = TITLE.map(w => c.measureText(w).width), total = widths[0] + gap + widths[1];
    const k = Math.min(1, (TW_PX - 40) / total);
    c.save(); c.translate(TW_PX / 2, TH_PX / 2 + size * 0.06); c.scale(k, k); c.translate(-total / 2, 0);
    let x = 0;
    TITLE.forEach((word, i) => {
      c.lineJoin = 'round';
      c.fillStyle = '#1c1917'; c.fillText(word, x + size * 0.07, size * 0.07);                 // hard comic shadow
      c.lineWidth = size * 0.13; c.strokeStyle = '#1c1917'; c.strokeText(word, x, 0);
      c.fillStyle = css[i]; c.fillText(word, x, 0);
      x += widths[i] + gap;
    });
    c.restore();
  }
  function revealTitle(frac) {   // 0..1 of the width, left to right
    sctx.clearRect(0, 0, TW_PX, TH_PX);
    if (frac <= 0) { titleTex.needsUpdate = true; return; }
    sctx.save(); sctx.beginPath(); sctx.rect(0, 0, Math.min(TW_PX, frac * TW_PX), TH_PX); sctx.clip(); sctx.drawImage(full, 0, 0); sctx.restore();
    titleTex.needsUpdate = true;
  }

  // ---- vacuums: 0 Blue, 1 Orange, 2 the yellow pace vacuum that prints the title ----
  function makeVac(color) {
    const root = new THREE.Group(), body = vacuumModel.clone(), brushes = [];
    body.traverse(o => {
      if (o.name === 'Brush_L' || o.name === 'Brush_R') brushes.push(o);
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (o.material.name === 'VacBody') o.material.color.setHex(color);
    });
    root.add(body); group.add(root);
    return { root, brushes, spin: 0, x: 0, z: 0, h: 0, vx: 0, vz: 0, s: 1, topper: null, topperType: 'none', px: 0, pz: 0 };
  }
  const vacs = [makeVac(colors[0]), makeVac(colors[1]), makeVac(0xfbbf24)];
  function setTopper(i, type) {
    const V = vacs[i];
    if (V.topper) V.root.remove(V.topper);
    V.topper = makeTopper(type); V.topperType = type;
    if (V.topper) V.root.add(V.topper);
  }

  // ---- view bounds (world units on the floor) ----
  const B = { l: -14, r: 14, t: -6.5, b: 6.5, w: 28, h: 13 };
  const _v = new THREE.Vector3();
  function placeCamera() {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const hc = VIEW_H / (2 * t);
    camera.position.set(0, hc, hc * 0.12); camera.lookAt(0, 0, 0);
  }
  function computeBounds() {
    placeCamera(); camera.updateMatrixWorld();
    const corners = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([nx, ny]) => {
      _v.set(nx, ny, 0.5).unproject(camera); const d = _v.clone().sub(camera.position).normalize();
      const s = -camera.position.y / d.y; return [camera.position.x + d.x * s, camera.position.z + d.z * s];
    });
    B.l = Math.max(corners[0][0], corners[2][0]); B.r = Math.min(corners[1][0], corners[3][0]);
    B.t = Math.max(corners[0][1], corners[1][1]) + 0.6; B.b = Math.min(corners[2][1], corners[3][1]) - 0.6;   // stay clear of the checker bars
    B.w = B.r - B.l; B.h = B.b - B.t;
    const tw = Math.min(B.w * 0.72, 20), th = tw * TH_PX / TW_PX;
    title.scale.set(tw, th, 1); title.position.set(0, 0.012, B.t + B.h * 0.3);
  }

  // ---- choreography ----
  const S = { phase: 'off', t: 0, fade: 0, ready: false, onReady: null };
  const titleZ = () => title.position.z, titleW = () => title.scale.x;
  function corners() {   // where the edge runs end and the bouncing starts
    vacs[0].x = B.l + 1.1; vacs[0].z = B.b - 1.4; vacs[1].x = B.r - 1.1; vacs[1].z = B.t + 1.4;
  }
  function launch() {
    const a = THREE.MathUtils.degToRad(-32);
    for (const V of [vacs[0], vacs[1]]) { V.s = 1; V.root.visible = true; V.px = V.pz = NaN; if (V.topper) V.topper.visible = true; }
    vacs[0].vx = Math.cos(a) * BOUNCE_SPEED; vacs[0].vz = Math.sin(a) * BOUNCE_SPEED;
    vacs[1].vx = -Math.cos(a) * BOUNCE_SPEED; vacs[1].vz = -Math.sin(a) * BOUNCE_SPEED;
    vacs[2].root.visible = false;
    S.phase = 'bounce'; S.ready = true; if (S.onReady) S.onReady();
  }
  function start({ intro = true, onReady = null } = {}) {
    group.visible = true; computeBounds(); drawTitle(); resetFloor(); trails.clear();
    S.t = 0; S.fade = 0; S.ready = false; S.onReady = onReady; frameNo = 0;
    for (const V of vacs) { V.vx = V.vz = 0; V.root.visible = true; V.px = V.pz = NaN; }
    if (!intro) { corners(); revealTitle(1); launch(); return; }
    revealTitle(0);
    // two giants, each half the screen wide, pass each other and paint the whole floor
    // bodies are a bit narrower than a half screen so they pass without touching; the paint still covers the halves
    const R = B.w / 4, body = B.w * GIANT_BODY;
    vacs[0].x = B.l + R; vacs[0].z = B.t - R - 0.5; vacs[0].vz = GIANT_SPEED; vacs[0].h = Math.PI / 2; vacs[0].s = body;
    vacs[1].x = B.r - R; vacs[1].z = B.b + R + 0.5; vacs[1].vz = -GIANT_SPEED; vacs[1].h = -Math.PI / 2; vacs[1].s = body;
    for (const V of [vacs[0], vacs[1]]) if (V.topper) V.topper.visible = false;   // no hats on the giants: they'd fill the screen
    // the pace vacuum is a third of the screen tall: as big as the letters it prints
    vacs[2].s = B.h / 3; vacs[2].x = B.l - vacs[2].s / 2 - 0.5; vacs[2].z = titleZ(); vacs[2].h = 0; vacs[2].vx = 0;
    S.phase = 'stripes';
  }
  function skip() { if (S.phase === 'stripes' || S.phase === 'print') { resetFloor(); corners(); revealTitle(1); launch(); } }
  function stop() { group.visible = false; S.phase = 'off'; }

  function bounceStep(V, dt) {
    V.x += V.vx * dt; V.z += V.vz * dt;
    const jitter = () => (Math.random() - 0.5) * 0.25;
    if (V.x < B.l + VAC_R) { V.x = B.l + VAC_R; V.vx = Math.abs(V.vx); V.vz += jitter(); }
    if (V.x > B.r - VAC_R) { V.x = B.r - VAC_R; V.vx = -Math.abs(V.vx); V.vz += jitter(); }
    if (V.z < B.t + VAC_R) { V.z = B.t + VAC_R; V.vz = Math.abs(V.vz); V.vx += jitter(); }
    if (V.z > B.b - VAC_R) { V.z = B.b - VAC_R; V.vz = -Math.abs(V.vz); V.vx += jitter(); }
    // keep the speed steady and never let a run go dead straight along an axis
    let sp = Math.hypot(V.vx, V.vz) || 1, ang = Math.atan2(V.vz, V.vx);
    const m = Math.abs(Math.sin(2 * ang)); if (m < 0.3) ang += (0.3 - m) * (Math.sin(2 * ang) >= 0 ? 1 : -1) * 0.5;
    V.vx = Math.cos(ang) * BOUNCE_SPEED; V.vz = Math.sin(ang) * BOUNCE_SPEED; sp = BOUNCE_SPEED;
  }

  function update(dt) {
    if (S.phase === 'off') return;
    S.t += dt; frameNo++;
    const printer = vacs[2];
    if (S.phase === 'stripes') {
      const R = B.w / 4;
      for (const V of [vacs[0], vacs[1]]) {
        V.z += V.vz * dt;
        paint(V.x, V.z, R + 0.9, V === vacs[0] ? css[0] : css[1]);   // a little past the screen edge so no dirt sliver is left
      }
      if (vacs[0].z >= B.b + R + 0.5) {   // both runs are the same length, so they leave together
        for (const V of [vacs[0], vacs[1]]) { V.vz = 0; V.root.visible = false; }
        S.phase = 'print'; printer.vx = (B.w + printer.s + 2) / 2.8;
      }
    } else if (S.phase === 'print') {
      printer.x += printer.vx * dt;
      const left = -titleW() / 2;
      revealTitle((printer.x - 0.3 - left) / titleW());
      if (printer.x > B.r + printer.s / 2 + 0.5) { corners(); launch(); }
    } else if (S.phase === 'bounce') {
      for (const V of [vacs[0], vacs[1]]) bounceStep(V, dt);
      // the two bounce off each other
      const [a, b] = vacs; let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d < VAC_R * 2 && d > 1e-4) {
        const nx = dx / d, nz = dz / d, ov = VAC_R * 2 - d;
        a.x -= nx * ov / 2; a.z -= nz * ov / 2; b.x += nx * ov / 2; b.z += nz * ov / 2;
        const pa = a.vx * nx + a.vz * nz, pb = b.vx * nx + b.vz * nz;
        if (pa - pb > 0) {   // moving toward each other: swap the parts along the line between them
          a.vx += (pb - pa) * nx; a.vz += (pb - pa) * nz; b.vx += (pa - pb) * nx; b.vz += (pa - pb) * nz;
          bumpTopper(a.topper); bumpTopper(b.topper); if (burst) burst((a.x + b.x) / 2, (a.z + b.z) / 2, 0xd6d3d1, 14, 2.2, 2.6, 0.8);
        }
      }
      for (const V of [vacs[0], vacs[1]]) paint(V.x, V.z, BRUSH, V === vacs[0] ? css[0] : css[1]);
    }
    // trails fade back to dirt a little at a time
    S.fade += dt;
    if (S.fade >= FADE_EVERY && (S.phase === 'bounce' || S.phase === 'print')) { S.fade = 0; tctx.globalAlpha = S.phase === 'print' ? FADE_PRINT : FADE_ALPHA; tctx.drawImage(dirt, 0, 0); tctx.globalAlpha = 1; floorDirty = true; }
    if (floorDirty && frameNo % 2 === 0) { floorTex.needsUpdate = true; floorDirty = false; }
    // place the models
    const T = performance.now() / 1000;
    vacs.forEach((V, i) => {
      const moving = Math.hypot(V.vx, V.vz) > 0.01;
      if (moving) V.h = Math.atan2(V.vz, V.vx);
      V.root.position.set(V.x, 0, V.z); V.root.rotation.y = -V.h; V.root.scale.setScalar(V.s);
      if (moving) V.spin += 18 * dt;
      for (const b of V.brushes) b.rotation.z = V.spin * (b.name === 'Brush_L' ? 1 : -1);
      const moved = Number.isFinite(V.px) ? Math.hypot(V.x - V.px, V.z - V.pz) : 0; V.px = V.x; V.pz = V.z;
      if (V.topper) {
        animateTopper(V.topper, T, dt, moving ? 1 : 0);
        if (moved < 1 && S.phase === 'bounce') trails.emit('menu' + i, V.topperType, V.x, V.z, V.h, moved);
      }
    });
    placeCamera();
  }

  function resize() {
    if (S.phase === 'off') return;
    computeBounds();
    for (const V of vacs) { V.x = Math.max(B.l + VAC_R, Math.min(B.r - VAC_R, V.x)); if (S.phase === 'bounce') V.z = Math.max(B.t + VAC_R, Math.min(B.b - VAC_R, V.z)); }
  }

  return { start, stop, skip, update, resize, setTopper, placeCamera, get ready() { return S.ready; }, get phase() { return S.phase; } };
}
