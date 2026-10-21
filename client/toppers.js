// Dust Duel — toppers (cosmetic hats that sit on a vacuum) and their trail effects.
// Purely visual: nothing here touches the game rules or the floor paint.
import * as THREE from 'three';

export const TOPPERS = {
  none:  { name: 'No topper' },
  cone:  { name: 'Traffic cone', trail: 'Road markings' },
  egg:   { name: 'Fried egg',    trail: 'Sizzle & steam' },
  duck:  { name: 'Rubber duck',  trail: 'Ripples & bubbles' },
};
export const TOPPER_TOP = 0.285;   // height of the vacuum's lid

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...o });
function shadowed(g) { g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g; }

// ---------------------------------------------------------------- models (built facing +x, which is the vacuum's forward)
function makeCone() {
  const g = new THREE.Group(), H = 0.46, R0 = 0.17, R1 = 0.025;
  const orange = std(0xf97316, { roughness: 0.35 }), white = std(0xf8fafc, { emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.2 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.045, 0.46), std(0xea580c, { roughness: 0.6 }));
  base.position.y = 0.0225; g.add(base);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R1, R0, H, 28), orange);
  body.position.y = 0.045 + H / 2; g.add(body);
  const r = y => R0 - (R0 - R1) * (y / H);
  for (const [y0, h] of [[0.15, 0.07], [0.29, 0.06]]) {      // two reflective bands
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r(y0 + h) + 0.004, r(y0) + 0.004, h, 28), white);
    band.position.y = 0.045 + y0 + h / 2; g.add(band);
  }
  g.userData.kind = 'cone';
  return shadowed(g);
}
function makeEgg() {
  const g = new THREE.Group();
  const sh = new THREE.Shape(), N = 40;
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, rr = 0.29 * (1 + 0.1 * Math.sin(3 * a + 0.4) + 0.06 * Math.sin(5 * a + 1.3));
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
  }
  const white = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.02, bevelSegments: 3, curveSegments: 4 });
  white.rotateX(-Math.PI / 2);
  const w = new THREE.Mesh(white, std(0xfbfaf5, { roughness: 0.35 })); w.position.y = 0.02; g.add(w);
  const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.12, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    std(0xf59e0b, { roughness: 0.12, metalness: 0.05, emissive: 0xf59e0b, emissiveIntensity: 0.12 }));
  yolk.scale.set(1, 0.72, 1); yolk.position.set(0.04, 0.055, 0.03); yolk.name = 'yolk'; g.add(yolk);
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 6), new THREE.MeshBasicMaterial({ color: 0xfff7d6 }));
  shine.position.set(0.0, 0.13, -0.01); shine.scale.set(1, 0.4, 1); yolk.add(shine); shine.position.set(-0.04, 0.09, -0.03);
  g.userData.kind = 'egg';
  return shadowed(g);
}
function makeDuck() {
  const g = new THREE.Group(), yellow = std(0xfde047, { roughness: 0.22 }), orange = std(0xf97316, { roughness: 0.3 }), black = std(0x111111, { roughness: 0.2 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 28, 18), yellow); body.scale.set(1.25, 0.82, 1.0); body.position.y = 0.15; g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.16, 16), yellow); tail.rotation.z = Math.PI / 2 + 0.7; tail.position.set(-0.26, 0.24, 0); g.add(tail);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 16), yellow); head.position.set(0.15, 0.36, 0); head.name = 'head'; g.add(head);
  const beak = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), orange); beak.scale.set(1.35, 0.42, 0.85); beak.position.set(0.13, -0.02, 0); head.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 10, 8), black); eye.position.set(0.08, 0.05, s * 0.075); head.add(eye);
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10), yellow); wing.scale.set(1.2, 0.55, 0.45); wing.position.set(-0.03, 0.17, s * 0.19); wing.rotation.x = s * 0.35; g.add(wing);
  }
  g.userData.kind = 'duck';
  return shadowed(g);
}
export function makeTopper(type) {
  const g = type === 'cone' ? makeCone() : type === 'egg' ? makeEgg() : type === 'duck' ? makeDuck() : null;
  if (!g) return null;
  const holder = new THREE.Group(); holder.add(g); holder.position.y = TOPPER_TOP;
  holder.userData = { type, wob: 0, model: g };
  return holder;
}
// idle / driving / bump animation; speed is 0..1
export function animateTopper(holder, t, dt, speed) {
  if (!holder) return;
  const u = holder.userData, m = u.model;
  u.wob = Math.max(0, u.wob - dt * 2.2);
  const shake = Math.sin(t * 38) * u.wob * 0.35;
  if (u.type === 'duck') {
    m.position.y = Math.abs(Math.sin(t * 9)) * 0.03 * speed;
    m.rotation.z = Math.sin(t * 9) * 0.06 * speed - speed * 0.08 + shake;  // leans back a little when driving fast
    m.rotation.x = shake * 0.6;
    const head = m.getObjectByName('head'); if (head) head.rotation.z = Math.sin(t * 2.3) * 0.12;
  } else if (u.type === 'egg') {
    const yolk = m.getObjectByName('yolk');
    if (yolk) { const j = 1 + Math.sin(t * 22) * (0.04 * speed + 0.15 * u.wob); yolk.scale.set(j, 0.72 / j, j); }
    m.rotation.y = shake;
  } else if (u.type === 'cone') {
    m.rotation.z = shake; m.rotation.x = Math.sin(t * 31) * u.wob * 0.25;
  }
}
export function bumpTopper(holder) { if (holder) holder.userData.wob = 1; }

