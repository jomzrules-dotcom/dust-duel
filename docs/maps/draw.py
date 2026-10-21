import json, sys, math
import numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle, FancyArrow
L = json.load(open(sys.argv[1])); solid, clean, p1, p2, unreach = np.load('masks.npy')
W, H = L['size']['w'], L['size']['h']
img = np.ones(solid.shape + (3,)) * np.array([0.93, 0.91, 0.87])
img[p1] = [0.74, 0.84, 0.99]; img[p2] = [1.0, 0.82, 0.70]; img[unreach] = [0.80, 0.78, 0.74]
fig, ax = plt.subplots(figsize=(13, 8.6), dpi=110)
ax.imshow(img, extent=[-W/2, W/2, H/2, -H/2], interpolation='nearest')
for w in L['walls']: ax.add_patch(Rectangle((w['x0'], w['z0']), w['x1']-w['x0'], w['z1']-w['z0'], color='#3f3a36'))
def rect_of(f):
    swap = (f['rot'] % 180) == 90; w, d = (f['d'], f['w']) if swap else (f['w'], f['d'])
    return f['x']-w/2, f['z']-d/2, w, d
COL = dict(bed='#c9a27e', nightstand='#9b7653', wardrobe='#8a6a4b', plant='#6aa86a', sofa='#5fa8a8', tv_stand='#6b5b4b', coffee_table='#b08a62', armchair='#7fb9b9',
           counter='#9aa3ab', fridge='#d9dde1', island='#aab2ba', bathtub='#e6eef2', sink='#cfd9de', toilet='#f2f5f6', shower='#b8c8cf')
for f in L['furniture']:
    x, z, w, d = rect_of(f); ax.add_patch(Rectangle((x, z), w, d, facecolor=COL.get(f['model'], '#999'), edgecolor='#2b2724', lw=0.8))
    ax.text(f['x'], f['z'], f['model'].replace('_', ' '), ha='center', va='center', fontsize=6.5, color='#1c1917')
for r in L['rooms']:
    ax.text((r['x0']+r['x1'])/2, r['z0']+1.0 if r['z0'] < 0 else r['z1']-1.0, r['name'].upper(), ha='center', va='center', fontsize=11, weight='bold', color='#44403c', alpha=.75)
for i, d in enumerate(L['docks']):
    c = ['#2563eb', '#ea580c'][i]; a = math.radians(d['rot'])
    ax.add_patch(Rectangle((d['x']-0.5, d['z']-0.45), 1.0, 0.9, facecolor=c, alpha=.9))
    ax.add_patch(FancyArrow(d['x'], d['z'], math.cos(a)*1.6, math.sin(a)*1.6, width=0.12, head_width=0.45, color=c))
    ax.text(d['x'] + math.cos(a)*2.6, d['z'] + math.sin(a)*2.6 + 0.6, f"P{i+1} start", color=c, fontsize=9, weight='bold', ha='center')
for k, s in enumerate(L['powerupSpots']):
    ax.add_patch(Circle((s['x'], s['z']), 0.5, facecolor='#fde047', edgecolor='#a16207', lw=1.2)); ax.text(s['x'], s['z'], str(k), ha='center', va='center', fontsize=7, weight='bold')
ax.set_xlim(-W/2-0.3, W/2+0.3); ax.set_ylim(H/2+0.3, -H/2-0.3); ax.set_aspect('equal'); ax.axis('off')
ax.set_title(sys.argv[2], fontsize=12, loc='left', color='#1c1917')
fig.text(0.01, 0.02, sys.argv[3], fontsize=9, color='#44403c')
plt.savefig(sys.argv[4], bbox_inches='tight', facecolor='white')
