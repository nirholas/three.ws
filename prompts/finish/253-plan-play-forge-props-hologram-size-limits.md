# Forge-in-world props get a hard triangle and file-size ceiling, server-side abuse limits and a placement-first hologram

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/253-plan-play-forge-props-hologram-size-limits.md`.

**Priority:** P0, live defect, security, or broken money rail (score 87 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Deadline: the meetup is 2026-11-06. After that date, re-scope this order to the next scheduled event or close it as moot.

Text to 3D inside build mode is the platform's headline demo, and it already ships: the Forge form, `/forge <prompt>` chat command, and a networked, persistent placement path. But `src/game/forge-prop.js` enforces no triangle or file-size ceiling on what comes back, so one heavy generation placed in a shared world is delivered raw to every player in it. `src/game/ambient-crowd.js` documents that exactly this class of uncapped user model killed iOS tabs (its `CROWD_BUDGET` tiers cap a model at 3 to 12 MB). At a live event a single oversized prop can crash every phone in the room. The endpoint also has only the lane's generic per-IP limits, with no per-player cooldown or per-world concurrency cap. The placement-first hologram and the session history are the remaining UX gaps.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Shipped: Forge form and `/forge` command, `_forgeProp` in `src/game/coincommunities.js` (about line 4231) calling `forgeWorldProp` in `src/game/forge-prop.js`, then `registerUploadedProp`, `_pickProp`, placement via `obj:spawn`, persistence, undo. A `durable: false` result raises a warning toast.
- `src/game/forge-prop.js`: `MAX_WAIT_MS` 6 minutes, `MAX_IMAGE_BYTES` 8 MB (input photo only), polls every 2.5 s. No triangle count, no output byte ceiling, no call into `api/forge-gameready.js` (which supports `poly_budget` 1000 to 500000 target faces with a remesh step) or `api/forge-remesh.js`.
- World limits: `multiplayer/src/build-limits.js` (`MAX_WORLD_OBJECTS` 200, `MAX_OBJECTS_PER_PLAYER` 30). Client budget precedent: `CROWD_BUDGET` in `src/game/ambient-crowd.js`.
- `api/forge.js` rate limits are per IP (`limits.mcp3dGenerate`, `mcp3dGenerateFreeTiered`, global `mcp3dGenerateGlobal`); there is no per-player cooldown or per-world concurrent cap keyed to a world.
- Ground truth table when debugging: `forge_creations` (backend, status, error, prompt).
- Tests present: `tests/forge-prop.test.js`, `tests/build-limits.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "MAX_\|triangle\|gameready\|remesh\|durable" src/game/forge-prop.js
sed -n 1,60p tests/forge-prop.test.js
grep -n "MAX_WORLD_OBJECTS\|MAX_OBJECTS_PER_PLAYER" multiplayer/src/build-limits.js
sed -n 1,40p api/forge-gameready.js
grep -n "action ===\|case '" api/forge.js | head -20
grep -n "uploadedProp\|allowlist\|allow-list\|glb" multiplayer/src/rooms/WalkRoom.js | head -20
```

Note which of the tasks below are already done and skip them.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Extend `tests/forge-prop.test.js` (and add `tests/forge-prop-budget.test.js` for the pure budget module): a result over the triangle ceiling is routed through decimation and re-checked; a result still over the ceiling after decimation or over the byte ceiling is rejected with a specific message and never registered; a result inside the ceiling passes untouched; the ceiling selected for a coarse-pointer device is stricter than desktop (mirror the one-tier step-down in `ambient-crowd.js`). Run the new cases and confirm they fail on today's code (no ceiling).
2. Create one shared budget module (for example `src/game/prop-budget.js`, imported by the forge client and any server check) with triangle and byte ceilings per device tier, derived from and referencing `CROWD_BUDGET` rather than duplicating its numbers. State the values in the module header.
3. Enforce before registration. In `forgeWorldProp`, measure the returned GLB (fetch headers for bytes; parse the meshopt/Draco-decoded geometry for triangle count the way neighbouring code does, see `docs/ops/worker-and-avatar-rules.md` on decoding), and route over-budget results through `POST /api/forge-gameready` (`poly_budget` set from the budget) or `api/forge-remesh.js`. The in-world flow must never place a raw over-budget model. Surface a designed message ("That model was too detailed for this world, so it was simplified" or the rejection reason).
4. Server-side enforcement. Add a per-player generation cooldown and a per-world concurrent-generation cap to `api/forge.js` for in-world submissions (carry a world id and the authenticated or guest identity on the request; reuse the limiter in `api/_lib/limits.js` and its `rateLimited` response shape). The client shows queue position or "wait N s" honestly from the response, never a fake progress bar. Add endpoint tests beside the existing forge API tests.
5. Defence in depth in the room: the room that accepts an uploaded prop URL on `obj:spawn` already applies an asset allow-list; add a test (and a check if missing) that an unknown or oversized asset URL is refused and that a refused placement leaves no phantom entry in the palette (`addUploadedProp` must be rolled back).
6. Placement-first flow. Let the player aim and place a hologram placeholder immediately (ghost shell in the build style, clearly "generating", driven by the real async job state), then swap the GLB in place with a brief materialize effect when it lands. On failure the hologram becomes a designed error marker with Retry and Dismiss, and the failed attempt consumes no build budget. Reuse `PropGhost` from `src/game/world-objects.js`. Respect reduced motion.
7. Session history and honest guidance in the Forge form (`coincommunities-ui.js`): a short list of this session's generations (re-arm a previous result without regenerating) and expectation text quoting observed times, taken from timings you measure in verification and from `coldStartLabel` in `src/shared/forge-frames.js`, not an invented number. Hover, focus-visible and active states, keyboard operation, empty state and error state with a retry.
8. Verification on `npm run dev` with a second browser: generate from a prompt, see the hologram and the swap, second browser renders it live and after reload; kill the request in devtools and confirm the error marker, retry and dismiss; submit an intentionally heavy prompt and confirm the ceiling message; emulate mobile and confirm the placed result stays inside the memory budget (record JS heap or model bytes). Record observed generation times.
9. Docs: update `docs/play-forge-in-world.md` with the ceiling values, limits and flow, add a `data/changelog.json` entry, run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/forge-prop.test.js tests/forge-prop-budget.test.js tests/build-limits.test.js` passes, and the over-budget cases failed before the change.
- [ ] A forge result over the ceiling is never registered raw (asserted in a test and observed in the browser with the heavy prompt).
- [ ] `api/forge.js` returns 429 with a retry hint for a second in-world submission inside the cooldown and for exceeding the per-world concurrency cap (asserted in an endpoint test).
- [ ] Failure path: no phantom palette entry and no consumed build budget.
- [ ] `grep -n "hologram" src/game/coincommunities.js src/game/forge-prop.js` shows the placement-first path; no console errors in the browser run.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Free forge lane cold-starting or rate limited while testing | The 6 minute wait and `coldStartLabel` already handle cold starts; for tests use recorded GLB fixtures checked into `tests/fixtures` (generated once from the real lane) so the budget logic is verified offline. |
| Cannot produce an over-budget model on demand | Ask `api/forge-gameready.js` for a high `poly_budget` on a small model, or subdivide a fixture GLB in a test; both are real GLBs, not mocks. |
| Decimation worker unavailable | Reject with the designed oversize message (task 3) so nothing raw is ever placed, and note the worker status in the report. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/253-plan-play-forge-props-hologram-size-limits.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `253-plan-play-forge-props-hologram-size-limits.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/19-forge-props-live.md` (whole file)

