# Generated animation seeding

three.ws generates its own animation clips. A prompt from `data/motion-prompts.json`
goes to our self-hosted text-to-motion GPU worker, the result is measured against a
quality gate, and the keepers are published into the same bulk clip library
(`GET /api/animations/library`) that the CC0 packs feed.

This document covers what the gate measures and why, because the "why" is the part
that is easy to get catastrophically wrong.

## The pieces

| Piece | What it does |
|---|---|
| `data/motion-prompts.json` | The prompt library: 180 prompts across 10 categories. Data, never a hardcoded list. |
| `workers/model-text2motion/` | The GPU worker. Samples a HumanML3D text-to-motion model and returns a three.js `AnimationClip` JSON. Two backends, chosen per `/infer` request with `model`: `mdm` (default, the one the seed runner and `/api/forge-motion` use, and the source of the Kabsch artifacts described below) and `momask`, loaded lazily on first use. |
| `api/forge-motion.js` | The public route: `POST` a prompt, poll for a clip. Rate limited per IP. |
| `api/_lib/motion-seed.js` | The prompt loader, the rest-shape conversion, the foot-flick and root-travel repairs, the quality gate, the publishing shape, the free-subset rotation. |
| `api/_lib/motion-glb.js` | Bakes a clip onto the platform rig as one portable GLB, the artifact the marketplace sells. |
| `api/_lib/generated-clip-market.js` | The generated collection as a marketplace product line: listing rows, price, and the weekly free rotation. |
| `scripts/gcp/seed-motion.mjs` | The resumable bulk runner: generate, re-derive, publish, list for sale. |
| `api/animations/library.js` | Serves the clip manifest that generated clips are merged into. Drops any entry with no `license`, or whose `source` names Mixamo, before the response serializes (`isPublishable()`). |
| `scripts/cc0-animation-library.mjs` | Builds the rest of the bulk library from CC0 packs, with per-clip provenance in `scripts/cc0-library.config.json`. |

Generated clips are named `gen-<prompt id>-<hash>`, so they are distinguishable from
the other bulk-library clips everywhere: in the manifest, the gallery, and any report.
Every generated entry carries its `source` and `license`, which the gallery shows
on each card. The legacy `mx-` Mixamo import is no longer served: Adobe's terms
allow in-project playback but not redistributing the raw clips, so the publish
phase of `scripts/mixamo-all.mjs` is permanently disabled and the endpoint
filters such entries out. Mixamo-era measurements below are kept as the record of
how the gate was calibrated.

## Format: the names match, the basis did not

A generated clip's track names are a strict **subset** of the library's: the 23
body bones, with no finger tracks and no foreign bone names. An unanimated finger
holds bind pose, which is correct rather than a defect.

Matching names are not a matching format, and this doc said they were until
2026-09-09. A library clip's per-bone quaternion is a local rotation **relative
to the `cz` rig's rest pose**, which is what `forwardKinematicsFrame` composes
against and what `src/animation-retarget.js` builds its bind correction from. The
text2motion lane does not produce that basis: its rotations come out of a Kabsch
fit against the HumanML3D skeleton's own raw offsets
(`workers/model-text2motion/mdm_sampler.py`), where a joint at rest yields the
IDENTITY quaternion. The hook meant to reconcile the two, `smpl_to_clip.py`'s
`rest_offsets`, was never given a value.

The gap is a half turn on the legs. An authored clip carries about 176 degrees on
each upper leg, because `cz` rests with the leg bones pointing up and the clip has
to turn them down; a generated clip carries about 29. Playing one composes the
missing rotation into the legs, and **all 133 clips published before 2026-09-09
play with the feet folded up over the body**: forward kinematics puts the feet at
1.71 m and the head at 1.45 m, against 0.15 m and 1.68 m for an authored clip.

`rebaseToCanonicalRest(clip)` converts a clip out of the generator's basis and
into the library's. It is `bindCorrections` with the source rest set to identity:

    L = Rt * Wt^-1 * Ws * Rs^-1  ->  Rt * Wt^-1     (Ws = Rs = identity)
    R = Ws^-1 * Wt               ->  Wt
    q <- L * q * R

