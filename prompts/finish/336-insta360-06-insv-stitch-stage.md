# insta360 06: `pano_stitch`, the stage that turns raw `.insv` and `.insp` files into level equirect video and photos

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C1: you own `pano_stitch/`, its CLI, `stitch.json` and exit codes; the out-of-scope list bans the Insta360 Media SDK and Gyroflow code). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Never contact Insta360 or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Most Insta360 owners have raw `.insv` files on a card, not stitched exports: exporting in Insta360 Studio is slow and many never do it. Accepting the raw file removes the biggest friction in the whole lane. The trailer carries per-unit lens calibration and IMU, so a calibrated stitch plus gyro horizon levelling is achievable with permissive code: the research doc (section 3) found `telemetry-parser` (Apache-2.0 or MIT) for the trailer and IMU, and the MIT `insta360-stitch` and `insv-stitch` projects as references for the lens math. Gyroflow is GPL: read nothing from it into this code.

## Step 0: re-derive the current state

    ls workers/model-pano2splat 2>&1 && find workers/model-pano2splat -maxdepth 2 | head -40
    sed -n 1,400p docs/research/insta360-360-capture-2026-11.md | grep -n "insv\|insp\|trailer\|Mei\|equidistant\|telemetry-parser\|insta360-stitch\|insv-stitch" | head -40
    pip index versions telemetry-parser 2>&1 | head -3
    which ffmpeg ffprobe; ffmpeg -hide_banner -hwaccels

Clone (read-only, into the scratchpad) `telemetry-parser`, `insta360-stitch` and `insv-stitch`, and read their LICENSE files and the parts that decode the Insta360 trailer and the lens model. Record commit SHAs.

## Tasks

1. **Package** `workers/model-pano2splat/pano_stitch/` plus `requirements.d/pano_stitch.txt` and `tests/test_pano_stitch.py`; nothing else in the worker. CLI per contract C1.
2. **Container and layout detection**: open the file with ffprobe; identify the camera model from the trailer (`telemetry-parser` Python bindings, or a direct trailer parser you write from the format documentation and the MIT references, with tests). Handle: X4, X5 and X6 single-file two-track (two square HEVC streams), X3 and ONE X2 split pairs `_00_` and `_10_` (pair them by name and timestamp; contract input accepts two comma-separated paths), side-by-side single-stream older files, and `.insp` (JPEG with both fisheyes side by side plus trailer). An unrecognised model exits 2 with a clear `unsupported_camera` message naming the model string found.
3. **Calibration**: decode the per-unit lens parameters from the trailer (equidistant fisheye on early firmware, Mei unified model on V3, Mei with five radial terms on V6 and X5, per the research notes; confirm each against real files) and the relative rotation between the two lenses. Build per-lens remap tables at the output resolution once per clip (NumPy on CPU, CuPy or PyTorch on GPU when present).
4. **Stitch**: remap both fisheyes into equirect, blend the overlap with a feathered seam (multiband blending if it measurably reduces visible seams on real footage; measure and record), exposure-match the two lenses from the overlap region. Output resolution is the source's native equirect size capped at `--max-width`. Encode with ffmpeg (H.265 10-bit when the source is 10-bit, else H.264; GPU encoder when present) and keep audio. `.insp` writes `equirect.jpg` at quality 95 with the original EXIF time and GPS (when present) copied and GPano XMP added (`ProjectionType=equirectangular`) so every 360 viewer recognises it.
5. **Horizon levelling** `--level-horizon`: integrate IMU (gyro plus accelerometer complementary or Madgwick filter, your own implementation) into per-frame orientation, and counter-rotate each output frame so the horizon stays level and the heading follows the walk smoothly (not locked to north). Time-sync gyro to video using the trailer's timestamps; verify on real footage by measuring horizon tilt on a few frames before and after (vanishing-line estimate) and record the numbers.
6. **Trim** `--trim-start`/`--trim-end` without re-encoding the unused part.
7. **`stitch.json`** exactly per contract C1, `warnings` for anything partial (for example missing IMU means no levelling, with a reason).
8. **Real footage**: gather raw `.insv` and `.insp` samples for as many models as are publicly downloadable under a redistributable license (context file fixture rules; GitHub issues on `telemetry-parser`, GyroView and the stitch projects often attach samples; check each license). Target X3, X4 and X5 at least. Run the stitch locally on CPU and on a GPU Cloud Run Job (throwaway image; 337 owns the production image). Record per model: works or not, resolution, seconds per minute of footage on CPU and GPU, and a seam quality note. View each output in a 360 viewer (the three.ws environment viewer or any equirect player) and look for seams, mismatched exposure, tilt.
9. **Tests**: trailer parsing on committed small trailer fixtures (under 1 MB, license recorded), lens model math (a known calibration maps known directions to known pixels), pairing logic for split pairs, exit codes and stderr JSON, `stitch.json` schema. Package README: supported models table with evidence, licenses of every reference you read, measured speeds.

## Definition of done

- [ ] `python -m pano_stitch` matches contract C1 for `.insv` (both layouts you could source) and `.insp`.
- [ ] Real stitched outputs for at least 2 camera models, inspected, with seam and tilt measurements recorded.
- [ ] Horizon levelling measurably reduces tilt on a handheld clip (numbers in the README).
- [ ] No GPL code read into the implementation; every reference's license recorded.
- [ ] Tests pass; dependencies pinned; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No raw sample for a model | Support what you can prove; list unproven models in the README as "parser ready, unverified on real footage", and add the request for samples to the owner message (owner can drop a file into `gs://three-ws-capture-fixtures/insta360/`). |
| `telemetry-parser` Python bindings lack a field | Parse that record yourself from the documented layout with tests, or contribute nothing upstream (no third-party contact). |
| Trailer calibration format differs from the notes | Real files win; correct the research doc with a small anchored edit and note it in the progress log. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If owner footage is the only gap, leave the file with a dated status line. Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the supported-models table.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message; one-line judgment calls. No trailing questions.
