# three.ws Desktop

> `/` now opens the [Field](field.md), a live map of the platform. This
> desktop and its campus are at `/?view=desktop` and `/?world=1`.

`/?view=desktop` is a web desktop with a 3D campus in front of it. The page boots like a
computer, locks with a greeting, and then the visitor walks to their desk as
their avatar and sits down; the desktop opens on the monitor. Every window
frames a real three.ws page, so nothing is mocked and every existing surface
works unchanged. The previous homepage is kept at `/classic`.

## Arriving

1. **Boot.** A live log of real checks, each line timed as it settles: Graphics
   (the GPU name, from WebGL), Site catalog (the page count from
   `public/nav-data.js`), Account (`/api/auth/me`, skipped when signed out),
   Fonts, Avatar (the default body and the clip manifest), the $THREE feed
   (`/api/three-token/stats`), the Gem ledger (`/api/world/gems`) and the
   Desktop itself. A check that fails is marked and the lock screen says which
   one is offline; nothing is faked and there is no timed progress bar. The
   checks run concurrently, so the boot takes as long as the slowest request.
2. **Lock screen.** A greeting for the hour (with your name once you set one in
   Settings or sign in), the $THREE price and 24h change, your gem balance and
   your account, and two ways in: **Walk in** (the campus) or **Desktop**. The
   first gesture also unlocks the startup chime, a short synthesised chord
   (Settings, Arrival, Startup chime turns it off).
3. **The campus.** You spawn at the gate facing your workstation, and the
   first thing you meet is a real agent: the most talked-to public agent on the
   platform stands beside the gate path, turns to you as you walk in, waves and
   says hello through its own brain (`POST /api/chat` with its id, so its
   published persona answers). Walk up to the desk and the prompt says Sit
   down; hold E and the camera settles into the chair while the desktop fades
   in on the monitor. The taskbar's World button (also in the Start menu footer
   and the desktop right-click menu) stands you back up where you were.

Controls: WASD or the arrow keys to walk, Shift to run, drag to orbit, wheel to
zoom, C cycles the camera (Follow, Cinematic, and the rest of the shared camera
modes), E interacts, Esc puts the phone down. On a phone the campus shows a
touch stick and an on-screen interact button. The strip along the bottom lists
every place; tap one to teleport to its doorstep.

## The campus

| Place | What it is | What E does |
| --- | --- | --- |
| Your workstation | The home office: desk, monitor, phone, VR headset | Sit down opens the desktop on the monitor. Step round to the phone to pick up Pocket (the handheld agent console, framed as `/pocket?chrome=off`). Step round to the headset to enter the world in WebXR when the browser offers an immersive session; the button is hidden otherwise. |
| three.ws Exchange | The trading floor, with a ticker board scrolling $THREE and the top market coins | Opens Trenches (live Solana launches, runners and smart money) |
| Launchpad | The launch tower | Opens the pump.fun Launchpad |
| The Mine | A quarry with five glowing veins | Hold E at a vein for four seconds to dig. The server rolls the gem (quartz, amethyst, sapphire, emerald, ruby, diamond, rarest last) and enforces the cadence; the gem panel in the HUD keeps the running balance and points. |
| The Forge | Text to 3D | Opens Forge |
| Gallery | Every public avatar | Opens Gallery |
| Agent Plaza | The agent directory | Opens Discover |
| Marketplace | Agent skills | Opens Marketplace |

The ticker board reads `/api/three-token/stats` and `/api/coin/markets` and
refreshes every minute; when a feed is down the board says so instead of
showing stale numbers. Places, keep-out radii, the veins and the desk-object
trigger distances live in `src/desktop/world/places.js`, which is pure data
and unit tested, so a place can never point at an app the desktop does not
have.

Walking into a place opens its app as a window and sits you at the desk; the
World button brings you back to that place's doorstep, not the gate. Your
avatar is the same default body and clip library the rest of the site uses
(`/avatars/default.glb`, `/animations/manifest.json`).

### The agents

The campus is populated by real registered agents, not extras. On entry the
world reads `GET /api/agents/public?avatar=1&sort=popular` and seats the ten
most talked-to public agents that have a real name and a publicly readable
avatar GLB (five on a phone): the greeter beside the gate path, a gathering in
front of Agent Plaza, two along the path and one at the doorstep of each other
building. Each wears its own body from `avatar_model_url`, idles and wanders a
step or two, turns to face you and nods when you come near, and carries a
floating name tag (tap it to walk over). Nothing about them is invented: the
name, description, skills, conversation count and on-chain badge all come from
the agent's public record, and an agent still wearing an onboarding placeholder
name or bio is never introduced by it.

