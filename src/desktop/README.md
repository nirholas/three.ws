# src/desktop

The web desktop served at `/` (page: `pages/desktop.html`). See
[docs/desktop.md](../../docs/desktop.md).

| File | Role |
| --- | --- |
| `main.js` | Entry: runs the boot checks, shows the lock screen, then walks the visitor in as an avatar or lands them on the desktop; deep links |
| `boot-logic.js` | Pure boot rules: concurrent boot steps with timings, entry mode (`?world=1`, `?world=0`, `?view=desktop`, deep links, WebGL, the Arrival preference), greeting, summary, GPU name (unit tested) |
| `boot.js`, `boot.css` | The boot screen (live log of real checks) and the lock screen (greeting, $THREE, gems and account chips, Walk in / Desktop), plus the synthesised startup chime |
| `shell.js` | Taskbar (peek cards, Aqua dock magnification and menu bar), Start, widgets, calendar, menus, native apps, the World button and the Arrival settings |
| `wm.js` | Window manager (drag, resize, edge and corner snap, Snap layouts flyout, Snap assist, minimize flight and morph motion, focus, persistence hooks) |
| `layout.js` | Pure geometry (snap zones, Snap layouts, dock magnification curve), shell styles and their bar sizes, search ranking, state and preference validation (unit tested) |
| `apps.js` | App registry and wallpapers |
| `icons.js` | Stroke glyphs |
| `theme.css`, `desktop.css`, `styles.css` | CTRL tokens; shell and window styles; Snap layouts, Snap assist, peek and the Fluent, Aqua and Classic skins |
| `world/index.js` | The campus controller: mounts the 3D world over the desktop, input, proximity prompts, sit-down and walk-in transitions, the phone, the VR headset, mining, the frame loop |
| `world/campus.js` | The scene: ground, office desk, exchange, launchpad, mine, forge, gallery, plaza, market, lighting |
| `world/places.js` | Pure campus map: places, keep-outs, veins, desk objects, trigger radii, stand points (unit tested) |
| `world/screen.js` | The desk monitor that shows the live desktop and the sit-down camera move |
| `world/ticker.js` | The exchange ticker board fed by `/api/three-token/stats` and `/api/coin/markets` (unit tested) |
| `world/mine.js` | Gem mining client over `/api/world/gems` (server-rolled gems, anonymous id that adopts onto the account) |
| `world/xr.js` | WebXR session entry for the headset |
| `world/world.css` | HUD, prompts, phone overlay, gem panel, touch controls |
