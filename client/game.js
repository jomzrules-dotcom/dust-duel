// Dust Duel — renderer, HUD, controls and the lobby.
// Game rules live in sim.js (shared with the server). This file only draws what the sim (or the server) says.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSim, makeInput, C, POWERUPS, rectOf } from './sim.js';
import { createBot } from './bot.js';
import { TOPPERS, makeTopper, animateTopper, bumpTopper, createTrails } from './toppers.js';
import { createMenu } from './menu.js';

const PX = 8;                                   // paint-texture pixels per scoring cell
const PLAYER_COLORS = [0x3b82f6, 0xf97316];
const PLAYER_CSS = ['#79b0ff', '#ffb062'];
const PLAYER_NAMES = ['Blue', 'Orange'];
const PU_COLOR = { turbo: 0xfbbf24, wide: 0x22c55e, shield: 0x38bdf8, cables: 0xa855f7, spill: 0xf43f5e };
const ITEM_ICON = { shield: '🛡', cables: '🔌', spill: '💧', turbo: '⚡', wide: '↔' };
const PU_CSS = Object.fromEntries(Object.entries(PU_COLOR).map(([k, v]) => [k, '#' + v.toString(16).padStart(6, '0')]));

const layout = await (await fetch('./assets/layout.json')).json();
{ const q = new URLSearchParams(location.search); if (q.has('t')) C.MATCH_TIME = Math.max(1, +q.get('t')); }   // ?t=10 → short matches for testing
const sim = createSim(layout);
const { MAP_W, MAP_H, GW, GH } = sim;
const CELL = C.CELL;

// ---------------------------------------------------------------- three.js setup
const canvas = document.getElementById('game');
// Performance profile: phones and tablets get plain (not soft) shadows, a smaller shadow map and no MSAA
// (their high pixel density already smooths edges). Resolution also adapts to the measured frame rate (see frame()).
const COARSE = matchMedia('(pointer: coarse)').matches;
const MAX_PR = Math.min(window.devicePixelRatio || 1, COARSE ? 1.5 : 2);
let pixelRatio = MAX_PR;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !COARSE, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = COARSE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24262c);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);   // the main menu's camera (menu.js moves it)
// The house is a painting (assets/house.jpg). houseCam is fitted to it once (docs/maps/fit-camera.mjs) and never moves:
// follow and overview are a 2D pan/zoom of its view (setViewOffset), so 3D things stay glued to the painted floor.
const PAINT = layout.painting, PCAM = PAINT.camera;
const houseCam = new THREE.PerspectiveCamera(PCAM.vfov, PAINT.width / PAINT.height, 100, 260);
houseCam.position.set(...PCAM.pos); houseCam.lookAt(PCAM.pos[0], 0, PCAM.targetZ); houseCam.updateMatrixWorld();
const fullCam = houseCam.clone(); fullCam.updateProjectionMatrix();   // same view with no pan/zoom: world → painting pixels
const _pp = new THREE.Vector3();
function toPaint(x, y, z) { _pp.set(x, y, z).project(fullCam); return [(_pp.x + 1) / 2 * PAINT.width, (1 - _pp.y) / 2 * PAINT.height]; }
// warm light, like the painting's evening lamps (only the 3D things are lit: vacuums, docks, power-ups)
scene.add(new THREE.HemisphereLight(0xfff0dc, 0x8a7560, 0.95));
const sun = new THREE.DirectionalLight(0xffe2b8, 1.5);
sun.position.set(-10, 24, 8); sun.castShadow = true; sun.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 1, far: 60 });
scene.add(sun);

// ---------------------------------------------------------------- floor paint
const paint = document.createElement('canvas');
paint.width = GW * PX; paint.height = GH * PX;
const pctx = paint.getContext('2d');
const floorTex = new THREE.CanvasTexture(paint);
floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 4;
floorTex.generateMipmaps = false; floorTex.minFilter = THREE.LinearFilter;   // the floor is repainted every frame: no mipmap rebuild per upload
let floorDirty = false;                                                     // uploads are batched: at most one every other frame (see frame())
const touchFloor = () => { floorDirty = true; };
// The floor layer lies over the painted floor and shows only the trails (boss: no dirt or grime). Cleaned floor is the
// owner's tint at 55% (boss pick "B"); everything else is transparent, so the painting shows. When the rules turn
// floor back to dirty (dump, spill), the trail is simply erased.
const TINT = PLAYER_CSS.map(c => `rgba(${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)},.55)`);
const clearCell = (cx, cz) => pctx.clearRect(cx * PX, cz * PX, PX, PX);
function clearFloor() { pctx.clearRect(0, 0, paint.width, paint.height); touchFloor(); }
function paintClean(x, z, r, owner) {
  pctx.beginPath(); pctx.arc((x + MAP_W / 2) / CELL * PX, (z + MAP_H / 2) / CELL * PX, r / CELL * PX, 0, Math.PI * 2);
  pctx.globalCompositeOperation = 'destination-out'; pctx.fill();   // wipe the other tint first: the tint is see-through
  pctx.globalCompositeOperation = 'source-over'; pctx.fillStyle = TINT[owner - 1]; pctx.fill();
  touchFloor();
}
function eraseTrail(ev) {
  for (const i of ev.cells) clearCell(i % GW, Math.floor(i / GW));
  // a completed dump stroke is erased as a round patch too, so the edge is as smooth as a clean stroke
  if (ev.full && ev.r) {
    pctx.beginPath(); pctx.arc((ev.x + MAP_W / 2) / CELL * PX, (ev.z + MAP_H / 2) / CELL * PX, ev.r / CELL * PX, 0, Math.PI * 2);
    pctx.globalCompositeOperation = 'destination-out'; pctx.fill(); pctx.globalCompositeOperation = 'source-over';
  }
  touchFloor();
}
function paintGrid(grid) {   // full repaint from a grid (rejoin)
  clearFloor();
  for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
    const v = grid[cz * GW + cx];
    if (v === 1 || v === 2) { pctx.fillStyle = TINT[v - 1]; pctx.fillRect(cx * PX, cz * PX, PX, PX); }
  }
}
const world = new THREE.Group(); scene.add(world);   // the house: hidden while the main menu's attract scene is showing
// The painted house, drawn first as a full-screen backdrop. `view` is the part of the painting on screen, in painting
// pixels (x0, y0, x1, y1); outside the painting is its charcoal background.
const paintTex = await new THREE.TextureLoader().loadAsync(`./assets/${PAINT.file}`);
paintTex.colorSpace = THREE.SRGBColorSpace; paintTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { map: { value: paintTex }, view: { value: new THREE.Vector4(0, 0, PAINT.width, PAINT.height) }, size: { value: new THREE.Vector2(PAINT.width, PAINT.height) }, bg: { value: new THREE.Color(0x24262c) } },   // = the painting's flattened background
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D map; uniform vec4 view; uniform vec2 size; uniform vec3 bg; varying vec2 vUv;
    void main() {
      vec2 p = vec2(mix(view.x, view.z, vUv.x), mix(view.w, view.y, vUv.y));   // painting pixel under this screen pixel
      gl_FragColor = vec4(p.x < 0.0 || p.y < 0.0 || p.x > size.x || p.y > size.y ? bg : texture2D(map, vec2(p.x / size.x, 1.0 - p.y / size.y)).rgb, 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
}));
backdrop.frustumCulled = false; backdrop.renderOrder = -1e9; world.add(backdrop);
// Grime and tints lie on the floor (unlit, so the painting's colours are kept), above a shadow-only layer for the vacuums.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false }));
floor.rotation.x = -Math.PI / 2; floor.position.y = 0.004; world.add(floor);
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_H), new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false }));
shadowFloor.rotation.x = -Math.PI / 2; shadowFloor.position.y = 0.002; shadowFloor.receiveShadow = true; world.add(shadowFloor);

// Depth occluders: invisible shapes where the painting has furniture and the front outer wall. Whatever the game draws
// behind them (grime, vacuums, inner walls) is hidden there, so the painted thing stays in front. Drawn before
// everything else that writes colour.
const occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });
function addOccluder(x0, z0, x1, z1, h, oval = false) {
  const geo = oval ? new THREE.CylinderGeometry(0.5, 0.5, h, 32).scale(x1 - x0, 1, z1 - z0) : new THREE.BoxGeometry(x1 - x0, h, z1 - z0);
  const m = new THREE.Mesh(geo, occluderMat);
  m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2); m.renderOrder = -1000; world.add(m);
}
// slightly inside each footprint: a vacuum that only grazes a painted edge stays visible
for (const f of layout.furniture) { const r = rectOf(f), s = 0.08; addOccluder(r.x0 + s, r.z0 + s, r.x1 - s, r.z1 - s, f.h ?? 1, f.shape === 'oval'); }
addOccluder(-MAP_W / 2, MAP_H / 2 - 0.4, MAP_W / 2, MAP_H / 2, layout.wallHeight);   // front (south) outer wall

