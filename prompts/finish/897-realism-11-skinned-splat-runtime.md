# Play animated, skinned Gaussian-splat avatars on our Spark renderer with our own animation clips

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4897** (`npx vite --port 4897 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

A Gaussian-splat scan of a real person is the most photoreal avatar representation a browser can render in real time. It captures skin, hair, cloth and lighting that no hand-built mesh matches. Static splats are already supported on three.ws (`/splat`, Spark). The missing piece is motion: binding each splat to the bones of a humanoid skeleton so the scan walks, waves and talks with the same canonical clips every other avatar uses. gaussian-vrm (MIT) shows how: each splat follows the skinning of its nearest template-mesh triangle. This order brings that to Spark, the splat library three.ws already ships. It does not add a second splat library.

## Current state (measured 2026-11-21; re-verify)

- `src/splat-stage.js` renders splats with Spark (`@sparkjsdev/spark` ^2.3.1, MIT). The page is `/splat` (`pages/splat.html`) and the doc is `docs/splat.md`.
- gaussian-vrm (`naruya/gaussian-vrm`, MIT code) renders `.gvrm` files with the mkkellogg `gaussian-splats-3d` library and binds splats to a VRM skeleton. Its `assets/` directory (including `sotai.vrm`) is NOT MIT and must never be copied. Its Google Drive sample avatars are MIT and may be used for testing (record which ones and their licence statement).
- `@pixiv/three-vrm` ^3.5.5 is already a dependency. `src/animation-manager.js` plays the canonical clips and `src/glb-canonicalize.js` maps bone names.
- Unverified on 2026-11-21: whether Spark 2.x already exposes splat skinning (look for `SplatSkinning`, `SplatMesh` skinning or bone options, or a dynamic per-splat transform API). If it does, use it rather than writing your own.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
grep -n "\"version\"" node_modules/@sparkjsdev/spark/package.json
grep -rln -i "skin\|bone" node_modules/@sparkjsdev/spark/dist 2>/dev/null | head; ls node_modules/@sparkjsdev/spark/dist | head -30
grep -o "class [A-Za-z]*Skin[A-Za-z]*\|SplatSkinning[A-Za-z]*" -r node_modules/@sparkjsdev/spark/dist | sort -u | head
sed -n 1,120p src/splat-stage.js; cat docs/splat.md | head -80
gh api repos/naruya/gaussian-vrm/contents --jq '.[].name'; gh api repos/naruya/gaussian-vrm/license --jq '.license.spdx_id'
sed -n 1,80p src/animation-manager.js
grep -rn "splat" src/element.js src/viewer.js | head
```

## Tasks

1. **Pick the binding mechanism by evidence.** If Spark has native skinning, document its API and use it. If not, implement GPU skinning for Spark splats. Each splat carries up to four bone indices and weights (or a triangle index plus barycentric coordinates on a hidden skinned proxy mesh, which is gaussian-vrm's approach). A per-frame pass (Spark's dynamic splat-edit or modifier hook, or a custom shader stage) transforms each splat's centre and covariance (rotate the covariance by the blended bone rotation, never only the position). Measure both binding styles on one avatar and keep the one that looks right at the elbows and shoulders.
2. **Format.** Support `.gvrm` input, by reading its spec in the MIT code and writing a clean-room loader. Also define our own canonical format, a glTF-adjacent container: a splat payload (`.spz` or `.sog`, whatever Spark loads best) plus a skinned proxy GLB with canonical bone names plus per-splat binding data. Document it in `docs/splat-avatars.md` with a version field. The loader is `src/splat-avatar/` (new directory, owned by this order), with a `README.md`.
3. **Animation:** retarget the bound skeleton onto the canonical rig through `glb-canonicalize.js` so `animation-manager.js` clips (idle, walk, wave, talk) play unchanged. If the source avatar has face blendshapes or a jaw bone, drive the jaw from visemes for lipsync. If not, document that splat avatars get jaw-only speech.
4. **Viewer and embed:** the Viewer loads a splat avatar the same way it loads a GLB avatar (URL or content type detection). `<agent-3d src="...splat avatar...">` works with the same attributes (animation, autoplay, camera). This touches `src/viewer.js` and `src/element.js`, both hot, so add a minimal hook last. The realism material passes (888 to 892) must skip splat avatars, which have no mesh materials, without errors.
5. **Performance:** measure frame time on a mid-range laptop profile (the bench script, or Chrome performance traces) for a 300k-splat avatar while animating. Add a LOD or splat-count cap for `viewerLooksLowPower()`. Record the numbers in the doc.
6. **Test assets:** download one or two MIT Google Drive sample avatars into a gitignored cache with a fetch script that records their source and licence. Commit them to the repo (or to the existing CDN asset bucket through the repo's asset-upload convention) only if the licence statement explicitly allows redistribution. Never commit `assets/` content from the gaussian-vrm repo.
7. **Tests:** unit tests for the loader (format parsing on a real sample file), binding maths (covariance transform against a reference rotation computed independently), and the retarget mapping. Add a Playwright check that a splat avatar loads in the viewer and the animation advances (bone transform changes between frames) with no console errors.
8. **Docs:** `docs/splat-avatars.md` (format, loader, limitations, licence notes), update `docs/splat.md`, `src/splat-avatar/README.md`, a `STRUCTURE.md` row (last), `docs/realism/licences.md` (create it if 887 has not), and a changelog entry. Then `npm run build:pages`.

## Definition of done

- [ ] On your dev port, an MIT sample splat avatar plays idle, walk and wave from our canonical clip library, with correct elbow and shoulder deformation (screenshots and a short description of a recorded clip in the doc).
- [ ] `<agent-3d>` renders the same avatar with an animation attribute (screenshot).
- [ ] Spark is the only splat renderer in `package.json` (no `gaussian-splats-3d` added). Nothing from gaussian-vrm `assets/` is in the repo (`git ls-files | grep -i sotai` is empty).
- [ ] Unit tests and the Playwright check pass. `npm run test:core` shows no new failures. No console errors or warnings.
- [ ] Frame-time numbers and the low-power cap are recorded in the doc.
- [ ] Docs, README, `STRUCTURE.md`, changelog, `npm run build:pages` and `npm run audit:docs` done.

## Never blocked

- If Spark exposes no per-frame splat modification hook, use its shader-injection or dyno system (check the Spark docs at sparkjs.dev and the package's type definitions). If even that is missing, render the bound splats through a custom `ShaderMaterial` over Spark's packed splat textures. Never switch libraries.
- If the Google Drive samples are unreachable from this machine, create a test splat avatar by scanning-free means: render the default GLB avatar from 100+ views in headless three.js and fit splats with an open, commercially clean trainer runnable in Cloud Build (check the licence first). The result is real splat data of our own avatar.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/897-realism-11-skinned-splat-runtime.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `897-realism-11-skinned-splat-runtime.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
