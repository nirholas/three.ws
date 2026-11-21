# Add pore-level micro-detail, cavity and specular occlusion to avatar skin

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4890** (`npx vite --port 4890 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Up close, real skin breaks its specular highlight into thousands of tiny glints from pores and fine wrinkles. Generated and stylised avatars mostly ship a smooth normal map at 1K to 2K, so the highlight smears into a wax sheen. Production character pipelines add a tiling micro-detail normal map, blended at a high UV scale and faded with distance, plus cavity and specular occlusion so creases do not glow. It costs a texture fetch and works on every avatar, including ones three.ws did not make.

## Current state (measured 2026-11-21; re-verify)

- `applySkin` in `src/shared/avatar-material-realism.js` sets roughness, sheen and specular intensity only. No detail map or occlusion is applied.
- Avatars come from many sources: Avaturn and wolf3d-style templates, the `parametric` Anny template, Forge and rigged GLBs. Some have no normal map at all. Some have UVs that are not suitable for a uniform tiling scale.
- Order 888 may have created `src/shared/realism/` with `options.js` and `skin-mask.js`.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/shared/realism/ 2>/dev/null && cat src/shared/realism/*.js
sed -n 1,178p src/shared/avatar-material-realism.js
ls public/textures public/assets 2>/dev/null | head -30
grep -rn "detailNormal\|detail_normal\|microNormal" src --include=*.js | head
```

## Tasks

1. **Get a detail texture you can legally ship.** Either generate it procedurally at build time (a script in `scripts/` that writes a seamless tiling pore and fine-wrinkle normal map from layered cellular and fBm noise, committed with its output and a README explaining how to regenerate it), or use a CC0 source whose licence you read today (record the URL and licence in `docs/realism/licences.md`, creating it if order 887 has not). Ship it as KTX2 (BasisU, the repo already loads KTX2 if `grep -rn KTX2Loader src` hits) or WebP, at 512 or 1024 px, tiling. Add a matching tiling cavity or roughness-variation map if it improves the result.
2. **Shader injection** in `src/shared/realism/skin-detail.js`, applied only to skin materials (`skin-mask.js`, created per the context file if missing). On WebGL2, use `onBeforeCompile` on `MeshPhysicalMaterial`. Blend the detail normal with the existing normal using reoriented normal mapping (RNM) or UDN at a configurable UV scale (default tuned so pores are about 1 mm on an adult head). Fade the detail with camera distance, using screen-space derivatives or view depth, so it never aliases at full-body framing. Add specular occlusion from the cavity term and the existing AO map. Set `customProgramCacheKey` correctly so shader variants do not explode.
3. **Bad UVs.** Detect UV density per mesh, using the ratio of UV area to world area computed once at load, and scale the tiling to match. If a mesh's UVs are degenerate, fall back to triplanar sampling for the detail map on that mesh. The UV-density helper gets unit tests.
4. **WebGPU parity:** in `webgpu-material-compat.js` (a hot file, so keep the hook minimal), build the same blend in TSL for converted skin materials. If order 889's SSS node material exists, compose with it rather than replacing it.
5. **Gate and wire:** behind `resolveRealismOptions(...).skinDetail` (create the option plumbing if no sibling has). The hook in `applyAvatarMaterialRealism` or the viewer's realism pass goes last. When off, materials are byte-for-byte what they are today.
6. **Measure:** run the bench on WebGL2 and WebGPU with the feature on and off. The budget share is at most 3% frame time. Record before and after close-up and full-body screenshots in `docs/realism/skin-detail.md` (img under `docs/realism/img/`). The doc covers the technique, scale tuning, licence and regeneration.
7. **Docs and changelog**, then `npm run build:pages`.

## Definition of done

- [ ] A close-up of the default avatar's face on your dev port shows broken-up, pore-scale specular. Full-body framing shows no shimmer or moire (screenshots and a 5 second screen capture description in the report).
- [ ] The detail texture's provenance and licence are recorded, and the generator script regenerates it byte-identically, or the CC0 source is linked.
- [ ] Works on WebGL2 and `?renderer=webgpu`.
- [ ] Off means unchanged: `tests/avatar-material-realism.test.js` passes unchanged, and new tests cover the detail branch and the UV-density helper.
- [ ] Bench delta is at or under 3%, recorded in the doc. No console errors or warnings. `npm run test:core` shows no new failures.
- [ ] Docs, changelog and `build:pages` done.

## Never blocked

- If no CC0 pore map passes the licence check, generate one procedurally. That path needs nothing external.
- If `onBeforeCompile` conflicts with another injection on the same material (888 or 891), chain the callbacks: wrap the existing `onBeforeCompile` and combine the cache keys, never overwrite them.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/890-realism-04-skin-micro-detail.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `890-realism-04-skin-micro-detail.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
