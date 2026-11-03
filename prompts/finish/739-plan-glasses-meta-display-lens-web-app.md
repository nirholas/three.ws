# Build /glass, the 600x600 Meta Ray-Ban Display lens app, on the existing IRL rail

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/739-plan-glasses-meta-display-lens-web-app.md`.

**Priority:** P2, new capability with clear value (score 47 of 100 inside the tier). **Area:** glasses. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Three.ws already pins agents to real places (`/irl`), already ships a tested Bluetooth HUD protocol for Frame and Even G1 lenses, and already publishes `@three-ws/irl`. The Meta Ray-Ban Display web-app path lets a page served from an HTTPS URL run on the lens with no native app, so the missing piece is one small DOM client: a surface that says "an agent stands 24 m ahead, turn left", lets the wearer talk with four arrow keys and Enter, and hands off to AR on the phone. Nothing of that exists yet (no `/glass`, no `src/glass`, no `api/glass`). This is the cheapest credible way to put the Solana-native agent economy on a wearable, it is demoable in a Chrome simulator without hardware, and the whole build plan is already written and verified against Meta's docs (2026-09-17).

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Absent: `pages/glass.html`, `src/glass/`, `api/glass/`, `/glass` in `data/pages.json` and `vite.config.js`. `ls pages | grep -i glass` returns nothing.
- Present and reusable unchanged: `src/irl/glasses/protocol.js` (`formatDistance`, `normalizeAngle`, `arrowGlyph`, `turnHint`, `buildHud`), `src/irl/proximity-cue.js` (nearest agent and relative bearing, radians, 0 ahead, positive right), `src/irl/pin-talk.js` (conversation), and the IRL API under `api/irl/` (`pins.js` nearby read and placement, `interactions.js`, `fix-token.js` presence tokens, `share/[token].js`).
- Existing test to model on: `tests/irl-glasses-protocol.test.js`.
- `POST /api/chat` has no `suggestReplies` option (`grep -rn suggestReplies api src` returns nothing).
- The doc's phase 0 (real glasses, Meta AI app, developer mode) is hardware-dependent and cannot be completed in a build session; phases 1 to 5 can be built and verified in the Chrome simulator (600x600, d-pad) and a Playwright lane.
- Meta publishing is closed during developer preview, so distribution is the QR deeplink only.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
ls pages | grep -i glass; ls src/glass api/glass 2>&1 | head -3
grep -n "glass" data/pages.json | head
sed -n 192,320p docs/glasses/meta-ray-ban-display.md   # the phased plan this order executes
grep -n "export" src/irl/glasses/protocol.js | head -20
ls api/irl; sed -n 1,25p api/irl/pins.js
```

