// Headless tests: bot-vs-bot match, then an online match over real WebSockets against the server.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSim, C } from '../client/sim.js';
import { createBot } from '../client/bot.js';

const layout = JSON.parse(readFileSync(new URL('../client/assets/layout.json', import.meta.url), 'utf8'));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };

// 1) sim + bots
{
  const sim = createSim(layout); sim.reset();
  const bots = [createBot(sim, 0), createBot(sim, 1)];
  let steps = 0;
  while (sim.state.phase !== 'over' && steps++ < 30 * 80) { sim.step(1 / 30, bots.map(b => b.think(1 / 30))); sim.events.length = 0; }
  const s = sim.state, pct = i => s.counts[i] / s.totalCells * 100;
  assert(s.phase === 'over', `bot match ends (${pct(1).toFixed(0)}% vs ${pct(2).toFixed(0)}%, winner ${s.winner})`);
  assert(pct(1) + pct(2) > 10, 'bots clean a meaningful share of the house');
}

// 2) server + two websocket clients
const PORT = 8123;
const srv = spawn(process.execPath, [fileURLToPath(new URL('../server/server.js', import.meta.url))], { env: { ...process.env, PORT, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('running')) r(); }));
const info = await (await fetch(`http://localhost:${PORT}/api/info`)).json();
assert(info.online === true, 'api/info reports online');
const page = await (await fetch(`http://localhost:${PORT}/`)).text();
assert(page.includes('Dust Duel'), 'serves index.html');

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, msgs: [], states: [], events: [], room: null, waitFor: (t, timeout = 5000) => new Promise((res, rej) => {
    const found = c.msgs.find(m => m.t === t); if (found) return res(found);
    const h = m => { if (m.t === t) { c.hooks.delete(h); res(m); } }; c.hooks.add(h); setTimeout(() => rej(new Error('timeout waiting for ' + t)), timeout); }), hooks: new Set(),
    send: o => ws.send(JSON.stringify(o)) };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'state') { c.states.push(m.s); c.events.push(...m.ev); } else c.msgs.push(m); if (m.t === 'room') c.room = m; for (const h of [...c.hooks]) h(m); };
  return new Promise(res => ws.onopen = () => res(c));
}
const A = await client(); A.send({ t: 'create' });
const roomA = await A.waitFor('room');
assert(/^DUST\d+$/.test(roomA.code) && roomA.slot === 0 && roomA.waiting === true, `host gets a room code (${roomA.code}) and waits`);
const B = await client(); B.send({ t: 'join', code: roomA.code.toLowerCase() });
const roomB = await B.waitFor('room');
assert(roomB.slot === 1, 'second player joins slot 1');
await A.waitFor('start'); await B.waitFor('start');
assert(true, 'both get start');
await new Promise(r => setTimeout(r, 4200));                              // countdown
assert(A.states.at(-1).phase === 'playing', 'match is playing after the countdown');
// each player drives out of its dock in the most open of 8 directions (works for any map)
const probe = createSim(layout); probe.reset();
const openDir = i => {
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, start = probe.state.vacs[i], p = { x: start.x, z: start.z };
    for (let s = 0; s < 120; s++) { p.x += Math.cos(a) * C.SPEED / 60; p.z += Math.sin(a) * C.SPEED / 60; probe.collide(p); }
    const d = Math.hypot(p.x - start.x, p.z - start.z);
    if (!best || d > best.d) best = { ix: +Math.cos(a).toFixed(3), iz: +Math.sin(a).toFixed(3), d };
  }
  return best;
};
const dirA = openDir(0), dirB = openDir(1), start0 = A.states.at(-1).vacs.map(v => ({ x: v.x, z: v.z }));
A.send({ t: 'm', ix: dirA.ix, iz: dirA.iz }); B.send({ t: 'm', ix: dirB.ix, iz: dirB.iz });
await new Promise(r => setTimeout(r, 2000));
const sA = A.states.at(-1), moved = i => Math.hypot(sA.vacs[i].x - start0[i].x, sA.vacs[i].z - start0[i].z);
assert(moved(0) > 3, `host vacuum drove out of its dock (${moved(0).toFixed(1)} m)`);
assert(moved(1) > 3, `guest vacuum drove out of its dock (${moved(1).toFixed(1)} m)`);
assert(sA.counts[1] > 50 && sA.counts[2] > 50, 'both cleaned floor');
assert(A.events.some(e => e.e === 'clean') && A.events.some(e => e.e === 'go'), 'events are relayed');
A.send({ t: 'a', k: 'toggle' }); await new Promise(r => setTimeout(r, 300));
assert(A.states.at(-1).vacs[0].mode === 'dump', 'toggle action reaches the server');
// disconnect + rejoin
const stateBefore = B.states.at(-1);
B.ws.close(); await A.waitFor('opponent');
await new Promise(r => setTimeout(r, 800));
assert(A.states.at(-1).phase === 'paused', 'match pauses when a player drops');
const B2 = await client(); B2.send({ t: 'join', code: roomA.code, token: roomB.token });
const back = await B2.waitFor('room'); await B2.waitFor('grid');
assert(back.slot === 1, 'rejoin with token restores the slot and sends the floor');
await new Promise(r => setTimeout(r, 300));
assert(A.states.at(-1).phase === 'playing', 'match resumes after rejoin');
// a wrong code
const X = await client(); X.send({ t: 'join', code: 'NOPE' }); const err = await X.waitFor('error'); assert(err.msg.includes('No room'), 'bad code is rejected');
// let the match finish
await new Promise(r => setTimeout(r, 58000));
const last = A.states.at(-1);
assert(last.phase === 'over', `match ends (winner ${last.winner}, ${Math.round(last.counts[1] / last.totalCells * 100)}% vs ${Math.round(last.counts[2] / last.totalCells * 100)}%)`);
A.send({ t: 'again' }); await new Promise(r => setTimeout(r, 300));
assert(A.states.at(-1).phase === 'countdown', 'play again restarts the match');
const bytes = JSON.stringify(A.states.at(-1)).length; console.log('snapshot ~' + bytes + ' bytes; ' + A.states.length + ' snapshots received');
srv.kill(); console.log('ALL OK');
