# src/desktop

The web desktop served at `/` (page: `pages/desktop.html`). See
[docs/desktop.md](../../docs/desktop.md).

| File | Role |
| --- | --- |
| `main.js` | Entry: boot, restore session, deep links |
| `shell.js` | Taskbar, Start, widgets, calendar, menus, native apps |
| `wm.js` | Window manager (drag, resize, snap, focus, persistence hooks) |
| `layout.js` | Pure geometry, search ranking, state validation (unit tested) |
| `apps.js` | App registry and wallpapers |
| `icons.js` | Stroke glyphs |
| `theme.css`, `desktop.css` | CTRL tokens; shell and window styles |
