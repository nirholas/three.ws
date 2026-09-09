# Generated animation seeding

three.ws generates its own animation clips. A prompt from `data/motion-prompts.json`
goes to our self-hosted text-to-motion GPU worker, the result is measured against a
quality gate, and the keepers are published into the same clip library the curated
Mixamo import already serves.

This document covers what the gate measures and why, because the "why" is the part
that is easy to get catastrophically wrong.

## The pieces

| Piece | What it does |
|---|---|
| `data/motion-prompts.json` | The prompt library: 137 prompts across 10 categories. Data, never a hardcoded list. |
| `workers/model-text2motion/` | The GPU worker. Samples a motion-diffusion model and returns a three.js `AnimationClip` JSON. |
| `api/forge-motion.js` | The public route: `POST` a prompt, poll for a clip. Rate limited per IP. |
| `api/_lib/motion-seed.js` | The prompt loader, the quality gate, the publishing shape, the free-subset rotation. |
| `scripts/gcp/seed-motion.mjs` | The resumable bulk runner. |
| `api/animations/library.js` | Serves the clip manifest that generated clips are merged into. |

Generated clips are named `gen-<prompt id>-<hash>`, so they are distinguishable from
the `mx-` Mixamo import everywhere: in the manifest, the gallery, and any report.

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
low-posture. Converted clips are stamped `userData.basis = "canonical-rest-v1"`
(`CLIP_BASIS`), so `needsRebase()` can tell a converted clip from a legacy one and
nothing is ever rebased twice.

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
touching vertical travel. The library's convention is in-place clips: they play on
an avatar standing where the page put it, and a game engine drives locomotion from
its own character controller.

**Run both before the gate, in this order: rebase, flatten, then close the seam.**
The order is load-bearing. The foot-slide rule divides planted-foot slide by the
stride the clip covers, and a fabricated one-metre stride makes that rule vacuous;
the seam search hunts for the frame whose pose repeats frame 0, which a ramp
guarantees no frame ever does.

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
the last frame has no reason to meet the first. This matters because **41% of the
prompt library (56 of 137) is tagged `loop`**, concentrated exactly where looping
matters: locomotion (16 of 20), dance (10 of 12), idle (10 of 14).

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
# Measure quality without publishing. Needs no credentials.
node scripts/gcp/seed-motion.mjs --count 20 --dry-run

# A real run, where R2 and DATABASE_URL live.
node scripts/gcp/seed-motion.mjs --count 200 --concurrency 6
```

Useful flags: `--categories locomotion,dance` to seed one slice, `--checkpoint PATH`
to keep runs separate, `--price` and `--free-size` to set the listing terms.

**Use the in-process transport for anything bulk.** `/api/forge-motion` is a public
endpoint rate limited per IP: a 40-clip run through it generates two clips and then
takes a 429 with a 49 minute `retry_after`. With `GCP_TEXT2MOTION_URL` set the runner
calls the provider directly and no limiter applies. `--origin` forces the HTTP path,
which is worth doing on a handful of clips to prove the deployed route works.

The run is **resumable**: every prompt's outcome is written to the checkpoint as it
lands, and a re-run skips anything already terminal, so killing the process costs at
most the clips in flight.

The run is **lane-asserted**. `/api/forge-motion` and the provider both return a job
id that names the worker the job was dispatched to, and the runner decodes it and
aborts the entire batch unless the host is our own `model-text2motion` Cloud Run
service. Bulk generation must never fall through to a paid third party.

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

Generated clips are listed in the marketplace under the platform creator (`three`)
and are paid by default. A fixed-size subset is free for one epoch at a time.

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

`GET /api/animations/library` already supports paging (`?limit=`, `?offset=`), and a
paged response is small: 24.6 KB for `?limit=60`. **With no `?limit` it returns the
entire manifest**, which is 1.12 MB uncompressed today (about 100 KB on the wire,
since the CDN serves it brotli-compressed). That un-paged form is the documented
backward-compatible contract, and three consumers still use it:

- `src/animations-gallery.js` (the `/animations` gallery)
- `src/animation-library.js` (pose deep-link lookup by clip name)
- `src/avatar-embed.js` (the embed viewer)

At 5 to 10 times the current library those three each parse 6 to 11 MB of JSON on
load. The gallery is the one to fix first, because it only ever renders a page at a
time and has no reason to hold the whole manifest; the other two look a clip up by
name, so they need either a name-indexed endpoint or a cached shard rather than
simple paging. None of this is urgent at 2,874 clips and all of it bites well before
30,000.

The other list surfaces are already scale-safe and need no change. Measured at
58,544 avatars, each returns a bounded first page even with **no** `?limit` given:

| Endpoint | No limit | `?limit=24` |
|---|---|---|
| `/api/marketplace` | 22.8 KB | 22.8 KB |
| `/api/avatars/public` | 38.3 KB | 38.3 KB |
| `/api/marketplace/animations` | cursor-paged, `limit` ceiling 60 | 
| `/api/animations/library` | **1.12 MB, the whole manifest** | 24.6 KB |

So the clip library is the single unbounded response on the platform, and the fix is
the three consumers above rather than the endpoint, which already pages.
