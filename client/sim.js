// Dust Duel — shared simulation. Pure logic, no DOM, no Three.js.
// Runs in the browser (local / solo modes) and in Node (the authoritative server).
// The renderer and the server both consume `sim.events` and read `sim.state`.

export const C = {
  MATCH_TIME: 60,
  HURRY_AT: 15,
  COUNTDOWN: 3.5,          // 3, 2, 1, GO
  CELL: 0.25,              // invisible scoring grid (world units)
  SPEED: 5.0,
  TURN: 7.0,
  VAC_R: 0.5,
  BRUSH_R: 0.8,
  BIN_CAP: 2400,           // dirt cells the bin holds (~19 s of fresh cleaning with the wider brush)
  DUMP_R: 0.55,
  DUMP_RATE: 110,           // cells / second onto the opponent's floor
  VENT_RATE: 60,           // cells / second lost when dumping where there is no opponent floor
  BUMP_FORCE: 7.0,
  BUMP_COOLDOWN: 0.4,
  POWERUP_EVERY: [8, 10],
  PICKUP_R: 0.9,
  TRAP_R: 1.0,
  TRAP_LIFE: 25,
  STUCK_TIME: 2,
  SPILL_R: 1.5,
  REJOIN_TIME: 10,
};

export const POWERUPS = {
  turbo:  { name: 'Turbo',      dur: 5, type: 'boost' },
  wide:   { name: 'Wide brush', dur: 8, type: 'boost' },
  shield: { name: 'Shield',     dur: 8, type: 'defense' },
  cables: { name: 'Cables',     dur: 0, type: 'trap' },
  spill:  { name: 'Spill',      dur: 0, type: 'attack' },
};
// boosts are more common than the two attack items
export const AUTO_POWERUPS = new Set(['turbo', 'wide']);   // applied the moment you drive over them
export const POWERUP_POOL = ['turbo', 'turbo', 'wide', 'wide', 'shield', 'shield', 'cables', 'spill'];

export const BLOCKED = 255;

export function rectOf(f) {   // furniture footprint in world coords, accounting for rotation
  const swap = ((f.rot % 180) + 180) % 180 === 90;
  const w = swap ? f.d : f.w, d = swap ? f.w : f.d;
  return { x0: f.x - w / 2, z0: f.z - d / 2, x1: f.x + w / 2, z1: f.z + d / 2 };
}

export function makeInput() { return { ix: 0, iz: 0, toggle: false, use: false }; }