// Inner walls, in the painted walls' look: plum top, warm cream faces. Outer walls are part of the painting.
const isOuter = w => w.x0 <= -MAP_W / 2 + 1e-6 || w.x1 >= MAP_W / 2 - 1e-6 || w.z0 <= -MAP_H / 2 + 1e-6 || w.z1 >= MAP_H / 2 - 1e-6;
// flat colours = the texture's (art/house/textures/NOTES.txt); used for the thin wall ends and if the texture is missing
const wallTop = new THREE.MeshBasicMaterial({ color: 0x775862 }), wallFace = new THREE.MeshBasicMaterial({ color: 0xfcc787 }), wallSide = new THREE.MeshBasicMaterial({ color: 0xd6a973 });
const wallTex = await new THREE.TextureLoader().loadAsync('./assets/inner-wall.png').catch(() => null);   // Codex's 256×256: rows 0–63 top, 64–255 face
if (wallTex) { wallTex.colorSpace = THREE.SRGBColorSpace; wallTex.wrapS = THREE.RepeatWrapping; wallTex.anisotropy = 4; }
function wallMat(base, len, part) {   // part: 'top' (0.4 m across) or 'face' (wall height tall); the texture repeats along the wall
  if (!wallTex) return base;
  const t = wallTex.clone(); t.needsUpdate = true;
  if (part === 'top') { t.repeat.set(len / 1.6, 0.25); t.offset.set(0, 0.75); } else { t.repeat.set(len / 2.5, 0.75); t.offset.set(0, 0); }
  return new THREE.MeshBasicMaterial({ map: t, color: base === wallSide ? 0xdddddd : 0xffffff });
}
for (const w of layout.walls.filter(w => !isOuter(w))) {
  const along = (w.x1 - w.x0) >= (w.z1 - w.z0), len = along ? w.x1 - w.x0 : w.z1 - w.z0, thick = along ? w.z1 - w.z0 : w.x1 - w.x0, H = layout.wallHeight;
  // built along local x, then turned for north-south walls, so the texture always runs along the wall
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z. The camera looks from the south, so south faces get the lit cream.
  // A north-south wall is turned +90°: local -x faces south, local ±z become its east / west sides.
  const faces = along
    ? [wallSide, wallSide, wallMat(wallTop, len, 'top'), wallTop, wallMat(wallFace, len, 'face'), wallFace]
    : [wallSide, wallMat(wallFace, thick, 'face'), wallMat(wallTop, len, 'top'), wallTop, wallMat(wallSide, len, 'face'), wallMat(wallSide, len, 'face')];
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, H, thick), faces);
  m.position.set((w.x0 + w.x1) / 2, H / 2, (w.z0 + w.z1) / 2);
  if (!along) m.rotation.y = Math.PI / 2;
  world.add(m);
}

// ---------------------------------------------------------------- models and static scene
const loader = new GLTFLoader();
const models = {};
// models.js (optional) embeds the .glb files as base64 for hosts that can't serve binary files; otherwise fetch them
const embedded = await import('./models.js').then(m => m.MODELS).catch(() => null);
async function loadModel(name) {
  let gltf;
  if (embedded && embedded[name]) {
    const bin = atob(embedded[name]), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    gltf = await new Promise((res, rej) => loader.parse(buf.buffer, '', res, rej));
  } else gltf = await loader.loadAsync(`./assets/models/${name}.glb`);
  gltf.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  models[name] = gltf.scene;
}
await Promise.all(['vacuum', 'dock'].map(loadModel));   // the furniture is painted
for (const d of layout.docks) {
  const m = models.dock.clone(); m.position.set(d.x, 0, d.z); m.rotation.y = -THREE.MathUtils.degToRad(d.rot); world.add(m);   // same turn convention as the vacuums
}
const spotMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.35 });
for (const s of layout.powerupSpots) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 32), spotMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.01, s.z); world.add(ring);
}

// ---------------------------------------------------------------- vacuum visuals
function makeVacuumVisual(idx) {
  const root = new THREE.Group();
  const body = models.vacuum.clone();
  const brushes = [];
  body.traverse(o => {
    if (o.name === 'Brush_L' || o.name === 'Brush_R') brushes.push(o);
    if (!o.isMesh) return;
    o.material = o.material.clone();
    if (o.material.name === 'VacBody') o.material.color.setHex(PLAYER_COLORS[idx]);
  });
  root.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 40), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.255; root.add(ring);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16), new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.28, roughness: 0.2 }));
  shield.position.y = 0.2; shield.visible = false; root.add(shield);
  const gauge = new THREE.Group();
  const gbg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.16), new THREE.MeshBasicMaterial({ color: 0x1c1917 }));
  const gfill = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.1), new THREE.MeshBasicMaterial({ color: 0x92400e }));
  gfill.position.z = 0.001; gauge.add(gbg, gfill); gauge.rotation.x = -Math.PI / 2 + 0.5; gauge.position.y = 1.0;
  scene.add(root, gauge);
  return { root, gauge, gfill, ring, brushes, shield, spin: 0, x: 0, z: 0, h: 0 };
}
const vis = [makeVacuumVisual(0), makeVacuumVisual(1)];

// ---------------------------------------------------------------- toppers (cosmetic) + trails
const TOPPER_KEYS = Object.keys(TOPPERS).filter(k => k !== 'none');
let myTopper = 'duck';
try { const s = localStorage.getItem('dd-topper'); if (s && TOPPERS[s]) myTopper = s; } catch {}
const trails = createTrails(scene);
function setTopper(i, type) {
  const V = vis[i];
  if (V.topper) V.root.remove(V.topper);
  V.topper = makeTopper(type); V.topperType = type;
  if (V.topper) V.root.add(V.topper);
}
function assignToppers() {
  // you wear your own pick; the other vacuum (computer or second player) wears a different one so you can compare
  const others = TOPPER_KEYS.filter(k => k !== myTopper);
  const other = others[Math.floor(Math.random() * others.length)] || 'none';
  if (mode === 'local') { setTopper(0, myTopper); setTopper(1, other); }
  else if (me >= 0) { setTopper(me, myTopper); setTopper(1 - me, mode === 'online' ? 'none' : other); }
  else { setTopper(0, myTopper); setTopper(1, other); }
  trails.clear();
}
function pickTopper(type) {
  myTopper = type; try { localStorage.setItem('dd-topper', type); } catch {}
  if (me >= 0) setTopper(me, type); else setTopper(0, type);
  menu.setTopper(0, type); renderGarage();
  trails.clear(); renderTopperBar();
}

// ---------------------------------------------------------------- particles
const PARTICLE_N = 160, partGeo = new THREE.SphereGeometry(0.07, 6, 4), particles = [];
for (let i = 0; i < PARTICLE_N; i++) {
  const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  m.visible = false; scene.add(m); particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 1 });
}
let pIdx = 0;
function burst(x, z, color, n, speed = 2, up = 2, size = 1) {
  for (let i = 0; i < n; i++) {
    const p = particles[pIdx = (pIdx + 1) % PARTICLE_N], a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
    p.mesh.position.set(x, 0.15, z); p.mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
    p.mesh.material.color.setHex(color); p.mesh.material.opacity = 1; p.mesh.visible = true;
    p.vel.set(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s);
    p.life = p.max = 0.35 + Math.random() * 0.4;
  }
}
function stepParticles(dt) {
  for (const p of particles) {
    if (!p.mesh.visible) continue;
    p.life -= dt; if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vel.y -= 9 * dt; p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.y < 0.05) { p.mesh.position.y = 0.05; p.vel.y *= -0.3; }
    p.mesh.material.opacity = p.life / p.max;
  }
}

