# The NVIDIA AI Infra benchmark play

How to earn a repost or quote from `@NVIDIAAIInfra`, and why we can't run it yet. Written 2026-11-18. Nothing here is posted; posting is owner-gated (CLAUDE.md gate 2). Background: [nvidia-visibility-map.md](./nvidia-visibility-map.md).

## The pattern this copies

On 2026-11-18 `@NVIDIAAIInfra` quote-posted Baseten's engineer (Phil Howes, `@saltyph`) with "Congratulations to the @baseten and @sgl_project teams on pushing low-latency inference forward with NVIDIA Vera Rubin." The original post had four things:

1. **One headline number on named NVIDIA hardware.** "~2,500 tok/s on Vera Rubin, batch size 1, TP4, 1.9ms per step."
2. **A comparison against NVIDIA's previous generation.** "Up to 1.7x faster than our GB300 numbers." That sells the new chip, so NVIDIA's social team has a reason to share it.
3. **A short clip of a real task, not a chart.** A terminal-style card: the model one-shots Tetris, a bar fills, and the footer shows TTFT 0.11s, 2,558 tok/s, 2,725 tokens, 1.18s.
4. **The serving stack named as a partner.** SGLang got tagged along with Baseten, so two accounts had a reason to amplify it.

This matches the 2026-10-29 Mistral pattern in the visibility map: NVIDIA reshares a partner when the partner's news is also NVIDIA's news.

## Our version

The three.ws equivalent is **text in, textured 3D model out, timed on NVIDIA GPUs, with a signed receipt.** We already have every part of this:

- **Hardware worth naming.** Every self-hosted generation lane runs on an NVIDIA L4. The heaviest lane (TRELLIS.2) runs on an RTX PRO 6000 Blackwell. Fleet details: [nvidia-forum-gpu-fleet-post.md](./nvidia-forum-gpu-fleet-post.md).
- **Per-stage GPU timing from the worker itself.** The TRELLIS.2 worker reports `queue_ms` and `gpu_ms`, and `npm run trellis2:benchmark` turns production rows into p50/p90/p99 per lane and per voxel-resolution preset ([scripts/trellis2-benchmark.mjs](../scripts/trellis2-benchmark.mjs)).
- **Proof you don't have to take on trust.** Every 3D Studio run writes an ed25519-signed run receipt with per-stage timings. The Baseten post asks viewers to believe a number. Ours can include a receipt anyone can verify with `node scripts/run-receipt-verify.mjs`.
- **A clip in the same format.** The terminal card maps one to one: prompt line, a bar filling per stage (brief, mesh, geometry check, rig), a footer showing GPU seconds, triangle count and total time, and then the model turning in the viewer.

The angle to pitch: **Blackwell versus L4, on the same prompt, same weights, same receipt format.** "Up to N x faster than our L4 lane" is our version of "1.7x faster than GB300". It sells the new card, which is exactly what `@NVIDIAAIInfra` posts about. Tag `@NVIDIAAIInfra`, `@NVIDIAAIDev` and Microsoft's TRELLIS authors (the model's owners have the same reason to share it that SGLang had).

## Why we can't post it today

Production numbers over the 14 days to 2026-11-18 (`npm run trellis2:benchmark -- --days 14`, 7,166 rows):

| Lane | Jobs | Failure rate | End-to-end p50 | p90 |
|---|---|---|---|---|
| `trellis_selfhost` (L4) | 4,707 | 37% | 176 s | 1,052 s |
| `triposg` (L4) | 1,255 | 56% | 116 s | 262 s |
| `nvidia` (hosted NIM TRELLIS) | 528 | 36% | 2.4 s | 4.2 s |
| `trellis2` (Blackwell) | 4 | 50% | 56 s | 56 s |

The last 48 hours were worse: `trellis_selfhost` failed 98% (457 of 468) and `triposg` and `nvidia` failed 100%. A speed post next to those numbers would invite exactly the replies we don't want.

Root causes found 2026-11-18:

1. **Raw R2 URLs handed to GPU workers (1,187 failures in 3 days).** Objects written during the R2 credential outage live in the GCS fallback, but workers were sent the raw `pub-…r2.dev` URL, which returns 404. Fixed in `4513b59b2` (rewrites bucket URLs to `/cdn/` in every worker request). **Not deployed:** production is still on revision `three-ws-api-00547-gzr` from 2026-11-16.
2. **NVIDIA's hosted TRELLIS is erroring upstream.** Our production key gets HTTP 500 after about 90 s with `nvcf-status: errored`. That is NVIDIA's side and outside our control.
3. **Our poller held each errored NIM job for 45 minutes.** NVCF answers 410 Gone for an errored request, and we treated 410 as still running. Fixed in `e7fbba2e7` (410 now takes the expired-request path: store check, one resubmit, honest failure, lane cooldown). Not deployed either.
4. **The Blackwell lane has 4 rows in 14 days.** Two at 512 voxels finished in 48.2 s of GPU time. The 1024 and 1536 presets have no successful run in the window. Four rows is not a benchmark.

## What has to be true before posting

- Both fixes deployed, and a full day with `trellis_selfhost` failure rate back near its pre-2026-11-15 level (about 18% on 2026-11-11).
- At least 50 successful TRELLIS.2 runs per preset, so p50 and p90 mean something. Run them deliberately on a fixed prompt set rather than waiting for traffic.
- The same prompt set run on the L4 `trellis_selfhost` lane, so the Blackwell-versus-L4 ratio is measured, not asserted.
- One signed receipt from the clip's run, linked in the post.

When that's done, rerun `npm run trellis2:benchmark`, take the numbers straight from `data/trellis2-benchmark.json`, and write the post around the measured ratio. Keep it to the Baseten shape: one sentence with the number and the hardware, one with the comparison, the clip, the receipt link.
