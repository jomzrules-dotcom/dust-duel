# Painted house in the game: DESIGN (approved with tint B, BUILT 2026-10-23)

## What the build changed from this design
- **No warp needed (section 2):** the fitted camera lands within ~8 px (≈ 8 cm) of the painting (RMS over the
  measured edges and wall caps), so the render-only correction was left out.
- **Docks (section 3):** the proposed front-wall spot is hidden behind the painted front wall, so both docks stand on
  the inner wall facing south: Blue in the bathroom (−0.7, 0.7), Orange in the kitchen (4.5, 0.7). Fairness split 1.3%.
- **No grime at all (boss, after the build):** the floor layer shows only the trails (owner's tint at 55% over the
  painting); dump and spill erase the other player's trail. Section 5's grime film is gone.
- **Trail outline: DROPPED by the boss ("remove outline"), never built.** Trails stay the plain 55% tint. The design
  is kept for reference (mockup `art/house/DESIGN_TRAIL_OUTLINE.png`): without grime,
  trails are faint where the colour matches the floor. Keep the 55% tint and add, per player, a 7 cm bright edge (a
  light, slightly more saturated version of the player colour, 92% opacity) plus a 2 px charcoal keyline outside it
  (variant B; Codex agrees). Where Blue meets Orange: both bright edges, one shared dark separator. Built in the floor
  shader (a trail pixel next to a pixel of another owner is edge), so it follows clean, steal, dump and spill.
- **Grime (superseded):** none under walls (from the camera those cells line up with the painted walls and what hangs on them);
  occluders are oval for the bathtub, baskets and plants, and as tall as what is painted on a piece (lamps, the TV).
- **Background:** the painting's charcoal outside the house was flattened to one colour (the 4 rooms differed by ~3
  levels and showed as a seam); `art/house/stitch/FlatBackground.cs` → `client/assets/house.jpg`.
- Screenshots: `art/house/screenshots/`.

Pictures: `art/house/DESIGN_WALLS.png` (inner walls, doorways, docks; painted furniture stays in front) and
`art/house/DESIGN_FLOOR_MOCKUP.png` (grime + cleaned trails, tint A vs B).
Art: `art/house/house-4rooms.png` (2920 x 1774, approved; fridge fixed after review, see `art/house/stitch/`).

## The idea in one line
The painting IS the house: a fixed 2D backdrop. The game draws only what moves or changes (grime, cleaned floor,
vacuums, power-ups, effects), plus the inner walls, all lined up exactly on the painting.

## 1. Camera: fitted to the painting, then only pan and zoom
- Fit one 3D camera (position, angle, field of view) so the game floor lands on the painted floor
  (corners, seam cross, doorway edges, furniture feet as control points).
- The camera never moves or tilts after that. **Follow view and overview are a 2D pan/zoom of the same view**
  (`camera.setViewOffset`), and the painting is cropped and scaled by exactly the same window, so 3D objects stay
  glued to the art on every screen shape. The "swoop" into follow view becomes a smooth zoom.
- Follow zoom stays ~1.6 rooms (`FOLLOW_AREA` 170 m²). Overview shows the whole painting. Outside the painting is
  the painting's charcoal background (the lawn goes away).
- The painting file is never edited or resized. The screen scales it like any image (≈1:1 on a 1080p screen).

## 2. Fitting the painting: warp the drawing of the world, not the art
- The AI painting is not an exact camera view: the near half is drawn shallower than real perspective allows
  (back half 660 px deep, front half 611 px, same 7.6 m each). No single camera fits it perfectly.
- So a smooth correction (per room, from the control points) moves where things are **drawn** by a few percent.
  **The game itself (`sim.js`, server, bot) is unchanged:** distances, speeds, brush size and fairness stay exact.
  Only rendering positions are corrected.

## 3. Map: house v2 walls + furniture measured from the painting
- Use **house v2** (`docs/maps/house-v2.json`): 26 x 16 m, same rooms in the same places, same inner walls and
  4 doorways (3 m wide). It was designed and fairness-checked already.