Measured over the whole published set, head-above-feet goes from -0.26 m to
+1.38 m and 127 of 133 clear a 0.6 m upright bar. The six that do not are a
pushup, a squat, a swim stroke, a crouch, a sneak and a meditation, all correctly
low-posture. Clips converted this way were stamped
`userData.basis = "canonical-rest-v1"`. That conversion fixed the legs only; the
next section replaces it, and `CLIP_BASIS` is now `canonical-rest-v2`, so
`needsRebase()` can tell a current clip from a legacy one and nothing is ever
rebased twice.

## The rest shape: arms and head (fixed 2026-09-18)

The conversion above assumed the generator's rest has the same SHAPE as `cz`,
just with identity rotations. It does not, and the legs were the only place
the two agreed. The worker's Kabsch fit measures every joint against
HumanML3D's `paramUtil.t2m_raw_offsets`, which are directions, not a posed
human: the upper arm, forearm and hand hang straight down, the collars point
straight out, and the head sits straight FORWARD of the neck. `cz` rests in a
T-pose with the head above the neck. Rendered on the default rig on
2026-09-18, every generated clip, including all 39 the repair pass had
published, played with the head thrown back about 90 degrees and the arms
raised where they should hang.

`rebaseToCanonicalRest` now aligns the two rest shapes per joint. For joint
`j`, `A_j` carries the `cz` rest directions of `j`'s children onto the source
rest directions of the same children (shortest arc onto the primary child, then
the twist that best places the others). A source world rotation `G_s` maps onto
the target as `G_s * A_j * Wt_j`, which puts every child exactly where the
source put it:

    q_t = (Wt_p^-1 * A_p^-1) * q_s * (A_j * Wt_j)

With every `A` at identity this is exactly the old conversion. A leaf the
22-joint source never measures (hand, head, toe) inherits its parent's `A`, so it
holds its `cz` rest relative to its parent. Converted clips are stamped
`canonical-rest-v2`; a clip stamped with the old `canonical-rest-v1` is carried
back to the source basis and forward again, which is exact because both
conversions are fixed rotations. The offsets were verified by running source
forward kinematics over a live idle take (head above neck, arms hanging, toes
forward) and by rendering baked GLBs of every category in a real browser.

The fix raised the honest accept rate, not just the look: in the old basis the
toe pointed 25 degrees off, which skewed foot contact, and the thrown-back head
and raised hands moved the witness joints the continuity rule watches. Re-gating
the same 882 takes in the new basis took the accept rate from 47% to 71%, and
`frame_discontinuity` rejects from 86 to 10.

The same conversion now runs for on-demand generation: the `/api/forge-motion`
poll returns the converted clip as `clip` next to the raw `clip_url`, and the
Animation Studio plays `clip`. `libraryReadyClip` hands `userData` over as a JSON
string (the basis stamp included), because `AnimationClip.parse()` feeds it to
`JSON.parse()`; a plain object there made every generated clip die client-side
with `"[object Object]" is not valid JSON`.

## Foot flicks: a second Kabsch artifact

A foot has one child in the source skeleton, so its fitted rotation can land on
the other solution for a frame or two, swinging the toe 8.6 cm and back while
the ankle holds still to under half a centimetre. On screen that is a foot
flicking; in the gate it reads as a planted toe skating across the floor.
`despikeFootFlicks` finds excursions of at most three frames where the toe,
measured relative to its own ankle, leaves the line between the good frames on
either side by more than 3 cm, and slerps the foot and toe rotations across them.
It is judged in world space, never on rotations, for the reason given under
"Judge positions" below.

## Root drift: a constant the lane welds onto every clip

The lane's root translation channel carries no prompt signal. Fitting a straight
line to the horizontal root track of all 133 published clips gives 0.2577 m/s
(sd 0.0248) whatever was asked for: emotes fit that line to a residual of
0.0002 m, and idles (0.2502 m/s) drift FASTER than locomotion (0.2841 m/s).

It is a denormalization artifact and it is upstream of us. MDM samples in
HumanML3D's normalized feature space and the worker denormalizes with the dataset
mean and std before `recover_from_ric` integrates the root velocity. Feature 2 is
the root's forward velocity and most of HumanML3D walks, so that feature's dataset
mean is a brisk walk: when the model has no strong locomotion signal it emits a
normalized value near zero, and denormalizing "near zero" yields the dataset's
average walking speed, which integration turns into a straight ramp.

