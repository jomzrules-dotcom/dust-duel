# Dust Duel

1v1 game where two robot vacuums race to clean a dirty house. Whoever owns the most clean floor after 1 minute wins. Plays like Splatoon, but you drive over dirt instead of spraying paint.

Design doc: https://claude.ai/artifact/TM2njkgaehL28F2JvMnnzV

## Play it

- **Browser (no install):** https://jomzrules-dotcom.github.io/dust-duel/ — vs computer, 2 players on one keyboard, garage. Published from `client/` by GitHub Pages on every push.
- **Online with friends:** the Node server has to run somewhere. Easiest is Render's free tier: Render dashboard → *New* → *Blueprint* → choose this repo (it reads `render.yaml`). You get an address like `https://dust-duel.onrender.com`; everyone opens that and uses **Online → Create room / Join**. The free instance sleeps when idle and wakes in about a minute.
- **On your PC:** below.

## Run it

Double-click `start.bat` (or run `node server/server.js`). It starts the game server and opens http://localhost:8080.

Menu: **Race the computer** (solo, keyboard or touch), **Two players** on one keyboard, **Online**: **Create room** → send the code to a friend → they open the same server address and **Join**. **Garage** picks your topper (hat) and has a free-drive **Test drive**.

The menu is an attract scene (`client/menu.js`): Blue and Orange paint the edges, a yellow pace vacuum prints the name on the floor, then the two bounce around screensaver-style leaving trails that fade. Tap or press a key to skip the opening. Buttons use the Luckiest Guy font from Google Fonts (falls back to a heavy system font offline).

- **Friends on your Wi-Fi** open the address the server prints (e.g. `http://192.168.0.12:8080`).
- **Friends elsewhere** need a tunnel to your PC. Easiest: install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) and run `cloudflared tunnel --url http://localhost:8080`; it prints a public https link that works as long as your PC and the server stay on. (ngrok works the same way.)
- Phones and tablets: turn the device sideways; the left half of the screen is the joystick, the round button on the right switches Clean/Dump, and a glowing item button appears above it when you hold Shield, Cables or Spill.

Three.js loads from a CDN, so players need internet the first time. The page must be served (not opened as a file).

## Controls (two players, one keyboard)

| | Blue | Orange |
|---|---|---|
| Move | W A S D | Arrow keys |
| Switch Clean / Dump | Space | Enter |
| Use item | Q | Right Shift |

Solo and online: either key set drives your vacuum. Touch: joystick + MODE / ITEM buttons.

- **Clean mode:** dirty floor turns your color and fills your bin. Driving over the other player's floor steals it.
- **Dump mode:** the bin empties behind you as dirt, but only onto the other player's clean floor.
- **Bin full:** you stop cleaning until you dump.
- **Bumping:** both vacuums bounce away in opposite directions.
- **Power-ups** spawn on the glowing floor spots every 8–10 s (faster in the last 15 s).
  - **Automatic** the moment you drive over them: Turbo (2x speed, 5 s) · Wide brush (2x width, 8 s).
  - **Held until you press the item button** (Q / Right Shift / the glowing button that appears on touch screens), one at a time: Shield (blocks Cables and Spill, 8 s) · Cables (drop a tangle behind you; the other player gets stuck 2 s) · Spill (throw dirt onto their floor).

## Project layout

```
client/
  index.html          page, HUD, main menu, lobby cards, touch controls
  game.js             rendering (Three.js), input, lobby, online client
  menu.js             main-menu attract scene (opening, floor title, bouncing vacuums)
  toppers.js          cosmetic toppers (cone, egg, duck) and their trail effects
  sim.js              ALL game rules — shared by the browser and the server
  bot.js              computer opponent (BFS on a coarse nav grid)
  assets/layout.json  the map: walls, furniture, docks, power-up spots (game coords)
  assets/models/      GLB models exported from Blender
server/
  server.js           game server: static files + WebSocket rooms, authoritative 30 Hz sim
test/run.mjs          headless tests (bot match, full online match over WebSockets) — `npm test`
blender/
  dust-duel-assets.blend   one collection per asset (library row north of the house) + a "Placed" collection showing the real room layout
docs/
  design.md           summary of the design doc + decisions
  maps/               map designs, camera design, check.py / draw.py
start.bat             starts the server
```

