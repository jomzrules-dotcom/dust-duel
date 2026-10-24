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
  assets/layout.json  the map: walls, furniture, docks, power-up spots (game coords) + the painting's camera
  assets/house.jpg    the painted house (2920×1774), drawn as the backdrop
  assets/inner-wall.png  Codex's 256×256 inner-wall texture (rows 0–63 wall top, 64–255 face + baseboard)
  assets/models/      GLB models exported from Blender (the game uses vacuum + dock; furniture is painted)
server/
  server.js           game server: static files + WebSocket rooms, authoritative 30 Hz sim
test/run.mjs          headless tests (bot match, full online match over WebSockets) — `npm test`
blender/
  dust-duel-assets.blend   one collection per asset (library row north of the house) + a "Placed" collection showing the real room layout
docs/
  design.md           summary of the design doc + decisions
  maps/               map designs, camera design, check.py / draw.py, fit-camera.mjs, build-painted-layout.mjs
  painted-house-design.md   how the painting is used in the game
art/house/            the house painting: rooms/, stitch/ (tools + notes), textures/, screenshots/
start.bat             starts the server
```

## The map: the painted house

The house is a painting (`client/assets/house.jpg`, made by Codex as 4 rooms and stitched, see `art/house/`). The game
draws it as a fixed backdrop and puts only what moves or changes on top. Design: `docs/painted-house-design.md`.

- **Camera:** one 3D camera fitted to the painting (`docs/maps/fit-camera.mjs`, fit error ≈ 8 px ≈ 8 cm, stored in
  `layout.json` → `painting.camera`). It never moves; follow view and overview are a 2D pan/zoom of its view
  (`setViewOffset`), so the vacuums stay glued to the painted floor on every screen shape.
- **Floor layer:** grime is a see-through film over the painted floor; cleaned floor shows the painting under the
  owner's colour at 55%. No grime under walls.
- **Depth:** invisible "occluder" shapes where the painted furniture and the front wall are (`h` in `layout.json` is
  the height of everything painted on a piece), so grime, vacuums and inner walls behind them are hidden.
- **Inner walls** are 3D, 1.88 m tall like the painted walls, with Codex's texture. Outer walls are painted.
- **Rooms:** house v2 (26 × 16): bedroom, living room, kitchen, bathroom, 4 doorways. Furniture collision is
  measured on the painting (`docs/maps/build-painted-layout.mjs`), one piece per thing (sofa, coffee table, dining
  table, each chair); round pieces (bathtub, baskets, plants) collide as ovals.
- **Outer walls' collision follows the painted floor edges**, not the 26 × 16 box: back z −6.8, front 6.85
  (where the front wall's cap hides the floor), sides ±12.45. The painting isn't a true perspective view, so the
  camera can't match its walls; the edges are measured on the painting instead. Check it with
  `node docs/maps/overlay-collision.mjs <out.png>` (collision drawn over the painting).
- **Outer walls in the painting** were redrawn straight and one colour per wall (the 4 rooms disagreed at the
  seams) and the background made flat: `art/house/stitch/CleanWalls.cs` (house-4rooms.png → `client/assets/house.jpg`).
- **Docks** stand on the inner wall facing south (Blue in the bathroom, Orange in the kitchen): floor right north of a
  wall is hidden from the camera, so docks can't go there. Placed by sweeping positions for the fairest split:
  **1.3%** (Blue 139.0 m² vs Orange 135.5 m²).

Coordinates are x right, z down on screen (1 unit ≈ 1 m, vacuum diameter 1).
To change the map: edit `PAINTED`, docks or spots in `docs/maps/build-painted-layout.mjs` and run
`node docs/maps/build-painted-layout.mjs --write` (it prints the fairness check).

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

`docs/maps/check.py <layout.json>` checks a layout before it's built: spawn clearance, docks facing into the room, overlaps, unreachable floor, and fairness (which player can drive to each spot first, room by room, plus power-up distances). `docs/maps/draw.py` draws the result. Needs Python with numpy, scipy, matplotlib. `docs/maps/build-painted-layout.mjs` runs the same fairness check in Node (no Python needed).


Open questions: should a bump also spill some of the other vacuum's bin? Are blue and orange the right colors?
