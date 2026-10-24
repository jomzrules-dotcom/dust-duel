// Draws the game's collision (walls + furniture from client/assets/layout.json, at floor level) over the painting,
// so you can see where the vacuum is stopped compared with what is painted.
// Run: node docs/maps/overlay-collision.mjs <out.png>   (Windows: draws with PowerShell + System.Drawing)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCam } from './fit-camera.mjs';
import { rectOf } from '../../client/sim.js';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const layout = JSON.parse(readFileSync(here('../../client/assets/layout.json'), 'utf8'));
const f = layout.painting.camera, cam = makeCam([...f.pos, f.targetZ, f.vfov]);
const out = process.argv[2] || here('../../art/house/screenshots/collision-overlay.png');
const shapes = [];
const poly = (pts, color) => shapes.push({ color, pts: pts.map(([x, z]) => cam.project([x, 0, z]).map(Math.round)) });
const ring = (r, n = 40) => Array.from({ length: n }, (_, i) => { const a = i / n * 2 * Math.PI; return [(r.x0 + r.x1) / 2 + Math.cos(a) * (r.x1 - r.x0) / 2, (r.z0 + r.z1) / 2 + Math.sin(a) * (r.z1 - r.z0) / 2]; });
for (const w of layout.walls) poly([[w.x0, w.z0], [w.x1, w.z0], [w.x1, w.z1], [w.x0, w.z1]], 'Cyan');
for (const p of layout.furniture.filter(p => p.blocks !== false)) {
  for (const r of p.parts ? p.parts.map(q => ({ ...rectOf(q), shape: q.shape })) : [{ ...rectOf(p), shape: p.shape }])
    poly(r.shape === 'oval' ? ring(r) : [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]], 'Red');
}
const json = join(tmpdir(), 'dust-duel-overlay.json');
writeFileSync(json, JSON.stringify(shapes));
const ps = `Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${here('../../client/assets/house.jpg')}'); $bmp = New-Object System.Drawing.Bitmap $img; $img.Dispose()
$g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'
foreach ($s in (Get-Content '${json}' -Raw | ConvertFrom-Json)) {
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromName($s.color)), 3
  $pts = [System.Drawing.Point[]]($s.pts | ForEach-Object { New-Object System.Drawing.Point $_[0], $_[1] })
  $g.DrawPolygon($pen, $pts)
}
$bmp.Save('${out}'); $g.Dispose(); $bmp.Dispose()`;
execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
console.log('wrote', out);
