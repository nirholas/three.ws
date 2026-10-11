# src/field

The Field, the homepage at `/`: a live, zoomable map of every agent and every
product surface. Feature doc: [docs/field.md](../../docs/field.md).

| File | Role |
| --- | --- |
| `entry.js` | Loaded by `pages/desktop.html`. Mounts the desktop (`src/desktop/main.js`) by default, or the Field when the URL asks for it (`?view=field`). |
| `logic.js` | Pure functions with no DOM: district layout and rings, agent spiral, camera math (`zoomAt`, `fitRect`, `zoomPath`), level of detail, event routing, formatting, search ranking and deep-link parsing. Covered by `tests/field-logic.test.js`. |
| `data.js` | The live feeds: `/api/stats`, `/api/three-token/stats`, `/api/agents/public`, `/api/avatars/public`, `/api/pump/launches`, `/api/pulse`, `/api/auth/me`, and the site nav (`/nav-data.js`) for search. |
| `field.js` | `mountField(root)`: builds the DOM world and canvas sky, runs the camera, input, polling, comets and surfaces. Returns `{ flyTo, dive, close }`. |
| `field.css` | All styles, dark by default and light under `:root[data-theme='light']`. |

## Rules

- Every value shown comes from a feed in `data.js`. A failed feed renders an
  offline state with a retry, never sample data.
- Add a district by appending to `DISTRICTS` in `logic.js` (unique `id`, a
  routed same-origin `href`, a `hue` and a `kind`) and a `case` for its `kind`
  in `field.js`. The tests check every `href` is routed in `vercel.json` and
  that tags and cards never collide.
- Far tags are counter-scaled (`--inv`), so they hold a fixed screen size. On
  phones the CSS caps them at 150px wide, the budget the layout test assumes.
