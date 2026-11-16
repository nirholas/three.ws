# nvidia 13: NVIDIA Run:ai Model Streamer cuts GPU worker cold starts, and the freed min-instances return L4 quota

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3263.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Cold weight loads are the main latency problem on the L4 fleet: our own forum draft on the GPU fleet describes min-instances as a quota decision, and us-central1 L4 quota is fully held by warm instances. NVIDIA's open-source Run:ai Model Streamer loads safetensors weights concurrently from object storage straight to GPU memory. Faster cold starts mean fewer always-on instances, which frees scarce quota for new lanes.

## Step 0: re-derive the current state

    gcloud run services list --project aerial-vehicle-466722-p5 --format="table(metadata.name,region,spec.template.metadata.annotations)" | grep -i -E "model-|minScale"
    sed -n 1,80p api/cron/gpu-keepwarm.js

For each GPU worker, measure cold start from Cloud Logging (instance start to first ready and first request served) over recent scale-ups, and record weight size, format and how weights are loaded (baked into the image, GCS FUSE, Hugging Face download). Read Run:ai Model Streamer's current docs for supported storage backends and frameworks.

## Tasks

1. **Pick** the two or three workers with the worst cold starts that load safetensors or can be converted faithfully.
2. **Adopt the streamer**: weights in a GCS bucket in the worker's region, loaded through the streamer with tuned concurrency; the current loader stays as fallback.
3. **Measure** before and after on real Cloud Run revisions: five forced cold starts each (scale to zero, then first request), reporting time to ready and first result.
4. **Roll out** where it wins, then revisit each worker's min-instances and the keep-warm cron with the new numbers; lower them only where the cold start now meets the lane's latency target, and report the L4 quota freed.
5. **Tests** for the loader selection and fallback in each worker's suite.
6. **Docs**: a write-up `docs/nvidia-runai-model-streamer.md` with the numbers, worker READMEs, changelog entry.

## Definition of done

- [ ] Cold-start table before and after for each chosen worker (five runs each).
- [ ] Revisions with the streamer serve real requests; fallback verified.
- [ ] Min-instance changes, if any, recorded with the quota freed; `npm test` passes; docs landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A worker's weights are not safetensors | Convert with the framework's own tools and verify output parity before using them. |
| A sibling order changed the same worker | Re-read every file, make anchored edits, deploy only your change on top of theirs. |
| The streamer does not support a backend we need | Stage weights on local SSD from GCS at boot and stream from local disk. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
