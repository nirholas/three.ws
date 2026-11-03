# Multi-agent stage serialises speech so agents never talk over each other

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/787-plan-stage-agent-speaking-queue.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 22 of 100 inside the tier). **Area:** stage. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

When two agents on one `<agent-stage>` speak at the same moment (for instance after a `stage.broadcast()` or a `say_to_agent` exchange), browser TTS overlaps and both lip-syncs run at once, which sounds broken. The spec lists a per-stage speaking queue as a known follow-up and nothing has built it.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/stage-element.js` hosts the multi-agent stage; `grep -n -iE "queue|speak" src/stage-element.js` shows no speech serialisation. `src/stage.js` has its own single-host `speak()` (for the club/spotlight show), unrelated to multi-agent.
- The spec line: "Voice conflicts: TTS is per-agent and not serialised across the stage ... A per-stage speaking queue is a follow-up."
- Related existing tests: `tests/embodiment-stage.test.js`, `tests/stage-show.test.js`, `tests/stage-host-line.test.js`, `tests/stage-split.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n -iE "queue|speak|tts|broadcast|say_to_agent" src/stage-element.js | head -20
grep -rn "say_to_agent" src --include=*.js -l
sed -n 60,95p specs/STAGE_SPEC.md
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Design a pure `src/stage-speech-queue.js`: FIFO with priority levels (user-directed beats broadcast beats ambient), per-agent de-duplication, a maximum queue depth with drop-oldest-ambient policy, and a `speaking` state exposing the current speaker. Dependency-free.
2. Test-first: `tests/stage-speech-queue.test.js` covering ordering, priority preemption of queued (never mid-utterance) items, depth limit, an utterance that errors (queue advances), and cancellation when an agent is removed from the stage. Use an injected `speak(agentId, text) => Promise` so no browser is needed.
3. Wire into `src/stage-element.js`: every agent speech request on the stage goes through the queue; the agent's own `speak` event still drives lip-sync and captions; add `stage.speaking` and `speaking-change` events to the public API in the spec.
4. Interaction with `say_to_agent`: the reply of the target agent is enqueued behind the caller; test the round trip with two agents.
5. Browser verification on a page with two agents (find the existing demo under `examples/` or `pages/`): trigger a broadcast and confirm sequential playback, correct captions, no overlap and no console errors.
6. Update `specs/STAGE_SPEC.md` (move the follow-up into the spec body), the element docs, changelog entry, `npm run build:pages` if a page text changes.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/stage-speech-queue.test.js tests/embodiment-stage.test.js` passes; the queue test failed before the implementation existed.
- [ ] `grep -n "per-stage speaking queue is a follow-up" specs/STAGE_SPEC.md` returns nothing.
- [ ] In a browser with two agents, a broadcast produces two non-overlapping utterances (record timestamps from the `speaking-change` events in the report).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Browser TTS unavailable headless | Test the queue through the injected speak function and verify the wiring through the events; verify audio in a real browser where available |
| No two-agent demo page | Create the smallest demo page under `examples/` and register it in the examples index |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/787-plan-stage-agent-speaking-queue.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `787-plan-stage-agent-speaking-queue.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `specs/STAGE_SPEC.md` (section "Constraints")

~~~~markdown
## Constraints

- **One `WebGLRenderer` per stage.** Never two canvases for this feature - shared context or nothing.
- **Shadow DOM per child stays isolated.** The chat pane of agent A is not reachable from agent B. Cross-agent communication flows exclusively through `stage.broadcast()` and `say_to_agent`.
- **No global registry.** Use the DOM: `element.closest('agent-stage')` is the only discovery mechanism.
- **Voice conflicts:** TTS is per-agent and not serialised across the stage. If two agents speak at the same time, browser TTS will overlap. A per-stage speaking queue is a follow-up.
- **Camera follow:** out of scope. One `OrbitControls` instance is owned by the stage; no agent fights for it.
- **Discovery over the network** (agent A fetching agent B's manifest from another site) is the registry task's job, not this one.
~~~~

