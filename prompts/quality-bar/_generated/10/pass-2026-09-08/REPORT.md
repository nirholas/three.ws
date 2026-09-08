# QB-10 avatar likeness: measured pass, 2026-09-08

What the platform actually produces when someone asks for a 3D person, measured end
to end through the live router on https://three.ws, with the mesh numbers read off
the delivered GLBs rather than eyeballed.

Every image referenced here is in this directory. Every number comes from the
glTF accessors of the exact GLB the router returned.

## The short version

Six synthetic personas, each generated twice through the real `/api/forge`: once on
the Standard tier (which the router maps to self-host TRELLIS) and once on High
(self-host Hunyuan3D). Nothing here is a fork of the pipeline; it is the same HTTP
contract `api/_mcp-studio/forge-client.js` speaks.

Two defects explain nearly every failure, and both are fixed in this pass:

1. **Avatars were generated on the weaker lane.** The avatar skill and the
   standalone MCP server both stated that `text_to_avatar` / `forge_avatar` always
   request the `high` tier, because that is the only tier the router maps to
   Hunyuan3D. `api/_mcp-studio/tools.js` was still sending `standard`. The two
   implementations of the same promise had drifted, and the API-side one was wrong.
2. **The reference image's background was reconstructed as geometry.** Text-to-3D
   skipped the rembg cutout on the reasoning that a synthesized reference is
   "already on a plain background". Plain is not transparent. Four of six figures
   came back standing on a full-footprint slab of their own backdrop, and two were
   swallowed by it entirely.

A third defect is upstream of both and is **not** fixed here: the quality gate that
should have caught a billboard is currently inert in production, because it
delegates to a vision chain that is entirely down. See "The gate that was supposed
to catch this".

## Per-case results

`flatness` = shortest bounding-box extent / longest. A standing person measures
about 0.10 to 0.35. Anything at 0.03 or below is a billboard, not a body.

| Case | Before (Standard / TRELLIS) | After (High / Hunyuan3D) | Verdict |
|---|---|---|---|
| a Athlete | 17,082 tris, flatness 0.297. Figure embedded in a slab of reconstructed backdrop, face smeared to a blank, hands are pink mitten blobs, limbs stretched. | 30,000 tris, flatness 0.260. Recognisable person: correct proportions, readable face, separate shoes, tracksuit reads as fabric. | **Improved.** The one clean result in the set. |
| b Grandmother | 35,648 tris, flatness 0.774. | 30,000 tris, flatness 0.353. Figure itself is good and carries the best hands in the set (open hand, fingers separated). Standing on a large flat plane of reconstructed backdrop; face is smeared. | **Partial.** Body improved, backdrop fused in. |
| c Stylized kid | 17,808 tris, flatness 0.286. | 30,000 tris, flatness 0.154. Reads correctly as a matte vinyl toy and did **not** drift photoreal, which is the child-safety requirement. Standing on a large backdrop plane. | **Partial.** Stylisation held; backdrop fused in. |
| d Businessperson | 35,016 tris, bbox 0.966 x **0.01** x 1, flatness **0.010**. A bare plane. No person. | 30,000 tris, bbox 1.946 x 1.993 x **0.013**, flatness **0.0065**. A bare plane. No person. | **Fails on both lanes.** The reference image was good (full-body, white background); the reconstruction lost the subject entirely. |
| e Construction worker | 19,458 tris, flatness 0.209. | **5,172 tris**, flatness 0.106. A tiny dark blob plus three floating specks. | **Regressed.** Worst result in the set. |
| f Dancer | Generation failed outright (job error). | 10,640 tris, flatness 0.033. Tiny featureless figurine surrounded by floating white shards of backdrop. | **Fails.** |

Hands, counted in the 1536px `-hands` views as the brief requires:

- **a**: both hands present, fused together into a single clasped blob at the chest.
  No separable fingers. The prompt explicitly asked for "hands open, fingers
  separated"; the generator produced clasped fists anyway.
- **b**: best in set. The raised hand shows distinct separated digits.
- **c**: mitten hands, which is correct for the stylised vinyl subject.
- **d, e, f**: no resolvable hands, because there is no resolvable figure.

So: 1 clean, 2 partial, 3 failures. That is the honest state of avatar likeness
today, and it is worse than the previous pass claimed, because the previous pass
never rendered or scored its meshes (its Vertex judge was 403-blocked, so
`audit-data.json` from 2026-09-04 carries GLB URLs with no views and no scores).

## What was fixed in this pass

