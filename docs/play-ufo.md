# Flappin UFO (`/play/ufo`)

A hold-to-climb arcade game. Hold to thrust, release to fall, thread the asteroid pillars. Each level has more pillars and a tighter gap than the last, on a fixed course that is the same for every player.

## How a run is verified

`src/play/ufo/sim.js` is a pure, deterministic 60 Hz simulation (seeded PRNG, only `+ - * /` and comparisons). The browser plays it live and records, per level, the tick numbers where the thrust input flipped. A run is `levels: [{ edges: [...] }, ...]`.

`POST /api/play/ufo-runs` with `{ name, levels }` replays those edges through the same sim (`verifyRun`):

- Every level except the last must be cleared. The last must end in a crash.
- Edges must be strictly increasing integers at least 2 ticks apart, at most 1500 per level, and none at or after the end tick.
- At most 30 levels.

Failures return 422 `impossible_run`. The stored score is the one the server computed. Identical recordings are rejected with 409. Submissions are rate limited per IP.

## Leaderboard and ghost

`GET /api/play/ufo-runs?limit=10&ghost=1` returns the ranked rows (best run per signed-in user, or per lowercased name for anonymous players) and the top run's recording. The client replays it through the same sim as a translucent ghost.

Scores also appear on `/rankings?metric=ufo_score` (signed-in players only).

## Files

- Page: `pages/play/ufo.html`, game `src/play/ufo/game.js`, styles `src/play/ufo/ufo.css`
- API: `api/play/ufo-runs.js`, migration `api/_lib/migrations/20261023150000_ufo_runs.sql`
- Tests: `tests/play-ufo-runs.test.js`