~~~~markdown
# Feature 19: forge 3D props live inside build mode

The platform's headline capability is text to 3D, and the world's build mode can now use it: the prop palette has a Forge form (and chat takes `/forge <prompt>`), `src/game/forge-prop.js` drives the free draft lane, and the finished GLB rides the uploaded-prop pipeline so everyone in the world sees it and the room persists it ([docs/play-forge-in-world.md](../play-forge-in-world.md)). What shipped is the pipeline; what is still open is the placement-first hologram, the size ceiling, and the server-side abuse limits below. At a live event this is the demo moment, and the size ceiling is what keeps it from becoming the iOS crash.

## Where the code lives

- Forge lane: `api/forge.js` (`POST /api/forge` submits, `GET /api/forge?job=` polls, `POST /api/forge?action=rig` auto-rigs; there is no separate rig handler) and siblings (`api/forge-gameready.js`, which now also accepts a settled forge purchase and echoes only its own payment error codes, and `api/forge-remesh.js`); in-world client `src/game/forge-prop.js` (submit, poll every 2.5 s, up to 6 minutes for a cold GPU start, with a "Waking up a GPU" status line from the shared `coldStartLabel` in `src/shared/forge-frames.js` while a worker boots, reference photos via `/api/forge-upload` capped at 8 MB, keyed to the same `forge:cid` handle the /forge page uses so in-world forges land in the same history); page precedents in `src/forge.js` / `src/forge-studio/`. Use the platform's free text-to-3D lane and its existing rate limits; do not add a new paid dependency
- Prop plumbing (already networked and persistent): `src/game/world-objects.js` (`registerUploadedProp`, mirrors the server `objects` MapSchema), `src/game/avatar-upload.js` (`uploadPropModel`, presigned upload), the `_uploadProp` flow in `src/game/coincommunities.js`, persistence via `src/game/world-persist.js`
- Prop palette UI: the props panel in `src/game/coincommunities-ui.js` (the gallery tab still fetches `/api/avatars/public`; the Forge form is `forgeBtn` / `toggleForge()` reporting through the shared status strip, and the game side is `_forgeProp` in `src/game/coincommunities.js`), styles in `src/game/coincommunities.css`
- The mobile lesson: `src/game/ambient-crowd.js` documents how uncapped user models killed iOS tabs, and its `CROWD_BUDGET` tiers are the sizing precedent
- Generation ground truth when debugging: the `forge_creations` table carries per-generation backend, status, error, and prompt