- `api/_mcp-studio/tools.js`: avatars now request the `high` tier via a named
  `AVATAR_TIER`, matching the skill doc and the MCP server. Props stay on
  `standard`. An explicit `high` already degrades to `standard` on a 402 or submit
  timeout, so the worst case is exactly the previous behaviour.
  Pinned by three new cases in `tests/mcp-studio.test.js`.
- `api/forge.js`, `api/gpt-forge.js`: text-to-3D now gets the same rembg cutout
  that uploaded photos already got (`matte: tier.id !== 'draft'`). Draft stays
  single-view and fast, and a rembg miss still falls back to the original image.
- `api/_lib/vision.js`: two real production bugs in the vision chain (below).
- `api/_lib/render-clip.js`: a multi-megabyte inline GLB was blowing puppeteer's
  default 30s `setContent` cap and reporting a navigation timeout for a page that
  never navigates; it now shares the render's own budget. The renderer also
  reports the page's real fault instead of a bare timeout, and honours a raised
  ceiling on a CPU-only box.

## The gate that was supposed to catch this

`api/_lib/glb-quality.js` does detect a slab: case d scores `planar` comfortably
(flatness 0.0065 against a `sliverFlatness` bar of 0.05). By design that is "a
signal, not a verdict" and it escalates to vision QA, because plates, coins and
posters are legitimately flat. That reasoning is sound and I did not override it.

The problem is what it escalates to. `POST /api/vision` on production today fails
on every rung:

| Rung | Status |
|---|---|
| `nvidia/nemotron-nano-12b-v2-vl` | **410 Gone**, end of life 2026-08-26 |
| `meta/llama-3.2-11b-vision-instruct` | never sent a byte, see below |
| `vertex-gemini` | 403, project billing hold |
| `openai gpt-5.4-nano` | 429, account not active |

The second rung was failing with `The value of "delay" is out of range. It must be
an integer. Received 7924.333333333333`. `laneAttemptTimeout()` divides the
remaining deadline by the number of lanes left and handed the float straight to
`AbortSignal.timeout()`, which rejects a non-integer delay. Every existing test for
that function used numbers that divide evenly, which is exactly how it shipped. So
the chain lost its fallback rung on essentially every request that reached it.

Both are fixed: the float is floored (with a regression test that asserts
integrality across non-divisible budgets), and the retired model is removed rather
than re-probed forever. A 410 now parks a lane for the long window instead of the
45s health window.