// ---------------------------------------------------------------- trails
function canvasTex(draw, w = 128, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const softTex = canvasTex(ctx => { const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128); });
const chevronTex = canvasTex((ctx, w, h) => {
  // a road-marking chevron pointing to +x: orange with white stripes
  ctx.clearRect(0, 0, w, h);
  ctx.save(); ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(70, 64); ctx.lineTo(8, 118); ctx.lineTo(44, 118); ctx.lineTo(118, 64); ctx.lineTo(44, 10); ctx.closePath(); ctx.clip();
  for (let i = -6; i < 12; i++) { ctx.fillStyle = i % 2 ? '#f97316' : '#fff7ed'; ctx.beginPath(); ctx.moveTo(i * 22, 0); ctx.lineTo(i * 22 + 22, 0); ctx.lineTo(i * 22 - 40, h); ctx.lineTo(i * 22 - 62, h); ctx.closePath(); ctx.fill(); }
  ctx.restore();
});
const geo = {
  chevron: new THREE.PlaneGeometry(0.42, 0.42),
  ripple: new THREE.RingGeometry(0.36, 0.44, 40),
  bubble: new THREE.SphereGeometry(0.05, 12, 8),
};
const SPACING = { cone: 0.5, egg: 0.28, duck: 0.55 };   // world units travelled between trail marks

export function createTrails(scene) {
  const live = [];
  const add = (mesh, life, upd) => { scene.add(mesh); live.push({ mesh, life, max: life, upd }); };
  const dist = new Map();
  function emit(key, type, x, z, h, moved) {
    if (!SPACING[type] || moved <= 0) return;
    const d = (dist.get(key) || 0) + moved;
    if (d < SPACING[type]) { dist.set(key, d); return; }
    dist.set(key, 0);
    const bx = x - Math.cos(h) * 0.6, bz = z - Math.sin(h) * 0.6;
    if (type === 'cone') {
      const m = new THREE.Mesh(geo.chevron, new THREE.MeshBasicMaterial({ map: chevronTex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -h; m.position.set(bx, 0.014, bz);
      add(m, 1.8, (e, k) => { e.mesh.material.opacity = Math.min(1, k * 2); });
    } else if (type === 'egg') {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.7 }));
      puff.position.set(x + (Math.random() - 0.5) * 0.25, 0.4, z + (Math.random() - 0.5) * 0.25); puff.scale.setScalar(0.25);
      const drift = (Math.random() - 0.5) * 0.4;
      add(puff, 0.9, (e, k, dt) => { e.mesh.position.y += dt * 1.1; e.mesh.position.x += dt * drift; e.mesh.scale.setScalar(0.25 + (1 - k) * 0.55); e.mesh.material.opacity = 0.65 * k; });
      for (let i = 0; i < 2; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xfbbf24, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.position.set(bx, 0.08, bz); s.scale.setScalar(0.12);
        const a = Math.random() * Math.PI * 2, v = 0.8 + Math.random() * 0.8;
        add(s, 0.35, (e, k, dt) => { e.mesh.position.x += Math.cos(a) * v * dt; e.mesh.position.z += Math.sin(a) * v * dt; e.mesh.position.y += dt * 0.6; e.mesh.material.opacity = k; });
      }
    } else if (type === 'duck') {
      const ring = new THREE.Mesh(geo.ripple, new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(bx, 0.013, bz); ring.scale.setScalar(0.6);
      add(ring, 1.1, (e, k) => { e.mesh.scale.setScalar(0.6 + (1 - k) * 1.6); e.mesh.material.opacity = 0.75 * k; });
      if (Math.random() < 0.7) {
        const b = new THREE.Mesh(geo.bubble, new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, depthWrite: false }));
        b.position.set(bx + (Math.random() - 0.5) * 0.3, 0.12, bz + (Math.random() - 0.5) * 0.3);
        const ph = Math.random() * 6;
        add(b, 0.9, (e, k, dt, t) => {
          e.mesh.position.y += dt * 0.7; e.mesh.position.x += Math.sin(t * 6 + ph) * dt * 0.3;
          const pop = k < 0.12 ? 1 + (0.12 - k) * 8 : 1;   // swell, then pop
          e.mesh.scale.setScalar(pop); e.mesh.material.opacity = k < 0.04 ? 0 : 0.55;
        });
      }
    }
  }
  let t = 0;
  function update(dt) {
    t += dt;
    for (let i = live.length - 1; i >= 0; i--) {
      const e = live[i]; e.life -= dt;
      if (e.life <= 0) { scene.remove(e.mesh); e.mesh.material.dispose(); live.splice(i, 1); continue; }
      e.upd(e, e.life / e.max, dt, t);
    }
  }
  function clear() { for (const e of live) { scene.remove(e.mesh); e.mesh.material.dispose(); } live.length = 0; dist.clear(); }
  return { emit, update, clear };
}