## The map

Four rooms in a 2×2 grid with single inner walls (no hallway), symmetric under a 180° rotation so both starts are fair. Each room has two doorways; the center where the inner walls meet is closed. All furniture is solid, so doorways are the choke points.

- **Bedroom** (top-left) — Blue's dock is on the left wall. Bed with its headboard against the top wall, nightstand, plant. Blocked area ≈ 19.8.
- **Kitchen** (bottom-right) — Orange's dock is on the right wall. Counter and fridge along the bottom wall, island in the center, pantry cabinet on the right wall, plant. Blocked area ≈ 19.9.
- **Living room** (top-right) — TV stand on the top wall, couch in the center facing it, plant (the coffee table was removed: vacuums got stuck between it and the couch). Blocked area ≈ 8.9.
- **Study** (bottom-left) — desk and bookshelf on the bottom wall, wardrobe on the left wall, plant. Blocked area ≈ 10.9.
- 10 fixed power-up spots: the four doorways, one in each room, and one near each start room's inner corner.

Everything comes from `client/assets/layout.json`; coordinates are x right, z down on screen, in the same units as the models (1 unit ≈ 1 m, vacuum diameter 1).

## Blender → game

Each asset lives in its own collection in `blender/dust-duel-assets.blend` and is exported as `client/assets/models/<name>.glb` (glTF, +Y up, materials included). Blender's Y axis is the game's −Z.

- `vacuum.glb`: the material named `VacBody` is tinted per player by the game; the objects `Brush_L` / `Brush_R` are spun by the game in Clean mode.
- The vacuum spawns `spawnOffset` (0.2) in front of its dock so it sits on the plate, facing into the room.
- **Every furniture model's origin must sit at the centre of its footprint (and its base at z = 0)**, and `w`/`d` in `layout.json` must be its real size. The game puts the origin at the layout position and builds the collision box around it; an off-centre origin makes you hit invisible furniture and drive through visible furniture. (This happened once: bed, sofa and coffee table had their origin on a leg.)

To change the map: edit `layout.json` (positions, rotations, footprints `w`/`d`, `powerupSpots`). To change a model: edit it in the .blend and re-export the collection to the same file name.

## Build plan (from the design doc)

1. **Core prototype** — done.
2. **Computer opponent** — done (`bot.js`); power-ups done.
3. **Online play** — done: Node + WebSockets, room codes, server-authoritative, prediction for your own vacuum and smoothing for the other, 10 s rejoin pause. Hosted on your PC; for a cheap host later, deploy the same folder and run `node server/server.js`.
4. Polish — sounds, music, effects. Touch controls, toppers and the main menu are in.
5. Launch — move the server to a cheap host, more maps, skins.

## How online play works

The server runs the real game (`sim.js`) 30 times a second. Players only send inputs (`m` move, `a` toggle/use), so nothing on a player's screen can change the score. Each tick the server sends a small snapshot (~400 bytes) plus the events since the last one (clean strokes, dirt, bumps…); the client paints the floor from those events, so both players see the same trails. Your own vacuum is predicted locally and pulled toward the server position when snapshots arrive; the other vacuum is smoothed. If a player drops, the match pauses up to 10 s and they can rejoin from the same browser; otherwise the remaining player wins.

## Tuning knobs

All in `client/sim.js` → `C`: match time, speed, turn rate, brush radius, bin size (`BIN_CAP`), dump rate, power-up timing. Bot behaviour in `bot.js` (reaction time, when it dumps, when it uses items). Camera zoom: `FOLLOW_AREA` in `game.js` (m² of floor in view; 170 ≈ 1.6 rooms, 91 ≈ one room).

## Map tools

`docs/maps/check.py <layout.json>` checks a layout before it's built: spawn clearance, docks facing into the room, overlaps, unreachable floor, and fairness (which player can drive to each spot first, room by room, plus power-up distances). `docs/maps/draw.py` draws the result. Needs Python with numpy, scipy, matplotlib.


Open questions: should a bump also spill some of the other vacuum's bin? Are blue and orange the right colors?
