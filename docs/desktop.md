# three.ws Desktop

`/` is a web desktop. Every window frames a real three.ws page, so nothing is
mocked and every existing surface works unchanged. The previous homepage is
kept at `/classic`.

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
- **Rubber band.** Drag on the empty desktop to draw a selection box; Ctrl or Shift adds to the current selection.
- **Right-click.** The desktop menu sets icon size, sorts by name, auto-arranges, refreshes, and opens All Apps and Personalize. Icon menus open or remove the selection.
- **All Apps.** A native app listing every app and page from the site navigation, with Open and Add to desktop for each.
- **Settings.** Profile (name, avatar colour), Personalization (dark, light or match system, six accents, five wallpapers or your own photo), Desktop and taskbar (icon size, taskbar alignment, 24-hour clock), and Session and storage.
- **Session.** Open windows and their geometry, icon layout, preferences, recent apps and the custom wallpaper are saved in this browser (`tws:desktop`, `tws:icons`, `tws:prefs`, `tws:recent` in localStorage; the wallpaper image in IndexedDB database `tws-desktop`) and restored on reload. Settings can export the session to a JSON file, import one (only known `tws:` keys are accepted, files over 2 MB are refused), close all windows, or reset everything. Nothing is sent to a server.

## URLs and preferences

| What | How |
| --- | --- |
| Open an app on load | `/?app=forge` or `/#app=forge` |
| Force the desktop | `/?view=desktop` (also remembers the choice) |
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

`npm run dev`, then `node scripts/desktop-smoke.mjs http://localhost:3000` boots
the desktop in a real browser, opens the Start menu and an app, and reports
console errors and failed requests. `npx vitest run tests/desktop-layout.test.js
tests/desktop-page.test.js`.

## Provenance

The visual design language and token values are ported from CTRL
(`nirholas/CTRL`), whose theme descends from the open-source Win12 project. The
DOM and JavaScript here are written for three.ws and share no code with it.
