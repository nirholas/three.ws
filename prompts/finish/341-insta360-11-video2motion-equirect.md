# insta360 11: video2motion learns 360 video: track the person across the sphere and capture their motion

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C3 is yours: the worker change and the `api/motion-swap.js` passthrough). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Redeploying the video2motion service is an owner step owned by order 347; you prove the change with a Cloud Run Job. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

A 360 camera on a stick never loses the subject: dancers, skaters and athletes stay in frame however they move. Today the pose pipeline sees a squashed equirect frame where the person is distorted near the poles and split at the seam. Reframing the sphere into a perspective view that follows the person, then running the existing pose solver, turns every Insta360 clip of a person into motion capture.

## Step 0: re-derive the current state

    sed -n 1,200p workers/model-video2motion/README.md
    sed -n 1,260p workers/model-video2motion/main.py
    sed -n 1,80p workers/model-video2motion/pose_solver.py
    sed -n 1,200p api/motion-swap.js
    grep -n "projection\|equirect" workers/model-video2motion/*.py api/motion-swap.js
    npm run check:vendored 2>&1 | tail -5

Record the request schema, how frames are decoded, which detector and pose model run (MediaPipe per the header comment), and the result shape.

## Tasks

1. **Request fields** per C3, optional and backwards compatible: default `perspective` keeps today's code path byte-for-byte in behaviour (a regression test proves the same output on a real perspective clip).
2. **Subject acquisition**: with `subject` given, start the track at that direction. Without it, detect people on a few cube-face renders of the first frames (six 90 degree faces, so nobody is lost at the poles or the seam) and pick the largest, most central-in-motion person; record the choice in the result.
3. **Tracking across the sphere**: per frame, render a perspective crop centred on the current subject direction with a FOV that keeps the whole body in frame (adapt FOV from the last bounding box, clamp 50 to 110 degrees), detect the person in the crop, convert the box centre back to yaw and pitch, and smooth with a constant-velocity Kalman filter on the sphere (handle yaw wrap at plus or minus 180). Re-acquire with cube-face detection if lost for more than 10 frames.
4. **Reframe and solve**: render the full reframed perspective video (same frame rate, 1080p) along the smoothed track, feed it to the existing pose pipeline unchanged, and return the existing result plus `reframe_url` (uploaded the same way the worker uploads its other outputs) and `subject_track` (`[{ t, yaw_deg, pitch_deg, fov_deg }]`). The camera's own motion is now in the reframe: compensate root rotation using the known per-frame yaw and pitch so the solved root orientation is in world space, not reframe space; verify on a clip where the subject walks a circle around the camera.
5. **Passthrough**: `api/motion-swap.js` forwards `projection` and `subject` when present, validates ranges, and returns `reframe_url` and `subject_track`. Tests for both.
6. **Real footage**: at least 3 real 360 clips with a person (fixture rules; CC-licensed equirect videos of people walking, dancing or doing sport; one from an Insta360 camera). Run on a GPU Cloud Run Job with an image built from the worker's Dockerfile (throwaway tag, not the production tag). Watch each reframe video and the resulting animation on an avatar in the three.ws viewer; record track loss count, re-acquisitions, and seconds per clip-second.
7. **Tests** (worker `pytest`, extending `test_service.py` and a new `test_equirect.py`): request validation, sphere-to-perspective projection math (known direction lands at the crop centre), yaw wrap smoothing, root rotation compensation on a synthetic-geometry unit case built from real track values, perspective regression. README section with the new fields, measured numbers and limits (one subject; multiple people pick the requested one).

## Definition of done

- [ ] Worker accepts C3 fields; perspective behaviour unchanged (regression test on a real clip passes).
- [ ] Real 360 clips produce reframes that follow the subject and animations that look right on an avatar; measured numbers recorded.
- [ ] `api/motion-swap.js` passes the fields through; tests pass; `npm run check:vendored` and `npm test` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The detector misses people near the poles | Cube-face acquisition in task 2 already covers it; tune and record. |
| GPU quota | Context file region list; the reframe and MediaPipe also run on CPU for correctness, but record GPU timing. |
| No real 360 clip with a person found | Wikimedia Commons equirect videos; search GitHub issues of 360 tools for attached clips with licenses; record sources. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. The service redeploy is the owner's: leave this file in `finish/` with a dated status line ("proven by job <execution>; redeploy waits on 347"). Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the measured numbers.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message; one-line judgment calls. No trailing questions.

Status 2026-11-21: proven by Cloud Run Job execution v2m-equirect-proof-48n24 (europe-west4, L4, 3 real 360 clips, measured numbers in _context/insta360-PROGRESS.md); worker, API passthrough and tests committed; redeploy of the worker and API waits on 347.
