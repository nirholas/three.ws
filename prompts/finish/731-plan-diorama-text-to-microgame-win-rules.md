# Turn a diorama sentence into a shareable microgame with win conditions, spawn rules and the walk controller

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/731-plan-diorama-text-to-microgame-win-rules.md`.

**Priority:** P2, new capability with clear value (score 52 of 100 inside the tier). **Area:** diorama. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The playbook rates "text to playable microgame" as the highest screenshot-and-share potential of anything on its list: the diorama pipeline already goes from a sentence to an explorable island with real forged meshes, and the walk controller already exists. What is missing is the part that makes it a game: a goal, a win state and a permalink that opens in play mode. A shared diorama today is a pretty room; a shared microgame ("collect the three lanterns before dusk") is something people send to friends, which is the distribution loop the forge funnel needs. It also keeps the platform's agent-on-3D identity, because the walker is the user's avatar.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/diorama/` has `schema.js` (shapes, `MAX_OBJECTS = 8`, `MIN_OBJECTS = 3`, `normalizeDiorama`, `isComplete`, `forgeProgress`, `SAMPLE_DIORAMA`), `compose.js` (plan via `/api/diorama` action `compose`, forge each object via `/api/forge`), `renderer.js` (island, sky, mood lighting, seeds, thumbnails), `gallery.js`, `share.js`, `main.js`, `diorama.css`. Backend `api/diorama.js` with `api/_lib/diorama-store.js`. README states the surface is orbit, save, share, remix.
- No win-condition or spawn concept anywhere in the schema: `grep -n "goal\|win\|spawn" src/diorama/schema.js` has no game fields, and `docs/diorama.md` has no gameplay section.
- The walk controller lives in `walk-sdk/` (`walk-sdk/src/{index,playground,roster,picker,config,companion}.js`); `src/diorama/main.js` does not import it.
- Tests: none named `diorama*` under `tests/` (verify with `ls tests | grep -i diorama`); the schema is pure and testable.
- Page registered in `data/pages.json` at `/diorama`, docs at `/docs/diorama`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
ls tests | grep -i diorama; grep -n "goal\|win\|spawn" src/diorama/schema.js
sed -n 118,200p src/diorama/schema.js     # normalizeDiorama: how plans are validated
grep -n "compose" api/diorama.js | head
sed -n 1,60p walk-sdk/README.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Extend the data contract in `src/diorama/schema.js` (pure, no DOM) with an optional `game` block: `{ goal: 'collect' | 'reach' | 'survive', targetIds: string[], count: number, timeLimitSec: number | null, spawn: { x, z, heading } }`. `normalizeDiorama` must keep every old diorama valid (no `game` means exploration only) and must reject targets that name an unknown object id, clamp the spawn inside `ISLAND_RADIUS`, and bound `count` to the object count. Tests first: `tests/diorama-schema.test.js` covering legacy plans, each goal type, bad ids, out-of-bounds spawn, and idempotent normalization.
2. Compose: extend the compose prompt and its validator in `api/diorama.js` so the model returns a `game` block alongside the plan when the sentence implies one ("find the three lanterns", "get to the cabin before night"), and omits it otherwise. The goal must reference only objects in the plan. Add an API-level test with a stubbed model response (stub only inside the test) for a plan with a game block, one without, and one with a hallucinated target id which is dropped, not 500'd.
3. Play mode: new `src/diorama/play.js` that mounts the walk controller from `walk-sdk/` on the island with collision against placed objects' bounds, a HUD (objective text, collected `n/m`, timer if any), a win overlay and a lose overlay with Retry, and Escape to return to orbit. Pure logic (goal progress, win and lose evaluation, proximity pickup) lives in `src/diorama/game-rules.js` with Node tests in `tests/diorama-game-rules.test.js`; no Three.js in that module.
4. Permalinks: `?play=1` opens a saved world directly in play mode; the share sheet (`src/diorama/share.js`) gains "Share as a game" (copies the play permalink, X intent text includes the objective) beside the existing orbit link, and the OG card for a game world says "Play this world". Saved worlds persist the `game` block in `api/_lib/diorama-store.js` (migration only if the store uses a typed column; if it stores JSON, no migration).
5. Honest partials: a world with failed object forges still plays when the goal's targets are ready; otherwise the HUD says which objects are still forming and disables Start with a reason. Never auto-win.
6. UI states per the Definition of done: Start button and every control have hover, active, focus-visible; mobile touch joystick or tap-to-move at 390x844 with a 44px tap floor; empty state when a world has no game block ("This world has no goal yet. Ask for one in the prompt."); error state when the walk controller fails to load with a retry; loading uses a skeleton or the existing forming seeds, not a spinner.
7. Verify in a real browser: compose a prompt with a goal, forge for real on the free lane, play to a win, play to a timeout, reload the permalink with `?play=1`, and confirm network calls are real and the console is clean on desktop and mobile viewports. A Playwright spec `tests/e2e/diorama-game.spec.js` covering the win path against a saved world loaded by id.
8. Docs: a "Playing a world" section in `docs/diorama.md`, update `src/diorama/README.md` layout, `STRUCTURE.md` unaffected unless a new directory appears, `data/changelog.json` entry (community language, `feature` tag), `npm run build:pages`, `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/diorama-schema.test.js tests/diorama-game-rules.test.js` passes; legacy dioramas load unchanged.
- [ ] `npx playwright test tests/e2e/diorama-game.spec.js --retries=0` passes.
- [ ] A real prompt produces a world with a goal, can be won in the browser, and the permalink `?play=1` reopens it in play mode.
- [ ] `docs/diorama.md` documents the game block and goal types.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Free forge lane is slow or down during verification | Load a previously saved world by id from the gallery for the play-mode check; verify compose separately. Do not use fake meshes in app code. |
| The model does not reliably emit a valid `game` block | Tighten the prompt and validator; as a fallback the client may derive a default `collect` goal from the first N ready objects when the sentence contains a collect verb (rule-based, deterministic, tested). |
| Walk controller needs a rigged avatar | Use the same default avatar the viewer uses; no new asset pipeline. |
| Anti-cheat concerns | Out of scope: this is a local, non-monetary game; no scores are stored on the server in this order. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/731-plan-diorama-text-to-microgame-win-rules.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `731-plan-diorama-text-to-microgame-win-rules.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/internal/fable-playbook.md` (section "Tier 2: moats only a 3D-native model builds cheaply")