// ---------------------------------------------------------------- main menu attract scene (menu.js)
const menu = createMenu({ scene, camera, vacuumModel: models.vacuum, colors: PLAYER_COLORS, css: PLAYER_CSS, trails, burst });
let menuOn = false;        // the attract scene is showing (menu, garage, and while waiting for an online rival)
let seenIntro = false, laps = 0;
function enterMenuScene() {
  menuOn = true; world.visible = false;
  for (const V of vis) { V.root.visible = false; V.gauge.visible = false; }
  document.body.classList.add('menu'); document.body.classList.remove('menuready', 'garage');
  document.body.classList.toggle('intro', !seenIntro);
  $('lap').textContent = String(laps + 1).padStart(2, '0');
  const others = TOPPER_KEYS.filter(k => k !== myTopper);
  menu.setTopper(0, myTopper); menu.setTopper(1, others[Math.floor(Math.random() * others.length)] || 'none');
  menu.start({ intro: !seenIntro, onReady: () => { seenIntro = true; document.body.classList.remove('intro'); document.body.classList.add('menuready'); } });
}
function leaveMenuScene() {
  if (!menuOn) return;
  menuOn = false; menu.stop(); world.visible = true;
  for (const V of vis) { V.root.visible = true; V.gauge.visible = true; }
  document.body.classList.remove('menu', 'menuready', 'garage', 'intro');
}
// checkered wipe that hides the camera cut between the menu and the house
function transition(fn) {
  const w = $('wipe');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
  w.className = 'in';
  setTimeout(() => { fn(); w.className = 'out'; setTimeout(() => { w.className = ''; }, 340); }, 280);
}

// ---------------------------------------------------------------- entity meshes (pickups, traps, spills), synced by id
const entityMeshes = new Map();
// shared glow textures
function gradientTexture(draw) { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const radialTex = gradientTexture(ctx => { const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); });
const beamTex = gradientTexture(ctx => { const g = ctx.createLinearGradient(0, 128, 0, 0); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); });
const glowMat = c => ({ color: c, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

// icon silhouettes, roughly within a 0.64-unit square
const ICONS = {
  turbo: () => poly([[0.09, 0.33], [-0.17, -0.01], [-0.01, -0.01], [-0.09, -0.33], [0.18, 0.05], [0.02, 0.05]]),             // lightning bolt
  wide: () => poly([[-0.33, 0], [-0.13, 0.18], [-0.13, 0.07], [0.13, 0.07], [0.13, 0.18], [0.33, 0], [0.13, -0.18], [0.13, -0.07], [-0.13, -0.07], [-0.13, -0.18]]),   // ↔
  shield: () => { const sh = shieldPath(1), hole = shieldPath(0.55); sh.holes.push(hole); return [sh]; },
  cables: () => [roundRect(-0.15, -0.06, 0.3, 0.22, 0.05), rect(-0.1, 0.16, 0.05, 0.14), rect(0.05, 0.16, 0.05, 0.14), rect(-0.035, -0.33, 0.07, 0.28)],  // plug
  spill: () => { const sh = new THREE.Shape(); sh.moveTo(0, 0.33); sh.bezierCurveTo(0.05, 0.22, 0.24, 0.03, 0.24, -0.1); sh.absarc(0, -0.1, 0.24, 0, Math.PI, true); sh.bezierCurveTo(-0.24, 0.03, -0.05, 0.22, 0, 0.33); return [sh]; },   // droplet
};
function poly(pts) { const sh = new THREE.Shape(); sh.moveTo(...pts[0]); for (const q of pts.slice(1)) sh.lineTo(...q); sh.closePath(); return [sh]; }
function rect(x, y, w, h) { return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])[0]; }
function roundRect(x, y, w, h, r) { const sh = new THREE.Shape(); sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h); sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y); return sh; }
function shieldPath(k) { const p = new THREE.Path(); p.moveTo(0, 0.31 * k); p.lineTo(0.25 * k, 0.22 * k); p.lineTo(0.23 * k, -0.02 * k); p.quadraticCurveTo(0.19 * k, -0.21 * k, 0, -0.33 * k); p.quadraticCurveTo(-0.19 * k, -0.21 * k, -0.23 * k, -0.02 * k); p.lineTo(-0.25 * k, 0.22 * k); p.closePath(); return k === 1 ? new THREE.Shape(p.getPoints()) : p; }

const badgeCache = {};
function badgeParts(type) {   // geometry + materials are built once per type and shared
  if (badgeCache[type]) return badgeCache[type];
  const c = PU_COLOR[type];
  const discShape = new THREE.Shape(); discShape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  const disc = new THREE.ExtrudeGeometry(discShape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 40 }); disc.center();
  const icon = new THREE.ExtrudeGeometry(ICONS[type](), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 16 }); icon.center();
  return badgeCache[type] = {
    disc, icon, rim: new THREE.TorusGeometry(0.53, 0.035, 10, 48),
    discMat: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.1 }),
    iconMat: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.25 }),
    rimMat: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.3 }),
  };
}
const beamGeo = new THREE.CylinderGeometry(0.38, 0.55, 2.4, 28, 1, true), pulseGeo = new THREE.RingGeometry(0.5, 0.62, 40), groundGeo = new THREE.CircleGeometry(0.85, 32), sparkGeo = new THREE.OctahedronGeometry(0.06);
function makePickupMesh(p) {
  const g = new THREE.Group(), c = PU_COLOR[p.type], B = badgeParts(p.type);
  const badge = new THREE.Group(); badge.name = 'badge'; badge.position.y = 1.05;
  const disc = new THREE.Mesh(B.disc, B.discMat), rim = new THREE.Mesh(B.rim, B.rimMat);
  const front = new THREE.Mesh(B.icon, B.iconMat); front.position.z = 0.1;
  const back = new THREE.Mesh(B.icon, B.iconMat); back.position.z = -0.1; back.rotation.y = Math.PI;
  for (const m of [disc, rim, front]) m.castShadow = true;
  badge.add(disc, rim, front, back);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex, ...glowMat(c), opacity: 0.7 })); glow.name = 'glow'; glow.position.y = 1.05; glow.scale.setScalar(2.4);
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, ...glowMat(c), opacity: 0.55, side: THREE.DoubleSide })); beam.position.y = 1.2;
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ map: radialTex, ...glowMat(c), opacity: 0.9 })); ground.rotation.x = -Math.PI / 2; ground.position.y = 0.02;
  const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ ...glowMat(c), opacity: 0.6 })); pulse.name = 'pulse'; pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.03;
  const sparks = new THREE.Group(); sparks.name = 'sparks';
  for (let i = 0; i < 6; i++) sparks.add(new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false })));
  g.add(ground, pulse, beam, glow, badge, sparks);
  g.position.set(p.x, 0, p.z);
  g.userData = { born: performance.now() / 1000, phase: Math.random() * 6, badge, glow, pulse, sparks };   // parts cached: no per-frame lookups
  burst(p.x, p.z, c, 14, 1.8, 3, 0.9);   // spawn pop
  return g;
}
const easeOutBack = x => 1 + 2.7 * Math.pow(x - 1, 3) + 1.7 * Math.pow(x - 1, 2);
function animatePickup(m) {
  const T = performance.now() / 1000, { born, phase, badge, glow, pulse, sparks } = m.userData, age = T - born;
  const pop = age < 0.55 ? Math.max(0.001, easeOutBack(age / 0.55)) : 1;
  badge.scale.setScalar(pop); glow.scale.setScalar(2.4 * pop);
  badge.position.y = glow.position.y = 1.05 + Math.sin(T * 2.6 + phase) * 0.12;
  badge.lookAt(houseCam.position);                                  // always face the camera so the icon reads
  badge.rotateY(Math.sin(T * 1.8 + phase) * 0.45);                  // gentle coin wobble
  glow.material.opacity = 0.6 + Math.sin(T * 4 + phase) * 0.15;
  const ph = (T * 0.9 + phase) % 1; pulse.scale.setScalar(1 + ph * 1.3); pulse.material.opacity = 0.7 * (1 - ph);
  sparks.children.forEach((s, i) => {
    const k = (T * 0.55 + i / 6 + phase) % 1, a = T * 1.6 + i * Math.PI / 3;
    s.position.set(Math.cos(a) * 0.72, 0.2 + k * 1.7, Math.sin(a) * 0.72); s.rotation.y = T * 3;
    s.material.opacity = Math.sin(k * Math.PI);
  });
}
function makeTrapMesh(t) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const curve = new THREE.CatmullRomCurve3([0, 1, 2, 3].map(() => new THREE.Vector3((Math.random() - 0.5) * 1.1, 0.05, (Math.random() - 0.5) * 1.1)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5), new THREE.MeshStandardMaterial({ color: 0x374151 })));
  }
  g.position.set(t.x, 0, t.z); return g;
}
const makeSpillMesh = () => new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshStandardMaterial({ color: 0x78350f }));
function syncEntities(view, time) {
  const seen = new Set();
  for (const p of view.pickups) { seen.add('p' + p.id); if (!entityMeshes.has('p' + p.id)) { const m = makePickupMesh(p); scene.add(m); entityMeshes.set('p' + p.id, m); }
    animatePickup(entityMeshes.get('p' + p.id)); }
  for (const t of view.traps) { seen.add('t' + t.id); if (!entityMeshes.has('t' + t.id)) { const m = makeTrapMesh(t); scene.add(m); entityMeshes.set('t' + t.id, m); } }
  for (const s of view.spills) { seen.add('s' + s.id); if (!entityMeshes.has('s' + s.id)) { const m = makeSpillMesh(); scene.add(m); entityMeshes.set('s' + s.id, m); }
    entityMeshes.get('s' + s.id).position.set(s.x, s.y, s.z); }
  for (const [k, m] of entityMeshes) if (!seen.has(k)) { scene.remove(m); entityMeshes.delete(k); }
}

