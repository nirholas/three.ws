# microsoft 20: the TRELLIS.2 lab, a public page that shows Microsoft Research's 3D model at full depth on our GPUs

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3120.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

TRELLIS.2 (Microsoft Research, MIT license) is the production image-to-3D lane on our GCP GPU workers, but users only see it as one option in the forge. Researchers, Microsoft people and 3D artists judge a platform by whether it exposes a model properly: its parameters, its real speed on real hardware, and honest comparisons. A lab page that does this is the most credible partnership surface there is, because it is built from our production numbers rather than claims, and it credits Microsoft Research correctly.

## Step 0: re-derive the current state

    ls workers/model-trellis2; sed -n 1,120p workers/model-trellis2/README.md
    grep -rn -i "trellis" api/_lib/*.js api/forge*.js 2>/dev/null | head -30
    sed -n 1,80p docs/ops/gcp-model-workers.md
    grep -rln -i "forge_creations" api/_lib/migrations | head -3
    curl -s https://three.ws/api/forge/lanes 2>/dev/null | head -c 1200

Read the worker's request schema to find every parameter TRELLIS.2 accepts that the forge UI hides (seeds, sampler steps and guidance per stage, texture size, decimation target, output formats). Read the TRELLIS.2 repository README and paper for the official names and the citation block. Find where `forge_creations` records lane, timings and status.

## Tasks

1. **Benchmark from production.** A script `scripts/trellis2-benchmark.mjs` that reads real `forge_creations` rows (read-only) and computes per-lane p50, p90 and p99 end-to-end time, queue time, GPU time, failure rate and output size over the last 30 days, and writes `data/trellis2-benchmark.json` with the query window and row counts. Never estimate; if a field is not recorded, report it as not measured.
2. **Lab page** at `/lab/trellis2`: upload or pick an image, every parameter from step 0 with sensible defaults and plain-language help, real generation through the existing authenticated or free lane with honest queue status, the resulting GLB in the viewer with wireframe, texture and normal views, and download. Parameter presets ("fast draft", "balanced", "maximum detail") whose speed claims come from the benchmark.
3. **Compare.** Run the same input on two lanes side by side (TRELLIS.2 and any other production lane), each with its measured time and mesh statistics (triangles, texture resolution, file size). Shareable compare URL.
4. **Credit and context.** A section crediting Microsoft Research with the paper citation, license, repository link and a short description of how we run it (GPU type, region, container), using the approved partnership wording only.
5. **Wiring.** `data/pages.json`, nav entry from the forge, sitemap, OG image, `docs/trellis2-lab.md`, link from docs/microsoft.md, STRUCTURE.md row, changelog entry. The benchmark script is rerunnable and documented.

## Definition of done

- [ ] `data/trellis2-benchmark.json` generated from real production rows (row counts and window in the report).
- [ ] A real generation with non-default parameters runs from the lab page on port 3120 and returns a GLB (job id in the report).
- [ ] The compare view shows two real results with measured stats.
- [ ] Hover, focus, active, loading, empty and error states verified in a browser; no console errors; `npm test` passes; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A parameter is not passed through by the API | Pass it through with validation and tests; clamp to the worker's documented range. |
| Production database read access | `npm run db:status` shows how the repo connects; use a read-only query. |
| Lane queued or cold | Show the honest queue state; never fake progress; wait for the real result. |
| Paper citation format unclear | Copy the BibTeX from the official repository verbatim. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