- **Furniture collision comes from the painting**, not v2's list: bed + nightstands, wardrobe, basket, plants;
  sofa, coffee table, bookshelf, lamp, TV stand; bathtub (middle), sink, toilet, towel rack, basket; dining table
  + chairs (one block), fridge, counters. Measured from where each piece touches the floor (its feet, not its top).
- **Docks move** (v2's spots land on the painted wardrobe and counters). Proposal: Blue on the bedroom's back
  wall, Orange on the kitchen's front wall, 180° opposite (picture). Power-up spots are re-placed off the furniture.
- Then `check.py` reruns: reachable floor, spawn clearance, and the Blue/Orange split must stay within ~1%.
  Check the bathroom basket next to the bottom doorway for clearance.

## 4. Inner walls
- 3D boxes in the painted walls' look, using **one 256 x 256 texture** from Codex (wall cap, cream face,
  baseboard, sampled from unlit parts of the painting, padded so colours don't bleed).
  The painted outer walls are left as painted.
- **No columns** (boss: removed). The small stitch leftovers (5 px right-wall jog, 7 px baseboard step, bottom-wall
  shading) sit where the inner walls meet the outer walls, so the 3D inner walls hide most of them. If one still
  shows in the real-game screenshots, the stitched painting is retouched at that spot.

## 5. Grime and cleaned floor (picture: `DESIGN_FLOOR_MOCKUP.png`)
- **Dirty:** a grey-brown grime film with crumbs and fluff over the painted floor (same palette as today, softer,
  no visible squares). The painting stays faintly visible underneath.
- **Cleaned:** the grime is gone and the painting shows through with the player's colour on top.
  **Tint A 30%** (subtle, more art) or **B 55%** (obvious ownership; Codex and I recommend **B**).
- Grime is only drawn on floor: never on furniture or walls (see 6).

## 6. Depth: what is in front of what
- Invisible 3D shapes ("occluders") stand where the painted furniture and outer walls are, fitted to each piece's
  silhouette and depth. Anything drawn by the game that is **behind** one of them is hidden there, so the painting
  shows through:
  - grime and vacuums behind something tall (the sofa back, the wardrobe, the bottom wall);
  - **the 3D inner walls behind painted furniture that stands in front of them** (boss: "the refrigerator is
    cut"): the **fridge** against the living/kitchen wall, and the bathroom **mirror, lamp and towel rail** by the
    bedroom/bathroom wall. Those always stay whole. The rule is depth, not "furniture beats walls": a wall in front
    of a piece still covers it (Codex).
- Thin things like chair legs and plant leaves get no occluder (a box would wrongly hide a vacuum next to them).

## 7. Vacuums, docks, power-ups, effects
- Same 3D models as now, lit warm to match the painting's evening lamps. Their shadows fall on the painting
  through a shadow-only floor layer.

## What changes in code (build step, after approval)
`client/game.js` (camera, backdrop, grime/tint layer, occluders, inner walls, lighting) ·
`client/assets/layout.json` (house v2 walls + measured furniture + docks/spots) · `sim.js` only reads the new
layout · the menu attract scene is unchanged · tests (`npm test`) + `check.py` rerun.
Order: calibrate camera → new layout + check.py → backdrop + grime → occluders → inner walls → lighting →
phone and PC screenshots of the real game for the boss.

## Who does what
- **Claude:** camera fit, layout, all game code, checks, screenshots.
- **Codex:** the 256 x 256 inner-wall texture; review the in-game look (lighting match, grime) once it runs.

## Decisions for the boss
1. Approve the approach (painting as a fixed backdrop, pan/zoom camera, lawn replaced by the charcoal background).
2. Tint: **A (30%)** or **B (55%, recommended)**.
3. Docks: on the back/front walls as proposed, final spot set by the fairness check.
