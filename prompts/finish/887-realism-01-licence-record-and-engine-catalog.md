# Record the verified licences for MHR, SAM 3D Body and gaussian-vrm, correct the October note, and list them on /avatar-engines

## How to run

Paste this whole file into a fresh Claude Code chat opened at `/home/user/three.ws`. It is self-contained: it needs no other chat and no input from the owner until the final report. If it names a prerequisite order that has not landed yet, this same session does that order first (its file says how), so nothing ever waits on another session. Read `prompts/finish/_context/realism-00-CONTEXT.md` (the campaign facts, licence table, shared realism option, hot files and deploy policy) before Step 0.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Licences are a hard gate: only what the licence table in the context file allows ships. Never vendor FLAME, BFM, SMPL, SMPL-X, MANO or anything trained on them.
- Solana is the home chain and leads every design. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`. If a credential, quota, database or test blocker appears, load `.claude/skills/self-unblock-playbook/SKILL.md` before considering any stop.

## Running alongside other sessions

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4887** (`npx vite --port 4887 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Every later `realism-` order relies on one licence decision: MHR (Apache-2.0) and SAM 3D Body (SAM License) are commercially clean, and FLAME and SMPL are not. The repo's own research note says the opposite about MHR. An agent or reviewer who trusts that note will either block good work or approve the wrong model. The public `/avatar-engines` catalog is where three.ws shows which avatar engines it supports or evaluates, and it does not list any of these projects yet.

## Current state (measured 2026-11-21; re-verify)

- `docs/research/oss-landscape-2026-10-notes/3d-generation.md` says sam-3d-body "emits the MHR ... which Meta distributes under the SAM License rather than MPI's registration terms". That is wrong. MHR is Apache-2.0: the GitHub repo licence and the `LICENSE.txt` inside its release zip (198,943,157 bytes) both say so. SAM 3D Body's code and checkpoints are under the SAM License (commercial use allowed worldwide, attribution required).
- `src/avatar-engines-data.js` feeds `/avatar-engines` (`pages/avatar-engines.html`, registered in `data/pages.json`, documented at `/docs/avatar-engines`). Check whether it already has Anny. It has no MHR, SAM 3D Body or gaussian-vrm entry.
- There is no single licence register for avatar-model dependencies.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
grep -n "MHR\|sam-3d-body\|SAM License" docs/research/oss-landscape-2026-10-notes/3d-generation.md
grep -n "anny\|mhr\|sam-3d\|gaussian-vrm\|gvrm" -i src/avatar-engines-data.js
sed -n 1,80p src/avatar-engines-data.js
ls docs | grep -i -E "licen|realism"; ls docs/realism 2>/dev/null
curl -sL https://raw.githubusercontent.com/facebookresearch/MHR/main/LICENSE | head -5
curl -sL https://raw.githubusercontent.com/facebookresearch/sam-3d-body/main/LICENSE | head -20
curl -sL https://raw.githubusercontent.com/naruya/gaussian-vrm/main/LICENSE | head -5
curl -s https://api.github.com/repos/naruya/gaussian-vrm/contents/assets | head -40
```

Read the upstream licence files yourself. Do not copy the context file's claims without checking them. If any licence has changed since 2026-11-21, record the new terms, and say in the report which later orders that change affects.

## Tasks

1. **Correct the October note.** Edit the MHR sentence in `docs/research/oss-landscape-2026-10-notes/3d-generation.md` so it states the real split: MHR model and weights are Apache-2.0, SAM 3D Body code and checkpoints are under the SAM License. Add a dated "Corrected 2026-11-21" line that links the evidence (the upstream LICENSE URLs). Search the rest of `docs/` and `prompts/` for the same wrong claim (`grep -rn "SAM License" docs prompts | grep -i mhr`) and fix every hit.
2. **Write the realism licence register** at `docs/realism/licences.md`. It needs one row per project in the context file's licence table: upstream URL, licence, exact file the licence was read from, date verified, what three.ws uses it for, attribution text required, and whether any part is excluded (gaussian-vrm `assets/`, the MHR to SMPL converter). Then add a banned list (FLAME, BFM, SMPL family, MANO, STAR) with one line on why each is banned (non-commercial or registration-gated licence). Add a short "how to add a model" checklist: read the LICENSE in the release artifact itself, not only the repo; check the weights separately from the code; check every transitive model download.
3. **Add catalog entries** to `src/avatar-engines-data.js` for MHR, SAM 3D Body and gaussian-vrm, and add Anny if it is missing. Match the existing entry shape exactly (read three existing entries first). Each entry states honestly what three.ws does with the engine today. If the wiring orders (893 to 898) have not landed, the status says "evaluating" or the closest existing status value. Never claim an integration that is not on disk. Link each entry to `docs/realism/licences.md` where the schema allows a docs link.
4. **Check the page renders** the new entries at phone and desktop width on your dev port: filters, search and cards work, with no console errors. If the catalog has a test (`grep -rln avatar-engines tests`), extend it to cover the new entries.
5. **Docs wiring:** link `docs/realism/licences.md` from `docs/avatar-engines*.md` (or wherever `/docs/avatar-engines` is sourced) and from `docs/research/` next to the corrected note. Add a `data/changelog.json` entry ("avatar engines catalog now lists MHR, SAM 3D Body and gaussian-vrm with verified licences"), then run `npm run build:pages`. Run `npm run audit:docs`.

## Definition of done

- [ ] The wrong MHR claim is gone from every file in `docs/` and `prompts/` (grep output shows zero hits), with a dated correction line.
- [ ] `docs/realism/licences.md` exists with every licence read from upstream today (the URLs are in the file).
- [ ] `/avatar-engines` shows the new entries on your dev port with no console errors (screenshot or Playwright output described in the report). Statuses match what is actually on disk.
- [ ] Catalog tests (existing or new) pass. `npm run test:core` (or the closest suite named in `package.json`) shows no new failures.
- [ ] Changelog entry added and `npm run build:pages` and `npm run audit:docs` pass.

## Never blocked

- GitHub raw is rate limited: use `gh api repos/<owner>/<repo>/license` or the release zip's `LICENSE.txt`.
- If the catalog schema has no field for licence or docs link, put the licence in the existing description text rather than changing the schema. Change the schema only if every consumer of `avatar-engines-data.js` (grep for imports) is updated in the same commit.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/887-realism-01-licence-record-and-engine-catalog.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `887-realism-01-licence-record-and-engine-catalog.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
