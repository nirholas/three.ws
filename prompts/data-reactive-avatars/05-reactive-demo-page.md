# 05 — Live demo page: pump.fun-reactive avatar

## Why

Ship a single static page that anyone can open to see a 3D avatar reacting in real time to actual pump.fun activity — proof the data-reactive pattern works end-to-end. No login, no LLM calls, no chat: the avatar just lives and breathes on the page driven by the real upstream.

## Real, no-mock requirements

- The page connects to the **real** `wss://pumpportal.fun/api/data` WebSocket directly from the browser. No mock feed, no canned events.
- The avatar is the production `<agent-3d>` element loading a real GLB from the project (use the same default avatar `app.html` / `embed.html` use — read it from those files, do not hardcode a new path).
- A live counter on the page shows real running counts: `mints received`, `graduations received`, `gestures emitted`, `last event N seconds ago`.

## Scope

Create `reactive-demo.html` at the repo root (matches the convention of `app.html`, `embed.html`, etc.; it'll be picked up by the existing `tests/test-pages.mjs` if not in its ignore list — check and add if needed).

Page contents:

1. A single `<agent-3d>` element with `eager` boot, the same default model used by `app.html`, `name-plate="Pumpy"`, `background="dark"`.
2. A small unstyled `<aside>` with the four counters above, updated via the protocol bus listeners (`protocol.on('gesture', ...)` increments `gestures emitted`; the WS message handler increments `mints` / `graduations`).
3. A `<script type="module">` block that:
   - Imports the agent-3d element from the local source (`./src/lib.js` or `./src/element.js` — whichever the existing demo pages use; do not invent a new entry).
   - Opens `new WebSocket('wss://pumpportal.fun/api/data')`, subscribes to `subscribeNewToken` and `subscribeMigration`.
   - Aggregates over a 2 s window using the same priority rules described in the `pump-fun-reactive` skill (this page must work even if that skill is not installed — duplicate the small classifier inline; it's < 50 lines).
   - Emits `gesture` / `emote` / `speak` / `look-at` to the agent's protocol via `document.querySelector('agent-3d').agent_protocol.emit(...)` (or the equivalent public accessor — check `src/element.js` for the right hook; do not introduce a new one).
   - Reconnects with exponential backoff (1 → 2 → 4 → 8 → cap 30 s).
4. A `<footer>` line linking to PumpPortal as the data source ("Live data: pumpportal.fun").

The page must work when served from `vite` dev (`npm run dev`) and when statically deployed (Vercel). No build-step magic beyond what the existing demo pages need.

## Out of scope

- Multi-avatar grid (one is enough for the demo).
- Settings panel.
- Chat / LLM.
- Any backend endpoint.

## Verification (must all pass before archiving)

- Run `npm run dev`, open `http://localhost:<port>/reactive-demo.html` in a real browser. Within 60 s, observe:
  - Counters incrementing.
  - Avatar performing a `wave` or `celebrate` gesture and visibly emoting.
  - DevTools network tab shows a real `wss://pumpportal.fun/api/data` connection.
- `npm run build` (or whatever the project's build command is) succeeds with the new page included.
- The existing `tests/test-pages.mjs` page-load test passes for `reactive-demo.html` (or the page is listed in its ignore patterns with a justification — prefer making it pass).
- `npm run lint` clean.

## When done

1. Add one line to the root `README.md`'s demo / pages list pointing at `reactive-demo.html`.
2. `git mv prompts/data-reactive-avatars/05-reactive-demo-page.md prompts/data-reactive-avatars/archive/05-reactive-demo-page.md`.