// ---------------------------------------------------------------- HUD
const $ = id => document.getElementById(id);
const hud = {
  timer: $('timer'), panels: [$('panel1'), $('panel2')],
  tug: $('tug'), t1: document.querySelector('#tug .t1'), t2: document.querySelector('#tug .t2'), tugL: $('tugL'), tugR: $('tugR'),
  revealLabel: $('revealLabel'), overButtons: $('overButtons'), confetti: $('confetti'),
  modes: [$('mode1'), $('mode2')], bins: [$('bin1'), $('bin2')], binlabels: [$('binlabel1'), $('binlabel2')], items: [$('item1'), $('item2')],
  tags: [$('tag1'), $('tag2')], keys: [$('keys1'), $('keys2')],
  overlay: $('overlay'), waiting: $('waiting'), result: $('result'), resultTop: $('resultTop'), resultline: $('resultline'), sticker: $('sticker'), plates: $('plates'), tally: $('tally'),
  countdown: $('countdown'), cdNum: $('cdNum'), lights: [...document.querySelectorAll('#lights i')], banner: $('banner'), status: $('status'), code: $('code'), waitHint: $('waitHint'),
  btnMode: $('btnMode'), btnItem: $('btnItem'),
};
let bannerTimer = 0;
function flashBanner(text, ms = 1200) {
  hud.banner.textContent = text; hud.banner.style.opacity = 1;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => hud.banner.style.opacity = 0, ms);
}
function showCard(name) {
  for (const c of ['how', 'pit', 'waiting']) $(c).style.display = c === name ? 'block' : 'none';
  hud.overlay.classList.toggle('hidden', !name);
}
// DOM writes only when the text actually changes (writing the same string every frame still costs layout on phones)
const setText = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const setHTML = (el, s) => { if (el._h !== s) { el._h = s; el.innerHTML = s; } };
const setStyle = (el, prop, s) => { if (el._s?.[prop] !== s) { (el._s ||= {})[prop] = s; el.style[prop] = s; } };
function updateHUD(view) {
  // no live score on purpose: nobody should know who is winning until the reveal
  const t = Math.max(0, Math.ceil(view.timeLeft));
  setText(hud.timer, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
  hud.timer.classList.toggle('hurry', view.phase === 'playing' && view.timeLeft <= C.HURRY_AT);
  view.vacs.forEach((v, i) => {
    if (hud.panels[i].style.display === 'none') return;
    const full = v.bin >= C.BIN_CAP, pct = Math.round(v.bin / C.BIN_CAP * 100);
    setText(hud.modes[i], v.mode.toUpperCase()); if (hud.modes[i]._m !== v.mode) { hud.modes[i]._m = v.mode; hud.modes[i].className = `mode ${v.mode}`; }
    setStyle(hud.bins[i].firstElementChild, 'width', `${pct}%`); hud.bins[i].classList.toggle('full', full);
    setText(hud.binlabels[i], full ? 'Bin FULL — dump!' : `Bin ${pct}%`);
    const fx = [];
    if (v.turboUntil > view.time) fx.push('Turbo'); if (v.wideUntil > view.time) fx.push('Wide'); if (v.shieldUntil > view.time) fx.push('Shield');
    setHTML(hud.items[i], (v.item ? `<span class="chip" style="background:${PU_CSS[v.item]}"></span>${POWERUPS[v.item].name}` : 'No item') + (fx.length ? ` · ${fx.join(' ')}` : ''));
    hud.items[i].classList.toggle('has', !!v.item);
  });
  if (me >= 0) {
    const v = view.vacs[me];
    hud.btnMode.classList.toggle('dump', v.mode === 'dump');   // the switch slides to the current mode
    if (hud.btnItem.dataset.item !== (v.item || '')) {
      hud.btnItem.dataset.item = v.item || '';
      hud.btnItem.innerHTML = v.item ? `<span class="ico">${ITEM_ICON[v.item]}</span>${POWERUPS[v.item].name.toUpperCase()}` : '';
      hud.btnItem.style.background = v.item ? PU_CSS[v.item] : '';
      hud.btnItem.classList.toggle('has', !!v.item);
    }
  }
  if (view.phase === 'countdown') {
    const n = Math.ceil(view.countdown - 0.5), go = n <= 0;
    setText(hud.cdNum, go ? 'GO!' : String(n)); hud.cdNum.classList.toggle('go', go); setStyle(hud.countdown, 'display', 'flex');
    // start lights: reds come on one by one through the count, all green on GO
    const lit = Math.min(5, Math.floor((C.COUNTDOWN - view.countdown) / (C.COUNTDOWN - 0.5) * 5 + 0.001));
    hud.lights.forEach((l, i) => { l.className = go ? 'g' : i < lit ? 'r' : ''; });
  } else setStyle(hud.countdown, 'display', 'none');
}

// ---------------------------------------------------------------- events → effects
// per-match stats for the results plates, counted from the events (no rule changes): stolen cells, dumps, power-ups
const stats = [{ stolen: 0, dumps: 0, pickups: 0 }, { stolen: 0, dumps: 0, pickups: 0 }];
let bumps = 0;
const wins = [0, 0];   // today's tally (this page session)
try { const w = JSON.parse(sessionStorage.getItem('dd-wins') || 'null'); if (Array.isArray(w)) { wins[0] = w[0] | 0; wins[1] = w[1] | 0; } } catch {}
function handleEvent(ev, view) {
  const t = view.time;
  switch (ev.e) {
    case 'reset': clearFloor(); for (const [k, m] of entityMeshes) { scene.remove(m); } entityMeshes.clear(); for (const st of stats) { st.stolen = st.dumps = st.pickups = 0; } bumps = 0; reveal.active = false; document.body.classList.remove('results'); break;
    case 'clean': paintClean(ev.x, ev.z, ev.r, ev.o); if (ev.s) stats[ev.o - 1].stolen += ev.s; break;
    case 'dirt': eraseTrail(ev); break;
    case 'toggle': burst(ev.x, ev.z, ev.mode === 'clean' ? 0xbbf7d0 : 0x92400e, 8, 1.2, 1.5, 0.7); if (ev.mode === 'dump') stats[ev.p].dumps++; break;
    case 'pickup': burst(ev.x, ev.z, PU_COLOR[ev.type], 10, 1.5, 2); stats[ev.p].pickups++; break;
    case 'use': if (ev.p === me || mode === 'local' || !ev.auto) flashBanner(ev.auto && ev.p === me ? `${POWERUPS[ev.type].name.toUpperCase()}!` : `${PLAYER_NAMES[ev.p]}: ${POWERUPS[ev.type].name}!`, 800); break;
    case 'bump': burst(ev.x, ev.z, 0xd6d3d1, 16, 2.2, 2.6, 0.8); flashBanner('BUMP!', 500); bumpTopper(vis[0].topper); bumpTopper(vis[1].topper); bumps++; break;
    case 'stuck': burst(ev.x, ev.z, 0xfde047, 14, 1.5, 2.5, 0.6); flashBanner(`${PLAYER_NAMES[ev.p]} is tangled in cables!`, 900); break;
    case 'blocked': burst(ev.x, ev.z, 0x38bdf8, 12, 2, 2); break;
    case 'spill': burst(ev.x, ev.z, ev.shielded ? 0x38bdf8 : 0x78350f, 22, 2.5, 2.5, 0.9); break;
    case 'binfull': flashBanner(`${PLAYER_NAMES[ev.p]}'s bin is full!`, 900); break;
    case 'hurry': flashBanner('FINAL 15 SECONDS!'); break;
    case 'go': break;
    case 'over': showResult(view, ev); break;
  }
}
let revealRun = 0;
// Reveal choreography (cosmetic, runs on each client from the 'over' event, so online both see the same):
// pull back → the bar shoves for a few seconds → banner slams in, camera dives to the winner doing donuts.
const reveal = { active: false, cam: false, w: 0, cx: 0, cz: 0, r: 0, a: 0, t: 0 };
function donutRadius(x, z) {   // biggest circle around (x, z) the vacuum can drive without hitting furniture or walls
  for (const r of [1.4, 1.0, 0.7]) {
    let ok = true;
    for (let i = 0; i < 20 && ok; i++) {
      const a = i / 20 * Math.PI * 2, p = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      const q = { x: p.x, z: p.z }; sim.collide(q);
      if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-3) ok = false;
    }
    if (ok) return r;
  }
  return 0;   // no room: spin on the spot
}
function startDonuts(w) {
  const V = vis[w - 1];
  reveal.w = w - 1; reveal.r = donutRadius(V.x, V.z); reveal.a = V.h - Math.PI / 2; reveal.t = 0;
  reveal.cx = V.x - Math.cos(reveal.a) * reveal.r; reveal.cz = V.z - Math.sin(reveal.a) * reveal.r;
  reveal.active = true; reveal.cam = false;   // the camera stays on the whole house (following the donuts made people dizzy)
}
function stepReveal(dt) {   // called from update() while the match is over
  if (!reveal.active) return;
  reveal.t += dt;
  const W = vis[reveal.w], L = vis[1 - reveal.w];
  const speed = reveal.r > 0 ? 4.2 / Math.max(reveal.r, 0.5) : 5;    // rad/s
  reveal.a += speed * dt;
  W.x = reveal.cx + Math.cos(reveal.a) * reveal.r; W.z = reveal.cz + Math.sin(reveal.a) * reveal.r; W.h = reveal.a + Math.PI / 2;
  W.spin += 18 * dt;
  if (reveal.r > 0) paintClean(W.x, W.z, C.BRUSH_R * 0.8, reveal.w + 1);
  if (reveal.t < 6 && Math.random() < 0.5) burst(W.x - Math.cos(W.h) * 0.5, W.z - Math.sin(W.h) * 0.5, 0xffffff, 1, 0.8, 1.6, 0.6);
  if (L.topper) { L.topper.rotation.z = -0.35 + Math.sin(reveal.t * 1.6) * 0.08; L.topper.rotation.x = 0.15; }   // the loser's hat droops
}
function endReveal() { if (reveal.active) { const L = vis[1 - reveal.w]; if (L.topper) { L.topper.rotation.z = 0; L.topper.rotation.x = 0; } } reveal.active = false; reveal.cam = false; }
function tallyLabel() {
  const names = mode === 'solo' ? ['YOU', 'COMPUTER'] : mode === 'online' ? (me === 0 ? ['YOU', 'FRIEND'] : ['FRIEND', 'YOU']) : ['BLUE', 'ORANGE'];
  return `TODAY · <b class="p1">${names[0]} ${wins[0]}</b> – <b class="p2">${wins[1]} ${names[1]}</b>`;
}
function showResult(view, ev) {
  const tot = view.totalCells || 1, a = view.counts[1] / tot * 100, b = view.counts[2] / tot * 100, w = ev.winner;
  const run = ++revealRun;
  endReveal();
  hud.resultTop.textContent = ''; hud.resultline.textContent = ''; hud.result.className = 'win'; hud.sticker.className = 'sticker';
  hud.overButtons.classList.remove('show'); hud.confetti.innerHTML = ''; hud.plates.innerHTML = '';
  hud.revealLabel.textContent = ev.reason === 'left' ? 'THE OTHER PLAYER LEFT' : "TIME'S UP — COUNTING THE FLOOR…";
  hud.tugL.textContent = '?'; hud.tugR.textContent = '?'; hud.tug.classList.add('shake');
  // the camera pulls back to the whole house first, so both players see the damage before the bar
  if (ev.reason !== 'left') flashBanner("TIME'S UP!", 1600);
  const HOLD = ev.reason === 'left' ? 300 : (followAllowed() ? 2600 : 1200);
  // the bar is split between the two players' cleaned floor only (no dirty gap): blue share = a / (a + b)
  const share = a + b > 0 ? a / (a + b) * 100 : 50;
  const setBar = l => { hud.t1.style.width = `${l}%`; hud.t2.style.width = `${100 - l}%`; for (const el of hud.tug.querySelectorAll('.flag, .mini')) el.style.left = `${l}%`; };
  const label = l => { hud.tugL.textContent = `${Math.round(l)}%`; hud.tugR.textContent = `${100 - Math.round(l)}%`; };
  setBar(50);
  // the bar wrestles back and forth for a few seconds, then snaps to the truth
  const DUR = ev.reason === 'left' ? 1.2 : 4.2; let start = 0;
  const lurches = []; let tt = 0.25;
  let side = Math.random() < 0.5 ? -1 : 1;
  while (tt < DUR - 0.4) { side = -side; lurches.push({ t: tt, l: 50 + side * (8 + Math.random() * 22) }); tt += 0.35 + Math.random() * 0.3; }   // alternate sides
  const ease = x => 1 - Math.pow(1 - x, 3);
  setTimeout(() => { if (run !== revealRun) return; document.body.classList.add('results'); start = performance.now(); requestAnimationFrame(frame); }, HOLD);
  function frame() {
    if (run !== revealRun) return;
    const el = (performance.now() - start) / 1000;
    if (el < DUR) {
      let i = 0; while (i < lurches.length - 1 && lurches[i + 1].t <= el) i++;
      const from = lurches[Math.max(0, i - 1)] || { l: 50 }, to = lurches[i] || from;
      const k = ease(Math.min(1, (el - (lurches[i]?.t ?? 0)) / 0.3)), late = Math.min(1, el / DUR) ** 2;   // drift toward the real split late on
      const cur = from.l + (to.l - from.l) * k, pos = cur + (share - cur) * late * 0.6;
      setBar(pos); label(pos);
      requestAnimationFrame(frame); return;
    }
    setBar(share); label(share); hud.tug.classList.remove('shake');
    hud.revealLabel.textContent = 'FINAL';
    // verdict sticker by margin
    const ws = w === 1 ? share : 100 - share;
    hud.sticker.textContent = w === 0 ? 'SPLIT DECISION' : ws > 80 ? 'LANDSLIDE' : ws > 65 ? 'CLEAN SWEEP' : ws < 55 ? 'PHOTO FINISH' : 'CHECKERED FLAG';
    hud.sticker.classList.add('show');
    const who = i => mode === 'solo' ? (i === 0 ? 'YOU' : 'THE COMPUTER') : mode === 'online' ? (i === me ? 'YOU' : 'YOUR FRIEND') : PLAYER_NAMES[i].toUpperCase();
    hud.resultTop.textContent = w === 0 ? "IT'S A TIE!" : `${PLAYER_NAMES[w - 1].toUpperCase()} WINS!`;
    hud.resultline.textContent = w === 0 ? 'NOBODY TAKES THE HOUSE' : `${who(w - 1)} TAKE${who(w - 1) === 'YOU' ? '' : 'S'} THE HOUSE`;
    hud.result.classList.add('show', w === 1 ? 'p1' : w === 2 ? 'p2' : 'tie');
    // plates: both shares, then the stats of "you" (or the winner when nobody is "you")
    const mine = me >= 0 ? me : Math.max(0, w - 1), st = stats[mine], m2 = (st.stolen * C.CELL * C.CELL).toFixed(1);
    const plates = [
      [`${m2} m²`, `${me >= 0 ? 'YOU' : PLAYER_NAMES[mine].toUpperCase()} STOLE`], [String(st.pickups), 'POWER-UPS'], [String(bumps), 'BUMPS'],
    ];
    // stats are counted but not shown (the boss wants the recap short): plates stay empty
    if (w !== 0) { wins[w - 1]++; try { sessionStorage.setItem('dd-wins', JSON.stringify(wins)); } catch {} startDonuts(w); }
    if (w !== 0) confetti(w === 1 ? ['#3b82f6', '#93c5fd', '#1d4ed8', '#fff'] : ['#f97316', '#fdba74', '#c2410c', '#fff']);
    setTimeout(() => { if (run === revealRun) hud.overButtons.classList.add('show'); }, 900);
  }
}
function confetti(colors) {
  for (let i = 0; i < 90; i++) {
    const el = document.createElement('i');
    el.style.left = `${Math.random() * 100}%`; el.style.background = colors[i % colors.length];
    el.style.animationDuration = `${1.6 + Math.random() * 1.6}s`; el.style.animationDelay = `${Math.random() * 0.6}s`;
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    hud.confetti.appendChild(el);
  }
}

