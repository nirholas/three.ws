# src/desktop

The web desktop served at `/` (page: `pages/desktop.html`). See
[docs/desktop.md](../../docs/desktop.md).

| File | Role |
| --- | --- |
| `main.js` | Entry: runs the boot checks, shows the lock screen, then walks the visitor in as an avatar or lands them on the desktop; deep links |
| `boot-logic.js` | Pure boot rules: concurrent boot steps with timings, entry mode (`?world=1`, `?world=0`, `?view=desktop`, deep links, WebGL, the Arrival preference), greeting, summary, GPU name (unit tested) |
| `boot.js`, `boot.css` | The boot screen (live log of real checks) and the lock screen (greeting, $THREE, gems and account chips, Walk in / Desktop), plus the synthesised startup chime |
| `shell.js` | Taskbar (peek cards, Aqua dock magnification and menu bar), Start, desktop files and menus, widgets and assistant wiring, native apps, the World button and the Arrival settings |
| `chrome/` | OS chrome: tray status pill, quick settings, notification centre and calendar, toasts, lock screen, power menu, Run and About dialogs, the bubbles wallpaper and the Fluent island taskbar; pure rules in `chrome/logic.js` (unit tested) |
| `icon-layer.js` | Desktop icon grid: selection, rubber band, drag, keyboard, per-item menus, rename and delete hooks |
| `wm.js` | Window manager (drag, resize, edge and corner snap, Snap layouts flyout, Snap assist, minimize flight and morph motion, focus, persistence hooks) |
| `layout.js` | Pure geometry (snap zones, Snap layouts, dock magnification curve), shell styles and their bar sizes, search ranking, state and preference validation (unit tested) |
| `apps.js` | App registry and wallpapers |
| `os/` | The OS layer: virtual file system (`fs.js`), app registry, app host and the native apps in `os/apps/` (see [os/README.md](os/README.md)) |
| `grid/` | The Grid: a neon wireframe room of live app surfaces. `index.js` is the scene and controller, `panels.js` the canvas painters, `logic.js` the pure layout, proximity and tier rules (unit tested), `grid.css` the HUD |
| `icons.js` | Stroke glyphs |
| `theme.css`, `desktop.css`, `styles.css` | CTRL tokens; shell and window styles; Snap layouts, Snap assist, peek and the Fluent, Aqua and Classic skins |
| `world/index.js` | The campus controller: mounts the 3D world over the desktop, input, proximity prompts, sit-down and walk-in transitions, the phone, the VR headset, mining, the frame loop |
| `world/campus.js` | The scene: sky, sun and shadows, the grounds (lawn, gate, paths, plaza, hills), every building as a walk-in room with photographic surfaces, the furnished office, the exchange, the launchpad, the cave mine, the forge, the gallery, the plaza, the market, quality tiers |
| `world/rooms.js` | Pure room data: footprint, walls, doors, windows, roofs, columns, door and arrival points, wall solids (unit tested) |
| `world/props.js` | Pure prop placement: trees, hedges, lamps, benches, bins, crates and the rest from the three.ws object library, per-tier byte budget, prop solids (unit tested) |
| `world/prop-loader.js` | Streams the placed GLBs nearest-first from the spawn, shares geometry between instances, hands each prop its hit id |
| `world/surfaces.js` | PBR surface materials (colour, normal, ARM) from `public/campus/manifest.json`, tiled in metres |
| `world/places.js` | Pure campus map: places, keep-outs, veins, desk objects, trigger radii, stand points (unit tested) |
| `world/cast.js` | Pure rules for the agents on the campus: who qualifies (real name, public GLB), where they stand, prompt distances, the SSE parser, the embed snippet and the grounding prompt (unit tested) |
| `world/agents.js` | Spawns the cast from `/api/agents/public?avatar=1`, each in its own body: wander, notice and face the visitor, the greeter's wave and hello, name tags and speech bubbles, the streaming `/api/chat` client |
| `world/talk.js` | The conversation panel: streamed replies, read-aloud through `/api/tts/speak`, the profile window and the one-tag `<agent-3d>` embed |
| `world/screen.js` | The desk monitor that shows the live desktop and the sit-down camera move |
| `world/ticker.js` | The exchange ticker board fed by `/api/three-token/stats` and `/api/coin/markets` (unit tested) |
| `world/mine.js` | Gem mining client over `/api/world/gems` (server-rolled gems, anonymous id that adopts onto the account) |
| `world/xr.js` | WebXR session entry for the headset |
| `world/world.css` | HUD, prompts, phone overlay, gem panel, touch controls, agent name tags and the talk panel |
