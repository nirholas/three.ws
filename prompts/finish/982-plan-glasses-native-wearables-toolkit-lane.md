# Add the native Meta Wearables toolkit lane to the iOS app for hands-free voice and camera re-localization

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/982-plan-glasses-native-wearables-toolkit-lane.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 28 of 100 inside the tier). **Area:** glasses. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The lens web app cannot hear or see: web apps on the Ray-Ban Display get no microphone and no camera. The native Device Access Toolkit (Swift or Kotlin) gives both plus speaker output, which is what turns "tap-to-talk with reply chips" into a spoken conversation with a street agent, and lets a placed pin snap back to where it was left rather than where GPS guesses. This is explicitly Phase 6 and should follow the lens web app (order `glasses-meta-display-lens-web-app`). It is gated because it needs physical glasses and Meta developer-preview enrollment that no build session can provide.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `ios/` exists (Capacitor shell, `ios/README.md`). No Meta Wearables package is referenced: `grep -rn "meta-wearables\|MWDAT\|DeviceAccess" ios` returns nothing.
- The toolkit is `facebook/meta-wearables-dat-ios` (Swift Package Manager, MockDeviceKit for no-hardware tests) and `facebook/meta-wearables-dat-android` for parity.
- The conversation pipeline to reuse is the `TalkController` path in `src/irl/pin-talk.js`; re-localization primitives are in `src/irl/room-anchor.js`, `marker-pose.js`, and `floor-anchor.js`.
- Meta publishing is closed in developer preview; native apps need registration and release channels.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 290,305p docs/glasses/meta-ray-ban-display.md
cat ios/README.md | head -40
grep -rn "Wearables\|MockDeviceKit" ios 2>/dev/null | head -3
ls src/glass 2>&1 | head -2   # the lens web app order should have landed first
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add the iOS Swift package for the toolkit to the Capacitor project through Swift Package Manager, pinned to an exact release at least two weeks old; wire `MockDeviceKit` so the project builds and the unit path runs without hardware.
2. A Capacitor plugin (Swift) exposing: device session state, microphone stream, speaker output, photo capture. JS side in `src/irl/glasses/native-bridge.js`, feature-detected so the web build is unaffected.
3. Spoken conversation: glasses microphone to speech-to-text, into the same `TalkController` pipeline; agent reply text to speech out through the glasses speakers. Reuse the platform's existing speech endpoints; do not onboard a new paid vendor (GCP speech is pre-approved).
4. Camera re-localization: process frames on device to compute pose against the pin's stored anchor; frames are never uploaded and never stored (privacy contract in `docs/irl/THREAT-MODEL.md`). Unit tests on the pose math with recorded sample frames committed as test fixtures under `tests/fixtures/`.
5. Android parity: same plugin on Android with the Kotlin toolkit.
6. Docs, STRUCTURE.md row, changelog entry only when it ships to testers.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] iOS project builds with the toolkit and runs its MockDeviceKit test target green.
- [ ] `npx vitest run tests/irl-native-bridge.test.js` passes for the JS side with a fake plugin boundary (test only).
- [ ] A hardware demo log exists, or the report states plainly that the hardware step is pending and who owns it.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No hardware | Build against MockDeviceKit and finish everything that compiles; the hardware demo is the single remaining step, owned by whoever holds the glasses. |
| No Mac or Xcode in the session | Write the Swift sources and Package manifest, run the JS tests, and list the exact `xcodebuild` command for the owner's Mac. |
| Toolkit API differs from the doc | Read the toolkit repo's README at the pinned tag and adapt; fix the doc. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Needs Meta developer-preview enrollment and a pair of Ray-Ban Display glasses, both owner-held. TestFlight or App Store submission is publishing and needs approval. Ask once at the end of the session if the owner wants either; do not stall the code.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/982-plan-glasses-native-wearables-toolkit-lane.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `982-plan-glasses-native-wearables-toolkit-lane.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/glasses/meta-ray-ban-display.md` (section "Phase 6: the native lane (camera, voice, precision)")

~~~~markdown
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