// ---------------------------------------------------------------- controls
const KEYS = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', mode: 'Space', use: 'KeyQ' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', mode: 'Enter', use: 'ShiftRight' },
];
const inputs = [makeInput(), makeInput()];
const down = new Set();
let mode = 'menu';      // menu | solo | local | online
let me = -1;            // which vacuum I drive (solo: 0, online: my slot, local: -1)
function keyboardSlot(i) { return mode === 'local' ? i : me; }   // in solo/online both key sets drive my vacuum
function pressAction(slot, kind) {
  if (slot < 0) return;
  if (mode === 'online') net.action(kind); else inputs[slot][kind] = true;
}
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  down.add(e.code);
  if (mode === 'menu') return;
  KEYS.forEach((k, i) => {
    const slot = keyboardSlot(i);
    if (e.code === k.mode) pressAction(slot, 'toggle');
    if (e.code === k.use) pressAction(slot, 'use');
  });
  if (e.code === 'KeyR' && document.body.classList.contains('results') && hud.overButtons.classList.contains('show')) playAgain();
});
window.addEventListener('keyup', e => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

const touch = { active: false, id: -1, ox: 0, oy: 0, ix: 0, iz: 0 };
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');
const zone = $('zone'), stick = $('stick'), knob = $('knob');
zone.addEventListener('pointerdown', e => {
  if (touch.active) return;
  document.body.classList.add('touch');
  touch.active = true; touch.id = e.pointerId; touch.ox = e.clientX; touch.oy = e.clientY; touch.ix = touch.iz = 0;
  stick.style.display = 'block'; stick.style.left = `${e.clientX - 75}px`; stick.style.top = `${e.clientY - 75}px`;
  knob.style.left = '43px'; knob.style.top = '43px';
  zone.setPointerCapture(e.pointerId);
});
zone.addEventListener('pointermove', e => {
  if (!touch.active || e.pointerId !== touch.id) return;
  let dx = e.clientX - touch.ox, dy = e.clientY - touch.oy;
  const len = Math.hypot(dx, dy), max = 50;
  if (len > max) { dx *= max / len; dy *= max / len; }
  knob.style.left = `${43 + dx}px`; knob.style.top = `${43 + dy}px`;
  const n = Math.min(1, len / max);
  touch.ix = n < 0.15 ? 0 : dx / (len || 1); touch.iz = n < 0.15 ? 0 : dy / (len || 1);
});
const endTouch = e => { if (touch.active && e.pointerId === touch.id) { touch.active = false; touch.ix = touch.iz = 0; stick.style.display = 'none'; } };
zone.addEventListener('pointerup', endTouch); zone.addEventListener('pointercancel', endTouch);
for (const [btn, kind] of [[hud.btnMode, 'toggle'], [hud.btnItem, 'use']]) {
  btn.addEventListener('pointerdown', e => { e.preventDefault(); btn.classList.add('down'); if (mode !== 'menu') pressAction(me, kind); });
  btn.addEventListener('pointerup', () => btn.classList.remove('down'));
  btn.addEventListener('pointercancel', () => btn.classList.remove('down'));
}
function readMovement(slot) {   // keyboard set + touch → ix/iz for a slot
  let ix = 0, iz = 0;
  KEYS.forEach((k, i) => {
    if (keyboardSlot(i) !== slot) return;
    ix += (down.has(k.right) ? 1 : 0) - (down.has(k.left) ? 1 : 0);
    iz += (down.has(k.down) ? 1 : 0) - (down.has(k.up) ? 1 : 0);
  });
  if (slot === me && touch.active) { ix = touch.ix; iz = touch.iz; }
  return [Math.max(-1, Math.min(1, ix)), Math.max(-1, Math.min(1, iz))];
}

// ---------------------------------------------------------------- online client
const net = {
  ws: null, slot: -1, token: null, code: null, latest: null, pending: [], lastSent: '', lastSentAt: 0, ready: false,
  connect(msg) {
    this.close();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    hud.status.textContent = 'Connecting…';
    ws.onopen = () => ws.send(JSON.stringify(msg));
    ws.onmessage = e => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => { if (mode === 'online' && this.ws === ws) { goMenu(); hud.status.textContent = 'Connection to the server was lost.'; } };
    ws.onerror = () => { hud.status.textContent = 'Could not reach the game server.'; };
  },
  close() { if (this.ws) { const w = this.ws; this.ws = null; w.onclose = null; w.close(); } this.latest = null; this.pending = []; this.ready = false; },
  onMessage(m) {
    switch (m.t) {
      case 'room':
        this.slot = m.slot; this.token = m.token; this.code = m.code; me = m.slot; assignToppers();
        try { sessionStorage.setItem('dd-room', JSON.stringify({ code: m.code, token: m.token })); } catch {}
        hud.code.textContent = m.code; hud.waitHint.textContent = m.lan ? `Friends on your Wi-Fi open ${m.lan}` : '';
        if (m.waiting) showCard('waiting'); else { leaveMenuScene(); showCard(null); }
        setTags(); break;
      case 'start': leaveMenuScene(); showCard(null); hud.status.textContent = ''; break;
      case 'state': if (menuOn) leaveMenuScene(); this.pending.push(m); break;
      case 'grid': { const bin = atob(m.grid); const g = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) g[i] = bin.charCodeAt(i); paintGrid(g); break; }
      case 'opponent': flashBanner(m.status === 'left' ? 'Opponent disconnected — waiting…' : 'Opponent is back!', 2000); break;
      case 'error': { const msg = m.msg; this.close(); goMenu(); hud.status.textContent = msg; break; }
    }
  },
  sendMove(ix, iz) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const key = `${ix.toFixed(2)},${iz.toFixed(2)}`, now = performance.now();
    if (key !== this.lastSent || now - this.lastSentAt > 100) { this.ws.send(JSON.stringify({ t: 'm', ix: +ix.toFixed(2), iz: +iz.toFixed(2) })); this.lastSent = key; this.lastSentAt = now; }
  },
  action(kind) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'a', k: kind })); },
  again() { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'again' })); },
};
// predicted position of my own vacuum (online)
const pred = { x: 0, z: 0, h: 0, init: false };