Within reach the prompt reads Talk to <name>; press E (or tap the tag again)
and the conversation panel opens. Messages go to `POST /api/chat` with the
agent's id and a grounding system prompt built from its public record, so the
agent answers as itself; replies stream in as they are generated, appear above
the agent's head as a speech bubble, and can be read aloud through
`POST /api/tts/speak` (the speaker toggle in the panel header, remembered in
`localStorage`). The footer opens the agent's profile as a desktop window, and
"Put this agent on your site" shows the one-tag embed (`<agent-3d
agent-id="…" chat voice>`) that puts that exact agent, body and brain, on any
web page: the 3D agent layer of the internet, demonstrated in place. Rate
limits (429) and a signed-out chat gate (401) are rendered as a note with a
Try again button; a failed TTS call is a toast and the text stays. Esc closes
the panel, sitting down or entering a building closes it too.

Which agents qualify, where they stand, the prompt distances, the SSE parser,
the embed snippet and the grounding prompt live in
`src/desktop/world/cast.js` (pure rules, unit tested in
`tests/world-cast.test.js`); `agents.js` spawns and animates the bodies;
`talk.js` is the panel.

### Gems

`GET /api/world/gems` returns the caller's balance (`gems` by id, `points`,
`total`, `recent`, the gem `table` and `dig_seconds`). `POST /api/world/gems`
with `{ node: "vein-a" }` completes a dig and returns the gem. Visitors mine
under the stable anonymous browser id the walk pages use (`twx_walk_anon`,
sent as `anonId`); a signed-in dig that carries that id adopts the browser's
gems onto the account, so nothing mined before signing in is lost. The server
refuses a dig that comes sooner than the dig time allows (`429 dig_too_soon`,
with `retry_in_sec`), stops at 300 digs a day (`429 daily_cap`) and rejects an
unknown vein (`400 invalid_node`). Table and rules: `api/_lib/world-gems.js`;
storage: migration `20261015000000_world_gems.sql`.

## What is in it

- **Theme.** The CTRL design system (Windows-12 lineage): Mica gradients, glass
  and blur presets, the CTRL token names, light and dark. Dark is the default.
  Light follows the site-wide `twx_theme` switch, so the desktop and every
  framed page flip together. Tokens: `src/desktop/theme.css`.
- **Shell.** Taskbar with pinned and running apps, Start menu (search, pinned,
  recommended, all apps), widgets panel with a resident `<agent-3d>`, calendar,
  desktop icons, right-click menu, toasts. `src/desktop/shell.js`.
- **Windows.** Drag, eight-handle resize, snap to left, right or top edge,
  minimize, maximize, Alt+Tab, Alt+W. On a phone every window is full screen.
  `src/desktop/wm.js`; geometry in `src/desktop/layout.js` (unit tested).
- **Apps.** The curated set in `src/desktop/apps.js`, plus every internal page in
  `public/nav-data.js`, so the launcher cannot drift from the site navigation.
  Search with Ctrl+K or the Start menu.

## Working like a computer

