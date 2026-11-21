# Turn an uploaded full-body splat scan into a rigged, saved, animated three.ws avatar

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

Many sessions may be working in this same worktree at once, including the other `realism-` orders. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Your dev port is **4898** (`npx vite --port 4898 --strictPort`). Edit the hot shared files listed in the context file last, with the smallest possible hook.

## Why this matters

Phone apps (Polycam, Scaniverse, KIRI and Luma, among others) and capture rigs now export Gaussian-splat scans of a person in minutes. A user who uploads their own A-pose scan should leave with a photoreal avatar that animates, attaches to their agent, and embeds anywhere, which no mesh pipeline can match for likeness. Order 897 makes skinned splats play. This order is the creator flow that produces them from a raw scan.

## Prerequisite

Order 897 (`897-realism-11-skinned-splat-runtime.md`): the skinned splat runtime and canonical splat-avatar format in `src/splat-avatar/`. Step 0 checks for it. If it is missing (no `src/splat-avatar/` and no line in `realism-PROGRESS.md`), open that order file and do all of it first, including its close-out, then continue. Never run this order while another session is running 897.

## Current state (measured 2026-11-21; re-verify)

- `@mediapipe/tasks-vision` ^1.2.3 is a dependency (Apache-2.0). The Pose Landmarker gives 33 body landmarks per image. There is no tfjs pose-detection dependency, so do not add one.
- Avatar storage API: `api/avatars/` (`index.js`, `[id].js`, `from-forge.js`, `fork.js`, `layer-upload.js`, `library.js`, `mine.js`, `thumbnail.js`). Records carry a `content_type`. Read how uploads, thumbnails and agent attachment work before adding a type.
- gaussian-vrm's preprocessor (MIT code: `apps/preprocess/preprocess.js`) renders the splat scan from several views, runs pose detection, lifts 2D landmarks to 3D, fits a template skeleton, and binds splats to the template mesh. Its template `sotai.vrm` is not MIT. Use our own canonical template skeleton (the default avatar or the parametric template).
- Selfie reconstruction already has consent, retention and moderation rules. Find them (`grep -rn "consent" api src | head`) and apply the same rules to body scans.

## Step 0: re-derive the current state

```bash
cat prompts/finish/_context/realism-00-CONTEXT.md
ls src/splat-avatar/ && cat src/splat-avatar/README.md; grep -n "897" prompts/finish/_context/realism-PROGRESS.md 2>/dev/null
sed -n 1,120p api/avatars/index.js; sed -n 1,80p api/avatars/layer-upload.js
grep -rn "content_type" api/avatars/*.js | head -20
grep -rn "consent" api src --include=*.js | grep -i -E "selfie|recon|photo" | head
grep -n "tasks-vision" package.json; grep -rln "PoseLandmarker\|FaceLandmarker" src | head
grep -n "\"/splat\"\|avatar-studio\|/create" data/pages.json | head
```

## Tasks

1. **Creator page** `/splat-avatar` (new page, registered in `data/pages.json`, linked from `/splat` and from the avatar creation entry points; find them in `data/pages.json` and the nav). The user uploads a `.ply`, `.spz`, `.splat` or `.sog` full-body scan. The page shows clear capture guidance: A-pose or T-pose, arms away from the body, even light, whole body in frame. It previews the scan in Spark, then walks through orientation (auto-detect up axis and facing, with a manual rotate control), crop (remove floor and background splats with a box and an automatic floor-plane removal), and rigging. Every state is designed: empty (what to scan and how, with app-agnostic instructions), uploading (real progress from the upload stream), processing (step list driven by real step completion), error (file too large, not a person, pose not A or T, too few splats, each with how to fix it), and success.
2. **Auto-rig pipeline** in `src/splat-avatar/rig-from-scan.js`, running in the browser in a Web Worker where it is heavy:
   - Render the cropped scan from 8 or more views with Spark offscreen.
   - Run the MediaPipe Pose Landmarker on each view.
   - Triangulate the landmarks to 3D with the known cameras, using RANSAC-style robustness against bad views.
   - Fit our canonical template skeleton to the 3D joints by scale per bone chain and a global transform, solving rest pose to the scan's A or T pose.
   - Fit the hidden proxy mesh to the scan surface so the binding follows the body (template mesh deformed to the splat centres with a smoothness term).
   - Bind each splat with 897's binding format.
   - Report a per-step quality score (landmark agreement, coverage). Reject scans that fail with a clear reason, never with a silently broken rig.
3. **Save:** add a `splat_avatar` content type to the avatar storage API (`api/avatars/`). The splat payload and binding go to object storage through the existing upload path (`layer-upload.js` pattern, size limits enforced server-side). A thumbnail is generated through `thumbnail.js`. The new avatar appears in "my avatars" (`mine.js`) and can be attached to an agent exactly like a GLB avatar. Add a database migration only if the schema needs one, following the self-unblock playbook's migration rules (`npm run db:status` first, and never apply a migration to production in this order: write it, test it on the isolated DB from memory `isolated-db-live-checks`, and leave the production apply for the owner in 899's batch).
4. **Consent and safety:** before upload, the user confirms that the scan is of themselves, or of someone who consented. Same text and storage of the confirmation as selfie reconstruction. Run the same moderation hook the selfie flow uses on rendered views. Apply the same retention and deletion: deleting the avatar deletes the scan.
5. **Tests:** unit tests for triangulation, skeleton fit and floor removal on a real MIT sample scan (897's fetch script), API tests for the new content type (create, list, attach, delete, size-limit rejection, and auth checks so one user cannot read another's scan), and an end-to-end Playwright run of upload to saved animated avatar on your dev port against the local API.
6. **Docs:** a user guide `docs/splat-avatar-creator.md` (capture tips, supported apps' export settings without endorsing a brand, limitations), an API doc update for the new content type, a `STRUCTURE.md` row, a changelog entry, and `npm run build:pages`.

## Definition of done

- [ ] On your dev port, uploading an MIT sample full-body scan produces a rigged avatar that plays canonical clips, saves to "my avatars" and attaches to an agent (screenshots of each step, network tab showing real API calls succeeding).
- [ ] Every page state (empty, uploading, processing, each error, success) is designed and reachable. Keyboard and phone width work. Hover, focus and active states exist.
- [ ] A non-person scan and a sitting-pose scan are rejected with an actionable message.
- [ ] Unit, API and Playwright tests pass. `npm run test:core` shows no new failures. No console errors or warnings.
- [ ] Consent, moderation, retention and delete paths work and are covered by tests.
- [ ] Any migration is written and verified on the isolated DB, and the production apply is listed for 899. Docs, `pages.json`, `STRUCTURE.md`, changelog, `build:pages` and `audit:docs` done.

## Never blocked

- If MediaPipe Pose struggles on rendered splat views, increase the view count, render at higher resolution with a neutral background, and run on the views with the highest landmark visibility. Do not switch to a non-commercial pose model.
- If object storage is degraded in local dev, use the storage path the other `api/avatars` uploads use in development (read `layer-upload.js`). Never write to a fake store.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Run `npm run check:rules -- --paths <every file you touched>` and fix what it reports.
3. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
4. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/898-realism-12-splat-scan-to-avatar.md`) and append one dated line to `prompts/finish/_context/realism-PROGRESS.md` (create it if missing): the date, `898-realism-12-splat-scan-to-avatar.md`, the commit SHAs, and one sentence on what shipped.
5. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/realism-PROGRESS.md`.
6. Never push or deploy to production unless the owner's message that started this session explicitly told you to. The campaign deploy policy (new unwired workers, staging revisions, verify-only Cloud Build runs) is the only exception. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.
