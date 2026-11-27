# Design: a 3D face for NVIDIA's Nemotron Voice Agent blueprint

**Status:** planned, not built. Work order: [876](../../../prompts/finish/876-nvidia-26-voice-agent-blueprint-face.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

NVIDIA publishes a ready-made voice agent: you talk, it answers out loud. It has
no face. This build is a small add-on that anyone can apply to a clean copy of
that blueprint so the agent speaks through a three.ws avatar rendered in the
listener's own browser, with the mouth in sync with the audio.

## Why build it

- On 2026-11-26 NVIDIA's blueprint catalog had a voice agent and no
  digital-human or avatar blueprint at all
  ([research, agents](../../nvidia-showcase-research.md#agents-are-the-center-of-gravity)).
- NVIDIA's own digital-human reference ends in an Omniverse or Unreal renderer
  on a GPU server. Rendering in the visitor's browser tab is the part nobody on
  its partner list does, and it is what we do.
- We already ship the two plugins this needs. The build is mostly proving they
  fit and measuring the result.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| Pipecat plugin | [integrations/pipecat/pipecat-threews/](../../../integrations/pipecat/pipecat-threews) | Sends a voice pipeline's speech to a three.ws avatar |
| LiveKit plugin | [integrations/livekit/livekit-plugins-threews/](../../../integrations/livekit/livekit-plugins-threews) | The same for LiveKit agents |
| The avatar element | [src/element.js](../../../src/element.js) | `<agent-3d>`, including `speakAudio()` for a caller-supplied clip and lip sync from a live stream |
| Face and mouth | [src/voice/a2f-player.js](../../../src/voice/a2f-player.js), [src/voice/lipsync-driver.js](../../../src/voice/lipsync-driver.js) | Facial animation and the fallback mouth |

## What is not known yet

Read from the blueprint's repository in step 0: which framework it is built on,
its license, whether it runs against hosted NVIDIA endpoints or needs local
GPUs, and where its audio leaves the pipeline.

## Design

```
microphone -> NVIDIA voice agent blueprint (unmodified core)
                 speech recognition -> Nemotron -> speech
                                                    |
                              our plugin at the blueprint's supported extension point
                                                    |
                       browser page with <agent-3d>: plays the audio, moves the mouth and face
```

- **An overlay, not a fork.** A compose file, one pipeline module and one web
  page that a reader applies to a clean checkout. The blueprint's core files are
  not edited.
- **Use whichever of our plugins matches the blueprint's framework.** If the
  plugin lacks something, it is fixed in the plugin, with tests, so every user
  of the plugin benefits.
- **Sync is measured, not judged by eye.** The offset between the audio the
  listener hears and the mouth movement, over at least 30 utterances.
- **Any avatar.** A three.ws avatar or the reader's own GLB.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Blueprint unmodified | Runs against hosted NVIDIA endpoints (or a self-deleting GPU VM if it must be local); voice-to-voice latency measured |
| 2. Face added | Mouth, face and idle motion follow the agent's speech in a browser |
| 3. Measured | Audio-to-mouth offset, added latency, frame rate on a mid-range laptop and a phone |
| 4. Runnable by a stranger | `integrations/nvidia/nemotron-voice-agent/` with a one-command start, a verify script and tests using real audio from the real speech lane |
| 5. Evidence | A 30 to 60 second screen capture of a real conversation, stored in our bucket, with a transcript |
| 6. Write-up | Forum post draft in `docs/nvidia-voice-agent-face-post.md`, not posted |
| 7. Docs | `docs/nvidia-voice-agent-face.md`, changelog |

## The numbers it leaves behind

Audio-to-mouth offset (median and 95th percentile), the latency the face adds to
the unmodified blueprint, and browser frame rate on two devices.

## Cost

No new service. The avatar renders on the visitor's device. A throwaway GPU VM
only if the blueprint cannot use hosted endpoints, and it deletes itself.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| The blueprint is built on a framework neither plugin covers | Write the thinnest bridge from its audio output to the avatar's existing audio input, and say so |
| The blueprint needs local GPUs we do not have on hand | A self-deleting GPU VM in the pre-approved project |
| Sync drifts on slow devices | Reported per device. The fix belongs in the player, test-first. |

## Owner steps

Push. Post the prepared forum write-up. Posting is always the owner's step.

## What we can say, and when

The blueprint is something we integrate with, not something running in our
production. The honest sentence: "NVIDIA's voice agent blueprint with a face
that renders in the browser", with the measured sync and the code link. No
NVIDIA logo or mark is added to the video.
