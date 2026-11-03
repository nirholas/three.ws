# A welcome concierge NPC greets first-time visitors in /play, answers questions from real features, and leads a skippable tour

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/723-plan-play-concierge-greeter-tour.md`.

**Priority:** P2, new capability with clear value (score 55 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Most visitors to the $THREE world arrive as first-timers from one shared link (the next community meetup is 2026-11-06, `public/event.json`). The onboarding overlay explains controls, but nobody in the world greets them, answers "what is this place" or shows where the stations are. The NPC layer, a chat endpoint and a navigation graph all exist, so a concierge is mostly wiring and a carefully grounded persona. Today nothing in `src/game` implements a greeter (the only "concierge" match in `src/game` is an unrelated string in `coincommunities-ui.js`).

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- NPC layer exists: `src/game/npc/npc.js`, `npc-catalog.js`, `npc-chat.js` (`openChat`, talks to `/api/brain/chat`), `nav-graph.js`, `citizens.js`, `world-life.js`, `economy-npcs.js` (placement precedent).
- Onboarding: `src/game/play-onboard.js` (3-step overlay; the control list is data with an `essential` flag) and `src/game/play-intro.js`. First-visit detection uses localStorage signals read by `play-onboard.js`.
- Self-attaching module precedents: `src/game/ambient-crowd.js`, `src/game/event-countdown.js`, `src/game/meetup-event.js`.
- `/api/brain/chat` clamps a signed-out caller to the free providers under an anonymous rate limit and answers 401 for paid first-party models, so a concierge persona that does not pin a free provider shows first-timers a sign-in wall instead of a welcome.
- No concierge persona, greeting trigger, tour route or test exists (`grep -rli "concierge\|greeter" src/game tests` finds nothing relevant).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -rli "concierge\|greeter" src tests api/brain 2>/dev/null
sed -n 1,80p src/game/npc/npc-chat.js
grep -n "localStorage" src/game/play-onboard.js | head
grep -n "free\|anonymous\|provider" api/brain/chat.js 2>/dev/null | head -20
ls src/game/npc; cat public/event.json
```

