// Headless tests: bot-vs-bot match, then an online match over real WebSockets against the server.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSim } from '../client/sim.js';
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
A.send({ t: 'm', ix: 1, iz: 0 }); B.send({ t: 'm', ix: -1, iz: 0 });
await new Promise(r => setTimeout(r, 2000));
const sA = A.states.at(-1);
assert(sA.vacs[0].x > layout.docks[0].x + 3, `host vacuum moved right (x=${sA.vacs[0].x})`);
assert(sA.vacs[1].x < layout.docks[1].x - 3, `guest vacuum moved left (x=${sA.vacs[1].x})`);
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
