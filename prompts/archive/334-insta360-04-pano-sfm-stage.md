# insta360 04: `pano_sfm`, the stage that turns 360 video or photos into a solved COLMAP camera rig

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](../finish/_context/insta360-00-CONTEXT.md) (contract C1: you own `pano_sfm/` and its CLI, outputs and exit codes; file rules for the shared worker directory). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Camera poses are where 360 splat pipelines win or fail. A 360 walkaround solved as a rigid multi-camera rig (one equirect frame split into N perspective views that share a centre) registers far more reliably than perspective video, because every frame sees every direction. COLMAP 4.2 ships `panorama_sfm.py` and rig-aware global mapping; the research doc (section 4a) ranks this path first. Your output is a standard COLMAP dataset, so the training stage (order 335) and every external tool (gsplat, Brush, nerfstudio) can read it.

## Step 0: re-derive the current state

    ls workers/model-pano2splat 2>&1 && find workers/model-pano2splat -maxdepth 2 | head -40
    sed -n 1,120p docs/research/insta360-360-capture-2026-11.md | grep -n "COLMAP\|panorama_sfm\|rig\|mask" | head -30
    which colmap ffmpeg python3; colmap -h 2>&1 | head -3; python3 -c "import pycolmap; print(pycolmap.__version__)" 2>&1
    nvidia-smi 2>&1 | head -5

Read COLMAP's current `python/examples/panorama_sfm.py` and the rig documentation in the COLMAP repository at the latest 4.x tag, and record the tag and the API you rely on.

## Tasks

1. **Package** `workers/model-pano2splat/pano_sfm/` (create the worker directory if absent; touch nothing outside your package, its tests and `requirements.d/pano_sfm.txt`). CLI exactly as contract C1: `python -m pano_sfm --input ... --out ... [flags]`, JSON-lines progress on stdout, exit codes 0 to 4 with the one-line JSON error on stderr.
2. **Frame selection** from video: decode with ffmpeg (hardware-agnostic, H.264 and H.265, 8K), sample at `--fps`, reject blurry frames (variance of Laplacian on a downscaled equirect, threshold relative to the clip's own distribution), and drop near-duplicates when the camera stood still (optical-flow magnitude on a low-res copy). Cap at `--max-frames`, spread evenly over the trimmed range. Folder of equirect photos: use all, sorted by EXIF time then name.
3. **Rig split**: render N perspective views per frame (`--views 8` default: 8 around the horizon at 90 degree FOV with overlap; 12 adds 4 tilted up; 14 adds up and down), with exact pinhole intrinsics written per camera, images named per contract. Build the COLMAP rig config so all views of one frame share one rig pose with known relative rotations. Use `pycolmap` APIs where they exist; shell out to the `colmap` binary only where they do not.
4. **Masks**: `--mask-operator` removes the person holding the camera: a commercially licensed person segmenter (check the license on the day; YOLO-family weights under AGPL are not allowed, prefer an Apache or MIT model, for example a torchvision Mask R-CNN or DeepLabV3 checkpoint under BSD), applied to the downward and nadir views where the operator always is, plus the selfie-stick region at the nadir. `--mask-sky` removes sky (it has no stable features and spawns floaters in training). Masks are written per contract and passed to feature extraction.
5. **Solve**: feature extraction (SIFT, GPU when present), sequential matching with loop detection for video and exhaustive or vocab-tree matching for photo sets, then the rig-aware global mapper (COLMAP 4.2 GLOMAP integration) with a fallback to the incremental mapper when the global one registers under 60 percent. Write `sparse/0` and `sfm.json` per contract. Registration below 0.6 exits 4 with `{ "error": "too_few_registered", "message": "We couldn't work out where the camera was in enough of this video. Walk slower, keep the camera on a stick above your head, and avoid blank walls." }`.
6. **Gravity**: if `stitch.json` from `pano_stitch` sits next to the input and says `horizon_leveled`, keep the up axis; otherwise estimate it from the vertical vanishing direction and align the model so +Y is up (the splat stage and the viewer assume it).
7. **Measure on real footage**: at least 3 real 360 walkaround videos (fixture rules in the context file; one indoor, one outdoor, one from an Insta360 camera) and one set of 20 or more equirect photos. Run on a real GPU (Cloud Run Job per the context file, using a throwaway image that installs COLMAP 4.2 and your package; order 337 builds the production image) and on CPU locally if feasible. Record registration ratio, mean reprojection error, point count and wall time for each, in `workers/model-pano2splat/pano_sfm/README.md`.
8. **Tests** (`pytest` under `workers/model-pano2splat/tests/test_pano_sfm.py`): CLI argument contract, exit codes and stderr JSON shape, rig split geometry (a known 3D point projects consistently into overlapping views), blur and duplicate rejection on real frames from your fixtures (small frames committed only if under 1 MB total and licensed), COLMAP output readable by `pycolmap.Reconstruction`.

## Definition of done

- [ ] `python -m pano_sfm` matches contract C1 (flags, outputs, exit codes, progress lines).
- [ ] Measured results on 3 or more real videos and 1 photo set, with registration ratio at or above 0.9 on at least two of them; the table is in the package README and the progress log.
- [ ] Output `sparse/0` loads in `pycolmap` and in the COLMAP GUI or `colmap model_analyzer` without errors.
- [ ] Tests pass; dependencies pinned in `requirements.d/pano_sfm.txt`; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| COLMAP 4.2 not installable locally | Build or run it in the Cloud Run Job image (official COLMAP Docker image as a base layer, or build from source in Cloud Build). |
| Global mapper fails on a clip | The incremental fallback in task 5; record which mapper solved each clip. |
| A segmentation model's license is unclear | Pick another with a clear permissive license; record it. |
| No GPU quota in the first region | Context file region list; a CPU run with fewer frames still proves correctness, but the GPU timing must be measured too. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. Append to [_context/insta360-PROGRESS.md](../finish/_context/insta360-PROGRESS.md) with the registration table.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; one-line judgment calls. No trailing questions.
