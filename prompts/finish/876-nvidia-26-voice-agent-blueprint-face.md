# nvidia 26: NVIDIA's Nemotron Voice Agent blueprint gets a 3D face that renders in the visitor's browser, as a tested example anyone can run

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3276 (`npm run dev -- --port 3276 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, any pull request or post on an NVIDIA property, the Inception portal edit, publishing the demo clip) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **Facial animation lanes are not changed here.** This order consumes the avatar and lip-sync stack as it exists (`src/voice/`, the `<agent-3d>` component, the Pipecat and LiveKit plugins). If the hosted Audio2Face lane is down, the example uses whatever the existing stack falls back to and says so.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

On 2026-11-26 NVIDIA's blueprint catalog (`build.nvidia.com/blueprints`, source in the `NVIDIA-AI-Blueprints` GitHub organization) included a Nemotron Voice Agent blueprint for real-time voice agents, and no digital-human or avatar blueprint at all. NVIDIA's own digital-human reference pipeline ends in an Omniverse or Unreal renderer on a server. three.ws renders a talking 3D avatar in the visitor's browser and already ships plugins for the two common voice-agent frameworks: `integrations/pipecat/pipecat-threews` and `integrations/livekit/livekit-plugins-threews`. A working example that gives NVIDIA's voice agent a face, with nothing to install on the viewer's side, fills a gap in their catalog with something only we do.

What is NOT known and must be read from the repository: which framework the blueprint is built on, its license, whether it can run against hosted NVIDIA endpoints or needs local GPUs, and where its audio leaves the pipeline.

## Step 0: re-derive the current state

    ls integrations/pipecat/pipecat-threews integrations/livekit/livekit-plugins-threews
    sed -n 1,80p integrations/pipecat/pipecat-threews/README.md
    sed -n 1,80p integrations/livekit/livekit-plugins-threews/README.md
    grep -n "export\|class " src/voice/a2f-player.js | head -30
    grep -rn -i "voice agent\|nemotron-voice" --include=*.md docs integrations 2>/dev/null | head
    curl -s https://three.ws/api/nvidia/stats | head -c 4000; echo

Find the blueprint's repository in the `NVIDIA-AI-Blueprints` organization and clone it into your session scratch directory. Read its README, license, architecture diagram and deployment options end to end. Write down the framework, the speech models and how they are reached, the transport to the browser, and the supported way to add a processor or output to the pipeline. Then read whichever of our two plugins matches that framework, and run its own tests so you know it works before you build on it.

## Tasks

1. **Run the blueprint unmodified first.** Against hosted NVIDIA endpoints on the key we already use if the blueprint supports that; otherwise on a GCE GPU VM in the pre-approved project that deletes itself. Record versions, commands and the measured voice-to-voice latency.
2. **Add the face.** Using the blueprint's supported extension point and our existing plugin, send the agent's speech to a three.ws avatar in a browser page so the mouth, face and idle motion follow the audio the listener hears, in sync. No fork of the blueprint's core files: the example is an overlay (a compose file, a pipeline module, a web page) that a reader applies to a clean checkout. If our plugin is missing something the blueprint needs, add it to the plugin test-first and bump its version per its README.
3. **Measure it.** Audio-to-mouth offset (median and 95th percentile over at least 30 utterances, measured, not judged by eye), the latency the face adds to the unmodified blueprint, and the browser frame rate on a mid-range laptop and a phone.
4. **Make it runnable by a stranger.** `integrations/nvidia/nemotron-voice-agent/`: a README with prerequisites, a one-command start, how to choose an avatar (any three.ws avatar or the visitor's own GLB), troubleshooting from errors you actually hit, and a script that verifies a setup. A test under `tests/` or the plugin's suite covers the new pipeline module with real audio fixtures generated by the real speech lane.
5. **Record evidence.** A 30 to 60 second screen capture of a real conversation, stored in our bucket (not committed), linked from the README, with a transcript. No NVIDIA logo or mark added to the video.
6. **Prepare the write-up, do not post it.** A technical forum post draft at `docs/nvidia-voice-agent-face-post.md` in the shape of our approved forum posts (see "What the approved posts have in common" in `docs/nvidia-visibility-map.md`): the problem, the architecture, the measured numbers, the code link. No token, price or monetization vocabulary.
7. **Docs.** A developer doc at `docs/nvidia-voice-agent-face.md`, a `STRUCTURE.md` row, `docs/nvidia-models.md` if a new NVIDIA model is exercised, and a `data/changelog.json` entry (then `npm run build:pages`). The blueprint is listed as something we integrate with, not as running in our production.

## Definition of done

- [ ] The unmodified blueprint ran and its baseline latency is recorded.
- [ ] A real spoken conversation drives a three.ws avatar's face in a browser with measured sync, on a laptop and a phone, with no console errors.
- [ ] The example applies to a clean checkout of the blueprint with one command, verified by the verify script on a fresh directory.
- [ ] Offset, added latency and frame rate numbers are in the doc.
- [ ] The capture exists in the bucket; the post draft is in the repo; no secret is in any committed file.
- [ ] Plugin tests and `npm test` pass; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The blueprint only runs on local GPUs | Use a GCE GPU VM that deletes itself, record the machine type and the cost, and say in the README what a reader needs. |
| The blueprint uses a framework we have no plugin for | Build the thinnest adapter from that framework's audio output to the same avatar protocol our plugins speak, with tests, in the integration directory. |
| The blueprint has been renamed or replaced | Use its successor, record the old and new names, and continue. If no voice-agent blueprint exists any more, build the same example on NVIDIA's own Pipecat-based voice agent examples and say so. |
| The hosted Audio2Face lane is down during the demo | Use the stack's existing fallback lip-sync, say which path the capture shows, and do not change the lane order in this order. |
| No microphone on the devbox | Drive the conversation with recorded speech from the real speech lane fed in as the input stream. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, any pull request or post on an NVIDIA property, the Inception portal edit, publishing the demo clip); one-line judgment calls. No trailing questions.