- **Icons.** Every app has a desktop icon on a snap grid. Click selects, Ctrl or Shift extends the selection, double-click (or Enter) opens, and a tap opens on touch. Drag to move one icon or a whole selection; drops land on the nearest free cell. Arrow keys move focus, Ctrl+Arrow nudges, Ctrl+A selects all, Delete removes an icon from the desktop.
- **Styles.** Settings, Personalization, Style switches the whole shell, not just colours. **Fluent** (default): Mica windows, a centred taskbar and Snap layouts. **Aqua**: a menu bar across the top that names the window in front (click it for Minimize, Zoom, Snap layouts, Reload, Quit), a floating dock that magnifies under the pointer, and traffic-light window controls on the left. **Classic**: bevelled 9x chrome, navy title bars and a taskbar with a labelled button per window. Saved as `style` in `tws:prefs`. On a phone every style keeps a single bottom bar, so Aqua falls back to the Fluent taskbar there.
- **Snap.** Drag a window to the top edge to maximize, a side to fill that half, or a corner for a quarter. Hover the maximize button (or press Alt+Z) for the Snap layouts flyout: halves, two-thirds and a third, thirds, a main window with a stack, quarters, and a centred focus layout. Layouts narrower than a usable window are hidden on small screens. After a window lands in a layout, Snap assist offers the other open windows for each empty zone; pick one per zone, or press Esc or click the backdrop to stop. Ctrl+Alt+Left and Right snap the focused window to a half, Ctrl+Alt+Up maximizes, Ctrl+Alt+Down restores and then minimizes.
- **Motion.** Minimize flies the window into its taskbar button and restore flies it back; snapping, maximizing and restoring morph between the two frames. Every motion is skipped when the system asks for reduced motion.
- **Peek.** Hover a running app in the taskbar for its window card (title, page, state, close). Hover the card and every other window fades out so the one you are pointing at shows through. The taskbar marks running apps with a short pill and the window in front with a long accent pill; pinned apps that are not running show none.
- **Rubber band.** Drag on the empty desktop to draw a selection box; Ctrl or Shift adds to the current selection.
- **Right-click.** The desktop menu sets icon size, sorts by name, auto-arranges, refreshes, and opens All Apps and Personalize. Icon menus open or remove the selection.
- **All Apps.** A native app listing every app and page from the site navigation, with Open and Add to desktop for each.
- **Settings.** Profile (name, avatar colour), Arrival (start in the campus or on the desktop, startup chime, a Walk the campus button), Personalization (style, dark, light or match system, seven accents, six wallpapers or your own photo; the default `three.ws` wallpaper is the classic site's violet glow over a hairline grid), Desktop and taskbar (icon size, taskbar alignment, 24-hour clock), and Session and storage.
- **Session.** Open windows and their geometry, icon layout, preferences, recent apps and the custom wallpaper are saved in this browser (`tws:desktop`, `tws:icons`, `tws:prefs`, `tws:recent` in localStorage; the wallpaper image in IndexedDB database `tws-desktop`) and restored on reload. Settings can export the session to a JSON file, import one (only known `tws:` keys are accepted, files over 2 MB are refused), close all windows, or reset everything. Nothing is sent to a server.

## URLs and preferences

| What | How |
| --- | --- |
| Open an app on load | `/?app=forge` or `/#app=forge` (skips the campus, lands on the desktop) |
| Walk in as your avatar | `/?world=1` or `/#world` (ignores the Arrival preference) |
| Straight to the desktop this once | `/?world=0` |
| Force the desktop | `/?view=desktop` (also remembers the classic-vs-desktop choice) |
| Skip the boot screen | `/?boot=0` (tests and embeds) |
| Where to start every time | Settings, Arrival, Start in (`startIn` in `tws:prefs`). Without WebGL the desktop opens directly and the World button is hidden. |
| Classic site | `/classic`, or the taskbar button. Remembered in `tws:view` |
| Session | Window layout is saved in `tws:desktop` and restored on reload |

## How a framed page behaves

The iframe is named `tws-os:<app>`. `public/nav.js` sees that name and drops the
site header, footer and floating widgets in that frame (class `tws-in-os`), so a
window is all content. The same page opened in a normal tab is unchanged.

## Adding an app

Add an entry to `APPS` in `src/desktop/apps.js` (id, title, href, hue, icon,
size) and an icon glyph in `src/desktop/icons.js` if needed. Add the page link
to the no-JS list in `pages/desktop.html`; `tests/desktop-page.test.js` fails
until the two agree. A new skeleton or page needs no other wiring.

## Verify

`npm run dev`, then `node scripts/desktop-world-smoke.mjs http://localhost:3000`
drives the whole arrival in a real browser (it opens `/?world=1`, which asks
for the campus whichever entry answers at `/`): it reads every boot line, the
lock greeting and chips, walks in, lists the agents on the campus, walks up to
one, waits for the greeter's hello, talks to the agent and prints its reply
and the embed snippet, runs to the desk and sits down, checks the desktop,
teleports to the Exchange and opens Trenches, picks up the phone, opens the
gem panel, cycles the camera and checks the phone layout, then prints every
console error and every failed or 5xx request. With the default Vite proxy
(`/api` to production) every step runs against live data. To run against a
local API (`PORT=3018 node --env-file=.env.local server/index.mjs`, Vite with
`DEV_API_PROXY=http://localhost:3018`) the gem endpoint needs a database, the
agents need `S3_PUBLIC_DOMAIN` set so `avatar_model_url` is populated, and
anonymous chat needs one of `GROQ_API_KEY`, `OPENROUTER_API_KEY` or
`NVIDIA_API_KEY`; without a key the panel shows the sign-in note instead of a
reply. `node scripts/desktop-smoke.mjs http://localhost:3000` is the shorter
desktop-only drive. Unit tests: `npx vitest run tests/desktop-boot.test.js
tests/world-places.test.js tests/world-cast.test.js tests/world-ticker.test.js
tests/desktop-layout.test.js tests/desktop-page.test.js`.

## Provenance

The visual design language and token values are ported from CTRL
(`nirholas/CTRL`), whose theme descends from the open-source Win12 project. The
DOM and JavaScript here are written for three.ws and share no code with it.

The three shell styles follow the long-standing conventions of Windows 11
(Snap layouts, Snap assist, taskbar peek), macOS (menu bar, magnifying dock,
traffic-light controls) and Windows 9x (bevelled chrome). The open-source web
desktops collected on GitHub were studied for interaction detail only; the
code and CSS are original to three.ws.
