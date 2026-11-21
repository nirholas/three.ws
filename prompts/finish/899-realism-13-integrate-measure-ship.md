# Integrate the realism campaign, measure it end to end, and hand the owner one ship message

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4899** (`npx vite --port 4899 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Twelve orders built features in parallel, each behind the shared `realism` option, each measured alone. Someone has to check that they work together, that the whole stack fits the performance budget, that likeness actually improved, and that the owner gets one message with every remaining click and command instead of twelve. Run this order last. It is also safe to run early: it reports exactly which orders landed and finishes whatever integration is possible with what is on disk.

## Current state (measured 2026-11-21; re-verify)

- The campaign context is `prompts/finish/_context/realism-00-CONTEXT.md` and the progress log is `prompts/finish/_context/realism-PROGRESS.md`.
- Owner-gated items the campaign can produce: accepting the SAM License on Hugging Face for `facebook/sam-3d-body-dinov3` and `-vith` (account behind secret `hf-token`), `git push threews main`, `npm run deploy:gcp:full`, deploying or pointing production at new workers (`SAM3D_BODY_URL` on the reconstruction service), flipping `RECON_TEMPLATE=mhr` on production `avatar-reconstruction`, making any default-off realism feature default-on, and applying a database migration to production (898).

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
cat prompts/finish/_context/realism-PROGRESS.md 2>/dev/null
ls prompts/finish/ | grep realism
ls src/shared/realism/ src/splat-avatar/ workers/model-sam3d-body/ workers/avatar-reconstruction/templates/ 2>&1
git log --oneline --since=2026-11-21 | grep -i -E "realism|sss|skin|eye|hair|mhr|sam3d|splat" | head -40
HF_TOKEN=$(gcloud secrets versions access latest --secret=hf-token --project aerial-vehicle-466722-p5) curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $HF_TOKEN" https://huggingface.co/api/models/facebook/sam-3d-body-dinov3/tree/main
npm run db:status 2>&1 | tail -10
```

Build a table of all 12 orders: landed (with SHAs), landed with a Status paragraph (with what remains), or not run. For every order that has not run, run it now in this session, one at a time in number order, respecting the prerequisites in the context file, unless it is clearly too large to finish in this session. In that case say which ones were not run and why in the report. This order is still done when every landed feature is integrated and measured.

## Tasks

1. **Combined render check.** On your dev port, load the default avatar, the parametric template, the MHR template (if present) and a splat avatar (if present) with every realism feature on, on WebGL2 and on `?renderer=webgpu`. Look for interaction bugs: chained `onBeforeCompile` hooks from 888, 890, 891 and 892 all active at once, shader cache key collisions, SSS haloing on hair cards, eye shading on the MHR eyes, and realism passes running on splat avatars. Fix every one test-first.
2. **Option plumbing audit:** there is exactly one `resolveRealismOptions`, `realism="off"` disables everything, the comma-list form works, low power disables the expensive features, and the Viewer option and the `<agent-3d>` attribute are both documented in the embed docs. Add an integration test that walks every combination of the four keys on a loaded avatar and checks the materials and passes match.
3. **Performance budget:** run `scripts/viewer-renderer-bench.mjs` for the whole stack on and off, on both renderers, on the default avatar. The whole stack must be at or under 15% frame time on WebGL2. If it is over, profile, fix the most expensive feature (resolution, tap count, half-res mask), and re-measure. Record the final table in `docs/realism/README.md` (the campaign index doc: what each feature does, how to toggle it, its cost, links to each feature doc).
4. **Likeness:** if MHR (894) and shape fit (896) are present, run the likeness eval for wolf3d, parametric, mhr and mhr plus shape fit on the same subjects (staging revisions only) and record the table. State plainly which template the evidence says production should use.
5. **Visual evidence:** a before and after gallery in `docs/realism/README.md` (same avatars, cameras and lights) for each feature and for everything combined.
6. **Full test pass:** `npm test` (or `npm run test:core` plus the Playwright suites the orders added), every worker suite the campaign touched (`workers/avatar-reconstruction`, `workers/model-sam3d-body`), `npm run check:vendored`, `npm run audit:docs` and `npm run check:rules` on every campaign file. Fix what fails, test-first for real bugs.
7. **Docs and changelog:** `docs/realism/README.md` is linked from the viewer docs and `STRUCTURE.md`. Add one changelog entry summarising the campaign's user-visible result (only features that are actually live after the owner ships; mark the rest as staged in the doc, not in the changelog), then `npm run build:pages`.
8. **Owner batch.** Write `prompts/finish/_context/realism-OWNER-ACTIONS.md`: one numbered list, every item with the exact command or click, what it unlocks, and the evidence that it is safe (test and eval numbers). Order the items so each can be done independently where possible. Include only items that are really outstanding, checked live today. Expected items:
   1. Accept the SAM License on huggingface.co for `facebook/sam-3d-body-dinov3` and `facebook/sam-3d-body-vith` while signed in as the account behind secret `hf-token`, then `npm run stage:sam3d-body -- --accept-sam-license` and `gcloud builds submit --config workers/model-sam3d-body/cloudbuild.yaml .` (with `TMPDIR=/home/user/.cache/gcloud-tmp`).
   2. `git push threews main`, then `npm run deploy:gcp:full`.
   3. `gcloud run services update avatar-reconstruction --region us-central1 --update-env-vars RECON_TEMPLATE=mhr,SAM3D_BODY_URL=<url>`, only if the likeness table supports it.
   4. Any realism default flip, and the 898 migration apply (`npm run db:migrate` after `npm run db:status`).
   Drop any item that is already done, and add any item an order's Status paragraph names.

## Definition of done

- [ ] The landed and not-landed table for all 12 orders, with SHAs, is in the report.
- [ ] Combined features render without interaction bugs on both renderers (screenshots in `docs/realism/`). Every bug found has a regression test.
- [ ] Whole-stack frame-time delta is at or under 15% on WebGL2, with the table in `docs/realism/README.md`.
- [ ] The likeness table is recorded (or the order that blocks it is named with its Status).
- [ ] The full test pass is green (outputs in the report).
- [ ] `realism-OWNER-ACTIONS.md` lists only live-verified outstanding items with exact commands.
- [ ] Docs, `STRUCTURE.md`, changelog and `build:pages` done.

## Never blocked

- Orders that have not landed are not a blocker. Run them, or integrate what exists and say what is missing.
- If the GPU bench cannot run headless on this machine, run it in Cloud Build with a GPU and commit the numbers.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/899-realism-13-integrate-measure-ship.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `899-realism-13-integrate-measure-ship.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