// ---------------------------------------------------------------- match flow
let bot = null;
let view = sim.state;    // what we render: the local sim state, or the latest server snapshot
function setTags() {
  hud.tags[0].textContent = me === 0 ? '(you)' : (mode === 'solo' ? '' : mode === 'online' ? '(friend)' : '');
  hud.tags[1].textContent = me === 1 ? '(you)' : (mode === 'solo' ? '(computer)' : mode === 'online' ? '(friend)' : '');
  hud.keys[0].style.display = mode === 'local' || me === 0 ? '' : 'none';
  hud.keys[1].style.display = mode === 'local' || me === 1 ? '' : 'none';
  // only your own bin and item are shown in solo / online; the other player's stats stay hidden
  hud.panels[0].style.display = mode === 'local' || me === 0 ? '' : 'none';
  hud.panels[1].style.display = mode === 'local' || me === 1 ? '' : 'none';
  document.body.classList.toggle('hasme', me >= 0);
}
function startLocal(kind) {
  leaveMenuScene(); endReveal(); document.body.classList.remove('results'); revealRun++; if (kind !== 'try') laps++;
  cam.init = false; cam.blend = 0;
  net.close(); mode = kind; me = kind === 'local' ? -1 : 0;
  bot = kind === 'solo' ? createBot(sim, 1) : null;
  view = sim.state; sim.reset(); drainEvents(sim.events);
  if (kind === 'try') { sim.state.phase = 'playing'; sim.state.countdown = 0; }   // straight in, no countdown
  assignToppers(); renderTopperBar();
  setTags(); showCard(null); hud.status.textContent = '';
  document.body.classList.toggle('trymode', kind === 'try');
}
function startOnline(msg) { showCard(null); endReveal(); document.body.classList.remove('results'); revealRun++; laps++; cam.init = false; cam.blend = 0; mode = 'online'; me = -1; bot = null; pred.init = false; view = emptyView(); clearFloor(); net.connect(msg); setTags(); }   // the attract scene keeps running until the match starts
function emptyView() { return { phase: 'idle', time: 0, timeLeft: C.MATCH_TIME, countdown: 0, counts: [0, 0, 0], totalCells: 1, vacs: [0, 1].map(i => ({ x: layout.docks[i].x, z: layout.docks[i].z, h: 0, mode: 'clean', bin: 0, item: null, stuckUntil: 0, turboUntil: 0, wideUntil: 0, shieldUntil: 0 })), pickups: [], traps: [], spills: [] }; }
function goMenu() { endReveal(); revealRun++; document.body.classList.remove('trymode', 'results'); net.close(); mode = 'menu'; me = -1; bot = null; view = emptyView(); clearFloor(); syncEntities(view, 0); trails.clear(); setTopper(0, myTopper); setTopper(1, 'none'); renderTopperBar(); showCard(null); hud.status.textContent = ''; enterMenuScene(); }
function playAgain() { if (mode === 'online') { net.again(); endReveal(); document.body.classList.remove('results'); revealRun++; showCard(null); } else startLocal(mode); }
function drainEvents(list) { for (const ev of list) handleEvent(ev, view); list.length = 0; }

