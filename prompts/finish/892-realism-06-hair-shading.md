# Give card hair anisotropic highlights and order-independent cutout transparency

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4892** (`npx vite --port 4892 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Hair on real-time avatars is made of alpha-textured cards. Two things make it look fake. First, the highlight is a round blob instead of the stretched, coloured double highlight real hair has (the Kajiya-Kay and Marschner models: a primary white shift and a secondary tinted shift along the strand tangent). Second, the transparency is wrong: hard alpha-test edges look jagged, while alpha blending sorts wrongly and flickers. The anisotropic highlight plus alpha-to-coverage (or dithered alpha with temporal smoothing) is the standard fix and works on any card hair. No strand-generation model is commercially clean today, so better shading is the realistic win.

## Current state (measured 2026-11-21; re-verify)

- `applyHair` in `src/shared/avatar-material-realism.js` adds sheen and sets `alphaTest 0.35` on materials matching `HAIR_NAME_RE`.
- `MeshPhysicalMaterial` in three r187 has `anisotropy`, `anisotropyRotation` and `anisotropyMap`. Check whether the installed version also has an anisotropy direction source suitable for hair (tangent attribute versus UV direction).
- The cinematic pipeline uses MSAA (`multisampling` 4, or 2 on low power), so alpha-to-coverage is available on WebGL2 whenever MSAA is on.
- `src/avatar-wardrobe.js` treats hair as a tintable slot (per-slot colour presets), so tint must keep working.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/shared/realism/ 2>/dev/null && cat src/shared/realism/*.js
grep -n "HAIR_NAME_RE\|applyHair" -A14 src/shared/avatar-material-realism.js | head -40
grep -n "hair" src/avatar-wardrobe.js | head -20
grep -n "anisotropy" node_modules/three/src/materials/MeshPhysicalMaterial.js | head
grep -n "multisampling" src/viewer/cinematic.js
```

## Tasks

1. **Strand direction.** Hair cards rarely ship tangents that follow the strand. Work out the strand direction per card: use glTF tangents if present and aligned, otherwise derive it from the UV gradient (cards are usually laid out root to tip along V). Detect per mesh which UV axis runs along the strand, by comparing the alpha texture's directional variance or by majority vote on card geometry. Cache it and unit-test the detector on the hair meshes in the shipped templates and on at least one wardrobe hair item.
2. **Anisotropic shading** in `src/shared/realism/hair-shading.js`. Implement a Kajiya-Kay style dual highlight (primary shifted towards the root and untinted, secondary shifted towards the tip and tinted by the hair albedo) with a jitter or shift map to break up uniformity. On WebGL2, inject into `MeshPhysicalMaterial` with `onBeforeCompile` (chain existing hooks, correct cache key) or use built-in `anisotropy` if it produces the dual highlight convincingly. Pick the one that looks right in the screenshots and say why in the doc. Write a TSL twin for WebGPU (minimal hook in the compat module).
3. **Transparency.** On WebGL2 with MSAA on, enable `alphaToCoverage` and drop the hard alpha test for hair, so edges get soft coverage without sorting. When MSAA is off (low power), use a hashed or dithered alpha that the existing pipeline smooths (check whether a TAA or blur stage exists; if none does, keep alpha test as the low-power fallback). Keep `depthWrite` so hair occludes correctly. On WebGPU, use the equivalent (alpha to coverage on the node material when the pipeline samples more than once).
4. **Tint and wardrobe:** wardrobe hair tint (`src/avatar-wardrobe.js`) still recolours hair correctly with the new shader, and the secondary highlight picks up the tint. Add a test that sets a tint and checks the uniform.
5. **Gate and wire:** behind `resolveRealismOptions(...).hair` (create the plumbing if missing). The hook goes into the realism pass last.
6. **Measure and document:** run the bench (on and off, WebGL2 and WebGPU, at most a 2% budget share). Take before and after screenshots of three hair styles (short, long, updo if available from templates or wardrobe) under the same light. Write `docs/realism/hair.md` with the technique, direction detection, transparency choices per renderer and power mode, and why strand generation is out of scope.
7. **Docs and changelog**, then `npm run build:pages`.

## Definition of done

- [ ] Hair shows a stretched dual highlight that moves along the strands as the light or camera moves, with soft edges and no sorting flicker while the avatar turns (screenshots plus a recorded turntable description).
- [ ] Wardrobe hair tint still works and the highlights pick up the tint.
- [ ] Low power and `realism="off"` render as before.
- [ ] Direction detector and tint tests pass. `tests/avatar-material-realism.test.js` passes unchanged. `npm run test:core` shows no new failures.
- [ ] Works on WebGL2 and WebGPU. Bench delta is at or under 2%, recorded. No console errors or warnings.
- [ ] Docs, changelog and `build:pages` done.

## Never blocked

- If a hair mesh's strand direction cannot be decided, fall back to isotropic sheen for that mesh only, and log it at debug level.
- If alpha-to-coverage shows banding on a particular GPU, use dithered alpha on that path and document it.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/892-realism-06-hair-shading.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `892-realism-06-hair-shading.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
