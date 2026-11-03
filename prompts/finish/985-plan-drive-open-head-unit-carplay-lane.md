# Drive lane D, the agent beside a projected CarPlay or Android Auto session on an open head unit

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/985-plan-drive-open-head-unit-carplay-lane.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 12 of 100 inside the tier). **Area:** drive. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Apple gives a conversational CarPlay app no drawing surface, so the agent as the face of the car is only legal on an open head unit: `node-carplay` plus a Carlinkit CPC200 dongle renders a real CarPlay or Android Auto session inside a browser surface we own, on a Raspberry Pi or any Linux box, with the 3D agent standing beside the projected phone screen at full size. `docs/carplay.md` scopes it as "Lane D, designed, not built" because it needs hardware to build against. Everything up to the dongle can be built and tested with the dongle stubbed at the USB boundary only.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `/drive` exists (`pages/drive.html`, `src/drive/*`, `tests/drive-surface.test.js`) and is the agent half; it already accepts a surface preset (`src/drive/surface.js`).
- No `node-carplay` dependency, no head-unit app, no docs for the lane beyond `docs/carplay.md` section "Lane D".
- License posture is settled: `node-carplay` is MIT; GPL projects (OpenAuto, aasdk) are excluded. Fixes made to `node-carplay` go upstream.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -rn -i "node-carplay\|carlinkit\|cpc200" --include=*.json --include=*.js --include=*.md . 2>/dev/null | grep -v node_modules | head
ls src/drive pages/drive.html
npm view node-carplay version license repository.url 2>&1 | head -5
lsusb 2>/dev/null | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Create `apps/head-unit/` (check `ls apps` and `STRUCTURE.md` for the right home) with a README, a pinned `node-carplay` dependency (verify the LICENSE file before adopting), and a minimal Electron-free web shell: a Node service that owns the USB dongle and streams the decoded video and audio to a local page, plus a page that lays the projected screen beside the `/drive` agent (embed `/drive?surface=headunit` or a new preset).
2. Add a `headunit` preset to `src/drive/surface.js` (larger glyphs, 3D stage ON because this lane has a real display) with unit tests first in `tests/drive-surface.test.js`.
3. Isolate the dongle behind one interface (`open()`, `onVideo`, `onAudio`, `sendTouch`, `close`) so the whole app can run in a "no dongle" mode that shows an honest "Connect a CarPlay dongle" empty state with the exact USB vendor/product ids the CPC200 enumerates as. No fake video source: the empty state is the real behavior without hardware.
4. Test the service's connection state machine (disconnected, probing, connected, error with retry) with the dongle interface driven by a recorded-protocol fixture captured from `node-carplay`'s own test data, not invented bytes.
5. Write `apps/head-unit/README.md` and the Pi setup runbook (udev rule for the dongle, kiosk Chromium launch, auto-start unit file), and update `docs/carplay.md` lane D and the build-plan phase 7 row.
6. Everything that needs the physical dongle goes into one short "first connection" checklist for the owner; do not claim it verified.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/drive-surface.test.js` and the head-unit service tests pass.
- [ ] Starting the head-unit app with no dongle attached serves the page and shows the designed "Connect a CarPlay dongle" state, with zero console errors, checked in a real browser.
- [ ] `npm ls node-carplay` shows the pinned MIT dependency and its LICENSE was read and quoted in the README.
- [ ] `docs/carplay.md` states exactly what is verified (no dongle ever touched) and what the owner must check.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No dongle on this machine | Build and test everything against the dongle interface and the recorded-protocol fixture; the hardware checklist is the deliverable for that last step. |
| `node-carplay` API differs from what the doc assumes | Read its source and README, adapt the interface adapter, and note the delta in the README. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The only gate is hardware: a Carlinkit CPC200 dongle and a Pi or Linux box, which only the owner can supply. This is why the order is GATED; the agent-doable work above is complete without it.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/985-plan-drive-open-head-unit-carplay-lane.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `985-plan-drive-open-head-unit-carplay-lane.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/carplay.md` (section "Lane D: the open head unit (designed, not built)")

~~~~markdown
### Lane D: the open head unit (designed, not built)

`node-carplay` plus a Carlinkit CPC200 dongle renders a real CarPlay or Android Auto session
inside a browser surface we own, on a Raspberry Pi or any Linux box. In that lane there is no
entitlement, no template vocabulary and no exclusive-map rule: the agent can stand beside
the projected phone screen at full size. This is where the original idea, the agent as the
face of the car, is legal today. It needs hardware to build against, so it is scoped and
deliberately not half-built.
~~~~

### `docs/carplay.md` (section "7. Licensing")

~~~~markdown
## 7. Licensing

Everything adopted or planned is permissive: MIT (`node-carplay`, and
`react-native-carplay` as a reference), Apache-2.0 (`androidx.car.app`), BSD-2 (MapLibre).
The GPL-3.0 projects in this space, OpenAuto and `aasdk`, are excluded on both counts:
copyleft we cannot link into a commercial product, and no meaningful maintenance.

The obligation runs the other way too. `node-carplay` is one maintainer's work holding up an
entire category of open head units. If the head unit lane lands and we fix something in it,
the fix goes upstream.

---
~~~~

### `docs/carplay.md` (section "5. Build plan")

~~~~markdown
## 5. Build plan

| Phase | Work | State |
|---|---|---|
| 1 | `/drive`: the surface, the voice loop, the safety rules, the presets | **Done.** Verified in Chromium at 800x480, 1280x720, 1920x720 and 390x844, day and night, with a real `/api/chat` and `/api/tts` turn. |
| 2 | Native CarPlay scene, audio session, message channel, entitlement, Info.plist | **Done in the tree.** Cannot be compiled or run without Xcode and a car or the CarPlay simulator. |
| 3 | Apple's entitlement request | **Owner action.** See `ios/docs/CARPLAY.md`. Nothing else blocks. |
| 4 | Android Auto: `CarAppService`, foreground-service web view, the same channel, the same four controls | **Done and compiled.** Needs the Desktop Head Unit and a phone to exercise on a car screen. |
| 5 | The home lane reaching the car: guarded actions surfaced and gated on being parked | **Done.** `/api/chat`'s home tools already work from `/drive`; the confirmation card is wired and refused while moving. |
| 6 | Android Automotive OS: `app-automotive` plus a `CarAppActivity` in its own build flavor | Scoped, not started. |
| 7 | Lane D head unit: `node-carplay` beside the agent on a Pi | Scoped, needs a CPC200 dongle. |

---
~~~~

