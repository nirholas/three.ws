# nvidia 17: one click turns an agent and a line of text into a shareable talking-avatar video, voiced by NVIDIA Riva and animated by Audio2Face-3D

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3267.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The digital-human stack only lives in a browser tab today. Users and the team both want a clip they can post. A frame-accurate MP4 of an avatar saying a line, with NVIDIA Magpie voice and Audio2Face-3D facial animation, is shareable content that markets three.ws and NVIDIA's stack in every post, and it is the easiest way for anyone to make the 15-second clip the visibility map keeps asking for.

## Step 0: re-derive the current state

    sed -n 1,80p api/_lib/tts-nvidia.js
    grep -n "export" src/voice/a2f-player.js | head
    grep -rn "MediaRecorder\|VideoEncoder\|mp4-muxer" src | head

## Tasks

1. **Render pipeline**: text (or an uploaded recording) to Magpie audio, then A2F blendshape track, then an offline, frame-stepped render of the avatar in three.js (not real-time capture), encoded with WebCodecs and muxed with audio by a maintained open-source muxer. Portrait 1080x1920 and landscape 1920x1080.
2. **Options**: framing presets, background (transparent-look colour, scene, or image), optional burned-in captions from the text, a small three.ws mark.
3. **UI** on the agent page and the avatar studio: "Make a clip" with real progress, preview, download and share, plus loading, error and quota states.
4. **Limits**: duration cap and per-plan quota enforced server-side for the TTS and A2F calls.
5. **Fallback** for browsers without WebCodecs: a server render path on Cloud Run with headless Chromium, or a clear message, decided by measured support.
6. **Tests** for frame timing and audio sync math; browser verification of a real export; docs; changelog entry.

## Definition of done

- [ ] A real clip exported on the dev server in both aspect ratios, lip-sync aligned within one frame (measured, file paths).
- [ ] Quota and error states verified; no console errors.
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| WebCodecs missing in the test browser | Use a Chromium build with it, and implement the server path for the rest. |
| A2F is down during testing | Wait and retry, using a real A2F response recorded from production earlier in the session for the sync tests. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
