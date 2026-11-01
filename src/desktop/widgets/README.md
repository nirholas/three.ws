# src/desktop/widgets

Live widgets for the web desktop: cards pinned to the desktop itself, and the
widgets board that slides in from the taskbar's Widgets button. Every value
comes from a real three.ws endpoint, Open-Meteo or the device; a feed that
fails says so and offers a retry. Guide: [docs/desktop-widgets.md](../../../docs/desktop-widgets.md).

| File | Role |
| --- | --- |
| `logic.js` | Pure rules: the catalog (`CATALOG`), sizes, the desktop grid with first-fit placement and stored-layout validation (`gridFor`, `fits`, `firstFit`, `settle`, `cellAt`), number, price and time formatting, sparkline geometry, weather codes, the month grid. Unit tested in `tests/desktop-widgets.test.js` |
| `data.js` | Shared feeds (`subscribe`, `refresh`): one fetch per feed for every widget that reads it, polled on its own cadence, paused while the tab is hidden, last good data kept on failure. Also the weather place (saved city, geolocation, Open-Meteo geocoding search) |
| `render.js` | One renderer per widget type (`renderWidget`), with skeleton, offline and empty states |
| `index.js` | The shell surface: `mountDesktopWidgets` (grid layer, drag or arrow keys to move, edit mode, Add widget gallery), `toggleWidgets` / `closeWidgets` (the board with a greeting, your widgets and a news column), `editDesktopWidgets`, `addDesktopWidget` |
| `widgets.css` | Card, per-widget, desktop layer, edit mode, menus, gallery and board styles; light and dark through the shell tokens; phone and reduced-motion rules |

## Feeds

| Feed | Source | Refresh |
| --- | --- | --- |
| `token` | `/api/three-token/stats` | 60 s |
| `history` | `/api/pump/price-history` (15 minute candles, last 24 h) | 5 min |
| `stats` | `/api/stats` | 60 s |
| `agents` | `/api/agents/public?sort=newest` | 2 min |
| `pulse` | `/api/pulse` | 15 s |
| `launches` | `/api/pump/launches` | 2 min |
| `news` | `/api/news/feed?featured=1` | 5 min |
| `weather` | Open-Meteo forecast for the saved or located place | 15 min |

Clock, Calendar, System (Battery, Network Information, memory and storage
estimates where the browser exposes them) and Sticky note read the device only.

## Storage

`tws-widgets:desktop` (desktop layout), `tws-widgets:board` (board widgets),
`tws-widgets:place` (weather place). A sticky note's text is saved inside its
layout entry. All in `localStorage`; a missing or corrupt value falls back to the default layout.
