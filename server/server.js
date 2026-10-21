// Dust Duel — game server. Serves the client and runs online matches.
// No dependencies: static files over HTTP, WebSockets implemented below (RFC 6455, text frames only).
// Run: node server/server.js   (or double-click start.bat)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSim, makeInput, C } from '../client/sim.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'client');
const PORT = Number(process.env.PORT) || 8080;
const TICK = 1 / 30;
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'layout.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg' };

// ---------------------------------------------------------------- rooms
const rooms = new Map();   // code → room
function makeCode() {
  for (let tries = 0; tries < 50; tries++) {
    const code = 'DUST' + String(Math.floor(Math.random() * 100)).padStart(2, '0');
    if (!rooms.has(code)) return code;
  }
  return 'DUST' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
function lanUrl() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${PORT}`;
  return null;
}
function createRoom() {
  const room = {
    code: makeCode(), sim: createSim(layout), slots: [null, null],         // slots: { sock, token }
    inputs: [makeInput(), makeInput()], started: false, timer: null, lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const sl of room.slots) if (sl?.sock) sl.sock.send(s); }
function startMatch(room) {
  room.started = true; room.sim.reset();
  broadcast(room, { t: 'start' });
  startTicking(room);
}
// Timers are coarse on some systems (Windows rounds a 33 ms interval up to ~46 ms), so the game is advanced by
// real elapsed time in fixed 1/30 s steps, never by "one step per timer callback".
function startTicking(room) {
  if (room.timer) return;
  room.lastTick = performance.now(); room.acc = 0;
  room.timer = setInterval(() => tick(room), 15);
}
function tick(room) {
  const { sim } = room, now = performance.now();
  room.acc = Math.min(room.acc + (now - room.lastTick) / 1000, TICK * 6);   // cap catch-up after a stall
  room.lastTick = now;
  if (room.acc < TICK) return;
  while (room.acc >= TICK) { sim.step(TICK, room.inputs); room.acc -= TICK; }
  broadcast(room, { t: 'state', s: sim.snapshot(), ev: sim.events.splice(0) });
  if (sim.state.phase === 'over' || sim.state.phase === 'idle') { clearInterval(room.timer); room.timer = null; }
}
function gridMessage(room) { return { t: 'grid', grid: Buffer.from(room.sim.grid).toString('base64') }; }
function join(sock, room, slot, token) {
  room.slots[slot] = { sock, token };
  sock.room = room; sock.slot = slot;
  sock.send(JSON.stringify({ t: 'room', code: room.code, slot, token, lan: lanUrl(), waiting: !room.slots[1 - slot] }));
}
function leave(sock) {
  const room = sock.room; if (!room) return;
  const slot = sock.slot; sock.room = null;
  if (room.slots[slot]?.sock !== sock) return;
  room.slots[slot].sock = null;
  const other = room.slots[1 - slot];
  if (room.started && (room.sim.state.phase === 'playing' || room.sim.state.phase === 'countdown')) {
    room.sim.pause(other ? (1 - slot) + 1 : 0);              // the remaining player wins if nobody comes back in time
    if (other?.sock) other.sock.send(JSON.stringify({ t: 'opponent', status: 'left' }));
    startTicking(room);
  }
  if (!room.slots.some(s => s?.sock)) setTimeout(() => { if (!room.slots.some(s => s?.sock)) { clearInterval(room.timer); rooms.delete(room.code); } }, 60000);
}
function onMessage(sock, m) {
  if (m.t === 'create') {
    const room = createRoom();
    join(sock, room, 0, crypto.randomBytes(8).toString('hex'));
  } else if (m.t === 'join') {
    const room = rooms.get(String(m.code || '').toUpperCase());
    if (!room) return sock.send(JSON.stringify({ t: 'error', msg: 'No room with that code.' }));
    // rejoin with a token
    const back = room.slots.findIndex(s => s && m.token && s.token === m.token);
    if (back >= 0) {
      if (room.slots[back].sock) room.slots[back].sock.close();
      join(sock, room, back, m.token);
      sock.send(JSON.stringify(gridMessage(room)));
      if (room.sim.state.phase === 'paused' && room.slots.every(s => s?.sock)) {
        room.sim.resume();
        const other = room.slots[1 - back]; if (other?.sock) other.sock.send(JSON.stringify({ t: 'opponent', status: 'back' }));
      }
      return;
    }
    const free = room.slots.findIndex(s => !s);
    if (free < 0) return sock.send(JSON.stringify({ t: 'error', msg: 'That room is full.' }));
    join(sock, room, free, crypto.randomBytes(8).toString('hex'));
    const host = room.slots[1 - free]; if (host?.sock) host.sock.send(JSON.stringify({ t: 'room', code: room.code, slot: 1 - free, token: host.token, lan: lanUrl(), waiting: false }));
    startMatch(room);
  } else if (sock.room) {
    const room = sock.room, inp = room.inputs[sock.slot];
    room.lastActive = Date.now();
    if (m.t === 'm') { inp.ix = Math.max(-1, Math.min(1, +m.ix || 0)); inp.iz = Math.max(-1, Math.min(1, +m.iz || 0)); }
    else if (m.t === 'a') { if (m.k === 'toggle') inp.toggle = true; else if (m.k === 'use') inp.use = true; }
    else if (m.t === 'again') { if (room.sim.state.phase === 'over' && room.slots.every(s => s?.sock)) startMatch(room); }
  }
}

// ---------------------------------------------------------------- HTTP
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ online: true, lan: lanUrl(), rooms: [...rooms.keys()] }));
  }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- WebSocket (RFC 6455, server side, text frames)
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
class Socket {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.open = true; this.room = null; this.slot = -1;
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
    this.ping = setInterval(() => this.frame(0x9, Buffer.alloc(0)), 15000);
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (masked) { const mask = this.buf.subarray(off - 4, off); const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
      this.buf = this.buf.subarray(off + len);
      if (op === 0x1) { try { onMessage(this, JSON.parse(payload.toString('utf8'))); } catch (e) { /* ignore bad messages */ } }
      else if (op === 0x8) { this.close(); return; }
      else if (op === 0x9) this.frame(0xA, payload);
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.onClose(); }
  }
  send(text) { this.frame(0x1, Buffer.from(text, 'utf8')); }
  close() { if (this.open) { try { this.frame(0x8, Buffer.alloc(0)); } catch {} this.socket.end(); } this.onClose(); }
  onClose() { if (!this.open) return; this.open = false; clearInterval(this.ping); leave(this); }
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.url !== '/ws') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  new Socket(socket);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanUrl();
  console.log(`Dust Duel server running.`);
  console.log(`  You:               http://localhost:${PORT}`);
  if (lan) console.log(`  Friends on Wi-Fi:  ${lan}`);
  console.log(`  Friends elsewhere: run a tunnel, e.g.  cloudflared tunnel --url http://localhost:${PORT}`);
  console.log(`Press Ctrl+C to stop.`);
  if (!process.env.NO_OPEN) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    import('node:child_process').then(cp => cp.exec(cmd));
  }
});