The wearables MCP endpoint (`https://mcp.developer.meta.com/wearables`, tool `search_webapps_docs`) can be queried over plain HTTP JSON-RPC to re-check display limits before building; use it rather than trusting the doc dated 2026-09-17.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. `pages/glass.html` with the documented 600x600 viewport and `<meta name="mrbd-web-app-capable" content="yes">`, registered in `vite.config.js`, `vercel.json` (route, CSP like other pages, hashes generated by the server), and `data/pages.json` (so sitemap, `llms.txt` and the changelog pick it up). Budget: under 60 KB JS, no three.js, no WebGL.
2. Pure modules first, each with a Node test in `tests/` (no DOM): `src/glass/dpad.js` (roving focus over an element list, wrap, Enter, Escape, drag scrub), `src/glass/compass.js` (deviceorientation to screen-relative bearing, calibration state when heading is unreliable, permission request behind the first pinch), `src/glass/presence.js` (check-in, token expiry and geohash-cell re-mint, adaptive polling, request coalescing, honest error surfacing). Tests: `tests/glass-dpad.test.js`, `tests/glass-compass.test.js`, `tests/glass-presence.test.js`.
3. `src/glass/hud.css`: the additive design system as tokens (pure `#000` ground, one accent `#7aa2ff`, one alert `#ffd479`, body 20px minimum, no mid-greys, focus ring as glow plus border, no continuous animation). Every interactive element is `.focusable` with hover, active and focus styles; the page is operable with only ArrowUp/Down/Left/Right, Enter and Escape.
4. Views under `src/glass/views/`: scanning (heading ring, nearby count, last-fix age), nearby (ranked list, name + `formatDistance()` + `arrowGlyph()`), agent card (160px portrait from `GET /api/render/avatar-clip`, name, caption, Talk, See it in AR, x402 endpoint when the pin carries one), talk (transcript, focused reply list, send on Enter), handoff, denied (geolocation or orientation refused, with the recovery step). Designed states for each: skeleton while loading, empty ("no agents within range, walk toward a pin"), error with a retry on Enter, and offline.
5. Arrival event: crossing a pin's radius promotes the agent to the lens once and logs `POST /api/irl/interactions` with type `glasses` (extend the allowed type list and its test if needed). One `talk` interaction per conversation, never the transcript, matching the IRL privacy posture in `docs/irl/THREAT-MODEL.md`.
6. `POST /api/chat` opt-in `suggestReplies` (integer 0 to 3) returning short suggestions in the same completion; add the handler change test-first with a test in `tests/` beside the chat handler tests; the lens falls back to a fixed reply set (Hello, Tell me more, Goodbye) when the field is absent.
7. Handoff: `api/glass/handoff.js` mints a six-character expiring code for a pin and `three.ws/g/<code>` resolves to `/irl?pin=<id>` (rate limited, owner-free, route added to `vercel.json`); `api/glass/pair.js` lets a signed-in phone claim a lens session. `/irl` opens the pin card directly when the arrival came from the lens. Tests: `tests/glass-handoff.test.js` for code format, expiry, rate limit, and unknown-code 404.
8. Verify in a real browser: Chrome at 600x600 with sensor emulation (and the Meta simulator extension if it can be installed), a Playwright spec `tests/e2e/glass.spec.js` walking scanning to nearby to agent to talk with the keyboard only, against a real pin in the dev database. Network tab shows real `/api/irl/*` calls; console clean; `npm run check:dist` and `npm run check:pages` pass.
9. Docs: tick the phase boxes in `docs/glasses/meta-ray-ban-display.md` that are done and mark phase 0 and the on-hardware check as pending-hardware; a `STRUCTURE.md` row; `data/changelog.json` entry (community language, `feature` tag); `npm run build:pages`; `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/glass-*.test.js tests/irl-glasses-protocol.test.js` passes.
- [ ] `npx playwright test tests/e2e/glass.spec.js --retries=0` passes at a 600x600 viewport using only the five keys.
- [ ] `/glass` JS payload is under 60 KB gzipped (state the measured number) and contains no three.js.
- [ ] The doc lists exactly which phase 0 and hardware items remain, with the owner.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Ray-Ban Display hardware | Everything except real walking is exercised in the simulator and Playwright; state the remaining on-hardware check and who holds the device. |
| No real pin nearby in dev | Place a real pin through `POST /api/irl/pins` at the test fix (a real API call against dev data), not a fixture array. |
| Meta platform limit differs from the doc | Query the wearables MCP, change the code to the source of truth, and fix the doc line in the same commit. |
| Geolocation unavailable in the browser test | Use Chrome DevTools sensor emulation or Playwright `geolocation` permissions with a real coordinate. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/739-plan-glasses-meta-display-lens-web-app.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `739-plan-glasses-meta-display-lens-web-app.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/glasses/meta-ray-ban-display.md` (section "Build plan")

~~~~markdown
## Build plan

Each phase is shippable on its own and leaves the platform better than it found
it. Nothing here is gated on Meta approving anything, except distribution.

### Phase 0: access and proof

- [ ] Meta Ray-Ban Display glasses on v125+, Meta AI app v272+, Developer Mode on.
- [ ] Install the Meta Ray-Ban Display Web App Simulator Chrome extension and
      confirm the 600x600 additive preview against a static page.
- [ ] Add the Wearables MCP endpoint (`https://mcp.developer.meta.com/wearables`,
      tool `search_webapps_docs`) to the workspace MCP config so platform limits
      are checked against the source, not against this document.
- [ ] Serve a one-screen `/glass` stub from the live site, add it to the glasses
      by QR, and confirm it loads on the lens. Record what the lens does with
      `deviceorientation` permission prompts.

**Done when:** a page served from `https://three.ws/glass` renders on real
glasses and logs a d-pad event from a real pinch.

### Phase 1: the lens surface

- [ ] `pages/glass.html` with the documented viewport and
      `<meta name="mrbd-web-app-capable" content="yes">`, registered in
      [vite.config.js](../../vite.config.js), [vercel.json](../../vercel.json)
      and [data/pages.json](../../data/pages.json).
