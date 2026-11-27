# nvidia 19: Audio2Face-3D emotion drives the whole face and head, and the agent can choose how a line should feel

Status 2026-11-16: code complete and verified locally (all three rig kinds, emotion on and off, one pass, 0 console errors; clips in docs/media/). Not archived: full `npm test` and `npm run audit:docs` fail only in other orders' files, and the feature stays under evaluation until the owner runs `git push threews main` and `npm run deploy:gcp:full`.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3269.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](../finish/_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The browser digital human lip-syncs from Audio2Face-3D blendshapes, but emotion barely reaches the face and the agent cannot say how a line should feel. Audio2Face-3D supports emotion input and emotion-aware output. Brows, eyes and head motion that match the words, and an agent that sounds and looks happy when it says something happy, are the difference between a talking mask and a digital human.

## Step 0: re-derive the current state

    grep -n "emotion\|audio_with_emotion\|blend_shape\|BlendShape" api/_lib/a2f-nvidia.js | head -30
    grep -n "emotion\|expression\|mood" src/voice/a2f-player.js | head -20
    grep -rln "mood" src | head

Read NVIDIA's current Audio2Face-3D API docs for emotion parameters (emotion input, emotion strength, post-processing) and the emotion values in the output stream. Capture one real A2F response from production with emotion output enabled and keep it as a test fixture.

## Tasks

1. **Request and consume emotion**: enable emotion output and parse it alongside blendshapes in [api/_lib/a2f-nvidia.js](../../api/_lib/a2f-nvidia.js).
2. **Map beyond the mouth**: emotion to brows, eyes, cheeks and subtle head nod and tilt, blended with idle animation, for ARKit, VRM expression and Oculus viseme rigs, with per-rig tuning.
3. **Agent intent**: the agent's reply carries an intended emotion (from its mood state or a structured field in the reply) passed to A2F as emotion input so the delivery matches the words.
4. **Controls** on the demo page and the agent embed: emotion strength and an off switch.
5. **Tests** on the mapping and blending with the captured fixture; browser verification on one avatar per rig type.
6. **Docs** ([docs/nvidia-forum-browser-digital-human.md](../../docs/nvidia-forum-browser-digital-human.md) follow-up notes, embed docs), changelog entry, and a side-by-side clip for the owner.

## Definition of done

- [ ] Emotion values parsed from a real production A2F response (fixture committed).
- [ ] Three rig types verified in the browser with emotion on and off (screenshots or clip paths), no console errors.
- [ ] `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The hosted A2F function does not return emotion | Record it; derive expression from the agent's intended emotion only and note the gap. |
| A rig has no brow or eye morphs | Drive head and eye bones where present, and skip what the rig cannot show. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](../finish/_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