$('btnSolo').onclick = () => transition(() => startLocal('solo'));
$('btnLocal').onclick = () => transition(() => startLocal('local'));
$('btnTry').onclick = () => transition(() => startLocal('try'));
$('btnOnline').onclick = () => showCard('pit');
$('btnPitBack').onclick = () => showCard(null);
$('btnHow').onclick = () => showCard('how');
$('btnHowClose').onclick = () => showCard(null);
// garage: swap the topper on the blue vacuum bouncing behind the panel, so you see it and its trail live
const GARAGE_ORDER = ['duck', 'cone', 'egg', 'none'];
function renderGarage() { $('gTitle').textContent = TOPPERS[myTopper].name; $('gTrail').textContent = TOPPERS[myTopper].trail || 'No trail'; }
function cycleTopper(dir) { const i = GARAGE_ORDER.indexOf(myTopper); pickTopper(GARAGE_ORDER[(i + dir + GARAGE_ORDER.length) % GARAGE_ORDER.length]); }
$('btnGarage').onclick = () => { renderGarage(); document.body.classList.add('garage'); };
$('gDone').onclick = () => document.body.classList.remove('garage');
$('gPrev').onclick = () => cycleTopper(-1);
$('gNext').onclick = () => cycleTopper(1);
// the opening can be skipped with a tap or any key
window.addEventListener('pointerdown', () => { if (menuOn) menu.skip(); });
window.addEventListener('keydown', e => { if (menuOn && !e.repeat && document.body.classList.contains('intro')) menu.skip(); });
function renderTopperBar() {
  const bar = $('topperBar'); if (!bar) return;
  bar.style.display = mode === 'try' ? 'flex' : 'none';
  if (!bar.dataset.built) {
    bar.dataset.built = '1';
    for (const [k, t] of Object.entries(TOPPERS)) {
      const b = document.createElement('button'); b.dataset.k = k;
      b.innerHTML = `<b>${t.name}</b>${t.trail ? `<small>${t.trail}</small>` : ''}`;
      b.onclick = e => { e.stopPropagation(); pickTopper(k); };
      bar.appendChild(b);
    }
    const x = document.createElement('button'); x.className = 'done'; x.innerHTML = '<b>Done</b>'; x.onclick = e => { e.stopPropagation(); goMenu(); }; bar.appendChild(x);
  }
  for (const b of bar.querySelectorAll('button[data-k]')) b.classList.toggle('on', b.dataset.k === myTopper);
}
$('btnCreate').onclick = () => startOnline({ t: 'create' });
$('btnJoin').onclick = () => { const code = $('joinCode').value.trim().toUpperCase(); if (code) startOnline({ t: 'join', code }); };
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').onclick(); e.stopPropagation(); });
$('btnCancel').onclick = goMenu;
$('btnAgain').onclick = playAgain;
$('btnMenu').onclick = goMenu;

// online is only offered when this page is served by the game server
fetch('./api/info').then(r => r.ok ? r.json() : null).then(info => {
  if (!info || !info.online) return;
  $('btnOnline').style.display = '';
  $('lanUrl').textContent = info.lan || location.origin;
  try { const saved = JSON.parse(sessionStorage.getItem('dd-room') || 'null'); if (saved && info.rooms?.includes(saved.code)) { hud.status.innerHTML = `Rejoin room ${saved.code}? <button id="btnRejoin">Rejoin</button>`; $('btnRejoin').onclick = () => startOnline({ t: 'join', code: saved.code, token: saved.token }); } } catch {}
}).catch(() => {});

// ---------------------------------------------------------------- frame loop
const FIXED = 1 / 60; let acc = 0;
function update(dt) {
  if (mode === 'solo' || mode === 'local' || mode === 'try') {
    for (const slot of [0, 1]) { const [ix, iz] = readMovement(slot); inputs[slot].ix = ix; inputs[slot].iz = iz; }
    acc += dt;
    while (acc >= FIXED) {
      if (bot) { const b = bot.think(FIXED); inputs[1].ix = b.ix; inputs[1].iz = b.iz; if (b.toggle) { inputs[1].toggle = true; b.toggle = false; } if (b.use) { inputs[1].use = true; b.use = false; } }
      sim.step(FIXED, inputs); acc -= FIXED;
      if (mode === 'try') sim.state.timeLeft = C.MATCH_TIME;   // free drive: the clock never runs out
    }
    drainEvents(sim.events);
    for (const [i, v] of sim.state.vacs.entries()) { vis[i].x = v.x; vis[i].z = v.z; vis[i].h = v.h; }
  } else if (mode === 'online') {
    const [ix, iz] = readMovement(me); net.sendMove(ix, iz);
    for (const m of net.pending) { view = m.s; view.events = m.ev; drainEvents(m.ev); }
    const fresh = net.pending.length > 0; net.pending = [];
    if (view.phase === 'playing') view.time += dt, view.timeLeft -= dt;      // keep the clock moving between snapshots
    const k = 1 - Math.exp(-14 * dt);
    for (const [i, v] of view.vacs.entries()) {
      if (i === me && view.phase === 'playing') {
        if (!pred.init) { pred.x = v.x; pred.z = v.z; pred.h = v.h; pred.init = true; }
        // move the prediction like the sim would, then pull it toward the server whenever a snapshot arrives
        if ((ix || iz) && v.stuckUntil <= view.time) {
          const target = Math.atan2(iz, ix), diff = sim.wrap(target - pred.h);
          pred.h = sim.wrap(pred.h + Math.max(-C.TURN * dt, Math.min(C.TURN * dt, diff)));
          const sp = C.SPEED * (v.turboUntil > view.time ? 2 : 1) * Math.max(0, Math.cos(diff));
          const p = { x: pred.x + Math.cos(pred.h) * sp * dt, z: pred.z + Math.sin(pred.h) * sp * dt }; sim.collide(p); pred.x = p.x; pred.z = p.z;
        }
        if (fresh) { pred.x += (v.x - pred.x) * 0.35; pred.z += (v.z - pred.z) * 0.35; pred.h += sim.wrap(v.h - pred.h) * 0.35; }
        vis[i].x = pred.x; vis[i].z = pred.z; vis[i].h = pred.h;
      } else {
        vis[i].x += (v.x - vis[i].x) * k; vis[i].z += (v.z - vis[i].z) * k; vis[i].h += sim.wrap(v.h - vis[i].h) * k;
      }
    }
    if (view.phase === 'paused' && Math.floor(view.pauseLeft) !== Math.floor(view.pauseLeft + dt)) flashBanner(`Waiting for the other player… ${Math.ceil(view.pauseLeft)}`, 900);
  } else {
    for (const [i, v] of view.vacs.entries()) { vis[i].x = v.x; vis[i].z = v.z; vis[i].h = THREE.MathUtils.degToRad(layout.docks[i].rot); }
  }
  if (view.phase === 'over') stepReveal(dt);
  // visuals
  const t = view.time;
  view.vacs.forEach((v, i) => {
    const V = vis[i], stuck = v.stuckUntil > t;
    const moved = Math.hypot(V.x - (V.px ?? V.x), V.z - (V.pz ?? V.z)); V.px = V.x; V.pz = V.z;
    if (V.topper) {
      animateTopper(V.topper, performance.now() / 1000, dt, Math.min(1, moved / Math.max(dt, 1e-3) / C.SPEED));
      if (view.phase === 'playing' && moved < 1) trails.emit(i, V.topperType, V.x, V.z, V.h, moved);
    }
    V.root.position.set(V.x, 0, V.z); V.root.rotation.y = -V.h;
    if (stuck) V.root.position.x += (Math.random() - 0.5) * 0.05;
    if (v.mode === 'clean' && view.phase === 'playing') V.spin += 18 * dt;
    for (const b of V.brushes) b.rotation.z = V.spin * (b.name === 'Brush_L' ? 1 : -1);
    V.ring.material.color.setHex(v.mode === 'clean' ? 0x22c55e : 0x92400e);
    V.shield.visible = v.shieldUntil > t;
    V.gauge.position.set(V.x, 0.9, V.z + 0.3); V.gauge.visible = !reveal.active && !menuOn;
    V.gfill.scale.x = Math.max(0.001, v.bin / C.BIN_CAP); V.gfill.position.x = -(1 - V.gfill.scale.x) / 2;
    V.gfill.material.color.setHex(v.bin >= C.BIN_CAP ? 0xdc2626 : 0x92400e);
    if (view.phase === 'playing' && v.mode === 'dump' && v.bin > 0 && (v.stuckUntil <= t) && Math.random() < 0.25) burst(V.x - Math.cos(V.h) * 0.55, V.z - Math.sin(V.h) * 0.55, 0x8b7355, 1, 1.2, 1.4, 0.6);
    if (view.phase === 'playing' && v.mode === 'clean' && v.bin < C.BIN_CAP && Math.random() < 0.15) burst(V.x, V.z, 0xffffff, 1, 0.6, 1.2, 0.5);
  });
  syncEntities(view, t); trails.update(dt);
  if (menuOn) menu.update(dt);
  updateCamera(dt); updateArrows();
  spotMat.opacity = 0.25 + Math.sin(t * 2) * 0.1;
  updateHUD(view);
}