## What to build

1. **A Forge tab in the prop palette.** Shipped as the Forge form in the props panel (prompt or reference photo, one forge at a time, progress in the status strip) plus the `/forge <prompt>` chat command, which opens build mode with the result armed. Still open: a short history of this session's generations, and guidance text that sets expectations honestly (the lane comment says draft-tier generations land in about 30 to 60 s; quote observed behavior, not a made-up number).
2. **Placement-first flow.** Still open. Today the prop is armed as a ghost only after the GLB lands and the next click places it. Build the other order: the player aims and places a hologram placeholder immediately (ghost shell in the build style, clearly "generating", using the real async state, never a fake progress bar). When the GLB lands, it swaps in place with a brief materialize effect. On failure the hologram becomes a designed error marker with retry and dismiss.
3. **The full prop pipeline, not a side door.** Shipped: `_forgeProp` hands the finished GLB to `registerUploadedProp` and the normal `obj:spawn` placement, so it is networked to every player, persists like any other build, respects the per-player build budget, and is undoable with the existing Ctrl+Z stack. A result that comes back with `durable: false` (temporary storage the server's asset allow-list may refuse) already raises a warning toast in `_forgeProp`; verify that a refused placement never leaves a phantom in the palette.
4. **Size discipline.** Still open, and the one that matters most. `forge-prop.js` enforces no triangle or file-size ceiling and never routes through the gameready/remesh path. Run generations through it so what enters the world is capped: enforce a hard triangle and file-size ceiling in the spirit of `CROWD_BUDGET` before a model is ever registered. An oversized result is decimated or rejected with a clear message, never placed raw. This is the difference between a demo moment and a repeat of the iOS crash.
5. **Abuse limits.** Still open beyond the lane's own rate limits and the client's one-forge-at-a-time guard. Per-player generation cooldown and a per-world concurrent-generation cap, enforced server-side on the endpoint, with the client showing queue position honestly.

## Verify

- On `npm run dev` with a second browser: generate a prop from a prompt, see the hologram, see the swap, confirm the second browser renders it live and after a reload (persistence).
- Failure path exercised (kill the request in devtools): error marker, retry works, dismiss cleans up, budget not consumed by the failure.
- Generate an intentionally heavy prompt and confirm the size ceiling triggers with its designed message.
- Mobile emulation: the Forge tab is usable with the touch keyboard and the placed result stays within the memory budget. `npm test` green.

## Report format

Files shipped, the size ceiling values and where they are enforced, the rate-limit shape, average observed generation time during verification, and the `data/changelog.json` entry.
~~~~

### `docs/play-forge-in-world.md` (whole file)

~~~~markdown
# Forge in world: spawn items into a `/play` server from a prompt

In [`/play`](https://three.ws/play), every coin is its own live server. Until now you could
only place props that already existed: a hand-authored catalog piece, a community gallery
model, or a `.glb` you uploaded yourself. Forge-in-world removes that last limit. Describe
an item in words, or hand it a photo, and about half a minute later the item is a real
textured 3D model standing in the world, visible to everyone connected to that server.

Nothing is faked. The text goes to the same free forge lane that powers
[`/forge`](https://three.ws/forge), the result is a genuine GLB in three.ws storage, and it
reaches other players over the world's existing object channel, which means it persists in
the world exactly like a block you placed by hand.

## Using it

### From the build palette

1. Enter a world and press `B` (or tap **Build**) to open build mode.
2. In the **Props** palette, click **Forge**.
3. Type what you want, for example `a mossy stone lantern with a copper roof`.
4. Optionally click **Photo** and attach a PNG, JPEG, or WebP reference image (up to
   8 MB). With a photo attached, the prompt becomes a hint rather than the whole brief.
5. Click **Forge**. The palette's status strip reports progress the whole way
   (`Sending to the forge…`, then `Forging: waiting for a slot…`, then `Forging your model…`).

When it finishes, the model is added to your props as its own button and armed
automatically. Click anywhere on the ground to place it. `R` rotates before you commit,
and break mode removes props you own.

### From world chat

Type a slash command into the chat box:

```
/forge a brass telescope on a tripod
```

Chat is the fastest path because you do not have to open the palette first. The command
answers locally (it is never broadcast to the other players), and when the model is ready
build mode opens with the new prop armed and waiting for your click. A bare `/forge` with
no description replies with a usage hint instead of sending `/forge` to the room.

## What everyone else sees

The moment you place a forged item, it becomes a `WorldObject` in the room's authoritative
state and Colyseus broadcasts it to every other client in that server. Their client reads
the model URL off the object itself, so nobody needs your palette entry, a page reload, or
the same version of the app. The world's persistence layer saves it with the rest of the
build, so the item is still standing when the room is next created.

That is the whole point of forging inside a server rather than on `/forge`: the thing you
imagined is instantly part of a shared place, not a file in your downloads folder.

## Cost and limits

| | |
|---|---|
| Price | Free. Forge-in-world uses the draft tier, which needs no account, wallet, or key. |
| Typical time | 20 to 60 seconds. A cold GPU can add up to a minute and a half. |
| Concurrency | One forge at a time per player. A second request while one is running is refused with a toast. |
| World caps | Forged props count against the normal build budget: 200 objects per world, 30 per player. |
| Rate limits | The free lane is rate-limited per client per hour. Hitting it reports "The forge is busy right now" and the request can be retried. |

Forged models are recorded against the same anonymous client id `/forge` uses
(`localStorage['forge:cid']`), so anything you make in-world also appears in that browser's
forge history.

## How it fits together

```
palette form / "/forge" chat        src/game/coincommunities-ui.js
  -> onForgeProp handler            src/game/coincommunities.js   (_forgeProp)
    -> forgeWorldProp()             src/game/forge-prop.js
      -> POST /api/forge            free draft lane, text or image_urls
      -> GET  /api/forge?job=<id>   polled to completion
    -> registerUploadedProp(url)    src/game/world-objects.js
    -> _pickProp(def.id)            arms it for placement
  -> click -> net.spawnObject(...)  obj:spawn { type, url, x, y, z, yaw, scale }
    -> WalkRoom._handleObjSpawn     multiplayer/src/rooms/WalkRoom.js
      -> normalizePropAssetUrl      multiplayer/src/build-limits.js  (allow-list)
      -> state.objects broadcast    every client in the server renders it
```

Two details worth knowing if you are extending this:

**The forge URL is already trusted.** Finished models are materialized into three.ws
storage on an `*.r2.dev` host, which is on the world asset allow-list
(`normalizePropAssetUrl` in [multiplayer/src/build-limits.js](../multiplayer/src/build-limits.js)).
No server change was needed to let forged items in, and no arbitrary third-party URL can
follow them: an off-list host is refused with `obj:reject` carrying `reason: 'asset_url'`.

**Nothing new is on the wire.** Forged props travel as ordinary world objects. The `url`
field that carries player uploads carries these too, so older clients, the persistence
layer, ownership checks, and the per-player object cap all apply without modification.

## Related

- [3D asset pipeline](3d-asset-pipeline.md): what the forge lanes are and how they differ
- [In-game economy](in-game-economy.md): the rest of what you can do inside a `/play` world
- [/forge](https://three.ws/forge): the full studio, with paid tiers, rigging, and game-ready export
~~~~