- [ ] `src/glass/hud.css`: the additive design system above, as tokens.
- [ ] `src/glass/dpad.js`: roving focus over `.focusable`, wrap-around, `Enter`
      to activate, `Escape` to pop, continuous-drag scrubbing. Pure and unit
      tested (no DOM assumptions beyond an element list).
- [ ] `src/glass/main.js`: view stack, document-visibility lifecycle, a single
      render pass per state change (never a per-event DOM write).
- [ ] Every designed state present, including the ones that are not the happy
      path.

**Done when:** the surface passes `npm run check:dist` and `npm run check:pages`,
renders correctly in the simulator at 600x600, and is fully operable with only
the five inputs.

### Phase 2: the presence loop

- [ ] `src/glass/presence.js`: check-in, token expiry and geohash-cell re-mint,
      adaptive polling, request coalescing, honest error surfacing.
- [ ] `src/glass/compass.js`: `deviceorientation` to a screen-relative bearing,
      `requestPermission()` behind the first pinch, a calibration state when the
      heading is unreliable.
- [ ] Scanning view: heading ring, nearby count, last-fix age.
- [ ] Nearby view: ranked list, each row name + `formatDistance()` +
      `arrowGlyph()` from the shared protocol module.
- [ ] Arrival: crossing into a pin's radius promotes that agent to the lens once,
      with a real interaction logged (`POST /api/irl/interactions`, type
      `glasses`, consistent with the BLE lane's telemetry).

**Done when:** walking toward a real pin moves the distance down and the arrow
tracks the turn, on hardware, with the phone in a pocket.

### Phase 3: conversation

- [ ] Agent card: portrait from `/api/render/avatar-clip`, name, caption, the
      actions (Talk, See it in AR, and its x402 endpoint when the pin carries one).
- [ ] `POST /api/chat` extended with an opt-in `suggestReplies` count, returning
      three short suggestions in the same completion. Wired for `/glass` first,
      then offered to [src/irl/pin-talk.js](../../src/irl/pin-talk.js), which
      wants it too.
- [ ] Talk view: transcript, focused reply list, send on pinch, honest thinking
      and error states, conversation capped to what fits on a lens.
- [ ] Capability gates for the composer and for audio, each proven at runtime
      rather than assumed.
- [ ] One `talk` interaction per conversation, never the transcript, matching
      the existing IRL privacy posture.

**Done when:** a full exchange with a real pinned agent happens on the lens with
no phone interaction, and `forge_creations`-style ground truth (the interaction
log) shows the encounter.

### Phase 4: handing off to the body

- [ ] `api/glass/handoff.js`: mint a six-character code for a pin, resolve
      `three.ws/g/<code>` to `/irl?pin=<id>`, expiring, owner-free, rate limited.
- [ ] Push lane for signed-in wearers through the existing notification rail.
- [ ] `api/glass/pair.js`: claim a lens session from the phone, upgrading the
      anonymous device token to the account.
- [ ] `/irl` recognises an arrival that started on the lens and opens the pin
      card directly, the way the visit link already does.

**Done when:** a pinch on the lens puts the avatar in your hand in AR in under
ten seconds, signed in or not.

### Phase 5: place an agent from the lens

- [ ] Place at your current fix, choosing from your own avatars, with the
      heading taken from where you are actually looking.
- [ ] Confirmation state, then the placed agent appears in your own nearby feed.
- [ ] Honest anonymous-versus-permanent expiry copy, as `/irl` already shows.

**Done when:** an agent can be placed and rediscovered without ever opening a
phone.

### Phase 6: the native lane (camera, voice, precision)

- [ ] Add the Meta Wearables Device Access Toolkit to the iOS app
      ([ios/](../../ios/README.md)) over Swift Package Manager, behind the
      existing Capacitor shell, with MockDeviceKit covering the no-hardware path.
- [ ] Spoken conversation: glasses microphone into the same `TalkController`
      pipeline, agent voice out through the glasses speakers.
- [ ] Camera frames into a re-localisation pass so a pin lands where it was
      placed rather than where GPS guesses, keeping the presence-gated contract
      intact (frames are processed for pose, never uploaded as a location feed).
- [ ] Android parity, same toolkit.

**Done when:** you can hold a spoken conversation with a street agent, hands
free, and the agent stands in the same doorway it was left in.

### Phase 7: ship it

- [ ] `data/pages.json` entry for `/glass` (this is what feeds the changelog,
      the sitemap and `llms.txt`).
- [ ] `data/changelog.json` entry, community language, `feature` tag.
- [ ] A row in [STRUCTURE.md](../../STRUCTURE.md) for the glasses surfaces.
- [ ] `npm run audit:docs` clean, `npm test` green, `npm run check:rules` clean
      on the touched paths.
- [ ] Distribution when Meta opens publishing. Until then, the QR deeplink is
      the install path and it is a perfectly good one for a demo.

---
~~~~

### `docs/glasses/research.md` (whole file)

~~~~markdown
# Glasses platform research: repos, packages and what we adopt

Everything below was checked on **2026-09-17**. Versions, availability and
shutdown dates move fast in this corner of the industry, so each row says what
was verified rather than asserting a permanent truth. Re-check before depending
on any of it.

The short version: **Meta's own toolkit is the only thing we need to adopt, and
almost everything else worth having we already own.** The 3D avatars, the
geofenced presence rail, the conversation pipeline and a tested smart-glasses
HUD protocol are already in this repository.

---

## Meta's first-party platform (adopt)

| Resource | What it is | Verdict |
|---|---|---|
| [wearables.developer.meta.com/docs](https://wearables.developer.meta.com/docs) | The source of truth for both paths. The [web apps build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) carries the real constraints: input mapping, sensors, storage, design system. | Adopt. Check limits here, not in blog posts. |
| `https://mcp.developer.meta.com/wearables` | Meta's MCP endpoint, tool `search_webapps_docs`, which answers questions about current display constraints, setup, testing and publishing. | Adopt. Wire it into the workspace MCP config so an agent checks the platform instead of guessing. |
| [facebookincubator/meta-wearables-webapp](https://github.com/facebookincubator/meta-wearables-webapp) | Meta's AI-assisted toolkit for building display web apps: skills covering d-pad navigation, EMG pinch and continuous drag, sensors, storage, offline, deployment, QR generation. Not an npm package, a set of agent skills. | Adopt as reference. Read the skills, keep our own code. |
| [facebook/meta-wearables-dat-ios](https://github.com/facebook/meta-wearables-dat-ios) | Native toolkit for iOS over Swift Package Manager: video streaming, photo capture, display components, session lifecycle, MockDeviceKit for testing without hardware. | Adopt in Phase 6, inside [ios/](../../ios/README.md). |
| [facebook/meta-wearables-dat-android](https://github.com/facebook/meta-wearables-dat-android) | The Android twin. | Adopt at Android parity. |
| [Meta Ray-Ban Display Web App Simulator](https://chromewebstore.google.com/detail/meta-ray-ban-display-web/jpjlmmodokemlepklkdbimceggpbjcll) | Chrome extension: the 600x600 surface with additive blending, environment backgrounds, d-pad input, display tuning, recording, and QR deeplink generation. | Adopt. This is the development loop before hardware. |
| [displayglasses.dev](https://displayglasses.dev/) | Browser-hosted simulator, same idea, no extension install. | Reference. Useful for sharing a preview with someone who has no extension. |

Platform facts worth repeating because they change the architecture:

- Web apps get **no camera and no microphone**. Native gets both, plus speakers
  over Bluetooth profiles.
- The native display API is a **fixed component set**, and custom pixel or 3D
  rendering is explicitly unsupported. Video is capped under 400px per side and
  70,000 total pixels.
- **No custom Neural Band gestures.** Predefined swipes and pinches only, and
  they arrive as arrow keys and Enter. The raw sEMG stream is not exposed.
- **Publishing is closed during developer preview.** Distribution today is a
  URL and a QR code, which is enough for a demo and a pilot.
- Mock Device Kit does not cover the display glasses, so display work needs
  either the simulator or hardware.

## Community work worth reading (reference, not dependency)

| Repo or site | Why it is useful |
|---|---|
| [ggoonnzzaallo/meta_display](https://github.com/ggoonnzzaallo/meta_display) | Working web apps written for real Ray-Ban Display hardware. The fastest way to see what the lens actually does with a DOM. |
| [kevinCCme/XR_WEARABLE](https://github.com/kevinCCme/XR_WEARABLE) | Early third-party experiments against the toolkit. |
| [glasskit.app/docs](https://glasskit.app/docs/meta-ray-ban-display-sdk-explained) | A clear third-party explainer of the two SDK paths, useful for onboarding someone new to the platform. |

## Neuromotor input research (context, not a dependency)

We cannot read the band ourselves, so none of this ships. It is here because it
explains what the band can and cannot do, which is what makes the five-input
design defensible rather than lazy.

- [facebookresearch/emg2qwerty](https://github.com/facebookresearch/emg2qwerty):
  the open sEMG typing dataset and baselines (108 users, 1,135 sessions, 346
  hours), with character error rates under 10% once a language model refines the
  decode. That threshold is why on-glasses handwriting exists at all.
- `emg2pose`, the companion pose-estimation dataset from the same release.
- ["A generic non-invasive neuromotor interface for human-computer
  interaction"](https://www.nature.com/articles/s41586-025-09255-w), Nature,
  2025: the research line the Neural Band productises.

## Geospatial anchoring (mostly avoid, and here is why)

The obvious idea for "an avatar standing exactly here" is a visual positioning
system. The 2026 landscape does not reward that bet for a web client:

| Option | Status on 2026-09-17 | Verdict |
|---|---|---|
| 8th Wall (WebAR, hosted VPS) | Shut down. Hosted services offline, access ended 28 Feb 2026, existing hosted campaigns run until 28 Feb 2027. The engine went open source (MIT) minus SLAM. | Avoid. |
| Niantic Spatial VPS on the web | Not supported on the distributed engine binary or the open-source engine. Legacy hosted projects only, through Feb 2027. | Avoid for web. |
| Google ARCore Geospatial API | Alive and strong, but native Android and Unity, not a browser API. | Phase 6 candidate on the native lane only. |
| Immersal | Native SDKs plus a REST lane, needs site mapping per location. | Revisit if a specific venue needs centimetre placement. |
| [OpenFLAME](https://arxiv.org/html/2510.03915v1) | Research on federated VPS with a common API, exactly the interoperability gap that makes every option above a lock-in. | Watch. |
| [locar](https://www.npmjs.com/package/locar) (LocAR.js, AR.js org) | 0.2.12, MIT, the location-based part of AR.js rebuilt for current three.js. GPS to world coordinates plus device-orientation controls. | Not needed. [src/irl.js](../../src/irl.js) and [src/ar/](../../src/ar) already do this with WebXR hit-test anchoring, and the lens cannot render 3D at all. Worth reading if the phone-side geo projection is ever rewritten. |
| `geolib`, `@turf/turf` | Solid MIT geospatial maths. | Not needed. `api/_lib/geohash.js` and the IRL distance maths already cover the whole surface, and a lens app should not ship a geospatial library to compute one bearing. |

The conclusion that matters: **GPS is inside our envelope.** The web lane gives
5 to 50 m accuracy, IRL's discovery radius is 10 to 60 m, so a pin resolves
correctly today with no VPS at all. Precision is a Phase 6 upgrade on the native
camera lane, not a prerequisite for shipping.

## What we already own (the real head start)

| Ours | Where | What it removes from the plan |
|---|---|---|
| Geofenced presence rail | [api/irl/](../../api/irl/README.md), [packages/irl/](../../packages/irl/README.md) | Presence tokens, nearby reads, pins, interactions, money drops, world lines |
| Tested smart-glasses HUD protocol | [src/irl/glasses/protocol.js](../../src/irl/glasses/protocol.js) | Distance formatting, direction glyphs, wire framing, all unit tested |
| Two live BLE glasses adapters | [src/irl/glasses/](../../src/irl/glasses) | Proof the HUD model works on a real lens |
| Walk-up conversation | [src/irl/pin-talk.js](../../src/irl/pin-talk.js) | Persona, memory, voice, lipsync, barge-in |
| Server-side avatar rendering | `GET /api/avatar/render`, `GET /api/render/avatar-clip` ([media API](/docs/media-api)) | The lens portrait, CDN-cached, no client 3D |
| AR handoff | [src/ar/](../../src/ar), [api/ar.js](../../api/ar.js), [/irl](https://three.ws/irl) | WebXR anchoring, Quick Look, Scene Viewer, visit links |
| iOS app shell | [ios/](../../ios/README.md) | Where the native toolkit lands in Phase 6 |

## How to re-verify this page

```bash
# Platform limits, straight from Meta's MCP endpoint
#   endpoint: https://mcp.developer.meta.com/wearables
#   tool:     search_webapps_docs

# Package facts
npm view locar version license
```

Check the [build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/)
and the [FAQ](https://developers.meta.com/wearables/faq/) for capability changes,
especially camera, microphone, audio playback and publishing, all of which are
the difference between a phase being possible and being blocked.

## Related

- [three.ws on smart glasses](/docs/glasses)
- [Meta Ray-Ban Display build plan](/docs/glasses/meta-ray-ban-display)
~~~~

### `docs/irl/street-demo.md` (whole file)

~~~~markdown
# Run an IRL street demo: drop an agent at a real spot, let strangers walk up

This is the runbook for showing IRL to people who have never heard of three.ws: you place a 3D AI agent at a real location, put a sign there, and anyone who scans it sees the agent standing on that spot through their phone camera, taps it, talks to it out loud, and can stand it on their own floor in AR. It was written for a demo in San Francisco, and everything in it applies to any city.

Nothing here needs an app or an account on the visitor's side. The owner needs a signed-in three.ws account so the pin is permanent.

---

## What the visitor experiences

1. They scan the sign. It opens `three.ws/irl?pin=<id>` in their phone browser.
2. IRL asks for camera and location (and motion, on iPhone, which takes one extra tap). A banner at the top says **"You're here to meet <agent name>"** and that the agent appears within 60 m of the spot.
3. Standing within range, the agent appears in their camera view, playing its idle animation and turning to look at them. Its name label flashes and its card opens on its own.
4. The card leads with **Talk** and **View in AR**, then shows the agent's bio, on-chain reputation, its **Solana wallet chip**, a **Tap to tip in person** panel (a Solana Pay QR plus an "Open in wallet" deep link), any paid x402 services, a message box, and **View profile**.
5. **Talk** opens a conversation with the agent standing in front of them. They hold the mic and speak (or type). The reply is in the agent's persona, spoken aloud in its voice, and the model's mouth moves with the audio. Pressing the mic while it is speaking interrupts it.
6. **View in AR** stands the agent on their real floor. iPhone opens ARKit Quick Look with the idle clip baked in; the Quick Look banner reads "Talk to <name>" and tapping it brings them back to the card with the conversation open. Android with ARCore enters a WebXR session that anchors this agent to the detected floor (tap to place, pinch to size). Anything else opens the AR launcher (`/api/ar`) in a new tab.

Anyone who opens the link from somewhere else sees only the agent's name and a prompt to walk to the spot. The link never carries a coordinate, and the nearby read is presence-gated, so posting the link publicly is safe. See [How location works on IRL](/irl-privacy).

---

## Before the day

### 1. Pick the agent

Use a real agent from your account, not the anonymous companion. The card's wallet chip, tip QR, reputation and services all come from the agent identity, and the pin only links to one when you place it signed in with that agent selected.

- Check the agent's profile page (`/agents/<id>`): if it shows a Solana wallet chip there, the IRL card will show the same chip and the tip QR.
- **An agent wallet is provisioned on demand, not automatically.** A brand-new agent has none, and `GET /api/agents/<id>/solana` answers `"wallet": null` for it. The IRL card then renders with no wallet chip and no tip QR, which removes the part of the demo people react to most. Create one from the agent's wallet panel (or `POST /api/agents/<id>/solana` while signed in as the owner) and confirm the same endpoint returns an address before you print anything.
- If you want a paid interaction in the demo, give the agent a priced service from `/dashboard/monetize`. It appears on the card as a **Pay via x402** action.
- A humanoid rigged body plays the idle animation and gaze in the camera view. Any of the rigs the universal retargeter maps work (Mixamo, VRM, and the rest); a non-humanoid prop stands still.

### 2. Pick the spot

GPS decides whether people see the agent, so the spot matters more than anything else in this runbook.

- **Open sky.** Plazas, parks, waterfronts. In San Francisco that means places like the Embarcadero, the Ferry Building plaza, Dolores Park, Crissy Field, or the top of a park hill. Avoid narrow downtown streets between tall buildings: multipath GPS there can drift 50 m or more, and the nearby read caps at 60 m.
- **Somewhere people can stop.** Visitors need to stand still for a few seconds while GPS settles and the model loads.
- **Cellular signal.** The agent's model is fetched over the visitor's own connection.

The card shows the pin's placement accuracy, and the ring under the agent goes amber above 25 m. If you see amber when you place it, move to clearer sky and place again.

### 3. Place the pin

On your phone, signed in, at the spot:

1. Open [/irl](/irl), grant camera, location, and motion.
2. Pick the agent (the avatar picker under the name).
3. Aim at the ground, tap **Move here** to set it down, then **Pin here**. On Android with ARCore, **Place in AR** anchors it to the detected floor with a pinch to size it; on iPhone, **Pin here** is the placement path.
4. Give it a caption. It shows on the sign and on the card.

Signed-in pins are permanent until you remove them. If you cannot be at the spot beforehand, **Place on map** in /irl drops it at a point you choose, and **Move on map** in the dashboard relocates it later.

The full placement walkthrough is [Place a 3D agent in your real environment](/docs/tutorials/place-agent-irl).

### 4. Print the sign

Open [/dashboard/irl-placements](/dashboard/irl-placements), find the pin, and tap **Visit link**. The modal shows the QR, the link to copy, and **Print a sign**, which opens `/irl/sign?pin=<id>`: the agent's name, thumbnail and bio, the QR, three steps for the visitor, and the link in plain text. Choose **Sign** (landscape) or **Poster** (a large QR for a vertical sheet) and print. A laminated Letter sheet at chest height reads fine from two metres.

Test the sign with your own phone before you leave: scan it, walk 70 m away, confirm the banner says the agent is out of range, walk back, confirm the card opens.

---

## On the day

- **Your phone is the demo screen too.** The dashboard's **View in IRL** opens the same visit link, so you can show the walk-up while a visitor does it.
- **Talk through the three taps:** scan, allow, look around. The banner carries the rest.
- **Let them talk first.** Hand the phone over with the card open and say "hold the mic and ask it anything". The agent answers out loud in its persona; that is the moment people remember. Give the agent a persona and a cloned voice beforehand (`/agents/<id>`, Brain Studio and the voice clone in talk mode) so it sounds like itself on the street.
- **Show the tip.** Expand **Tap to tip in person**, and let someone scan the Solana Pay QR with Phantom or Solflare. The agent's wallet is a real address; a tip lands on-chain.
- **Show it on the floor.** **View in AR** is the moment people photograph: Quick Look on an iPhone, a floor-anchored WebXR session on an Android phone with ARCore.
- **Volume and noise.** Replies play through the phone speaker. On a loud street, hold the phone up or use a small speaker; typed turns work when speech recognition cannot hear.
- **Messages and taps land in your dashboard.** The placements page lists every message, tap and pay under the pin, and the inbox lets you reply. `GET /api/irl/analytics` (admin) has the rollup afterwards.

---

## Troubleshooting on site

| Symptom | Cause | Fix |
|---|---|---|
| Banner never changes from "You're here to meet" | Visitor is outside 60 m, or their GPS fix is far off | Move to open sky, wait ten seconds, check the accuracy line on the card once it opens |
| "Enable location" chip in the top bar | Location was denied | Tap the chip; on iPhone, Settings > Safari > Location if the prompt is gone |
| Agent appears but does not move | Motion permission not granted (iPhone), or a non-humanoid body | Tap the motion chip; humanoid rigs animate, props do not |
| "View in AR" is missing | The pin has no model URL | Re-place the pin with a hosted avatar from your account |
| Talk shows "Voice input isn't available" | The browser has no speech recognition, or the mic was denied | Type in the box instead; on iPhone allow the microphone when Safari asks, or Settings > Safari > Microphone |
| The agent answers but you hear nothing | The phone is on silent (iPhone honours the mute switch for web audio) or volume is down | Flip the ring/silent switch, raise the volume, tap the mic again |
| The mouth does not move while it speaks | The body has no mouth morphs or jaw bone, or the model is still streaming in | Nothing to fix on site; the agent still talks. Rigs with ARKit or VRM mouth shapes animate |
| Banner says the agent has moved on | The pin expired (anonymous pins last 7 days) or was removed | Place it again signed in and print a fresh sign |
| Visitors see nothing at all, you see the agent | Your device owns the pin; theirs reads nearby only within range | Have them stand where you placed it, not where you are now |

---

## Related

- [IRL overview](/docs/irl): what IRL is, Money Drops, World Lines, the SDK
- [How location works on IRL](/irl-privacy) and the [threat model](/docs/irl/THREAT-MODEL)
- [Place a 3D agent in your real environment](/docs/tutorials/place-agent-irl)
- [AR and WebXR reference](/docs/ar): the device routing behind "View in AR"
~~~~