`flattenRootDrift(clip)` fits the horizontal root track by least squares and
subtracts the fitted line, keeping the residual, which is where the real signal
lives (locomotion residual 0.0051 m against an emote's 0.0002 m), and never
touching vertical travel.

## Root travel from foot contact

Flattening is right for a clip that stands still and wrong for one that walks.
The authored library does NOT ship in-place locomotion (an earlier version of
this doc said it did): measured on 2026-09-18, a Mixamo catwalk travels 1.23 m
and a careful walk 1.32 m, with their planted feet sliding 0.09 m and 0.13 m. A
generated walk with its root pinned is a treadmill whose planted foot is dragged
under a body that goes nowhere, and every locomotion prompt in the first batch
failed on exactly that.

`lockRootToContacts` derives the travel from the one place the motion carries it,
the feet: while a foot is planted it should stay put, so the body moves by the
opposite of that foot's hips-relative motion. Gaps (a run's flight phase, a foot
switch) are interpolated, and the velocity is smoothed over a third of a second,
which keeps the gate honest: the root follows the average stride, so a foot that
genuinely skates relative to a steady gait still reads as a skate. The derived
root is only kept when at least 30% of frame pairs have a planted foot and the
net speed reaches 0.2 m/s; below that a standing clip's centimetre of jitter would
be integrated into a fake stride, so the flattened root stands.

**The order is load-bearing: rebase, repair foot flicks, flatten, restore travel,
close the seam, gate.** The foot-slide rule divides planted-foot slide by the
stride the clip covers, so a fabricated stride makes it vacuous; a flick reads as
a skating toe, so it is repaired before contact is measured; and the seam search
hunts for the frame whose pose repeats frame 0, which a ramp guarantees no frame
ever does. `deriveClip` in the runner and `libraryReadyClip` in `motion-seed.js`
both apply this order.

## The gate

Run `gateMotionClip(clip, { expectedDuration })`. It returns
`{ ok, reasons[], metrics }`, and every threshold in `MOTION_GATE` was derived by
measuring a 60-clip sample of the authored Mixamo library, not chosen by taste.

### Check the rest basis, because every other rule cannot

`wrong_rest_basis` is the rule whose absence let an entire inverted library
through. Every other threshold here measures a clip **against itself**, so a clip
expressed in the wrong rest basis is perfectly self-consistent and passes all of
them: continuity, travel, quaternion norms, even foot contact.