// Camera. Overview = the whole house (menu, countdown, reveal, and always in 2-players-one-keyboard).
// Follow = about 1.6 rooms around your own vacuum (solo and online, while the match is on).
// Both are windows onto the painting (painting pixels), shown through houseCam.setViewOffset: never a 3D move.
const FOLLOW_AREA = 170;                // m² of floor in view (≈ 19 × 9 on a phone held sideways, about 1.6 rooms); equal on every screen shape
const HOUSE_PX = { x0: 20, y0: 30, x1: 2900, y1: 1600 };   // the house in the painting (walls included), for the overview
const PX_PER_M2 = (() => { const a = toPaint(0, 0, 0), b = toPaint(1, 0, 0), c = toPaint(0, 0, 1); return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); })();
const cam = { aspect: 1, overview: [0, 0, 1, 1], followW: 1, followH: 1, blend: 0, tx: 0, tz: 0, lx: 0, lz: 0, vx: 0, vz: 0, init: false };
function fitCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  cam.aspect = w / h;
  // overview: the whole house fits the screen, centred (cx, cy, width, height)
  const hw = HOUSE_PX.x1 - HOUSE_PX.x0, hh = HOUSE_PX.y1 - HOUSE_PX.y0, ow = Math.max(hw, hh * cam.aspect) * 1.02;
  cam.overview = [(HOUSE_PX.x0 + HOUSE_PX.x1) / 2, (HOUSE_PX.y0 + HOUSE_PX.y1) / 2, ow, ow / cam.aspect];
  cam.followH = Math.sqrt(FOLLOW_AREA * PX_PER_M2 / cam.aspect); cam.followW = cam.followH * cam.aspect;
}
function setView(cx, cy, w, h) {   // show this window of the painting: backdrop and 3D both
  const x0 = cx - w / 2, y0 = cy - h / 2;
  houseCam.setViewOffset(PAINT.width, PAINT.height, x0, y0, w, h);
  backdrop.material.uniforms.view.value.set(x0, y0, x0 + w, y0 + h);
}
function followAllowed() { return me >= 0 && mode !== 'local' && mode !== 'menu'; }   // solo, online and try
function updateCamera(dt) {
  if (menuOn) { menu.placeCamera(); return; }
  const follow = (followAllowed() && (view.phase === 'playing' || view.phase === 'paused')) || reveal.cam;
  const target = follow ? 1 : 0;
  cam.blend += (target - cam.blend) * (1 - Math.exp(-dt * (follow ? 3.2 : 2.6)));   // ~1 s swoop in / pull back
  const camIdx = reveal.cam ? reveal.w : me;
  if (camIdx >= 0) {
    const V = vis[camIdx];
    if (!cam.init) { cam.tx = V.x; cam.tz = V.z; cam.lx = V.x; cam.lz = V.z; cam.init = true; }
    // look ~1.5 m ahead of where the vacuum is going (from its actual motion)
    const k = 1 - Math.exp(-dt * 6);
    cam.vx += ((V.x - cam.lx) / Math.max(dt, 1e-3) - cam.vx) * k; cam.vz += ((V.z - cam.lz) / Math.max(dt, 1e-3) - cam.vz) * k;
    cam.lx = V.x; cam.lz = V.z;
    const sp = Math.hypot(cam.vx, cam.vz), ahead = Math.min(1, sp / C.SPEED) * 1.5;
    const dx = V.x + (sp > 0.05 ? cam.vx / sp * ahead : 0), dz = V.z + (sp > 0.05 ? cam.vz / sp * ahead : 0);
    const e = 1 - Math.exp(-dt / 0.3);
    cam.tx += (dx - cam.tx) * e; cam.tz += (dz - cam.tz) * e;
  }
  const s = cam.blend * cam.blend * (3 - 2 * cam.blend);       // smoothstep
  // follow window around the target, kept inside the house picture (centred when it is bigger than the house)
  let [fx, fy] = toPaint(cam.tx, 0, cam.tz);
  const clampTo = (c, half, lo, hi) => hi - lo <= 2 * half ? (lo + hi) / 2 : Math.max(lo + half, Math.min(hi - half, c));
  fx = clampTo(fx, cam.followW / 2, HOUSE_PX.x0, HOUSE_PX.x1); fy = clampTo(fy, cam.followH / 2, HOUSE_PX.y0, HOUSE_PX.y1);
  const [ox, oy, ow, oh] = cam.overview, mix = (a, b) => a + (b - a) * s;
  setView(mix(ox, fx), mix(oy, fy), mix(ow, cam.followW), mix(oh, cam.followH));
}

// Off-screen power-up arrows (follow camera only)
const arrowLayer = document.getElementById('arrows'), arrowPool = [];
const _a = new THREE.Vector3();
function updateArrows() {
  const show = followAllowed() && view.phase === 'playing' && cam.blend > 0.9;
  let used = 0;
  if (show) {
    const w = window.innerWidth, h = window.innerHeight, M = 34;
    for (const p of view.pickups) {
      _a.set(p.x, 1.0, p.z).project(houseCam);
      let sx = (_a.x * 0.5 + 0.5) * w, sy = (-_a.y * 0.5 + 0.5) * h;
      if (_a.z < 1 && sx > M && sx < w - M && sy > M && sy < h - M) continue;      // on screen: no arrow
      const cx = w / 2, cy = h / 2; let ddx = sx - cx, ddy = sy - cy;
      if (_a.z > 1) { ddx = -ddx; ddy = -ddy; }
      const sc = Math.min((w / 2 - M) / Math.abs(ddx || 1e-6), (h / 2 - M) / Math.abs(ddy || 1e-6));
      const el = arrowPool[used] || (arrowPool[used] = arrowLayer.appendChild(document.createElement('div')));
      el.className = 'arrow'; el.style.display = 'block';
      el.style.left = `${cx + ddx * sc}px`; el.style.top = `${cy + ddy * sc}px`;
      el.style.setProperty('--c', PU_CSS[p.type]); el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(ddy, ddx)}rad)`;
      used++;
    }
  }
  for (let i = used; i < arrowPool.length; i++) arrowPool[i].style.display = 'none';
}
window.addEventListener('resize', () => { fitCamera(); menu.resize(); });
fitCamera();
// the title is painted on the floor with the display font, so wait for it (briefly) before the opening
await Promise.race([document.fonts.load('100px "Luckiest Guy"'), new Promise(r => setTimeout(r, 2500))]).catch(() => {});
goMenu();
setTags();
document.getElementById('loading').classList.add('hidden');

let last = performance.now(), frameNo = 0;
// Adaptive resolution: if frames keep taking longer than ~22 ms, render at a lower pixel ratio (down to 0.75);
// when it has been comfortably fast for a while, step back up toward the device's native ratio.
const perf = { acc: 0, n: 0, since: 0 };
function adaptResolution(dt) {
  perf.acc += dt; perf.n++;
  if (perf.acc < 1.5) return;
  const avg = perf.acc / perf.n; perf.acc = 0; perf.n = 0; perf.since += 1.5;
  let want = pixelRatio;
  if (avg > 0.022 && pixelRatio > 0.75) { want = Math.max(0.75, pixelRatio - 0.25); perf.since = 0; }
  else if (avg < 0.0145 && pixelRatio < MAX_PR && perf.since > 8) { want = Math.min(MAX_PR, pixelRatio + 0.25); perf.since = 0; }
  if (want !== pixelRatio) { pixelRatio = want; renderer.setPixelRatio(pixelRatio); fitCamera(); }
}
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frameNo++;
  update(dt); stepParticles(dt);
  if (floorDirty && (frameNo & 1) === 0) { floorTex.needsUpdate = true; floorDirty = false; }   // floor uploads at 30 Hz
  renderer.render(scene, menuOn ? camera : houseCam);
  adaptResolution(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