~~~~markdown
### Tier 2: moats only a 3D-native model builds cheaply

5. **Procedural animation layer.** Runtime IK (look-at, foot planting, reach)
   layered on the existing retarget pipeline (`src/animation-retarget.js`, and
   the universal-rig doctrine in `CLAUDE.md`: no rig allowlist). This is graphics
   work competitors cannot hire cheaply and Fable does natively. It makes every
   avatar feel alive instead of looped.
6. **Gaussian splatting lane.** Mostly present. The viewer (`src/splat-viewer.js`,
   `pages/splat.html`) runs Spark 2.3.1 with worker-built LoD trees on large
   scenes and saved camera hotspots with in-browser video export
   (`src/splat-hotspots.js`). `POST /api/forge-splat` turns one image into a
   splat (`workers/model-triposplat`), and the AR Studio "From a photo" tab
   (`/api/forge-scene-objects`, `workers/model-sam3d-objects`) is built but off
   until the gated weights are staged. The open half is the product loop: photo
   or video to splat to embeddable scene, on the same monetization rails as Forge. All REUSE-MAP
   splatting picks in the allowed column are permissively licensed; the
   non-commercial rasterizers are a hard no regardless of demo quality.
7. **WebGPU/TSL migration, flag-gated.** three.js ships a WebGPU renderer;
   ours appears only inside the vendored scene-studio editor today. Put it behind
   a query flag on the viewer, for the perf ceiling on splats, crowds and
   post-processing, not for the headline.
