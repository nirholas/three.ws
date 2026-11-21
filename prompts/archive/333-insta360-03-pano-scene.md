# insta360 03: "Step inside your 360 photo": the `/api/pano-scene` endpoint and the `/pano-scene` page

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3333.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contracts C1 stitch, C2, C4 `pano-scene` row, C5, independence rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, env vars on `three-ws-api`) into ONE message at the end. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

This is the visible half of the depth shell lane: a visitor drops a 360 photo (a stitched JPEG or a raw `.insp` straight off an Insta360 card) and a minute later stands inside it in 3D, with GLB and PLY downloads. The workers (C1 `task:"stitch"` for `.insp`, C2 for depth) are separate orders and may not exist when you run; you build against their contracts and prove your side live.

## Step 0: re-derive the current state

    sed -n 1,200p api/scene-capture.js
    sed -n 1,80p api/scene-upload.js
    ls workers/model-panodepth workers/model-pano2splat 2>&1
    grep -n "GCP_VIDEO2SCENE_URL\|GCP_RECONSTRUCTION_KEY" api/_lib/env.js
    grep -n "createRegenProvider\|supportsMode" api/_providers/gcp.js | head -20
    grep -n "\"/capture\"\|\"/splat\"" vercel.json
    sed -n 1,60p pages/capture.html

Record how scene-capture authenticates, rate-limits, stores jobs (in memory, DB or provider task ids) and reports `unconfigured`. Check whether the two workers exist on disk; if they do, you will also prove against them live in task 7.

## Tasks

1. **Endpoint** `api/pano-scene.js` implementing the C4 `pano-scene` row exactly, structured like [api/scene-capture.js](../../api/scene-capture.js): `requireCreator`, `limits.mcp3dGenerate`, `assertPublicHttpsUrl` on every URL, CORS via `api/_lib/http.js`, 503 `unconfigured` with a visitor `message` and an operator `hint` when `GCP_PANODEPTH_URL` (or, for `.insp`, `GCP_PANO2SPLAT_URL`) is unset. Route registration wherever sibling endpoints register (check `vercel.json` routes and the server's api discovery in step 0).
2. **Pipeline**: `source_kind: "equirect_image"` posts to C2 directly. `source_kind: "insp"` posts to C1 `/infer` with `task:"stitch"`, polls `GET /tasks/{id}` until `equirect_url` appears, then posts that to C2. The job id you return encodes or maps to the worker task ids so `GET ?job=` can report one combined `status`, `stage` and `progress` (stitch counts as the first 20 percent). Persist the mapping so any Cloud Run instance can answer the poll: use the same mechanism scene-capture uses; if that is in-memory only, use a signed, tamper-proof job token (HMAC with an existing server secret, never a new one) carrying the worker task ids and the owner's user id, and check ownership on every poll.
3. **Result**: `result.glb_url`, `result.ply_url`, and `viewer_url` pointing to a real viewer route that opens the GLB (find it: `grep -n "glb\|src=" vercel.json | head`; `/viewer?src=` or equivalent). Copy the worker's 7-day files to R2 under `captures/pano-scene/<user_id>/<job_id>/` before returning success, so links stay valid; reuse the R2 helpers [api/scene-upload.js](../../api/scene-upload.js) uses.
4. **Page** `pages/pano-scene.html` plus `src/pano-scene.js`, registered in `vercel.json` routes and `vite.config.js` inputs the way `/capture` is (hot files, anchored edits, last), and in `data/pages.json`. Flow: drop or pick a file (JPEG, PNG, `.insp`), check 2:1 for images in the browser, upload through the existing `/api/scene-upload` presign path if it accepts images (extend its allowed types with a minimal anchored edit if not), create the job, show staged progress (Upload, Stitch for `.insp`, Depth, Mesh, Done) driven by real `stage` and `progress`, then render the GLB inside the page with the existing viewer component, camera at the origin, look-around with drag, WASD and gyroscope on phones, plus a "step" control that moves a little off-centre to show the depth. Downloads for GLB and PLY. "Open in viewer" link.
5. **Copy and states**: headline "Step inside your 360 photo". Nominative Insta360 mention ("Works with photos from Insta360 X3, X4, X5 and X6, or any 360 camera"). Empty state explains what to upload and how to export a 360 photo. Designed errors: not a 360 photo, file too large, not signed in (sign-in link), lane `unconfigured` ("Photo-to-3D is not switched on yet on this server." no operator hint), worker failure (its `message`, retry button). Skeleton loading. Hover, active, focus states. Mobile layout at 400 px.
6. **Tests** `tests/pano-scene.test.js`: input validation, SSRF rejection, unconfigured response, stitch-then-depth sequencing and combined progress, job token tamper rejection and cross-user rejection. Use local HTTP servers that speak C1 and C2 for the sequencing tests (allowed: context file, "Unit tests may stand in"). Production code calls only real URLs.
7. **Live proof of your side**: run the endpoint against the real R2 bucket and a real 360 photo with a locally reachable C2 implementation if `workers/model-panodepth` exists on disk (run it locally on CPU if it supports that, or point at a Cloud Run Job proof URL if order 332 left one in the progress log). If neither worker exists yet, prove upload, job creation, `unconfigured` behaviour and the viewer rendering of a real GLB you place in R2 yourself from a real reconstruction the repo already serves, and say exactly that in the report; order 347 runs the full chain.
8. Docs: a section in the capture docs (find with `grep -rln "scene-capture" docs | head`), API reference entry, changelog entry.

## Definition of done

- [ ] `api/pano-scene.js` matches contract C4 field for field; tests pass.
- [ ] `/pano-scene` is reachable from navigation (link it from `/capture` and from the tools menu that lists `/capture`), works at 400 px and desktop, every state designed.
- [ ] Live evidence for every piece you could run (task 7), with the honest statement of what waits for the workers.
- [ ] No console errors or warnings from this code. `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Workers not built yet | Expected. Build to contract, test with contract-speaking local servers, prove your side live, note it. |
| Sign-in needed in the browser | `self-unblock-playbook` skill, QA login row. |
| `/api/scene-upload` rejects images | Extend its allowed content types with a minimal anchored edit and a test; do not fork the uploader. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
