# Independent fairness / sanity check for a Dust Duel layout.json
import json, sys, heapq, math
import numpy as np
from scipy import ndimage
L = json.load(open(sys.argv[1]))
RES = 0.1; VAC_R = 0.5; BRUSH_R = 0.8; OFF = L.get('spawnOffset', 0.2)
W, H = L['size']['w'], L['size']['h']; NX, NZ = round(W / RES), round(H / RES)
xs = -W / 2 + (np.arange(NX) + 0.5) * RES; zs = -H / 2 + (np.arange(NZ) + 0.5) * RES
X, Z = np.meshgrid(xs, zs)            # [z, x]
def rect_of(f):
    swap = (f['rot'] % 180) == 90
    w, d = (f['d'], f['w']) if swap else (f['w'], f['d'])
    return dict(x0=f['x'] - w/2, z0=f['z'] - d/2, x1=f['x'] + w/2, z1=f['z'] + d/2)
blockers = [dict(**w, kind='wall') for w in L['walls']] + [dict(**rect_of(f), kind=f['model']) for f in L['furniture']]
solid = np.zeros_like(X, bool)
for b in blockers: solid |= (X > b['x0']) & (X < b['x1']) & (Z > b['z0']) & (Z < b['z1'])
# a vacuum centre is allowed where it's >= VAC_R from every solid cell
dist_to_solid = ndimage.distance_transform_edt(~solid) * RES
centre_ok = dist_to_solid >= VAC_R
def cell(x, z): return int((z + H/2) / RES), int((x + W/2) / RES)
issues = []
# docks / spawns
spawns = []
for i, d in enumerate(L['docks']):
    r = math.radians(d['rot']); sx, sz = d['x'] + math.cos(r) * OFF, d['z'] + math.sin(r) * OFF
    spawns.append((sx, sz)); ci = cell(sx, sz)
    if not centre_ok[ci]: issues.append(f"P{i+1} spawn at ({sx:.2f},{sz:.2f}) overlaps something (clearance {dist_to_solid[ci]:.2f} < {VAC_R})")
    # facing: does it face into the room (more open floor ahead than behind)?
    ahead = [dist_to_solid[cell(sx + math.cos(r) * k, sz + math.sin(r) * k)] for k in (1.0, 1.5)]
    if min(ahead) < VAC_R: issues.append(f"P{i+1} dock rot={d['rot']} faces into an obstacle/wall (rot convention: 0 = +x right, 90 = +z down)")
    # dock plate footprint ~1.0 x 0.9 vs furniture
    for b in blockers[len(L['walls']):]:
        if b['x0'] < d['x'] + 0.5 and b['x1'] > d['x'] - 0.5 and b['z0'] < d['z'] + 0.45 and b['z1'] > d['z'] - 0.45:
            issues.append(f"P{i+1} dock overlaps {b['kind']}")
# Dijkstra over allowed centres from each spawn (8-connected)
def field(start):
    D = np.full(X.shape, np.inf); s = cell(*start); D[s] = 0; pq = [(0.0, s)]
    nb = [(-1,0,1),(1,0,1),(0,-1,1),(0,1,1),(-1,-1,1.4142),(-1,1,1.4142),(1,-1,1.4142),(1,1,1.4142)]
    while pq:
        dd, (i, j) = heapq.heappop(pq)
        if dd > D[i, j]: continue
        for di, dj, c in nb:
            a, b2 = i + di, j + dj
            if 0 <= a < NZ and 0 <= b2 < NX and centre_ok[a, b2]:
                nd = dd + c * RES
                if nd < D[a, b2]: D[a, b2] = nd; heapq.heappush(pq, (nd, (a, b2)))
    return D
F = [field(s) for s in spawns]
reach = np.isfinite(F[0]) | np.isfinite(F[1])
if not np.array_equal(np.isfinite(F[0]), np.isfinite(F[1])): issues.append("the two docks can't reach the same areas")
# cleanable floor: non-solid cells within BRUSH_R of a reachable centre; their distance = nearest reachable centre + offset
dist_to_reach, idx = ndimage.distance_transform_edt(~reach, return_indices=True)
dist_to_reach *= RES
clean = (~solid) & (dist_to_reach <= BRUSH_R)
free = ~solid
unreach = free & ~clean
D = [Fi[idx[0], idx[1]] + dist_to_reach for Fi in F]
area = lambda m: m.sum() * RES * RES
p1 = clean & (D[0] < D[1]); p2 = clean & (D[1] < D[0]); tie = clean & (D[0] == D[1])
print(f"map {W}x{H}; floor (non-solid) {area(free):.1f}; cleanable {area(clean):.1f}; unreachable pockets {area(unreach):.1f}")
print(f"split by who arrives first: P1 {area(p1)+area(tie)/2:.1f}  P2 {area(p2)+area(tie)/2:.1f}  diff {abs(area(p1)-area(p2))/max(1e-9,(area(p1)+area(p2)))*100:.1f}%")
for r in L['rooms']:
    m = clean & (X > r['x0']) & (X < r['x1']) & (Z > r['z0']) & (Z < r['z1'])
    d1 = np.where(m, D[0], np.inf).min(); d2 = np.where(m, D[1], np.inf).min()
    # distance to the room's 'middle' = median of cell distances
    med1 = np.median(D[0][m]); med2 = np.median(D[1][m])
    print(f"  {r['name']:16s} cleanable {area(m):6.1f} | P1 share {area(m & p1):5.1f}  P2 share {area(m & p2):5.1f} | median drive P1 {med1:5.1f}  P2 {med2:5.1f}")
print("power-up spots (driving distance from P1 / P2 spawn):")
for k, s in enumerate(L['powerupSpots']):
    ci = cell(s['x'], s['z'])
    note = '' if centre_ok[ci] else f'  <-- NOT reachable by a vacuum centre (clearance {dist_to_solid[ci]:.2f})'
    print(f"  #{k} ({s['x']:5.1f},{s['z']:5.1f})  P1 {F[0][ci]:5.1f}  P2 {F[1][ci]:5.1f}{note}")
d1 = sorted(F[0][cell(s['x'], s['z'])] for s in L['powerupSpots']); d2 = sorted(F[1][cell(s['x'], s['z'])] for s in L['powerupSpots'])
print("  sorted P1:", [round(v, 1) for v in d1]); print("  sorted P2:", [round(v, 1) for v in d2])
# furniture vs walls / each other
fr = blockers[len(L['walls']):]
for i in range(len(fr)):
    for j in range(i + 1, len(fr)):
        a, b = fr[i], fr[j]
        if a['x0'] < b['x1'] and a['x1'] > b['x0'] and a['z0'] < b['z1'] and a['z1'] > b['z0']: issues.append(f"{a['kind']} overlaps {b['kind']}")
for f, b in zip(L['furniture'], fr):
    for w in L['walls']:
        if b['x0'] < w['x1'] - 1e-6 and b['x1'] > w['x0'] + 1e-6 and b['z0'] < w['z1'] - 1e-6 and b['z1'] > w['z0'] + 1e-6: issues.append(f"{f['model']} at ({f['x']},{f['z']}) pokes into a wall")
# doorway widths: narrowest passage the vacuum must use
print("issues:" if issues else "issues: none"); [print("  -", s) for s in issues]
np.save('fields.npy', np.stack([np.where(np.isfinite(D[0]), D[0], -1), np.where(np.isfinite(D[1]), D[1], -1)])); np.save('masks.npy', np.stack([solid, clean, p1, p2, unreach]))
