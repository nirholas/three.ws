# Audit and fix the /play client for the 2026-11-06 meetup across first impression, mobile, performance, auth failures and accessibility

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/256-plan-play-meetup3-client-ux-audit.md`.

**Priority:** P0, live defect, security, or broken money rail (score 84 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

$THREE Community Meetup #3 starts 2026-11-06 16:00Z (`public/event.json`, id `three-community-meetup-3`) and its link goes to the /play world. A large share of visitors will be first-timers on phones, signed out, behind ad blockers and venue wifi. The /play client has changed a lot since the last full audit pass (the prompt pack in `docs/event-readiness/` was written for the August event): new stations, NPCs, a party system, signature wall, projector mode, photo mode, the quest line, new boot watchdog. Nothing records that the five client audits were re-run against the current build, and production serves an older commit than the working tree. This order re-runs them with the harnesses that already exist, fixes what breaks, and leaves numbers behind so the next event can compare.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Audit harnesses exist: `scripts/play-mobile-repro.mjs` (engines chromium and webkit), `npm run audit:mobile-touch`, `npm run audit:console`, `npm run audit:web`, `npm run audit:web:login` (needs `AUDIT_EMAIL` and `AUDIT_PASSWORD` in `.env`), `npm run audit:states`, `npm run audit:motion-tokens`, `npm run audit:motion`, `scripts/drive-event-e2e.mjs`.
- Docs for context: `docs/play-boot-performance.md` (boot watchdog scope), `docs/DESIGN-TOKENS.md`.
- Production (`curl -s https://three.ws/api/version`) serves commit `ab4b79e90`; the working tree is 24 commits ahead at review time, so findings against production may already be fixed locally. Audit the local build (`npm run dev`) for fixes and production for ground truth.
- Canonical URL for every check is in `docs/event-readiness/README.md` (the $THREE world with `coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`).
- No results of a re-run against the current build are recorded in the repo.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
curl -s https://three.ws/api/version | head -c 200; git log -1 --format='%h %s'
cat public/event.json | head -8
ENGINE=chromium node scripts/play-mobile-repro.mjs "http://localhost:3000/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three" 120000 2>&1 | tail -40
npm run audit:mobile-touch 2>&1 | tail -20
npm run audit:console -- /play 2>&1 | tail -30
npm run audit:states 2>&1 | tail -10
```

(Start `npm run dev` first. Treat a result made only of navigation timeouts or `net::ERR_*` on a busy machine as unmeasured and re-run when quiet.)

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Baseline. Record before-numbers: transferred bytes to interactive, peak heap after 5 minutes idle, worst frame time over 30 s of walking in the busiest area, time to first meaningful paint, and the mobile harness result (chromium and webkit, 120 s, zero page errors, no disconnect) on the canonical URL.
2. First impression (audit 01). Walk it fresh (cleared localStorage): blank-screen window with a designed loading state built on the existing boot watchdog in `pages/play.html` (do not duplicate it); coin identity from the query string visible in title, HUD and signage with an image fallback when IPFS fails; intro/onboarding skippable, under 30 s and not re-appearing; HUD controls with hover, focus-visible and active states (`npm run audit:states`, `npm run audit:motion-tokens` pass); every visible control does something; top three screenshot gaps fixed. Include the newer surfaces (invite, party, photo mode, quests, signature wall, projector mode) in the control sweep.
3. Mobile (audit 02). Fix the root cause of any crash or disconnect in the harness evidence (page error versus WebKit memory kill versus socket drop); eliminate duplicate GLB or clip fetches; scale crowd density and textures down on coarse pointers (`CROWD_BUDGET` in `src/game/ambient-crowd.js`); one-handed portrait controls; 44 px targets (`npm run audit:mobile-touch` passes); safe-area insets; chat input with the on-screen keyboard; rotate mid-session without a reload.
4. Performance (audit 03). Fix in priority order from measurements: duplicate fetches, eager imports that should be dynamic `import()` (wheel UI, shop, voice, intel kiosk, anything new from the last month), draw-call instancing, texture downsizing, per-frame allocation in the render loop, and disposal of despawned objects. Re-measure and show before and after.
5. Auth and failure states (audit 06). Signed-out exploration and an invitation-style gate; sign-in mid-session without losing position; session expiry mid-purchase gives a re-auth prompt that resumes the action; every `fetch(` in `src/game` has a user-visible, actionable failure state; blocked IPFS image and blocked GLB render with fallbacks (never a T-pose or an invisible avatar); bad query strings (no params, garbage `coin=`, script payload in `name=` and `symbol=`, oversized `image=`) never execute script and get a designed default. Report any XSS finding first. Console zero on anon and authed runs (`npm run audit:console -- /play`, `npm run audit:web`, `npm run audit:web:login`).
6. Accessibility and i18n (audit 09). Keyboard-only session through every panel; visible focus; Escape closes the top panel; hotkeys do not swallow chat typing; accessible names for icon-only buttons; polite live region for balance changes and incoming chat; 4.5:1 contrast on the worst five HUD pairs with scrims where needed; `prefers-reduced-motion` honoured (`npm run audit:motion`); all play strings through the i18n layer, with one non-English locale (a long German or Romanian pass) rendered without overflow; 200% zoom usable.
7. Regression tests for every bug fixed (test first: reproduce, see it fail, fix, see it pass), placed beside the module's existing tests in `tests/`; for pure visual defects say so in the report.
8. Add `scripts/audit-event-client.mjs` (or extend `scripts/drive-event-e2e.mjs`) that runs the repeatable parts (mobile harness thresholds, console zero, touch audit) and exits non-zero on a regression, so the next event can rerun it with one command. Document it in `docs/event-readiness/README.md`.
9. Results table (before/after numbers, each fix in one line, accepted exceptions with the measured cost) in the report, and a `data/changelog.json` entry for user-visible fixes; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `ENGINE=chromium` and `ENGINE=webkit node scripts/play-mobile-repro.mjs <canonical url> 120000` both finish with zero page errors and no disconnect (output pasted).
- [ ] `npm run audit:mobile-touch`, `npm run audit:states`, `npm run audit:motion-tokens` and `npm run audit:motion` pass; `npm run audit:console -- /play` reports zero errors and zero warnings from our code on anon and authed runs.
- [ ] Before/after table shows no regression in transfer bytes, worst frame time or 5-minute heap growth, and at least the duplicate-fetch count is zero.
- [ ] A keyboard-only session (join, open every panel, send one chat message) completes with no mouse; contrast of the worst five pairs recorded and passing.
- [ ] `name=<script>alert(1)</script>` and an oversized `image=` produce no script execution and a designed default (asserted in a test or recorded in the browser).
- [ ] The repeatable audit script exists and exits non-zero on a seeded regression.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| WebKit browser missing | `npx playwright install webkit`, then rerun with `ENGINE=webkit`. |
| Machine too loaded, audits time out | Lower `CONCURRENCY`, raise `SETTLE_MS` and `SERVER_BOOT_MS`, reuse the running dev server on :3000, rerun when quiet; treat all-timeout results as unmeasured. |
| `AUDIT_EMAIL` / `AUDIT_PASSWORD` missing for the authed sweep | Follow the QA login row in the self-unblock playbook; do not skip the authed half. |
| Finding is real hardware only (iOS memory kill) | Fix everything the harness can prove, then state the residual real-device risk plainly in the report. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/256-plan-play-meetup3-client-ux-audit.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `256-plan-play-meetup3-client-ux-audit.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/README.md` (whole file)

~~~~markdown
# Event readiness: prompt pack

Twenty-four self-contained agent prompts to get three.ws, and especially the /play world, to 100% before the event. Files 01-10 audit and fix what exists; files 11-16 build new event features; files 17-24 build new capabilities, things players can DO in the virtual world, by wiring in subsystems that are already built but unreachable from /play. Each file is a complete prompt: paste it into a fresh Claude Code session (or hand it to a subagent) and it runs end to end, fixing or building, then reporting.

Suggested order and parallelism (audits):

| # | Prompt | Surface | Can run in parallel with |
|---|--------|---------|--------------------------|
| 1 | [01-play-first-impression.md](01-play-first-impression.md) | /play load, intro, onboarding UX | 4, 5, 7, 8 |
| 2 | [02-play-mobile.md](02-play-mobile.md) | /play on phones (stability + touch) | 7, 8 |
| 3 | [03-play-performance.md](03-play-performance.md) | /play load weight, FPS, memory | 7, 8 |
| 4 | [04-play-multiplayer-net.md](04-play-multiplayer-net.md) | WebSocket, reconnects, voice, crowd | 1, 5 |
| 5 | [05-play-economy-loops.md](05-play-economy-loops.md) | Store, bank, wheel, combat, quests, cosmetics | 1, 4 |
| 6 | [06-play-auth-errors.md](06-play-auth-errors.md) | Sign-in, gates, error/empty states, console | after 1 |
| 7 | [07-platform-smoke-sweep.md](07-platform-smoke-sweep.md) | Every page on the live site | 1, 2, 3 |
| 8 | [08-api-production-health.md](08-api-production-health.md) | Cloud Run, crons, logs, DB, x402 | 1, 2, 3 |
| 9 | [09-accessibility-i18n.md](09-accessibility-i18n.md) | Keyboard, ARIA, contrast, translations | after 1 |
| 10 | [10-event-day-runbook.md](10-event-day-runbook.md) | Pre-scale, monitoring loop, rollback | last, after all fixes deploy |

Feature builds (run after audits 1-3 land, or in parallel if staffed; 12, 14, and 16 interlink but each stands alone):

| # | Prompt | Builds | Depends on |
|---|--------|--------|------------|
| 11 | [11-event-live-ops.md](11-event-live-ops.md) | Operator broadcast, go-live moment, live event config | nothing |
| 12 | [12-photo-mode-share.md](12-photo-mode-share.md) | Photo mode with branded one-tap share | nothing |
| 13 | [13-event-quests-leaderboard.md](13-event-quests-leaderboard.md) | Time-boxed quest line + live leaderboard + cosmetic reward | nothing (better with 12) |
| 14 | [14-welcome-concierge.md](14-welcome-concierge.md) | Greeter NPC, guided tour, event-aware opening line | nothing |
| 15 | [15-live-hype-feed.md](15-live-hype-feed.md) | Activity ticker + market hype moments | nothing (better with 13) |
| 16 | [16-invite-flow.md](16-invite-flow.md) | Invite sheet, QR, OG card truth, arrival continuity | nothing (better with 14) |

Capability builds (17-24): each wires an existing, finished subsystem into the world or adds a missing social primitive. All stand alone; the noted pairings just make them better together.

| # | Prompt | Builds | Wires in / pairs with |
|---|--------|--------|-----------------------|
| 17 | [17-plaza-live-show.md](17-plaza-live-show.md) | Live hosted show on a plaza stage, with $THREE tips | StageRoom + ShowDirector (built, unreachable from /play) |
| 18 | [18-coin-wars-portal.md](18-coin-wars-portal.md) | In-world Coin Wars portal: standings, queue, spectate | ClashRoom + war standings (built, arena-page only) |
| 19 | [19-forge-props-live.md](19-forge-props-live.md) | Text-to-3D prop generation inside build mode | Forge lane + the networked prop pipeline |
| 20 | [20-world-chat-scrollback.md](20-world-chat-scrollback.md) | Chat scrollback for late joiners + community-feed bridge | the WalkRoom relay + api/community/messages |
| 21 | [21-party-system.md](21-party-system.md) | Parties: form, see, reach, and talk to your crew | friends/presence stack; pairs with 13, 16 |
| 22 | [22-venue-projector-mode.md](22-venue-projector-mode.md) | Broadcast spectator view for the venue big screen | camera rig + event.json; pairs with 15, 16, 17 |
| 23 | [23-signature-wall.md](23-signature-wall.md) | Persistent signature wall, the event's artifact | world-persist patterns + name safety |
| 24 | [24-dance-off.md](24-dance-off.md) | Judged dance-off rounds with crowd voting and tips | dance floor beat + King of the Totem round machine |

Rules that apply to every prompt in this pack:

- The canonical test URL for the world is the $THREE community: `https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`
- Fix what you find. Do not produce a findings report and stop; the report is what you fixed plus what genuinely cannot be fixed in-session and why.
- Verify locally with `npm run dev` (port 3000) plus the named audit scripts before claiming done. `npm test` must stay green.
- Commit finished work promptly with explicit paths (concurrent agents share this worktree; never `git add -A`).
- Deploys stay owner-gated. Prepare everything so shipping is one command (`npm run deploy:gcp:full`), then say so in the report.
~~~~

### `docs/event-readiness/01-play-first-impression.md` (whole file)

~~~~markdown
# Audit 1: /play first impression and core UX

We have a major event tomorrow and /play is the showcase surface. Your job: make the first 60 seconds of the $THREE world feel world-class. Load, audit, and fix; do not just report.

Canonical URL (the exact link we will share at the event):

```
https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
```

## Where the code lives

- Page shell: `pages/play.html` (served at /play via the vercel.json route table)
- World boot and main loop: `src/game/coincommunities.js`
- HUD and panels: `src/game/coincommunities-ui.js`, `src/game/coincommunities.css`, `src/game/hud/`
- Intro and onboarding: `src/game/play-intro.js`, `src/game/play-onboard.js`, `src/game/play-handoff.js`
- Avatar boot: `src/game/boot-avatar.js`
- Ambient population: `src/game/ambient-crowd.js`

## What to audit (walk it as a first-time visitor, in a real browser via `npm run dev`)

1. **The blank-screen window.** Time from navigation to first meaningful paint of the world. Anything over a couple of seconds of dead screen needs a designed loading state: skeleton or branded loader with real progress (assets actually loading), never a fake timer. Note `pages/play.html` already ships an inline boot watchdog: while the loading card is up, a failed same-origin script/stylesheet, an uncaught boot error, or 45s of silence swaps the spinner for a real error card with a retry, and it deliberately ignores blocked optional extras and flaky WebSocket reconnects (scope in `docs/play-boot-performance.md`). Build on that path; do not duplicate it.
2. **Query-string identity.** The coin name, symbol, and image from the URL must be visibly used: page title, HUD, world signage. Verify the `image` param (an /api/img proxy URL) renders everywhere it should and has a fallback if the IPFS fetch fails.
3. **Intro/onboarding flow.** Run it fresh (clear localStorage). Is it skippable? Does it explain movement, chat, and the economy in under 30 seconds? Does it re-appear when it should not?
4. **HUD polish.** Every button: hover, active, focus states. Panel open/close transitions (opacity + transform, no pops). Consistent spacing and typography with the existing design tokens (`docs/DESIGN-TOKENS.md`). Two ratchets already cover the mechanical half of this and the HUD is expected to stay clean under both: `npm run audit:states` fails a selector that declares `cursor: pointer` with no `:hover` rule behind it (the focus and disabled floors live in `public/tokens.css`), and `npm run audit:motion-tokens` fails a transition whose duration or easing is off the one ladder. Run them over your changes rather than eyeballing the CSS.
5. **Dead paths.** Click every visible control. Anything that does nothing, links nowhere, or throws is a bug to fix now.
6. **The screenshot test.** Would a stranger screenshot this and share it? If not, identify the top 3 visual gaps (lighting, framing, initial camera position, signage) and fix them.

## Verify

- `npm run dev`, exercise /play with the canonical query string; zero console errors, zero warnings from your code.
- `npm test` stays green.
- Re-run your walkthrough after fixes; capture before/after notes in the final report.

## Report format

What you changed (files + one line each), what you verified in-browser, anything you judged out of scope with a one-line reason. No open questions.
~~~~

### `docs/event-readiness/02-play-mobile.md` (whole file)

~~~~markdown
# Audit 2: /play on mobile (stability and touch UX)

A large share of event traffic will arrive on phones from a shared link. There is a known report that /play kicked mobile users out right after joining. Your job: reproduce, root-cause, fix, and then polish the touch experience.

## Tools already in the repo

- `scripts/play-mobile-repro.mjs`: emulated-phone harness that records console messages, page errors, WebSocket lifecycle, failed requests, transferred bytes, and heap samples. Run both engines:
  - `ENGINE=webkit node scripts/play-mobile-repro.mjs https://three.ws/play 120000` (reproduces iOS Safari memory kills)
  - `ENGINE=chromium node scripts/play-mobile-repro.mjs https://three.ws/play 120000` (gives heap + transfer numbers)
  - It also attributes every `.glb` load and animation-clip fetch to a call stack, so duplicated downloads point at the code that asked for them.
- `npm run audit:mobile-touch`: static touch-target audit.

## What to audit

1. **Survival.** Does an emulated iPhone stay in the world for the full run window? If it dies, the harness output tells you whether it was a page error, a memory kill (WebKit), or a WebSocket drop. Fix the root cause; do not add a reconnect band-aid over a crash.
2. **Memory and transfer budget.** From the chromium run: total transferred bytes and peak heap. Duplicate GLB or clip fetches (same URL, multiple stacks) are the first thing to eliminate. Texture sizes and crowd density (`src/game/ambient-crowd.js`) are the usual heavy hitters; scale them down on mobile rather than shipping the desktop load.
3. **Touch controls.** Virtual joystick or tap-to-move must work one-handed in portrait. Buttons at least 44px targets (`npm run audit:mobile-touch`). No hover-only affordances.
4. **Viewport correctness.** No horizontal scroll, no UI under the notch or home indicator (safe-area insets), no 100vh keyboard bugs in the chat input.
5. **Orientation.** Rotate mid-session; the canvas and HUD must reflow without a reload.

## Verify

- Both harness engines complete a 120s run on the canonical $THREE URL (see `docs/event-readiness/README.md`) with zero page errors and no disconnect.
- `npm run audit:mobile-touch` passes on the play surface.
- `npm test` stays green.

## Report format

Root cause of any crash found (with the harness evidence), fixes applied, remaining risk on real hardware that emulation cannot prove, stated plainly.
~~~~

### `docs/event-readiness/03-play-performance.md` (whole file)

~~~~markdown
# Audit 3: /play performance (load weight, frame rate, memory)

The world must load fast on event wifi and hold 60fps on a mid-range laptop. Measure first, then fix the biggest numbers, then measure again.

## Where the weight lives

- Main world: `src/game/coincommunities.js` (5k+ lines; check what it imports eagerly vs lazily)
- Population and props: `src/game/ambient-crowd.js`, `src/game/world-objects.js`, `src/game/terrain.js`, `src/game/build-voxels.js`, `src/game/static-batch.js`
- Shaders and environment: `src/game/water-shader.js`, `src/game/day-night.js`, `src/game/world-env.js`
- Avatar pipeline: `src/game/boot-avatar.js`, `src/glb-canonicalize.js`, `src/animation-retarget.js`

## What to measure (before touching anything)

1. **Network.** With devtools on the canonical $THREE URL (see `docs/event-readiness/README.md`): total transferred bytes to interactive, largest individual assets, any asset fetched more than once. `scripts/play-mobile-repro.mjs` (chromium engine) prints transfer totals and attributes duplicate GLB/clip fetches to their call stacks.
2. **Frame rate.** Performance panel recording of 30s of walking through the busiest area. Note long tasks, GC spikes, and the main-loop cost breakdown.
3. **Memory.** Heap snapshot after 5 minutes idle in the world. Growth means a leak (event listeners, geometries/materials not disposed on despawn, chat log unbounded).

## Fix priorities (biggest wins first)

1. **Duplicate fetches.** Same GLB or animation clip loaded twice is pure waste; cache at the loader.
2. **Eager imports that should be lazy.** Wheel UI, cosmetics shop, voice chat, intel kiosk: anything not needed for first paint should be a dynamic `import()` triggered on approach or click.
3. **Draw calls.** Instance repeated props (trees, rocks, crowd members). Merge static geometry per zone.
4. **Texture budget.** Downsize anything over 1024px that never fills the screen; KTX2/basis if the pipeline supports it, otherwise plain resizing is fine.
5. **Per-frame allocation.** No `new Vector3()` in the render loop; reuse scratch objects.
6. **Disposal.** Everything despawned (crowd, projectiles, dropped items) must dispose geometry, material, and textures.

## Verify

- Re-run the same three measurements; the report includes before/after numbers for transfer size, worst frame time, and 5-minute heap growth.
- No visual regressions: walk the full map once after changes.
- `npm test` stays green.

## Report format

Numbers table (before/after), each fix in one line, anything intentionally skipped with the measured cost that made it not worth it.
~~~~

### `docs/event-readiness/06-play-auth-errors.md` (whole file)

~~~~markdown
# Audit 6: /play auth, gates, and every failure state

Event visitors will arrive signed out, with ad blockers, on flaky wifi, with wallets we have never seen. Every one of those must get a designed experience, not a blank canvas or a raw stack trace.

## Where the code lives

- Auth flow: `src/game/play-auth.js`, `src/game/play-gate.js`, `src/game/play-handoff.js`
- World boot (error surfaces): `src/game/coincommunities.js`, `src/game/boot-avatar.js`
- QA credentials for authed testing: `AUDIT_EMAIL` / `AUDIT_PASSWORD` in `.env` (a real production QA account); sweeps via `npm run audit:web` (anon) and `npm run audit:web:login` (authed). Both take route paths as arguments to scope the sweep (`npm run audit:web -- /play`) and `--engine webkit` or `--engine firefox` to run it in Safari's or Firefox's engine instead of Chromium (`npx playwright install webkit` once)

## What to audit

1. **Signed-out experience.** Load the canonical $THREE URL (see `docs/event-readiness/README.md`) with no session. How much of the world is explorable before a gate appears? The gate itself: is it an invitation (clear value, one-tap sign-in) or a wall? Fix toward invitation.
2. **Sign-in mid-session.** Complete wallet sign-in from inside the world. The session must hand off without losing position or reloading the page if the flow supports it; if it must reload, state must restore.
3. **Session expiry.** Expire the session (clear the cookie/token) while playing, then perform an authed action (buy, bank). The user gets a re-auth prompt that resumes the action afterward, not a generic failure. Note `play-gate.js` now reads the cached play pass first on boot, and reading is how it is reaped: `loadStoredPass()` drops an expired or corrupt entry before either early exit (config probe failing open, gate off for this world), so a dead token no longer outlives the boot and gets handed to a room join the server can only refuse.
4. **Every fetch boundary.** Grep the play modules for `fetch(`/net calls and check each one handles rejection and non-2xx with a user-visible, actionable state. Internal code trusts itself; boundaries do not.
5. **Asset failures.** Block the IPFS coin image and one GLB in devtools. The world must render with fallbacks (placeholder texture, default rig per the `AnimationManager.supportsCanonicalClips()` gate), never a T-pose or an invisible avatar. A blocked or missing avatar GLB is a designed path in `boot-avatar.js`: it releases the loader, styles the card for the no-avatar case, and logs at info through the gated logger, so it costs a decoration, never the boot and never a console warning.
6. **Bad query strings.** /play with no params, a garbage `coin=`, an XSS attempt in `name=`/`symbol=` (must render escaped, never execute), and an oversized `image=` URL. Each gets a sane default world or a designed error, and never script execution.
7. **Console zero.** `npm run audit:console -- /play` (route paths passed as arguments scope the sweep; `--desktop` or `--mobile` picks one viewport), plus a manual pass. Zero errors, zero warnings from our code, on both anon and authed runs.

## Verify

- `npm run audit:web` and `npm run audit:web:login` pass for the play surface.
- Manual devtools-driven failure injection for items 3-6, each recovered per above.
- `npm test` stays green.

## Report format

A failure-mode table: scenario, what happened before, what happens now. Call out any XSS finding separately and first.
~~~~

### `docs/event-readiness/09-accessibility-i18n.md` (whole file)

~~~~markdown
# Audit 9: accessibility and internationalization

The event audience is international and diverse. Keyboard users, screen-reader users, and non-English speakers all get first-class treatment. Accessibility is not optional here; it is a hard platform rule.

## Where the code lives

- /play HUD and panels: `src/game/coincommunities-ui.js`, `src/game/hud/`, `src/game/coincommunities.css`
- i18n runtime: `i18n.js` (loaded by `pages/play.html`); play strings use `data-i18n` / `data-i18n-attr` attributes (see the meta tags in `pages/play.html` for the pattern)
- Motion audit: `npm run audit:motion`; design tokens: `docs/DESIGN-TOKENS.md`

## What to audit

1. **Keyboard.** Tab through every /play panel (store, bank, wheel, quests, cosmetics, chat, settings). Visible focus ring on every interactive element, logical order, Escape closes the top panel, no focus traps, and game hotkeys must not swallow typing in the chat input (and vice versa).
2. **Screen reader semantics.** Panels are labeled regions, buttons have accessible names (icon-only buttons need `aria-label`), balance changes and incoming chat announce via a polite live region, and the canvas has a text alternative describing the world state entry point.
3. **Contrast.** Every HUD text/background pair meets 4.5:1 (3:1 for large text). HUD text over the 3D scene is the usual failure: add scrims/backdrops where needed rather than hoping the scene stays dark.
4. **Motion sensitivity.** `prefers-reduced-motion` must tone down camera shake, wheel spin flourish, and ambient animation. Run `npm run audit:motion`.
5. **i18n coverage on the event funnel.** Every user-facing string on /play, the home page, and /launches goes through the i18n layer; hardcoded English in the play HUD is a bug. Verify at least one non-English locale renders the play HUD without broken layouts (long German/Romanian strings are the classic overflow test).
6. **Text scaling.** 200% browser zoom: HUD remains usable, nothing overlaps, no clipped labels.
7. **Platform-wide spot check.** Repeat items 1-3 briefly on the home page and /launches; fix what you find there too.

## Verify

- Full keyboard-only session: join the canonical $THREE world (URL in `docs/event-readiness/README.md`), open every panel, buy one thing, send one chat message. No mouse.
- Contrast checks recorded for the worst 5 HUD pairs, all passing after fixes.
- `npm test` stays green.

## Report format

Per-category pass/fixed list, the keyboard-only session result, locales verified, and any genuinely unfixable-today item with its concrete follow-up.
~~~~

