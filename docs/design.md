# Dust Duel — design summary

Full doc: https://claude.ai/artifact/TM2njkgaehL28F2JvMnnzV (that doc is the source of truth; this file is the short version for the team).

## What it is
1v1 online game. Two robot vacuums clean a dirty house; each player's clean floor is their own color shade. After 1 minute the player with more clean floor wins. 3D cartoon look, high overhead camera, browser first (phone + computer). Avoid the word "Roomba" (trademark).

## Core loop
- House starts fully dirty. Clean mode: drive over dirt → your shade, bin fills.
- Full bin = you can't clean. Switch to Dump mode: bin empties behind you as dirt, only onto the opponent's clean floor.
- Stealing: cleaning over the opponent's floor takes it.
- Bumping: both vacuums bounce away in opposite directions.
- Scoring uses an invisible grid; players only see smooth trails.
- Last 15 seconds: music speeds up, power-ups spawn faster.

## Power-ups (hold one at a time; fixed spawn spots)
| Power-up | Effect | Type |
|---|---|---|
| Turbo | 2x speed, 5 s | Boost |
| Wide brush | 2x path width, 8 s | Boost |
| Shield | Blocks Cables and Spill, 8 s | Defense |
| Cables | Drop a tangle; opponent stuck 2 s | Trap (rarer) |
| Spill | Throw dirt onto a patch of opponent's floor | Attack (rarer) |

## Map (first house)
Four rooms in a 2×2 grid with single inner walls and no hallway (decision: bigger rooms), 180°-symmetric so both starting positions are fair. Bedroom (Blue start), Kitchen (Orange start), Living room, Study. Two doorways per room; the center crossing is closed (decision). Docks sit mid-wall on the outer walls. All furniture is solid (decision: no driving under furniture). Rooms are furnished like a real house (bed against the wall with nightstands, sofa facing the TV, counter + island + dining table + fridge, desk + bookshelf + wardrobe). One floor type everywhere. Later maps: office, garage, café.

## Online (step 3) — built
Node.js + hand-written WebSocket server (no dependencies), authoritative (players send inputs only). Room codes like `DUST42`, no accounts. Client prediction + smoothing. Disconnect: 10 s pause, rejoin by token, then the remaining player wins. Vs. computer runs fully in the browser (`bot.js`). Host on the boss's PC first (`start.bat`; Cloudflare Tunnel / ngrok for friends elsewhere), then Render / Fly.io.

Balance (after bot tests): brush radius 0.8, bin 2400 cells (~19 s of cleaning), dump 110 cells/s, venting 60 cells/s when dumping where there is no opponent floor (so a full bin never deadlocks). Bot matches end with ~75–85% of the house clean.

## Presentation (decided 2026-10-21)
- No live score during play; you only see your own bin and item.
- Camera follows your own vacuum at about one room (equal floor area on every screen shape). Whole-house view only during the countdown, at the final reveal, and in 2-players-one-keyboard.
- No minimap. Edge arrows point to off-screen power-ups.
- End of match: TIME'S UP, camera pulls back to the whole house, then a tug-of-war bar (split of the cleaned floor only) wrestles for ~4 s before the winner pops in with confetti.
- Dirty floor is grimy (blotches, crumbs, hair); clean floor is a bright player tint.
- Power-ups are glowing coin badges with icons: Turbo amber ⚡, Wide green ↔, Shield blue, Cables purple plug, Spill pink droplet.

## Next map: house v2 (designed, checked, not built yet)
26 × 16, bedroom / living room / kitchen / bathroom in one loop, files in `docs/maps/`. Checked with `docs/maps/check.py`: 170.2 vs 168.9 m² split (0.4%). Open choice: keep docks as designed (each player effectively owns one shared room) or move them to the far corners so the shared rooms are contested earlier.

## Process
Design first (drawn plan or mockup + numbers), review, then build.

## Decisions so far
Boosts (Turbo, Wide brush) apply on pickup; Shield / Cables / Spill are held and fired with the item button · camera follows your vacuum at about one room, whole house only in the countdown, the reveal and 2-players-one-keyboard · no live score, no minimap · Name Dust Duel · dump only on opponent's floor · bumping yes · 1-minute matches · computer opponent yes · own-PC hosting first · shield counters cables + spill · no floor types · invisible tiles · 3D · furniture is solid, nothing is drive-under.

Still open: player colors (blue/orange?); should a bump also spill part of the other bin?

## Who does what
- Claude: code (`client/*.js`, `server/server.js`), map layout, export pipeline, bot.
- Codex: art direction, textures, extra models/skins, effects and audio in the polish step. Models are in `blender/dust-duel-assets.blend`, one collection per asset; export to `client/assets/models/<name>.glb` with +Y up.