8. **Text to playable microgame.** The diorama pipeline (`src/diorama/`,
   `packages/scene-mcp`) already goes sentence to explorable world. Add
   win-conditions, spawn rules, and the existing walk controller (`walk-sdk/`)
   and a sentence becomes a shareable game with a permalink. Highest
   screenshot-and-share potential of anything in this list.
~~~~

### `docs/diorama.md` (whole file)

~~~~markdown
# Diorama: speak a little world into being

Diorama turns one sentence into a tiny, explorable 3D world. You describe a scene, an AI set designer decomposes it into a placed set of single objects, and each object is forged into a real textured GLB and dropped into place, live, as it arrives. The finished world sits on a small floating island you can orbit, view in AR, save to a public gallery with its own permalink, and export as a single merged GLB that opens cleanly in Scene Studio.

Page: [/diorama](https://three.ws/diorama) · API: `/api/diorama`

## Why it exists

Forge makes one object at a time. But a world is a composition: a campfire and a tent and three pine trees, arranged on the ground, lit for a mood. Doing that by hand means forging each piece, importing them into a scene editor, and placing them one by one. Diorama collapses that into a sentence. It is the difference between a modeling tool and a director's chair: you say what you want to see, and the platform composes, generates, and assembles it in front of you. Every object is a real mesh (no billboards, no fakes), so the result is genuine geometry you can walk around, share, and take into any glTF tool.

## How it works

Diorama is a four-step pipeline (`api/diorama.js` plus `src/diorama/`), and each step is real.

1. **Compose.** `POST /api/diorama {action:'compose', prompt}` sends your sentence to the platform's free-first LLM chain (`llmComplete`) with a 3D-set-designer system prompt. The model returns a strict JSON plan: a 2-to-4-word title, a mood (`dawn`/`day`/`dusk`/`night`), a ground type (`grass`/`sand`/`snow`/`stone`/`water`/`meadow`/`void`), an island shape (`round`/`craggy`/`plateau`), a color palette (sky gradient, ground, fog, accent), and a placed list of objects. Each object is exactly one physical thing (a single tree, a single tent, never a scene and never "and"), with a one-line forge prompt (subject plus dominant material and color), an `(x, 0, z)` position spread across the island with spacing enforced, a scale, and a Y rotation. Objects come back with `status:'pending'` and no meshes.

2. **Forge each object.** The browser walks the plan and calls `/api/forge` for every object, on the free lane, watching each one turn from `pending` to `forging` to `ready` (or `failed`, with an in-place retry). The renderer (`src/diorama/renderer.js`) materializes each mesh into the scene the moment it arrives, so the world assembles progressively in front of you rather than appearing all at once.

3. **Save and share.** `POST /api/diorama {action:'save', diorama}` persists a fully-forged world, returns an `{id, url}` permalink, opens the share sheet, refreshes the gallery, and rewrites the page URL to the new permalink. A signed-in creator's world links to their public portfolio; anonymous saves fall back to a plain handle.

4. **Export.** `POST /api/diorama {action:'export', diorama}` merges the world's objects, ground, and lights into one GLB (`api/_lib/scene-graph-compose.js`) with named, selectable nodes, uploads it, and hands back a `glbUrl` plus a `sceneStudioUrl` so it opens directly in Scene Studio ([/scene](https://three.ws/scene)) or any glTF viewer.

A headless one-shot, `POST /api/diorama {action:'build', prompt}`, runs the whole flow server-side (compose, forge every object on the free lane, export the merged GLB) for callers with no browser to drive the progressive client, such as MCP tools and agents.

Reads: `GET /api/diorama?id=<uuid>` loads a saved world (a deep link renders it read-only and offers a remix), and `GET /api/diorama?list=recent|featured&limit=<n>` returns gallery cards. The gallery renders each card as live geometry through `<model-viewer>`, not a flat thumbnail.

There are no mocks: if the LLM chain is unreachable, the compose route returns a clean 503 and the page shows a designed retry state instead of fabricating a world.

## Walkthrough

1. Open [/diorama](https://three.ws/diorama).
2. Type a sentence: `a lighthouse on a rocky islet at dusk`, or `a cozy campsite in a pine clearing`.
3. Watch the plan appear as a row of per-object status chips (pending, forging, ready). The island, ground, and mood render immediately from the palette.
4. Watch each object drop into place as its mesh finishes forging. A failed object gets a one-tap retry.
5. Orbit the finished world. When at least one real mesh is present, the world actions unlock: remix, save, AR (on supported devices), and download.
6. Save to get a permalink and a gallery slot, or export to open the merged GLB in Scene Studio.

## Examples

Compose a plan, then drive the forge yourself, or let the server build the whole thing.

```bash
# 1) Compose: sentence -> placed plan of single-object forge prompts.
curl -X POST 'https://three.ws/api/diorama' \
  -H 'content-type: application/json' \
  -d '{"action":"compose","prompt":"a lighthouse on a rocky islet at dusk"}'

# 2) Headless one-shot: compose + forge every object + export a merged GLB.
curl -X POST 'https://three.ws/api/diorama' \
  -H 'content-type: application/json' \
  -d '{"action":"build","prompt":"a cozy campsite in a pine clearing"}'

# 3) Load a saved world by id.
curl 'https://three.ws/api/diorama?id=<uuid>'

# 4) Browse the public gallery.
curl 'https://three.ws/api/diorama?list=featured&limit=12'
```

The compose response shape (abridged). The plan always arrives under a
`diorama` key, and every read (`?id=`, the save and build actions) returns that
same object, so one renderer handles all of them. `id` and `createdAt` are empty
until the world is saved:

```json
{
  "diorama": {
    "id": "",
    "prompt": "a lighthouse on a rocky islet at dusk",
    "title": "Lonely Beacon Watch",
    "mood": "dusk",
    "ground": "stone",
    "island": "craggy",
    "palette": { "sky": ["#2e3a59", "#d67850"], "ground": "#4a4a4a", "fog": "#332d40", "accent": "#ffcc00" },
    "objects": [
      { "id": "obj-0", "label": "lighthouse", "prompt": "tall lighthouse made of weathered white brick with a glass lantern room", "position": [0, 0, 0], "scale": 2.2, "rotationY": 0, "status": "pending", "glbUrl": null },
      { "id": "obj-1", "label": "boulder", "prompt": "jagged grey granite boulder with lichen patches", "position": [3.5, 0, 2], "scale": 1.2, "rotationY": 0.5, "status": "pending", "glbUrl": null }
    ],
    "author": null,
    "createdAt": "",
    "views": 0,
    "featured": false
  }
}
```

## States and limits

- **Object count** is bounded (the plan enforces a minimum and maximum), and objects are spaced so they never stack.
- **Compose failure**: a clean 503 and a designed retry state, never a fabricated world.
- **Per-object status**: pending, forging, ready, failed (with in-place retry). One failed object does not block the rest.
- **Save/export** need object storage configured; export returns 503 with a clear message when it is not.
- **AR and download** appear only once at least one real mesh has forged.
- **Deep links** render a saved world read-only and offer a remix, so a shared permalink is stable.
- Prompt length is capped; reads are rate-limited per client IP.

## Related

- [Forge](./forge.md) is the single-object generator every diorama object is forged on.
- [Image to 3D](./image-to-3d.md) for photo-based objects; [AR](./ar.md) for viewing worlds in augmented reality.
- Pages: [/scene](https://three.ws/scene) (Scene Studio, where an exported diorama opens), [/gallery](https://three.ws/gallery), [/create](https://three.ws/create).
~~~~