export function createSim(layout, opts = {}) {
  const random = opts.random || Math.random;
  const MAP_W = layout.size.w, MAP_H = layout.size.h;
  const GW = Math.round(MAP_W / C.CELL), GH = Math.round(MAP_H / C.CELL);
  const blockers = [...layout.walls, ...layout.furniture.filter(f => f.blocks !== false).map(rectOf)];
  const grid = new Uint8Array(GW * GH);
  const events = [];
  const emit = e => events.push(e);

  // ---- grid ----
  let totalCells = 0;
  function initGrid() {
    totalCells = 0;
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
      const x = -MAP_W / 2 + (cx + 0.5) * C.CELL, z = -MAP_H / 2 + (cz + 0.5) * C.CELL;
      let blocked = false;
      for (const r of blockers) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) { blocked = true; break; }
      grid[cz * GW + cx] = blocked ? BLOCKED : 0;
      if (!blocked) totalCells++;
    }
  }
  const cellOf = (x, z) => [Math.floor((x + MAP_W / 2) / C.CELL), Math.floor((z + MAP_H / 2) / C.CELL)];
  const cellCenter = (cx, cz) => [-MAP_W / 2 + (cx + 0.5) * C.CELL, -MAP_H / 2 + (cz + 0.5) * C.CELL];

  const state = {
    phase: 'idle', time: 0, timeLeft: C.MATCH_TIME, countdown: 0, pauseLeft: 0, winner: 0, hurryShown: false,
    counts: [0, 0, 0], totalCells: 0, nextSpawn: 0, nextId: 1,
    vacs: [], pickups: [], traps: [], spills: [],
  };

  function makeVac(idx) {
    const d = layout.docks[idx], rot = d.rot * Math.PI / 180, off = layout.spawnOffset ?? 0.2;
    return {
      idx, owner: idx + 1, x: d.x + Math.cos(rot) * off, z: d.z + Math.sin(rot) * off, h: rot, kx: 0, kz: 0,
      mode: 'clean', bin: 0, item: null, stuckUntil: 0, bumpCooldown: 0, turboUntil: 0, wideUntil: 0, shieldUntil: 0,
    };
  }

  function reset() {
    initGrid();
    Object.assign(state, {
      phase: 'countdown', time: 0, timeLeft: C.MATCH_TIME, countdown: C.COUNTDOWN, pauseLeft: 0, winner: 0, hurryShown: false,
      counts: [0, 0, 0], totalCells, nextSpawn: 3, nextId: 1, vacs: [makeVac(0), makeVac(1)], pickups: [], traps: [], spills: [],
    });
    emit({ e: 'reset' });
  }

  // Clean mode: dirty + opponent cells within r become `owner`. Returns how many were dirty (fills the bin).
  function cleanAt(x, z, r, owner) {
    const [cx0, cz0] = cellOf(x - r, z - r), [cx1, cz1] = cellOf(x + r, z + r);
    let dirty = 0, stolen = 0, changed = false;
    for (let cz = Math.max(0, cz0); cz <= Math.min(GH - 1, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(GW - 1, cx1); cx++) {
        const [wx, wz] = cellCenter(cx, cz);
        if ((wx - x) ** 2 + (wz - z) ** 2 > r * r) continue;
        const i = cz * GW + cx, v = grid[i];
        if (v === BLOCKED || v === owner) continue;
        if (v === 0) dirty++; else { state.counts[v]--; stolen++; }
        grid[i] = owner; state.counts[owner]++; changed = true;
      }
    }
    if (changed) emit({ e: 'clean', x: +x.toFixed(2), z: +z.toFixed(2), r, o: owner, s: stolen });   // s: cells taken from the other player
    return dirty;
  }
  // Dirt lands only on the victim's clean floor. Returns cells converted.
  // Cells closest to the centre go first, so a moving dump leaves one solid round-edged stroke instead of a
  // ragged scatter when the budget is tight. The event carries the stroke (x, z, r) and whether it was completed,
  // so the renderer can draw it smooth.
  function dirtyAt(x, z, r, victim, budget) {
    const [cx0, cz0] = cellOf(x - r, z - r), [cx1, cz1] = cellOf(x + r, z + r);
    const cand = []; let floorCells = 0, dirtAlready = 0;
    for (let cz = Math.max(0, cz0); cz <= Math.min(GH - 1, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(GW - 1, cx1); cx++) {
        const [wx, wz] = cellCenter(cx, cz), d2 = (wx - x) ** 2 + (wz - z) ** 2;
        if (d2 > r * r) continue;
        const i = cz * GW + cx;
        if (grid[i] === BLOCKED) continue;
        floorCells++;
        if (grid[i] === victim) cand.push(i, d2); else if (grid[i] === 0) dirtAlready++;
      }
    }
    const order = []; for (let k = 0; k < cand.length; k += 2) order.push(k);
    order.sort((a, b) => cand[a + 1] - cand[b + 1]);
    const cells = [];
    for (const k of order) { if (cells.length >= budget) break; const i = cand[k]; grid[i] = 0; state.counts[victim]--; cells.push(i); }
    // full: after this, every floor cell inside the circle is dirt, so the renderer may draw one round dirt patch
    if (cells.length) emit({ e: 'dirt', cells, x: +x.toFixed(2), z: +z.toFixed(2), r, full: dirtAlready + cells.length === floorCells });
    return cells.length;
  }

  function collide(v) {
    const r = C.VAC_R;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of blockers) {
        const cx = Math.max(b.x0, Math.min(v.x, b.x1)), cz = Math.max(b.z0, Math.min(v.z, b.z1));
        let dx = v.x - cx, dz = v.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          const l = v.x - b.x0, rr = b.x1 - v.x, t = v.z - b.z0, bb = b.z1 - v.z, m = Math.min(l, rr, t, bb);
          if (m === l) v.x = b.x0 - r; else if (m === rr) v.x = b.x1 + r; else if (m === t) v.z = b.z0 - r; else v.z = b.z1 + r;
        } else {
          const d = Math.sqrt(d2); v.x = cx + dx / d * r; v.z = cz + dz / d * r;
        }
      }
      v.x = Math.max(-MAP_W / 2 + r, Math.min(MAP_W / 2 - r, v.x));
      v.z = Math.max(-MAP_H / 2 + r, Math.min(MAP_H / 2 - r, v.z));
    }
  }
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function spawnPickup() {
    const free = layout.powerupSpots.map((s, i) => i).filter(i => !state.pickups.some(p => p.spot === i));
    if (!free.length) return;
    const spot = free[Math.floor(random() * free.length)], s = layout.powerupSpots[spot];
    const type = POWERUP_POOL[Math.floor(random() * POWERUP_POOL.length)];
    state.pickups.push({ id: state.nextId++, type, spot, x: s.x, z: s.z });
  }

  function toggleMode(v) {
    v.mode = v.mode === 'clean' ? 'dump' : 'clean';
    emit({ e: 'toggle', p: v.idx, mode: v.mode, x: v.x, z: v.z });
  }

  function useItem(v, auto = false) {
    if (!v.item) return;
    const type = v.item; v.item = null;
    const fx = Math.cos(v.h), fz = Math.sin(v.h), t = state.time;
    if (type === 'turbo') v.turboUntil = t + POWERUPS.turbo.dur;
    else if (type === 'wide') v.wideUntil = t + POWERUPS.wide.dur;
    else if (type === 'shield') v.shieldUntil = t + POWERUPS.shield.dur;
    else if (type === 'cables') state.traps.push({ id: state.nextId++, owner: v.owner, x: v.x - fx * 0.9, z: v.z - fz * 0.9, until: t + C.TRAP_LIFE });
    else if (type === 'spill') state.spills.push({ id: state.nextId++, owner: v.owner, x: v.x + fx * 0.6, y: 0.5, z: v.z + fz * 0.6, vx: fx * 7, vy: 4.5, vz: fz * 7, t: 0 });
    emit({ e: 'use', p: v.idx, type, auto });
  }

  function endMatch(winner, reason) {
    state.phase = 'over'; state.winner = winner;
    emit({ e: 'over', winner, reason });
  }

  function step(dt, inputs) {
    if (state.phase === 'countdown') {
      state.countdown -= dt;
      if (state.countdown <= 0) { state.phase = 'playing'; emit({ e: 'go' }); }
      return;
    }
    if (state.phase === 'paused') {
      state.pauseLeft -= dt;
      if (state.pauseLeft <= 0) endMatch(state.pauseWinner || 0, 'left');
      return;
    }
    if (state.phase !== 'playing') return;

    state.time += dt; state.timeLeft -= dt;
    const t = state.time, hurry = state.timeLeft <= C.HURRY_AT;
    if (hurry && !state.hurryShown) { state.hurryShown = true; emit({ e: 'hurry' }); }
    if (state.timeLeft <= 0) {
      const [a, b] = [state.counts[1], state.counts[2]];
      endMatch(a === b ? 0 : (a > b ? 1 : 2), 'time');
      return;
    }
    if (t >= state.nextSpawn) {
      spawnPickup();
      const [lo, hi] = C.POWERUP_EVERY, gap = lo + random() * (hi - lo);
      state.nextSpawn = t + (hurry ? gap / 2 : gap);
    }

    for (const v of state.vacs) {
      const inp = inputs[v.idx] || makeInput();
      if (inp.toggle) { inp.toggle = false; toggleMode(v); }
      if (inp.use) { inp.use = false; useItem(v); }
      const stuck = v.stuckUntil > t;
      let speedFactor = 0;
      if ((inp.ix || inp.iz) && !stuck) {
        const target = Math.atan2(inp.iz, inp.ix), diff = wrap(target - v.h);
        v.h = wrap(v.h + Math.max(-C.TURN * dt, Math.min(C.TURN * dt, diff)));
        speedFactor = Math.max(0, Math.cos(diff));
      }
      const speed = C.SPEED * (v.turboUntil > t ? 2 : 1) * speedFactor;
      v.x += Math.cos(v.h) * speed * dt + v.kx * dt;
      v.z += Math.sin(v.h) * speed * dt + v.kz * dt;
      const decay = Math.exp(-6 * dt); v.kx *= decay; v.kz *= decay;
      collide(v);

      const other = 3 - v.owner;
      if (v.mode === 'clean') {
        if (v.bin < C.BIN_CAP && !stuck) {
          const r = C.BRUSH_R * (v.wideUntil > t ? 2 : 1);
          const dirty = cleanAt(v.x, v.z, r, v.owner);
          v.bin = Math.min(C.BIN_CAP, v.bin + dirty);
          if (v.bin >= C.BIN_CAP && dirty > 0) emit({ e: 'binfull', p: v.idx });
        }
      } else if (v.bin > 0 && !stuck) {
        const bx = v.x - Math.cos(v.h) * 0.55, bz = v.z - Math.sin(v.h) * 0.55;
        const used = dirtyAt(bx, bz, C.DUMP_R, other, Math.max(4, C.DUMP_RATE * dt));
        v.bin = Math.max(0, v.bin - (used || C.VENT_RATE * dt));   // venting onto dirty floor still empties the bin, slowly
      }

      for (let i = state.pickups.length - 1; i >= 0; i--) {
        const p = state.pickups[i];
        const auto = AUTO_POWERUPS.has(p.type);
        if ((auto || !v.item) && (p.x - v.x) ** 2 + (p.z - v.z) ** 2 < C.PICKUP_R ** 2) {
          state.pickups.splice(i, 1); emit({ e: 'pickup', p: v.idx, type: p.type, x: p.x, z: p.z });
          if (auto) { const held = v.item; v.item = p.type; useItem(v, true); v.item = held; } else v.item = p.type;   // boosts fire straight away; the rest wait for the button
        }
      }
      for (let i = state.traps.length - 1; i >= 0; i--) {
        const tr = state.traps[i];
        if (tr.owner !== v.owner && (tr.x - v.x) ** 2 + (tr.z - v.z) ** 2 < C.TRAP_R ** 2) {
          state.traps.splice(i, 1);
          if (v.shieldUntil > t) emit({ e: 'blocked', p: v.idx, x: v.x, z: v.z });
          else { v.stuckUntil = t + C.STUCK_TIME; emit({ e: 'stuck', p: v.idx, x: v.x, z: v.z }); }
        }
      }
      v.bumpCooldown = Math.max(0, v.bumpCooldown - dt);
    }

    // bumping
    const [a, b] = state.vacs;
    let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < C.VAC_R * 2) {
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const nx = dx / d, nz = dz / d, overlap = C.VAC_R * 2 - d;
      a.x -= nx * overlap / 2; a.z -= nz * overlap / 2; b.x += nx * overlap / 2; b.z += nz * overlap / 2;
      if (a.bumpCooldown <= 0) {
        a.kx -= nx * C.BUMP_FORCE; a.kz -= nz * C.BUMP_FORCE; b.kx += nx * C.BUMP_FORCE; b.kz += nz * C.BUMP_FORCE;
        a.bumpCooldown = b.bumpCooldown = C.BUMP_COOLDOWN;
        emit({ e: 'bump', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      }
      collide(a); collide(b);
    }

    for (let i = state.spills.length - 1; i >= 0; i--) {
      const s = state.spills[i];
      s.vy -= 14 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.t += dt;
      if (s.y <= 0.1 || s.t > 2) {
        const victim = 3 - s.owner;
        const x = Math.max(-MAP_W / 2, Math.min(MAP_W / 2, s.x)), z = Math.max(-MAP_H / 2, Math.min(MAP_H / 2, s.z));
        const vv = state.vacs[victim - 1];
        const shielded = vv.shieldUntil > t && (vv.x - x) ** 2 + (vv.z - z) ** 2 < 1.6 ** 2;
        if (!shielded) dirtyAt(x, z, C.SPILL_R, victim, 1e9);
        emit({ e: 'spill', x, z, shielded });
        state.spills.splice(i, 1);
      }
    }
    for (let i = state.traps.length - 1; i >= 0; i--) if (state.traps[i].until < t) state.traps.splice(i, 1);
  }

  // Server helpers: pause while a player is away, resume on rejoin.
  function pause(winnerIfGone) { if (state.phase === 'playing' || state.phase === 'countdown') { state.prevPhase = state.phase; state.phase = 'paused'; state.pauseLeft = C.REJOIN_TIME; state.pauseWinner = winnerIfGone; } }
  function resume() { if (state.phase === 'paused') state.phase = state.prevPhase || 'playing'; }

  function snapshot() {
    const r = n => Math.round(n * 100) / 100;
    return {
      phase: state.phase, time: r(state.time), timeLeft: r(state.timeLeft), countdown: r(state.countdown), pauseLeft: r(state.pauseLeft),
      winner: state.winner, counts: state.counts, totalCells: state.totalCells,
      vacs: state.vacs.map(v => ({ x: r(v.x), z: r(v.z), h: r(v.h), mode: v.mode, bin: Math.round(v.bin), item: v.item,
        stuckUntil: r(v.stuckUntil), turboUntil: r(v.turboUntil), wideUntil: r(v.wideUntil), shieldUntil: r(v.shieldUntil) })),
      pickups: state.pickups.map(p => ({ id: p.id, type: p.type, x: p.x, z: p.z })),
      traps: state.traps.map(p => ({ id: p.id, owner: p.owner, x: r(p.x), z: r(p.z) })),
      spills: state.spills.map(s => ({ id: s.id, x: r(s.x), y: r(s.y), z: r(s.z) })),
    };
  }

  return { state, grid, GW, GH, MAP_W, MAP_H, blockers, events, reset, step, snapshot, pause, resume, cellOf, cellCenter, endMatch, collide, wrap };
}
