# Give avatar eyes real depth: iris parallax under the cornea, limbal ring and wet occlusion

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4891** (`npx vite --port 4891 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

People read a face through its eyes first. Flat painted irises are the fastest way to make an avatar look dead. Film and game character shaders use three cheap techniques. The iris is drawn recessed behind a refractive cornea, with parallax that shifts as the view angle changes. A dark limbal ring sits where iris meets sclera. An occlusion and wetness layer shades the eyeball where the lids meet it and adds a moist highlight along the lower lid. None of this needs new geometry.

## Current state (measured 2026-11-21; re-verify)

- `applyEye` in `src/shared/avatar-material-realism.js` sets clearcoat 1 and ior 1.376 on materials that match `EYE_NAME_RE`. There is no parallax, limbal ring or occlusion.
- Eye topology varies by source. wolf3d-style templates use `Wolf3D_Eyes`/`EyeLeft`/`EyeRight` meshes with the iris painted into one texture. The `parametric` template uses ICT-FaceKit eyes. Some generated avatars have no separate eye mesh at all.
- `src/shared/realism/` may already hold `options.js` and `skin-mask.js` (with `isEyeMaterial`) from sibling orders.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/shared/realism/ 2>/dev/null && cat src/shared/realism/*.js
grep -n "EYE_NAME_RE\|applyEye" -A12 src/shared/avatar-material-realism.js | head -40
ls workers/avatar-reconstruction/templates/
node -e "const fs=require('fs');for(const f of ['default','cz','parametric']){const b=fs.readFileSync('workers/avatar-reconstruction/templates/'+f+'.glb');const l=b.readUInt32LE(12);const j=JSON.parse(b.slice(20,20+l));console.log(f,j.meshes.map(m=>m.name).filter(n=>/eye/i.test(n)),(j.materials||[]).map(m=>m.name).filter(n=>/eye/i.test(n)))}"
```

## Tasks

1. **Find the iris in the texture.** For eye meshes whose iris is painted into the base-color texture, find the iris centre and radius in UV space once per texture at load time. Use a small canvas or GPU analysis of the radial colour profile around the mesh's forward-facing UV, and cache the result per texture. Templates three.ws ships (`default`, `cz`, `parametric`) get exact values in a lookup table, measured once and committed with a test. Unit-test the detector against the shipped templates.
2. **Eye shader** in `src/shared/realism/eye-shading.js`, injected only into eye materials. Parallax-offset the iris UVs by the refracted view ray through a cornea of ior 1.376, using a configurable iris depth (default about 2.5 mm at adult scale). Darken a limbal ring band at the iris edge. Keep the sclera's existing albedo, slightly desaturated and veined towards the edges only if the source texture is flat white. Keep a sharp cornea specular from the existing clearcoat. Write it for WebGL2 (`onBeforeCompile`, with a correct `customProgramCacheKey`, chaining any existing callback), with a TSL twin in the WebGPU compat path (minimal hook).
3. **Occlusion and wetness.** Add a lid-contact occlusion term: darken the eyeball near the upper lid using the eye's vertical UV and the blink morph weight where available, so it follows blinks. Add a thin wet highlight on the lower lid line if the face mesh has a usable lid region. Otherwise skip the highlight on that avatar, not everywhere.
4. **Avatars without eye meshes:** detect and leave them unchanged. Never warp a face texture.
5. **Gate and wire:** behind `resolveRealismOptions(...).eyes` (create the shared plumbing if missing), with the hook into the realism pass last.
6. **Measure and document:** run the bench (on and off, WebGL2 and WebGPU, at most a 2% budget share). Take before and after close-ups at three view angles to show the parallax, and record them in `docs/realism/eyes.md` with the technique, the per-template table and the detection fallback.
7. **Docs and changelog**, then `npm run build:pages`.

## Definition of done

- [ ] On the default and parametric templates, rotating the camera visibly shifts the iris under the cornea, and the limbal ring and lid occlusion are visible (three-angle screenshots committed).
- [ ] Blink and look-at animations still work, and the occlusion follows the blink.
- [ ] Avatars without eye meshes and `realism="off"` render unchanged.
- [ ] Iris detector tests pass against all three shipped templates. `tests/avatar-material-realism.test.js` passes unchanged. `npm run test:core` shows no new failures.
- [ ] Works on WebGL2 and WebGPU. Bench delta is at or under 2%, recorded. No console errors or warnings.
- [ ] Docs, changelog and `build:pages` done.

## Never blocked

- If automatic iris detection fails on an avatar, fall back to the measured template table, then to "no parallax, ring only" for that avatar, and log one debug line. Never break the eye.
- If chained `onBeforeCompile` hooks from sibling orders conflict, chain them (wrap the existing hook, combine cache keys).

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/891-realism-05-eye-shading.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `891-realism-05-eye-shading.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
