# The GLB editor reaches 1.0: <agent-3d editor> works, every edit survives export, and hosts get DOM events

**Status (2026-11-04):** Implemented and committed in 1fed88375 (export fidelity landed earlier inside 26df3658a). Verified: tests/editor-glb-export.test.js and tests/editor-edit-persistence.test.js pass (14); in a real browser `<agent-3d editor>` docked the editor, the emissive edit, hidden node and replaced texture survived export and reloaded through the viewer loader plugin, and the inspector Replace error and success paths worked. Not done: `npm run build:pages` (would rewrite other sessions' generated files), a full `npx vitest run` baseline comparison, and re-opening the export in the `/viewer` page itself (used the same GLTFLoader plugin in-page instead). Order file kept for those three.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/743-plan-avatar-editor-attribute-and-export-fidelity.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** avatar. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The in-browser GLB editor (`src/editor/`) is the path creators use to tweak materials, node transforms and visibility before publishing an embed. `specs/EDITOR_SPEC.md` lists five "pre-1.0 rough edges" that are all still open, and `specs/EMBED_SPEC.md` documents `<agent-3d editor>` as a working attribute that it is not (`editor` is not in `observedAttributes()`). Two of the five silently lose a creator's work: emissive intensity is shown in the viewport but never recorded, so it vanishes from the exported GLB, and materials that share a name collapse onto the first match on export with no warning. Hidden nodes are exported as scale 0, which destroys any scale edit and is not the standard `KHR_node_visibility`, so round-tripping in other tools breaks. External hosts also cannot observe edits or detect the editor version, and the Texture Inspector is read-only with texture replacement promised on the roadmap. An editor whose export does not match what the user saw is a trust problem on a core creator flow.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/element.js` `observedAttributes()` (around line 723) has no `editor` entry and nothing in `_boot()` mounts the editor. `src/editor/embed-editor.js` exports `mountEmbedEditor(root, opts)` (line 103, callable manually only) and `src/editor/index.js` exports `class Editor` (line 18). `specs/EMBED_SPEC.md` lines 159 and 430 still promise the attribute ("EDITOR_SPEC.md (coming next)").
- `src/editor/material-editor.js` lines 99-105: the `emissiveIntensity` control's `onChange` calls `mat.needsUpdate` and `viewer.invalidate()` but never `record()` (the other bindings call it at lines 91, 97, 108, 133), so `session.materialEdits` never carries it; `snap.emissiveIntensity` exists for reset (line 153).
- `src/editor/glb-export.js` `applyMaterialEdits` (line 49) handles baseColor, opacity, metalness, roughness, emissive, alphaMode, alphaCutoff, doubleSided only, and builds a first-name-wins `byName` Map (lines 52-56; nodes the same at 87-91). `applyTransformAndVisibilityEdits` (line 82) writes `node.setScale([0, 0, 0])` for hidden nodes (lines 106-111).
- No `CustomEvent` is dispatched anywhere in `src/editor/*.js` (`session.onChange()` only); no `data-editor-version` attribute exists. `specs/EDITOR_SPEC.md` line 536 recommends `data-editor-version="agent-editor/0.1"` and an `editor:ready` event, not yet implemented.
- `src/editor/texture-inspector.js` is read-only (`docs/editor.md` line 155).
- No test in `tests/` imports `src/editor/` apart from `tests/manifest-builder-mount.test.js`; `glb-export.js` and `material-editor.js` are untested.
- Libraries already installed: `@gltf-transform/core` ^4.4.0, `@gltf-transform/extensions` ^4.5.1 (use `ALL_EXTENSIONS`), `@gltf-transform/functions`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "observedAttributes" -A30 src/element.js | grep -n "editor" ; echo "exit=$? (1 means editor attr still unwired)"
grep -n "record()" src/editor/material-editor.js
grep -n "emissiveIntensity" src/editor/*.js
grep -n "setScale(\[0" src/editor/glb-export.js
grep -rn "CustomEvent\|dispatchEvent\|data-editor-version" src/editor/ | head
grep -rln "glb-export\|material-editor\|embed-editor" tests | head
grep -n "KHR_node_visibility" -r node_modules/@gltf-transform/extensions/dist/*.d.ts | head -3
grep -c "KHR_node_visibility" node_modules/three/examples/jsm/loaders/GLTFLoader.js
```

Skip any task whose gap no longer exists.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first for each export bug, in a new `tests/editor-glb-export.test.js` (Vitest, Node, no browser, beside the other `tests/*.test.js`): build small GLBs in memory with `@gltf-transform/core` `Document` (two materials sharing the name `Material`, a node with a non-trivial scale, an emissive material), construct a minimal stub `session` exposing `getSourceBuffer()`, `materialEdits`, `transformEdits`, `visibilityEdits`, run `exportEditedGLB`, re-read the bytes with `WebIO`, and assert. Write the failing assertions for emissive intensity round trip, hidden-node fidelity, duplicate-name targeting. Run and confirm each fails for the documented reason before fixing.
2. Emissive intensity: call `record()` for the `emissiveIntensity` binding in `src/editor/material-editor.js`, add `emissiveIntensity` to the stored edit shape in `src/editor/session.js`, and in `applyMaterialEdits` write it with `KHR_materials_emissive_strength` (`doc.createExtension(KHRMaterialsEmissiveStrength)`, `material.setExtension(...).setEmissiveStrength(v)`). When the value is exactly 1, remove the extension rather than writing a no-op. Revert (`clearMaterialEdit`) must clear it too.
3. Visibility: stop zeroing scale. If the installed `@gltf-transform/extensions` ships `KHRNodeVisibility` (Step 0), write `KHR_node_visibility` (`visible: false`) and keep the node's real scale (add it to `ALL_EXTENSIONS` if absent); otherwise write the same extension through `node.setExtension` with a custom `Extension` subclass registered on the `WebIO`. Confirm `three`'s `GLTFLoader` and the loader in `src/viewer.js` / `src/element.js` honour it on re-import; if not, add a small loader plugin in `src/editor/` that sets `object.visible = false`, and use it wherever edited GLBs are re-opened (the viewer and the publish preview). Also write `extras: { threeWsHidden: true }` so downstream tools that ignore the extension can read intent. Add the re-import round trip to the test file.
4. Duplicate names: key edits by a stable identity, not the name. In `src/editor/session.js` record the glTF index (`materialIndex`, `nodeIndex`) captured at `rebuild()` time (use `loader.parser.associations` or traverse `parser.json` `materials[]`/`nodes[]` in file order), and have `glb-export.js` look up by index with name as a fallback for sessions persisted before this change. `src/editor/edit-persistence.js` stores sessions: version the stored shape and migrate on read. When a name still collides and no index exists (legacy name key), apply to all matches, and return `{ bytes, warnings }` from the export, surfacing the warnings in the Editor's download toast and `PublishModal` (plus one `console.warn` with the name), instead of silently patching the first match. Test both the index path and the legacy path.
5. Events and version: in `src/editor/embed-editor.js` set `data-editor-version` to the current spec version string on the mounted root and dispatch `editor:ready` (`{ version }`) at mount. In `src/editor/index.js`, hook `session.onChange()` to dispatch bubbling, composed `CustomEvent`s on the host element: `editor:change` (`{ kind: 'material'|'transform'|'visibility'|'reset', editCount }`), `editor:export` (`{ bytes: byteLength, warnings }`) and `editor:publish` (`{ step }`, mirroring the publish progress events). Document each in the `specs/EMBED_SPEC.md` events table and in `specs/EDITOR_SPEC.md` (replace the "Recommended (not yet implemented)" text at line 536).
6. Wire `<agent-3d editor>`: add `editor` to `observedAttributes()` in `src/element.js` and a boot branch (and `attributeChangedCallback`) that, when the attribute is present, lazy-imports the editor module (code-split, never loaded for plain embeds; lazy-load dat.gui together with it only when `editor` is set and keep the default embed bundle unchanged, checking any bundle-size budget test in `tests/`), constructs the editor against the element's viewer, and passes `src`/`agent-id` through as the source. Toggling the attribute at runtime attaches and `dispose()`s cleanly. Follow `EMBED_SPEC.md` (the editor replaces the live agent chrome); record that decision in one paragraph in the spec. Do not mount in `kiosk` mode. The Copy Embed output must never contain `editor`.
7. Texture replacement: add a "Replace" action to the lightbox in `src/editor/texture-inspector.js` (file input accepting `image/png`, `image/jpeg`, `image/webp`, size cap matching `api/_lib/validate.js` limits). Record the replacement in the session keyed by material identity plus slot (base color, normal, metallic-roughness, occlusion, emissive), preview it live on the Three.js material, and in `glb-export.js` write the new image bytes with `texture.setImage(bytes).setMimeType(...)` on the slot texture (create the texture and texture info if the slot was empty). Revert restores the original. Add export tests for replacing an existing slot and filling an empty one.
8. Docs: update the Known Limitations and roadmap sentence in `docs/editor.md` (texture replacement is no longer "not yet available"), remove each fixed "Pre-1.0 rough edge" from `specs/EDITOR_SPEC.md` (including rough edge #1 in section 1; bump the version string in section 8 and `src/editor/index.js` to `agent-editor/0.2`, keep the runtime version detection accurate), and fix `specs/EMBED_SPEC.md` lines 159 and 430 (the `editor` row in Dev / debug and the Editor mode section: drop "coming next", link EDITOR_SPEC.md). Append a `data/changelog.json` entry and run `npm run build:pages`.
9. Browser verification: `npm run dev`, open a page with `<agent-3d editor src="...">` for a real GLB, change emissive intensity, hide a node, replace a texture, export, and re-open the exported file in `/viewer` to confirm all edits survive. Check no console errors, and that removing the attribute detaches the editor.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/editor-glb-export.test.js` passes with cases for emissive strength, `KHR_node_visibility` round trip with the node's original scale preserved, duplicate material names patched independently, and texture replacement; each was seen failing before its fix.
- [ ] `grep -n "setScale(\[0" src/editor/glb-export.js` returns nothing.
- [ ] `grep -n "'editor'" src/element.js` shows the attribute in `observedAttributes()`; `<agent-3d editor src="...">` renders the editor panels in a real browser with zero console errors.
- [ ] `grep -rn "editor:ready\|editor:change\|data-editor-version" src/editor` shows all implemented, and they are documented in `specs/EDITOR_SPEC.md` and `specs/EMBED_SPEC.md`.
- [ ] In a real browser: edit emissive intensity, download the GLB, re-open it in `/viewer`; the glow matches. Hide a node, export, re-open; it stays hidden and its scale in the file is unchanged.
- [ ] `specs/EDITOR_SPEC.md` has no "Pre-1.0 rough edge", "not yet wired" or "not yet implemented" text left; `docs/editor.md` no longer says texture replacement is "not yet available".
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No fixture GLB for tests | Build one in the test with `@gltf-transform/core` `Document`; no network or binary fixture needed |
| Installed `three` or `@gltf-transform/extensions` lacks `KHR_node_visibility` | Write the extension through a custom gltf-transform `Extension` subclass and add the tiny `GLTFLoader` plugin (apply visibility in the editor's post-load pass if the loader will not); do not fall back to the scale hack. Check for a newer compatible release first |
| Editor depends on dat.gui which `<agent-3d>` deliberately does not load in embed mode | Lazy-load dat.gui together with the editor chunk only when `editor` is set |
| No stable glTF index available from `GLTFLoader` | Compute identity from document order: the loader parses `materials[]` and `nodes[]` in file order, so traverse `parser.json` in the same order and store the index when the session rebuilds |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/743-plan-avatar-editor-attribute-and-export-fidelity.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `743-plan-avatar-editor-attribute-and-export-fidelity.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/editor.md`
- `specs/EDITOR_SPEC.md`
- `specs/EMBED_SPEC.md` (section "Dev / debug")
- `specs/EMBED_SPEC.md` (section "Editor mode")
