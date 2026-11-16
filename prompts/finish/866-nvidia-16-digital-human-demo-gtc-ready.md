# nvidia 16: the browser digital human becomes conference-grade: faster, self-healing, with a kiosk mode and a latency HUD

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3266.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The browser Audio2Face demo (`/demos/audio2face`) is our most differentiated NVIDIA story and NVIDIA said Pavilion candidates come from "clear demos of NVIDIA acceleration". A demo that stalls once on a show floor or in a meeting with NVIDIA staff costs more than no demo. This order makes it fast, self-healing and runnable unattended at a booth, with numbers on screen.

## Step 0: re-derive the current state

    wc -l public/demos/audio2face.html src/voice/a2f-player.js api/_lib/a2f-nvidia.js api/a2f.js
    grep -n "function-id\|FUNCTION_ID\|rotate" api/_lib/a2f-nvidia.js | head

Measure from production 20 real round trips: speech end to ASR text, LLM first token, TTS first audio, A2F first frame, total, recording p50 and p95 per stage.

## Tasks

1. **Pipelining**: overlap stages (sentence-level TTS and A2F as LLM tokens stream), keep connections warm, preconnect, and remove any serial waits found in step 0.
2. **Self-healing**: detect the A2F function-id rotation and other stage failures, recover automatically, and fall back per stage (for example browser speech synthesis with viseme lip-sync if Riva is down) with a clear on-screen state.
3. **Kiosk mode** `?kiosk=1`: fullscreen, attract loop, large push-to-talk control, auto-reset after idle, noise-robust mic handling, assets cached by a service worker so a flaky network does not break the page.
4. **Latency HUD** toggle showing per-stage milliseconds live.
5. **Synthetic monitor**: a cron running a real headless round trip hourly against production, alerting on failure or regression past a stated threshold.
6. **Booth runbook** `docs/digital-human-booth.md`, a Playwright script that records a clean 15-second clip for owner posts, tests for the pipelining and fallbacks, changelog entry.

## Definition of done

- [ ] Before and after per-stage p50 and p95 from 20 runs each.
- [ ] Each fallback exercised by forcing its stage to fail on the dev server (evidence per stage).
- [ ] Kiosk mode runs unattended for 30 minutes with auto-resets and no console errors (log).
- [ ] Monitor runs; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No microphone in the headless browser | Feed recorded speech through a fake audio device in Chromium. |
| NVIDIA endpoints rate-limit the monitor | Hourly cadence with backoff; never more often. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