If a concierge module already exists, run its tests and only build the missing pieces below.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first for the pure logic. Add `tests/play-concierge.test.js` covering: first-visit detection (greets once, never again after the stored flag is set, never when the NPC layer is disabled), the event-window opening line (present only inside the window read through `src/shared/event-config.js`, absent before and after), and the tour route builder (stops resolve to real landmark positions, skip works at every index).
2. Create `src/game/npc/concierge.js` as a self-attaching module in the `ambient-crowd.js` style: no edits to core modules beyond one import and mount call in `src/game/coincommunities.js`. It mounts only when the NPC layer is enabled and costs nothing while idle (no per-frame work until a player is within greeting range; use the same proximity pattern the stations use).
3. Persona and chat. Register a distinct, well-dressed concierge in `npc-catalog.js` and open it through `openChat`. The persona prompt lives in one exported constant and is grounded in the real feature set: name the stations and panels that exist in `src/game/play-activities.js`, the chart jumbotron (`chart-screen.js`), the cosmetics boutique, the intel kiosk, the war portal and wheel station, how to earn and spend in the world, and how to sign in. Build the feature list from the code (read the station registry) rather than hand-typing marketing copy, and add a test that fails when a named station no longer exists. Pin a free provider so a signed-out caller never gets the 401 wall; verify with a signed-out request.
4. Greeting. For a first-time visitor the concierge approaches or waves and beckons once, never blocks movement, and never repeats. Returning players see it idle at its post. Respect reduced motion.
5. Guided tour. A "show me around" choice leads the player through three or four real landmarks along the nav graph with one line at each, falling back to waypoint markers when no path exists. Skippable at any step by button, Escape or walking away; works with the mobile joystick and does not capture it.
6. Event awareness. Inside the `public/event.json` window the opening line states what is happening and where (name and place from the config, no hard-coded copy). Outside the window that line does not exist.
7. States and polish: the greeting bubble, tour card and chat entry have hover, focus-visible and active states, keyboard operation, empty/error states (chat provider down shows a designed retry, not a stack trace) and text through the i18n layer used by neighbouring HUD code.
8. Real browser verification on `npm run dev` with a cleared profile: greeting fires once, tour completes on desktop and emulated mobile, chat answers "what is this place" and "how do I make money here" from real features, second visit shows no re-greeting, console clean. Record observed results in the report.
9. Docs: add a section to `docs/play-live-events.md` (or the NPC doc if one exists), a `STRUCTURE.md` row only if a new directory lands, and a `data/changelog.json` entry; run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/play-concierge.test.js` passes, including the station-existence guard.
- [ ] `grep -n "concierge" src/game/coincommunities.js` shows the single mount call.
- [ ] Browser: fresh profile greets exactly once; reloading does not greet again; tour skip works at every step; no console errors or warnings from the new code.
- [ ] A signed-out chat with the concierge returns an answer (no 401 or sign-in wall) when called against `npm run dev`.
- [ ] With the NPC layer disabled the concierge never mounts and adds no network requests.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No free chat provider reachable locally | Use the worker-proxied free provider the brain endpoint already lists; if all are down, the designed error state is the shipped behavior and the persona test still runs offline. |
| Nav graph has no path to a landmark | Fall back to waypoint markers (task 5) and log the unreachable landmark in the report. |
| Event config absent locally | Use `npm run event:schedule -- --rehearse 10 --apply` locally to exercise the event line, and `--clear` to reset. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/723-plan-play-concierge-greeter-tour.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `723-plan-play-concierge-greeter-tour.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/14-welcome-concierge.md` (whole file)

~~~~markdown
# Feature 14: welcome concierge NPC for first-time event visitors

Most event visitors will be first-timers landing from one shared link. The onboarding overlay explains controls, but nobody in the world greets them, answers questions, or shows them where things are. Build a concierge NPC that does.

## Where the code lives

- NPC layer: `src/game/npc/npc.js`, `npc-catalog.js`, `npc-chat.js` (already talks to `/api/brain/chat`), `nav-graph.js` (pathing), `economy-npcs.js` for placement precedent, and `citizens.js` / `world-life.js` (every ambient walker is now a real citizen you can open and talk to; the closest precedent for a greeter that approaches once). Mind the chat gate: `/api/brain/chat` clamps a signed-out caller to the free providers under an anonymous rate limit and answers 401 for the paid first-party models, so the concierge persona must pin a free provider or first-timers get a sign-in wall instead of a welcome
- Onboarding today: `src/game/play-onboard.js` (3-step overlay; its control list is data with an `essential` flag, so a tour stop that teaches a key should reference that list rather than restate it); intro card: `src/game/play-intro.js`
- Landmarks worth touring: the stations from `src/game/play-activities.js`, the chart jumbotron (`chart-screen.js`), the cosmetics boutique, the intel kiosk
- First-visit detection: the same localStorage signals `play-onboard.js` uses

## What to build

1. **The greeter.** A distinct, well-dressed NPC near spawn. For first-time visitors it approaches (or waves and beckons) once, never repeatedly, and never blocks movement. Returning players see it idle at its post; it never re-triggers the greeting.
2. **Real conversation.** Clicking or approaching opens the existing NPC chat with a concierge persona: it knows what this place is ($THREE's world on three.ws), what there is to do (name the actual stations and panels that exist in code, not marketing copy), how to earn and spend, and how to sign in. Ground the persona prompt in the real feature set so it never invents features.
3. **Guided tour.** A "show me around" choice that walks the player (NPC leads using the nav graph, waypoint markers as fallback) through three or four real landmarks with one line at each. Skippable at any point; works with the mobile joystick.
4. **Event awareness.** During the event window (`public/event.json`) the concierge's opening line points at the event: what is happening and where. Outside the window that line does not exist.
5. **Zero-regression mount.** Prefer a self-attaching module in the `ambient-crowd.js` / `event-countdown.js` style. The concierge must never appear in worlds where the NPC layer is disabled, and must cost nothing when idle (no per-frame work while nobody is near).

## Verify

- Fresh profile (cleared localStorage) on `npm run dev`: greeting fires once, tour completes, chat answers "what is this place" and "how do I make money here" sensibly, on desktop and emulated mobile.
- Second visit: no re-greeting. Console clean throughout.
- `npm test` green.

## Report format

Files shipped, the persona prompt location, the tour stops, what the concierge says in its event-window line, and the `data/changelog.json` entry.
~~~~