`scoreQualityGate()` is deliberately fail-open ("a vision outage returns a passing
verdict, so scoring can never block a delivered model"). That is the right call for
delivery, but combined with a fully dead vision chain it means **the semantic
quality floor for avatars has been returning a pass without looking at anything**.
That is why a bare plane shipped as a finished avatar with no retry.

## Rig and animation

Unchanged and still green, verified this session:

- `node scripts/animation-dignity-sweep.mjs --verbose` → **10/10 conventions animate
  both arms and both legs on both lanes.**
- `npx vitest run tests/glb-canonicalize.test.js tests/animation-retarget.test.js` →
  543 passed.
- `npm run audit:rig-coverage` → 204/204 studio avatars animate, full legs 100%.
  The only unmapped joint names are leaf bones (`HeadTop_End`, fingertip `*4`,
  `LeftToe_End`, eyes), none of which drive a clip.
- Rig-failure degrade path: `tests/forge-avatar-rig-degrade.test.js` passes. A rig
  failure returns the mesh in the same success envelope with an honest message,
  never a T-pose and never an error.

## The /irl moment

`node scripts/irl-realism-check.mjs --only=prod` against the rigged avatars, real
camera AR path (synthetic media device, auto-granted permission):

- **athlete**: `loaded=true avatarRendered=true`, camera stream live
  (`readyState 4`, 640x480), **zero console errors, zero page errors**. Reads as a
  person standing on the floor at human scale with a grounded contact shadow, with
  the Pin here / Add object / Clear controls live.
  See `irl-avatar-athlete-prod.png` and `irl-avatar-ar-athlete-prod.png`.
- **grandmother**: `irl-avatar-grandmother-prod.png`,
  `irl-avatar-ar-grandmother-prod.png`.
- **kid**: `loaded=true avatarRendered=true`, zero console errors, zero page
  errors. The camera stream had not attached by the time of capture on this run
  (`bodyIsAr=false`), so its AR frame shows the placement surface without the video
  behind it; the athlete run is the one that proves the camera path.
  See `irl-avatar-kid-prod.png`, `irl-avatar-ar-kid-prod.png`.

All three loaded and rendered with no console or page errors.

One finding from that run: **`REALISM MODULE ACTIVE: NO`**, `classified=0`. The
skin/eye/hair pass in `src/shared/avatar-material-realism.js` never runs on a
forge-generated avatar. It classifies by mesh and material NAME (Ready Player Me,
Avaturn, VRM conventions), and a Hunyuan3D avatar ships a single generically-named
material covering skin, clothing and shoes together, so nothing matches and the
pass is correctly a no-op rather than guessing.

This is not fixable at the classifier: applying skin shading to one material that
also covers a tracksuit and trainers would make the clothing worse. The real path
is per-region separation, either by having the mesh lane emit named submeshes or by
routing through `workers/segment` before the material pass. Filed here rather than
forced, because a wrong fix degrades every generated avatar.

## Verification

Green, run this session:

- `tests/mcp-studio.test.js` 32 passed (includes the three new tier-routing cases)
- `tests/api/vision.test.js` 29 passed, `tests/api/vision-lane-health.test.js` 12 passed
- `tests/glb-canonicalize.test.js` + `tests/animation-retarget.test.js` 543 passed
- `tests/forge-avatar-rig-degrade.test.js`, `forge-avatar-humanoid`,
  `forge-humanoid`, `api/mcp-studio-safety` 101 passed
- `npm run check:rules -- --paths <every file touched>` clean
- `npm run audit:rig-coverage` clean
- `node scripts/animation-dignity-sweep.mjs` 10/10, re-run AFTER these changes

Whole-suite `vitest run`: **29,103 passed, 2 failed, 155 skipped (3 files red of
2,018)**. None of the three is from this work, and all three are accounted for:

- `tests/audit-guards.test.js`: genuine, and someone else's. `data/guards.json`
  never describes the gate steps `check:skills-seed`, `audit:motion` and
  `audit:tour-global`, and a `check-thing` fixture edits a `public/gone.json` that
  does not exist. Neither that file nor `package.json` is touched by this pass; the
  recent commits there belong to another agent's in-flight guards registration.
- `tests/version-endpoint.test.js`: shared-file race. The case is literally
  "trusts a pre-build snapshot ... then consumes it", and 21 concurrent vitest
  processes from other agents were consuming the same snapshot. Passes in
  isolation, verified.
- `tests/extension-build.test.js`: shared-directory race:
  `ENOENT ... chmod dist/extension/popup.html` on a file the build had just
  written, i.e. a concurrent `vite build` (which runs with `emptyOutDir`) wiped
  `dist/` mid-copy.

`tests/build-asset-paths.test.js` and `tests/server-404-routes.test.js` also failed
in an earlier shared run and both pass in isolation, verified individually.

The Playwright stage was not run to completion: it needs the single shared dev
server on port 3000, which concurrent agents were already using, and starting a
second run kills the first one's server.

## What is still open

The two shipped fixes cannot be demonstrated on new generations from this session:

- The `high` tier requires the platform seed token (`CRON_SECRET`), which is not on
  this machine, and `gcloud` re-auth is expired, so it cannot be read from the
  Cloud Run service. A new high-tier submit answers 402.
- The matte change only takes effect once `api/forge.js` is deployed.

So "6 of 6 cases visibly improved" is **not** verified, and this prompt file stays
on disk. What is proven is the diagnosis: the exact mechanism of each failure, with
per-case bounding boxes, and fixes whose effect is deterministic (the avatar tier is
a routing constant; the matte is a parameter the TRELLIS worker already implements
and unit-tests as `matte_enabled`).

To close it, in order:

1. Deploy `api/forge.js`, `api/gpt-forge.js`, `api/_mcp-studio/tools.js`,
   `api/_lib/vision.js` (owner-gated).
2. Re-run with the seed token:
   `CRON_SECRET=<secret> CHROMIUM_EXECUTABLE_PATH=<chrome> RENDER_CLIP_TIMEOUT_MS=170000 node scripts/avatar-likeness-audit.mjs --out-dir=prompts/quality-bar/_generated/10/pass-<date>`
   and compare flatness per case against the table above. Cases d, e and f are the
   ones that must move.
3. Clear the Vertex billing hold so the quality gate stops fail-open passing.
4. Add matte support to `workers/model-hunyuan3d` (it has none; only
   `workers/model-trellis` implements `matte_enabled`), or matte router-side before
   submit so every lane benefits.