It takes two signals together, because neither is safe alone. `maxUprightGap`
(head clearance over the higher foot, at the clip's most upright sampled frame)
under `MIN_UPRIGHT_GAP` is suspicious, but a pushup or a swim stroke is prone by
definition. `legBasisDegrees` (mean angle the upper legs sit from identity) under
`MIN_LEG_BASIS_DEGREES` is suspicious, but one published clip reached 148 degrees.
A clip is rejected only when both agree, which leaves real margin: clips in the
wrong basis peak at 0.435 m of clearance with a median leg angle of 23.6 degrees,
while the same clips rebased clear 0.939 m at p05 and never fall below 74.9
degrees. It flags 111 of the 133 published clips. The deterministic fix is
`rebaseToCanonicalRest` plus the `CLIP_BASIS` stamp; this rule is the net under
it, not the mechanism.

### Judge positions, not rotations

This is the important part.

The sampler routinely emits a **180 degree twist about a bone's own axis which the
child bone immediately cancels**. Measured on the local quaternion tracks that looks
like a catastrophic pop: in one "idle breathing" clip the left shoulder and left
forearm each flipped a half turn on 39 of 119 frames. Measured where it matters, the
hand never moved more than 1.1 cm in a single frame. The flip is a property of the
representation, not of the animation, and it is invisible on a rendered mesh.

A first version of this gate tested adjacent local quaternions and **rejected 100% of
generated clips** while the motion was in fact fine. So the gate runs forward
kinematics over `src/animation-canonical-rest.js` and judges world-space joint
positions, which is what a viewer actually sees:

- **`world_discontinuity`**: the largest single-frame step of any witness joint
  (hands, feet, toes, head, hips), divided by that joint's own 95th-percentile step.
  Dividing by the clip's own scale makes the test speed-independent, so a sprint and
  an idle are held to the same standard. Authored clips score a median of 1.69 and a
  worst case of 5.79 (a heavy push), so the ceiling is **6.5**.
- **`frozen_clip`**: the longest path any witness joint walks, in metres. The
  library's static *pose* assets score 0.00 and its quietest real animation 0.11, so
  the floor is **0.35**.
- **`foot_sliding`**: real foot contact. A foot counts as planted only when it is
  within 6 cm of the clip's own floor level **and** the hips are at least 0.55 m above
  that floor. Without the upright test, floor work (a fall, a crawl, a breakdance
  flair) reads as skating, because the "lower" foot is merely the one that happens to
  be less high. Slide is then scored against the stride the clip actually covers.
- Plus the cheap structural checks: NaN or infinite keyframes, non-monotonic times,
  quaternions off the unit sphere, missing body bones, bones the canonical skeleton
  does not have, frame count, and a duration that does not match what was ordered.

`maxFrameJumpRad` and `totalMotionRad` are still **reported** in `metrics`, because
they are useful for spotting worker regressions. They are deliberately **not gated**.

### Calibration

Against 60 authored library clips the gate accepts 87%. The rejects are all clips
that are legitimately out of spec for *generated* content rather than gate errors:
sliced sub-clips a few frames long, static pose assets with zero motion, and one hit
reaction that genuinely slides. Generated clips are held to a duration we ordered and
motion we asked for, so those rules are correct where they are applied.

Re-run the calibration whenever a threshold changes, and inspect rejected clips before
touching a number. A broken pipeline looks exactly like a strict gate.

## Loop seams

A motion-diffusion sampler does not produce seamless loops. It samples a window, and
the last frame has no reason to meet the first. This matters because **42% of the
prompt library (75 of 180) is tagged `loop`**, concentrated exactly where looping
matters: locomotion (21 of 25), dance (14 of 16), idle (14 of 18).

Measured on real output, a generated walk ends **0.25 m** per joint from where it
started (hips-relative), against **0.000** for the authored library's loops. Published
as-is, every one of those clips would visibly pop once a cycle.

`closeLoopSeam(clip)` fixes it in two steps:

1. **Trim to the cycle.** Search the tail for the frame whose pose is closest to frame
   0 and cut there. For a periodic motion the cycle really is in the clip already. A
   trim is only taken if it beats the untrimmed seam by a clear margin, and never cuts
   more than 35% of the clip.
2. **Blend what is left.** Over the final frames, slerp each rotation onto the value it
   holds at frame 0, so the seam closes exactly. The root's height is matched the same
   way while its horizontal travel is preserved, so a travelling walk still travels.

The blend length is **adaptive**. Blending is tried shortest first (8 frames, then 16,
24, 36, 48) and the first length that closes the seam without costing more continuity
than the gate allows is taken. A short blend keeps the motion crisp; a wide seam needs
a longer one, because spreading a big correction over more frames is exactly what stops
it reading as a pop. A fixed 8-frame blend left a 0.378 m seam on a sneaking walk and
the clip was rejected; at 36 frames the same clip closes to 0.000 and passes.

It **self-verifies**: if every blend length still costs more continuity than the gate
allows and the clip was fine to begin with, the original is returned untouched with a
reason attached, rather than publishing something this made worse.

Measured on seven real clips, seams from 0.029 m to 0.378 m all close to **0.000** and
all seven pass the gate as loops. On one live batch this took the accepted share of
loop prompts from 3 of 6 to 6 of 6.

Seam distance is measured in world space, hips-relative, for the same reason the
continuity test is. Compared on local rotations, a clip whose joints are 2.9 cm apart
reports a **178 degree** seam, because the twist flips described above land in that
comparison too. That reading would have condemned a clip that was already fine.

## Running a batch

```bash
# Generate and gate, staging keepers locally. Publishes nothing.
node scripts/gcp/seed-motion.mjs --limit=20

# The 2026-09-18 run: up to six takes per prompt, stop a prompt at three keepers.
node scripts/gcp/seed-motion.mjs --samples=6 --keep-per-prompt=3 --concurrency=4

# Rebuild the generated manifest from the staged keepers, then list them for sale.
node scripts/gcp/seed-motion.mjs --publish --keep-per-prompt=3
node scripts/gcp/seed-motion.mjs --list --keep-per-prompt=3

# Re-derive every staged clip from its source after the pipeline changes. No GPU.
node scripts/gcp/seed-motion.mjs --regate
```

Useful flags: `--categories=locomotion,dance` to seed one slice, `--limit=N` for a
smoke batch, `--retry-rejects` to re-roll past rejects, `--out=DIR` to keep a run's
staging separate, `--price=<USDC>` to override the listing price, and `--report`
to print the checkpoint's numbers. Staging lives in `animation-sources/.motion-clips/`
(gitignored).

**Use the direct transport for anything bulk.** `/api/forge-motion` is a public
endpoint rate limited per IP: a 40-clip run through it generates two clips and then
takes a 429 with a 49 minute `retry_after`. With `GCP_TEXT2MOTION_URL` and
`GCP_RECONSTRUCTION_KEY` in the environment the runner calls the worker through
the platform's own GCP provider and no limiter applies; both live on the
`three-ws-api` Cloud Run service (`node scripts/read-service-env.mjs '^NAME$' --raw`).
`--origin` forces the HTTP path, which is worth doing on a handful of clips to prove
the deployed route works. Poll misses that land on the other worker instance (task
records are per instance) are retried inside the poll budget, not recorded as
failures.

The run is **resumable**: every prompt's outcome is written to the checkpoint as it
lands, and a re-run skips anything already terminal, so killing the process costs at
most the clips in flight.

The run is **lane-asserted**. `/api/forge-motion` and the provider both return a job
id that names the worker the job was dispatched to, and the runner decodes it
(`assertSelfHostedLane`) and aborts the entire batch unless the host is our own
`model-text2motion` Cloud Run service. Bulk generation must never fall through to a
paid third party.

## Measured 2026-09-18: the generated collection

| | |
|---|---|
| Takes generated | 843 new, on `model-text2motion` only (lane-asserted, zero paid calls) |
| Accepted by the gate | 596 of 843, **70.7%**, plus 33 of the 39 repaired legacy clips |
| Published | **469** (at most three takes per prompt), covering 175 of 180 prompts |
| Library total | 3,343 clips, 469 of them `gen-*` |
| Listed for sale | 469, at 0.01 USDC each, 12 free per week |
| GPU | 3,805 lane-seconds (sum of per-job wall time, about 4.5 s a take) inside 18 minutes of batch wall time on at most two instances |
| Cost | \$0.73 (two instances for the batch window) to \$1.27 (every lane-second billed) at \$1.20/hr, so **\$0.002 to \$0.003 per accepted clip** |

Rejects: 229 foot slide, 11 off the ordered duration, 10 frame discontinuity, 4
open loop seams, 1 implausible root speed. By category the accept rate runs from
emotes, idles and interactions (the easiest for this lane) down to dance and
traversal, where the five prompts with no keeper after six takes all sit
(celebration spin, laugh, running jump, forward roll, crawl).

What the gate cannot judge is whether a clip does what its prompt says. That is a
vision-model question, and the vision lane (Gemini on Vertex) was unavailable
during this run because of a billing hold on the project. A rendered spot check of
one keeper per category on the default rig showed anatomically sound motion
(upright, arms hanging, feet planted) with prompt fidelity that varies, which is
the honest state of a text-to-motion model at this size.

## Repairing the published library

The 133 clips published before 2026-09-09 carry both defects. Repairing them
costs no GPU time, because the motion was already generated and was only ever
written down wrong:

    node scripts/gcp/seed-motion.mjs --repair            # re-derive, re-gate, stage
    node scripts/gcp/seed-motion.mjs --repair --publish  # and rewrite the library

`--repair` reads every generated clip live in the library, rebases it, flattens
the drift, closes the seam on loop prompts, and re-gates the result. Survivors are
staged exactly as a fresh generation would leave them, so the following
`--publish` rewrites the clips and the manifest together and a clip that no longer
passes simply stops being served. Publishing needs the R2 credentials that live on
the `three-ws-api` Cloud Run service (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_DOMAIN`).

The same shared pipeline now backs `--regate`, which re-derives every clip in
the checkpoint from its source with no GPU time: a fresh take from the worker
output it was built from (`clip_source_url`), a repaired clip from its staged
copy, carried back to the source basis first. Names never change, so a following
`--publish` replaces each clip in place and a clip that no longer passes stops
being served.

**Measured 2026-09-09: 39 of 133 survive, 29%.** The 94 drops are 91 for foot
sliding and 7 for frame discontinuity. That number is the first honest accept rate
the generated library has had, and it is far below the "10 of 10" recorded on
2026-09-02, which was measured against drift-inflated clips: the fabricated
one-metre stride made the foot-slide rule vacuous, so the check that now rejects
91 clips could not fire. The authored Mixamo control run through the same gate
still passes 48 of 60 (80%), and its rejects are frozen, too-short and
out-of-duration assets rather than basis or sliding faults, so the gate is
calibrated and it is the lane's output that is failing it.

## Pricing and the rotating free subset

**Shipped 2026-09-18.** `seed-motion.mjs --list` bakes every published keeper and
upserts one `animation_clips` row per clip, owned by the platform account
(`three-ws@users.three.ws.local`, the same account that owns the platform's own
agents) and tagged `generated`. The rows surface in
`GET /api/marketplace/animations` and sell through the existing x402 route,
`GET /api/x402/animation-download?id=<uuid>`. No migration was needed: the
rotation is computed at read time, so the stored price never changes.

- **Price:** the Animation Bazaar's advertised price, 0.01 USDC (10,000 atomic
  units, `X402_PRICE_ANIMATION_DOWNLOAD` overrides it), which is the number the
  route's 402 challenge and `/.well-known/x402.json` already quote. `--price`
  overrides it per run.
- **Free rotation:** a listing counts as generated only when it is owned by the
  platform account AND tagged `generated`, so no creator listing and nothing the
  platform lists by hand is ever given away. The feed reports a rotating listing
  as `free: true` with `free_rotation: { regular_price, until }`, the `?price=`
  filter and the price sorts treat it as free, the marketplace card reads "Free
  this week", and the download route hands it over without payment. If the
  rotation cannot be read, the feed shows stored prices and the download charges
  them: failing closed on a paid product.
- **Keys:** the object store serves its whole bucket on a public domain and every
  clip name is in the free manifest, so each GLB is stored under a random key kept
  in its row, never under the clip name.
- **Idempotent:** a re-run re-bakes in place (purchase and play counts survive),
  numbers repeat takes of one prompt ("Wave Hello (take 2)"), and delists a clip
  that is no longer published rather than deleting its row, so a buyer's SIWX
  re-download grant still resolves.

The policy: generated clips are listed under the platform creator and are paid by
default, and a fixed-size subset is free for one epoch at a time.

The sellable artifact is **not** the clip JSON. That is already public and free,
it drives every avatar on the site, and it is useless outside three.ws. It is the
motion baked onto the platform rig as one portable GLB a buyer can open in
Blender, Unity or Unreal: `bakeMotionGlb` (`api/_lib/motion-glb.js`) writes it by
appending keyframe accessors to the rig's own glTF container, so nothing is
decoded and a meshopt-compressed rig survives untouched. It retargets through
`src/animation-retarget.js` first, and rebases a legacy clip on the way, because
writing library rotations onto a differently-resting rig is what produces the
folded-legs pose described above.

The subset is chosen by hashing each clip name together with the epoch number
(`freeClipNames`). That makes it deterministic, so every server instance agrees
without coordination or a database write; stable for a whole epoch, so a visitor
never watches a price flicker on reload; and evenly spread, because each clip's hash
ordering differs per epoch, so the free slot rotates instead of favouring the same
names. The epoch is one week and the subset is 12 clips (`FREE_ROTATION`).

The subset is computed over the **whole** generated collection rather than the current
batch, so a later batch cannot hand out a second set of free clips.

## Scale: what happens as the library grows

Measured 2026-09-02 against the live site, with 2,874 clips in the library and
58,544 avatars in the catalog.

`GET /api/animations/library` pages with `?limit=` and `?offset=`, and a paged
response is small: 24.6 KB for `?limit=60`. With no `?limit` it returns the entire
manifest, which is 1.14 MB uncompressed at 3,007 clips (about 100 KB on the wire,
since the CDN serves it brotli-compressed). That un-paged form is the documented
backward-compatible contract and it stays, but **nothing three.ws ships asks for it
any more.** Two more query shapes landed on 2026-09-09 so no consumer has to:

| Query | Returns | Size at 3,007 clips | Size at 30,070 |
|---|---|---|---|
| `?name=<clip>` | just the named clips (up to 50 per request) | 365 B | 480 B |
| `?facets=1` | catalog total plus per-category counts, no clips | 541 B | 558 B |
| `?limit=1000&offset=0` | one bounded page | 388 KB | 397 KB |
| (no params) | the whole manifest | 1.14 MB | 11.5 MB |

Both are flat in the catalog size, which is the point.

### What each consumer does now

- `src/animation-library.js` (pose deep-link) and `src/avatar-embed.js` (embed
  viewer) each resolve ONE clip by name. Paging cannot serve them, because neither
  knows which page holds the name, so both used to download the whole manifest for
  a single 3 KB entry: on every embed load carrying `?animation=`. They now ask
  `?name=`, measured in a real browser at 365 B and 474 B against the live catalog,
  a 3,190x smaller response for the same answer.
- `src/animations-gallery.js` (the `/animations` gallery) loads **one page** plus
  `?facets=1` and stops. Further pages are fetched when a reader actually reaches
  the end of the grid. It used to fetch every page on load: 3 requests at 3,007
  clips, 30 at ten times that, paid by every visitor who reads the first screen and
  leaves.
- `packages/vscode-3d/src/animations.js` pages already and is unchanged.

The gallery's totals do not wait for the catalog. `?facets=1` counts it server-side
with the same classifier the gallery uses (`src/animation-categories.js`), so the
hero line and every filter chip read true at first paint and never count upward as
pages arrive.

Searching, filtering by category or re-sorting DOES need every clip, because all
three run client-side over the whole gallery, and a count like "63 of 3,119" has to
mean every match rather than every match among the pages that happen to be loaded.
Those actions drain the remaining pages in the background and the grid refreshes as
they land. Idle browsing, which is the common case, never pays for it. A URL that
arrives already narrowed (`?cat=`, `?q=`, `?sort=`) drains for the same reason, and
so does a `?clip=` deep link whose clip has not been loaded yet: a shared link must
open the clip it names.

### Measured at ten times the catalog

Verified in Chromium against a synthetic 30,070-clip catalog served through the real
endpoint:

| | Before | After |
|---|---|---|
| `/animations` first paint | 30 requests, 11.5 MB | 2 requests, 389 KB |
| Hero and chip counts at first paint | partial, counting up as pages land | exact |
| Scrolling to the end of the grid | already loaded | one 397 KB page per screenful |
| A search across the whole catalog | already loaded | 3.1 s to drain, results stream in |
| Embed resolving one clip by name | 11.5 MB | 480 B |

The remaining trade is deliberate: a deliberate search at 30,000 clips reads the
catalog once, cached by the CDN and the browser, instead of every visitor reading it
once.

The other list surfaces are already scale-safe and need no change. Measured at
68,971 avatars (2026-09-09), each returns a bounded first page even with **no**
`?limit` given:

| Endpoint | No limit | `?limit=24` |
|---|---|---|
| `/api/marketplace` | 22 KB | 22 KB |
| `/api/avatars/public` | 39 KB | 39 KB |
| `/api/marketplace/animations` | cursor-paged, `limit` ceiling 60 | |
| `/api/animations/library` | 1.14 MB, the whole manifest, no first-party caller | 24.6 KB |

`/gallery` pages at `?limit=24` with lazy thumbnails, and `/dashboard/avatars` is
cursor-paged with an IntersectionObserver, both verified live at that catalog size
with no console errors.
